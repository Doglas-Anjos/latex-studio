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
  PayloadTooLargeException,
} from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { DOCUMENT_SYNC, type DocumentSync } from '../../collab/domain/document-sync';
import { LanService } from '../../lan/application/lan.service';
import type { User } from '../../users/domain/user';
import {
  type Project,
  type ProjectEngine,
  type ProjectWithRole,
  parseProjectName,
} from '../domain/project';
import {
  type NewProject,
  PROJECT_REPOSITORY,
  type ProjectListFilter,
  type ProjectPatch,
  type ProjectRepository,
} from '../domain/project.repository';
import { PROJECT_STORAGE, type ProjectFiles, type ProjectStorage } from '../domain/project-storage';
import {
  accountQuotaExceeded,
  accountRoom,
  assertAccountQuota,
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
const PROJECT_PAGE_SIZE = 10;

export interface ListProjectsOptions {
  limit?: number;
  filter?: ProjectListFilter;
  search?: string;
  cursor?: string;
}

export interface ListProjectsResult {
  items: ProjectWithRole[];
  total: number;
  nextCursor: string | null;
}

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
    // Optional only so tests that never delete can skip it; CollabModule always provides it.
    @Optional() @Inject(DOCUMENT_SYNC) private readonly sync?: DocumentSync,
    // Marks which listed projects are shared on the LAN, so the dashboard can tint them.
    @Optional() @Inject(LanService) private readonly lan?: LanService,
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
   * `seed` fills the working tree with about `bytes` and returns the commit message; an account
   * without room for those is refused before anything is written.
   */
  async createWith(
    owner: User,
    name: string,
    seed: (files: ProjectFiles) => Promise<string>,
    mainFile?: string,
    bytes = 0,
  ): Promise<Project> {
    await this.assertProjectCap(owner);
    const id = randomUUID();
    const mb = this.config.USER_QUOTA_MB;
    await assertAccountQuota(this.projects, this.storage, mb, { id, ownerId: owner.id }, bytes);
    try {
      const files = await this.storage.init(id);
      await files.repo.commitAll(await seed(files), author(owner));
      return await this.insertWithinQuota(owner, { id, name, ...(mainFile && { mainFile }) });
    } catch (e) {
      if (!(e as { rowKept?: boolean }).rowKept) await this.storage.remove(id);
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
      const mb = this.config.USER_QUOTA_MB;
      // Within the account's room too: an owner over the cap writes nothing before the 413
      // (insertWithinQuota still decides, with the history this import adds).
      const room = await accountRoom(this.projects, this.storage, mb, { id, ownerId: owner.id });
      const budget = { left: Math.min(quota, room) };
      // A file over MAX_UPLOAD_MB keeps its own message; only the budget means the account is full.
      const tooLarge =
        room < quota
          ? (m?: string) =>
              m === 'File too large' ? new PayloadTooLargeException(m) : accountQuotaExceeded(mb)
          : undefined;
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
            const maxFile = megabytes(this.config.MAX_UPLOAD_MB);
            await extractZip(await part.toBuffer(), files, budget.left, maxFile, tooLarge);
          } else if (part.fieldname === 'files' && mode !== 'archive') {
            mode = 'files';
            // NFC like the zip import: macOS sends decomposed names, which SafePath refuses.
            const path = part.filename.normalize('NFC');
            // Folder uploads include .git and .gitignore; drop them like the zip import does.
            if (isGitPath(path)) {
              part.file.resume();
              continue;
            }
            checkPath(files, path);
            await files.writeStream(path, limitBytes(part.file, budget, tooLarge));
          } else {
            throw new BadRequestException('Send one "archive" or several "files"');
          }
        }
        if (!name || !files) throw new BadRequestException('Send a "name" and at least one file');
        const { mainFile, engine } = await finishImport(files);
        await files.repo.commitAll('Import', author(owner));
        return await this.insertWithinQuota(owner, {
          id,
          name,
          mainFile,
          ...(engine && { engine }),
        });
      } catch (e) {
        if (!(e as { rowKept?: boolean }).rowKept) await this.storage.remove(id);
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

  async listForUser(user: User, options: ListProjectsOptions = {}): Promise<ListProjectsResult> {
    // A LAN guest owns and is a member of nothing, so the normal query is empty for them: list the
    // projects shared with them instead (always marked published, since access implies published).
    if (user.issuer === 'lan' && this.lan) {
      const ids = await this.lan.projectsFor(user.id);
      const found = await Promise.all(ids.map((id) => this.projects.findById(id)));
      const items = found
        .filter((p): p is Project => p !== null)
        .map((p) => ({ ...p, role: 'editor' as const, published: true }));
      return { items, total: items.length, nextCursor: null };
    }
    const limit = options.limit ?? PROJECT_PAGE_SIZE;
    const filter = options.filter ?? 'all';
    const search = foldSearch(options.search ?? '');
    const cursor = options.cursor ? decodeProjectCursor(options.cursor, filter, search) : null;
    const page = await this.projects.listPageForUser(user.id, { limit, filter, search, cursor });
    // Tag the ones published to the LAN so the dashboard can show them in a different colour.
    const published = this.lan ? new Set(await this.lan.listPublished()) : null;
    const items = published
      ? page.items.map((p) => ({ ...p, published: published.has(p.id) }))
      : page.items;
    return {
      items,
      total: page.total,
      nextCursor: page.next
        ? Buffer.from(JSON.stringify({ v: 1, ...page.next, filter, search })).toString('base64url')
        : null,
    };
  }

  async remove(project: Project, user: User): Promise<void> {
    if ((await this.projects.roleOf(project.id, user.id)) !== 'owner') {
      throw new ForbiddenException('Only the owner can delete a project');
    }
    await this.forceRemove(project, user);
  }

  /** Deletes without the owner check: for a platform superadmin governing any project. */
  async forceRemove(project: Project, actor: User): Promise<void> {
    await this.projects.delete(project.id);
    this.sync?.revoke(project.id);
    await this.storage.remove(project.id);
    await this.audit?.record(actor.id, 'project.delete', project.id, { name: project.name });
  }

  /**
   * Inserts the row of a project already written, then checks the owner's account quota with it
   * counted: concurrent imports and copies see each other's rows, so they cannot all pass on the
   * same room. A refusal deletes the row; the caller removes the directory.
   */
  private async insertWithinQuota(owner: User, project: NewProject): Promise<Project> {
    const row = await this.projects.create(project, owner.id);
    const mb = this.config.USER_QUOTA_MB;
    try {
      if ((await accountRoom(this.projects, this.storage, mb, row)) < 0) {
        throw accountQuotaExceeded(mb);
      }
      return row;
    } catch (e) {
      // If the row cannot go, the caller must keep the folder it names (`rowKept`): a project
      // without its repository is worse than one over the quota.
      await this.projects.delete(row.id).catch(() => Object.assign(e as object, { rowKept: true }));
      throw e;
    }
  }

  private async assertProjectCap(owner: User) {
    // A LAN guest (joined by PIN) may only edit the project shared with them: never create or import
    // its own on the host. The single chokepoint for both create and import, so neither can leak.
    if (owner.issuer === 'lan') throw new ForbiddenException('LAN guests cannot create projects');
    if ((await this.projects.ownedIds(owner.id)).length >= this.config.MAX_PROJECTS_PER_USER) {
      throw new ConflictException('Project limit reached');
    }
  }
}

function foldSearch(value: string): string {
  return value
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function decodeProjectCursor(raw: string, filter: ProjectListFilter, search: string) {
  try {
    if (raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error('Invalid encoding');
    // null or a non-object fails on `.v`, an invalid date throws in toISOString: both land in catch.
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const data = JSON.parse(json) as Record<string, unknown>;
    if (
      data.v !== 1 ||
      data.filter !== filter ||
      data.search !== search ||
      typeof data.updatedAt !== 'string' ||
      new Date(data.updatedAt).toISOString() !== data.updatedAt ||
      typeof data.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.id)
    ) {
      throw new Error('Invalid cursor');
    }
    return { updatedAt: data.updatedAt, id: data.id };
  } catch {
    throw new BadRequestException('Invalid or expired project cursor');
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
