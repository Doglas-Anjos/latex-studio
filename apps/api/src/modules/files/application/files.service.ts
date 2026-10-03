import { APP_CONFIG, type AppConfig } from '@latex-studio/core';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DOCUMENT_SYNC, type DocumentSync } from '../../collab/domain/document-sync';
import {
  assertQuota,
  author,
  checkPath,
  limitBytes,
  megabytes,
  pathExists,
  type UploadPart,
} from '../../projects/application/project-files';
import { ProjectLock } from '../../projects/application/project-lock';
import type { Project } from '../../projects/domain/project';
import {
  PROJECT_STORAGE,
  type ProjectFiles,
  type ProjectStorage,
} from '../../projects/domain/project-storage';
import type { User } from '../../users/domain/user';

/** The file at `path`, or every file under the folder `path`. */
async function filesUnder(files: ProjectFiles, path: string) {
  return (await files.repo.listFiles()).filter(
    (f) => f.path === path || f.path.startsWith(`${path}/`),
  );
}

/** Every mutation runs under the project lock: git index, quota and exists-checks stay consistent. */
@Injectable()
export class FilesService {
  constructor(
    @Inject(PROJECT_STORAGE) private readonly storage: ProjectStorage,
    @Inject(ProjectLock) private readonly lock: ProjectLock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DOCUMENT_SYNC) private readonly sync: DocumentSync,
  ) {}

  private get quota() {
    return megabytes(this.config.PROJECT_QUOTA_MB);
  }

  list(project: Project): Promise<Array<{ path: string; size: number }>> {
    return this.storage.open(project.id).repo.listFiles();
  }

  async read(project: Project, path: string): Promise<Uint8Array> {
    const files = this.storage.open(project.id);
    if (!(await pathExists(files, path))) throw new NotFoundException('File not found');
    try {
      return await files.repo.readFile(path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EISDIR') throw new NotFoundException('Not a file');
      throw e;
    }
  }

  create(project: Project, user: User, path: string, content = ''): Promise<void> {
    return this.lock.run(project.id, async () => {
      const files = this.storage.open(project.id);
      if (await pathExists(files, path)) throw new ConflictException(`${path} already exists`);
      await assertQuota(files, this.quota, Buffer.byteLength(content));
      await files.write(path, content);
      await files.repo.commitAll(`Create ${path}`, author(user));
    });
  }

  update(project: Project, user: User, path: string, content: string): Promise<void> {
    return this.lock.run(project.id, async () => {
      const files = this.storage.open(project.id);
      checkPath(files, path);
      if (!(await files.isFile(path))) throw new NotFoundException('File not found');
      await assertQuota(files, this.quota, Buffer.byteLength(content), path);
      await files.write(path, content);
      await files.repo.commitAll(`Update ${path}`, author(user));
      await this.sync.replaceText(project.id, path, content);
    });
  }

  /** Deletes a file, or every file under a folder. */
  remove(project: Project, user: User, path: string): Promise<void> {
    return this.lock.run(project.id, async () => {
      const files = this.storage.open(project.id);
      checkPath(files, path);
      const targets = await filesUnder(files, path);
      if (targets.length === 0) throw new NotFoundException('File not found');
      // ponytail: emptied folders stay on disk; listFiles and git ignore them.
      for (const f of targets) {
        // Refuses a path whose parent folder is a symlink leading outside the project.
        await files.safe.resolveExisting(f.path).catch(() => {
          throw new BadRequestException(`Invalid path: ${f.path}`);
        });
        await files.repo.deleteFile(f.path);
      }
      await files.repo.commitAll(`Delete ${path}`, author(user));
      for (const f of targets) await this.sync.forget(project.id, f.path);
    });
  }

  rename(project: Project, user: User, from: string, to: string): Promise<void> {
    return this.lock.run(project.id, async () => {
      const files = this.storage.open(project.id);
      if (!(await pathExists(files, from))) throw new NotFoundException(`${from} not found`);
      if (await pathExists(files, to)) throw new ConflictException(`${to} already exists`);
      if (to.startsWith(`${from}/`)) {
        throw new BadRequestException('Cannot move a folder into itself');
      }
      const moved = await filesUnder(files, from);
      await files.rename(from, to);
      await files.repo.commitAll(`Rename ${from} → ${to}`, author(user));
      // The new path loads from disk on first open.
      for (const f of moved) await this.sync.forget(project.id, f.path);
    });
  }

  createFolder(project: Project, user: User, path: string): Promise<void> {
    return this.lock.run(project.id, async () => {
      const files = this.storage.open(project.id);
      if (await pathExists(files, path)) throw new ConflictException(`${path} already exists`);
      await assertQuota(files, this.quota, 0);
      await files.write(`${path}/.gitkeep`, '');
      await files.repo.commitAll(`Create folder ${path}`, author(user));
    });
  }

  /**
   * Multipart upload: an optional `path` field (target folder, sent before the files), then files
   * whose filenames are paths relative to that folder. Existing files are overwritten.
   */
  upload(project: Project, user: User, parts: AsyncIterable<UploadPart>): Promise<string[]> {
    return this.lock.run(project.id, async () => {
      const files = this.storage.open(project.id);
      const used = (await files.repo.listFiles()).reduce((sum, f) => sum + f.size, 0);
      const budget = { left: this.quota - used };
      let folder = '';
      const written = new Set<string>();
      const created: string[] = [];
      try {
        for await (const part of parts) {
          if (part.type === 'field') {
            if (part.fieldname === 'path') folder = String(part.value);
            continue;
          }
          const path = folder ? `${folder}/${part.filename}` : part.filename;
          try {
            checkPath(files, path);
          } catch (e) {
            part.file.resume();
            throw e;
          }
          const existed = await files.isFile(path);
          await files.writeStream(path, limitBytes(part.file, budget));
          written.add(path);
          if (!existed) created.push(path);
        }
      } catch (e) {
        // Only new files are rolled back: an overwritten file keeps its new, complete content
        // rather than disappearing from the working tree.
        for (const path of created) await files.repo.deleteFile(path).catch(() => {});
        throw e;
      }
      if (written.size === 0) throw new BadRequestException('No files uploaded');
      await files.repo.commitAll(`Upload ${written.size} files`, author(user));
      return [...written];
    });
  }
}
