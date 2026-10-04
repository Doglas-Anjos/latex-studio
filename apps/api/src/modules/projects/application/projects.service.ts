import { randomUUID } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '@latex-studio/core';
import {
  detectEngine,
  findMainFile,
  type PackageManifest,
  parseManifest,
  renderPackagesTex,
} from '@latex-studio/latex-tools';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { User } from '../../users/domain/user';
import {
  type Project,
  type ProjectEngine,
  type ProjectWithRole,
  parseProjectName,
} from '../domain/project';
import {
  PROJECT_REPOSITORY,
  type ProjectPatch,
  type ProjectRepository,
} from '../domain/project.repository';
import { PROJECT_STORAGE, type ProjectFiles, type ProjectStorage } from '../domain/project-storage';
import {
  author,
  checkPath,
  isGitPath,
  limitBytes,
  megabytes,
  type UploadPart,
} from './project-files';
import { ProjectLock } from './project-lock';
import { extractZip } from './zip-import';

const MANIFEST = 'latex-packages.json';
const MAX_MANIFEST_BYTES = 256 * 1024;
/** \documentclass sits in the preamble; no need to read whole files to find it. */
const MAIN_FILE_SCAN_BYTES = 64 * 1024;

const MAIN_TEMPLATE = `\\documentclass{article}
\\input{latex-packages}

\\title{Untitled}
\\begin{document}
\\maketitle

\\end{document}
`;

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    @Inject(PROJECT_STORAGE) private readonly storage: ProjectStorage,
    @Inject(ProjectLock) private readonly lock: ProjectLock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(AuditService) private readonly audit?: AuditService,
  ) {}

  create(owner: User, name: string): Promise<Project> {
    return this.createWith(owner, name, async (files) => {
      await files.repo.writeFile('main.tex', MAIN_TEMPLATE);
      await files.repo.writeFile(MANIFEST, '[]\n');
      await files.repo.writeFile('latex-packages.tex', renderPackagesTex([]));
      return 'Initial commit';
    });
  }

  /**
   * The repository is written and committed before the row exists, so no row lacks a repo.
   * `seed` fills the working tree and returns the commit message.
   */
  async createWith(
    owner: User,
    name: string,
    seed: (files: ProjectFiles) => Promise<string>,
    mainFile?: string,
  ): Promise<Project> {
    await this.assertProjectCap(owner);
    const id = randomUUID();
    try {
      const files = await this.storage.init(id);
      await files.repo.commitAll(await seed(files), author(owner));
      return await this.projects.create({ id, name, ...(mainFile && { mainFile }) }, owner.id);
    } catch (e) {
      await this.storage.remove(id);
      throw e;
    }
  }

  /**
   * Multipart import: a `name` field first, then either one `archive` (.zip) or several `files`
   * whose filenames are paths relative to the project root.
   */
  async import(owner: User, parts: AsyncIterable<UploadPart>): Promise<Project> {
    await this.assertProjectCap(owner);
    const id = randomUUID();
    return this.lock.run(id, async () => {
      const quota = megabytes(this.config.PROJECT_QUOTA_MB);
      const budget = { left: quota };
      let name: string | null = null;
      let files: ProjectFiles | undefined;
      let mode: 'archive' | 'files' | undefined;
      try {
        for await (const part of parts) {
          if (part.type === 'field') {
            if (part.fieldname === 'name') {
              name = parseProjectName(part.value);
              if (!name) throw new BadRequestException('Invalid project name');
            }
            continue;
          }
          if (!name) throw new BadRequestException('Send the "name" field before the files');
          files ??= await this.storage.init(id);
          if (part.fieldname === 'archive' && !mode) {
            mode = 'archive';
            await extractZip(await part.toBuffer(), files, quota);
          } else if (part.fieldname === 'files' && mode !== 'archive') {
            mode = 'files';
            // Folder uploads include .git and .gitignore; drop them like the zip import does.
            if (isGitPath(part.filename)) {
              part.file.resume();
              continue;
            }
            checkPath(files, part.filename);
            await files.writeStream(part.filename, limitBytes(part.file, budget));
          } else {
            throw new BadRequestException('Send one "archive" or several "files"');
          }
        }
        if (!name || !files) throw new BadRequestException('Send a "name" and at least one file');
        const { mainFile, engine } = await finishImport(files);
        await files.repo.commitAll('Import', author(owner));
        return await this.projects.create(
          { id, name, mainFile, ...(engine && { engine }) },
          owner.id,
        );
      } catch (e) {
        await this.storage.remove(id);
        throw e;
      }
    });
  }

  /** Engine and main file; the main file must exist in the working tree. */
  async update(project: Project, user: User, patch: ProjectPatch): Promise<Project> {
    if (patch.mainFile !== undefined) {
      const files = this.storage.open(project.id);
      checkPath(files, patch.mainFile);
      if (!(await files.isFile(patch.mainFile))) throw new NotFoundException('Main file not found');
    }
    const updated = await this.projects.update(project.id, patch);
    await this.audit?.record(user.id, 'project.update', project.id, patch);
    return updated;
  }

  listForUser(user: User): Promise<ProjectWithRole[]> {
    return this.projects.listForUser(user.id);
  }

  async remove(project: Project, user: User): Promise<void> {
    if ((await this.projects.roleOf(project.id, user.id)) !== 'owner') {
      throw new ForbiddenException('Only the owner can delete a project');
    }
    await this.projects.delete(project.id);
    await this.storage.remove(project.id);
    await this.audit?.record(user.id, 'project.delete', project.id, { name: project.name });
  }

  private async assertProjectCap(owner: User) {
    if ((await this.projects.countForUser(owner.id)) >= this.config.MAX_PROJECTS_PER_USER) {
      throw new ConflictException('Project limit reached');
    }
  }
}

/** Validates the root manifest, (re)generates latex-packages.tex, returns the main file. */
async function finishImport(
  files: ProjectFiles,
): Promise<{ mainFile: string; engine: ProjectEngine | null }> {
  const list = await files.repo.listFiles();
  const root = list.find((f) => f.path === MANIFEST);
  let manifest: PackageManifest = [];
  if (root) {
    if (root.size > MAX_MANIFEST_BYTES) throw new BadRequestException(`${MANIFEST} is too large`);
    try {
      manifest = parseManifest((await files.readHead(MANIFEST, MAX_MANIFEST_BYTES)).toString());
    } catch (e) {
      throw new BadRequestException(`${MANIFEST}: ${(e as Error).message}`);
    }
  } else {
    await files.write(MANIFEST, '[]\n');
  }
  await files.write('latex-packages.tex', renderPackagesTex(manifest));

  const tex = list.filter((f) => f.path.endsWith('.tex')).map((f) => f.path);
  const candidates = tex.includes('main.tex') ? ['main.tex', ...tex] : tex;
  for (const path of candidates) {
    const head = (await files.readHead(path, MAIN_FILE_SCAN_BYTES)).toString();
    if (findMainFile([[path, head]])) return { mainFile: path, engine: detectEngine(head) };
  }
  return { mainFile: 'main.tex', engine: null };
}
