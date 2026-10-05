import { basename } from 'node:path/posix';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { DOCUMENT_SYNC, type DocumentSync } from '../../collab/domain/document-sync';
import { author, checkPath } from '../../projects/application/project-files';
import { ProjectLock } from '../../projects/application/project-lock';
import type { Project } from '../../projects/domain/project';
import { PROJECT_STORAGE, type ProjectStorage } from '../../projects/domain/project-storage';
import type { User } from '../../users/domain/user';

const SHA = /^[0-9a-f]{40}$/;

function checkSha(sha: string): void {
  if (!SHA.test(sha)) throw new BadRequestException('Invalid commit sha');
}

@Injectable()
export class HistoryService {
  constructor(
    @Inject(PROJECT_STORAGE) private readonly storage: ProjectStorage,
    @Inject(ProjectLock) private readonly lock: ProjectLock,
    @Inject(DOCUMENT_SYNC) private readonly sync: DocumentSync,
  ) {}

  log(project: Project, limit = 50) {
    return this.storage.open(project.id).repo.log(limit);
  }

  /** Commits that touched `path`, newest first. */
  fileLog(project: Project, path: string, limit = 50) {
    const files = this.storage.open(project.id);
    if (!path) throw new BadRequestException('Missing path');
    checkPath(files, path);
    return files.repo.fileLog(path, limit);
  }

  changes(project: Project, fromSha: string, toSha: string) {
    checkSha(fromSha);
    checkSha(toSha);
    return this.storage.open(project.id).repo.changedFiles(fromSha, toSha);
  }

  async fileAt(project: Project, sha: string, path: string): Promise<Uint8Array> {
    checkSha(sha);
    const files = this.storage.open(project.id);
    checkPath(files, path);
    const content = await files.repo.readFileAt(sha, path);
    if (!content) throw new NotFoundException('File not found in that commit');
    return content;
  }

  async status(project: Project) {
    const repo = this.storage.open(project.id).repo;
    const base = await repo.baseline();
    const changes = await repo.workingChanges(base?.sha ?? null);
    return {
      baseline: base && { sha: base.sha, message: base.message, date: base.date },
      changes,
    };
  }

  // ponytail: recomputed per request; cache by HEAD sha + content hash if it shows up in profiles.
  async blame(project: Project, path: string) {
    const files = this.storage.open(project.id);
    if (!path) throw new BadRequestException('Missing path');
    checkPath(files, path);
    if (!(await files.isFile(path))) throw new NotFoundException('File not found');
    try {
      return await files.repo.blame(path);
    } catch (e) {
      if ((e as Error).message === 'File too large to blame') throw new PayloadTooLargeException();
      if ((e as { code?: string }).code === 'ENOENT') throw new NotFoundException('File not found');
      throw e;
    }
  }

  /** Named commit ("Salvar versão"). */
  commit(project: Project, user: User, message: string): Promise<{ sha: string }> {
    if (message.length < 1 || message.length > 200 || /\p{Cc}/u.test(message)) {
      throw new BadRequestException('Invalid commit message');
    }
    return this.lock.run(project.id, async () => {
      const sha = await this.storage.open(project.id).repo.commitAll(message, author(user));
      if (!sha) throw new ConflictException('Nothing to commit');
      return { sha };
    });
  }

  /**
   * Commits only `path` ("Ctrl+S" on a single file). Flushes the open Y.Doc to the working tree
   * first, so a just-typed edit is included despite Hocuspocus's 2-10s store debounce.
   */
  async commitFile(
    project: Project,
    user: User,
    path: string,
    message?: string,
  ): Promise<{ sha: string }> {
    const files = this.storage.open(project.id);
    checkPath(files, path);
    const trimmed = (message ?? '').trim();
    if (trimmed.length > 200 || /\p{Cc}/u.test(trimmed)) {
      throw new BadRequestException('Invalid commit message');
    }
    return this.lock.run(project.id, async () => {
      await this.sync.flush(project.id, path);
      const sha = await files.repo.commitPaths(
        [path],
        trimmed || `Update ${basename(path)}`,
        author(user),
      );
      if (!sha) throw new ConflictException('Nothing to commit');
      return { sha };
    });
  }

  /** Writes the file as it was at `sha`, commits it and patches its open Y.Doc as a diff. */
  async restore(project: Project, user: User, sha: string, path: string): Promise<{ sha: string }> {
    const content = await this.fileAt(project, sha, path);
    return this.lock.run(project.id, async () => {
      const files = this.storage.open(project.id);
      await files.write(path, content);
      const created = await files.repo.commitAll(
        `Restore ${path} from ${sha.slice(0, 7)}`,
        author(user),
      );
      if (!created) throw new ConflictException('File already matches that version');
      // Binary files have no doc; replaceText then only drops a missing yjs_docs row.
      await this.sync.replaceText(project.id, path, Buffer.from(content).toString('utf8'));
      return { sha: created };
    });
  }
}
