import { basename } from 'node:path/posix';
import { APP_CONFIG, type AppConfig } from '@latex-studio/core';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { DOCUMENT_SYNC, type DocumentSync } from '../../collab/domain/document-sync';
import {
  assertAccountQuota,
  assertQuota,
  checkPath,
  commitAs,
  megabytes,
} from '../../projects/application/project-files';
import { ProjectLock } from '../../projects/application/project-lock';
import type { Project } from '../../projects/domain/project';
import {
  PROJECT_REPOSITORY,
  type ProjectRepository,
} from '../../projects/domain/project.repository';
import { PROJECT_STORAGE, type ProjectStorage } from '../../projects/domain/project-storage';
import type { User } from '../../users/domain/user';

const SHA = /^[0-9a-f]{40}$/;

function checkSha(sha: string): void {
  if (!SHA.test(sha)) throw new BadRequestException('Invalid commit sha');
}

// The `<e-mail>` of each Co-authored-by trailer (the name stays).
const TRAILER_EMAIL = /^(Co-authored-by: [^<\n]*?) ?<[^>\n]*>$/gim;
const withoutEmails = (message: string) => message.replace(TRAILER_EMAIL, '$1');
/**
 * A commit as the API serves it: authors by name only. Like the member list (e-mails for the owner
 * only), every viewer reads the history, so e-mails stay in git and leave only in the owner's zip.
 */
function byName<T extends { author: { name: string }; message: string }>(c: T) {
  return { ...c, author: { name: c.author.name }, message: withoutEmails(c.message) };
}

@Injectable()
export class HistoryService {
  constructor(
    @Inject(PROJECT_STORAGE) private readonly storage: ProjectStorage,
    @Inject(ProjectLock) private readonly lock: ProjectLock,
    @Inject(DOCUMENT_SYNC) private readonly sync: DocumentSync,
    @Inject(APP_CONFIG)
    private readonly config: Pick<
      AppConfig,
      'PROJECT_QUOTA_MB' | 'USER_QUOTA_MB' | 'MAX_UPLOAD_MB'
    >,
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
  ) {}

  async log(project: Project, limit = 50) {
    return (await this.storage.open(project.id).repo.log(limit)).map(byName);
  }

  /** Commits that touched `path`, newest first. */
  fileLog(project: Project, path: string, limit = 50) {
    const files = this.storage.open(project.id);
    if (!path) throw new BadRequestException('Missing path');
    checkPath(files, path);
    return files.repo.fileLog(path, limit).then((commits) => commits.map(byName));
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
    // Nothing bigger than an upload enters the tree, so every version stays readable.
    const max = this.config.MAX_UPLOAD_MB;
    const content = await files.repo.readFileAt(sha, path, megabytes(max)).catch((e: Error) => {
      if (e.message === 'File too large') throw new PayloadTooLargeException(`File over ${max} MB`);
      throw e;
    });
    if (!content) throw new NotFoundException('File not found in that commit');
    return content;
  }

  /** Working-tree changes not yet committed. */
  async status(project: Project) {
    const repo = this.storage.open(project.id).repo;
    const [base] = await repo.log(1);
    const changes = await repo.workingChanges(base?.sha ?? null);
    return {
      baseline: base
        ? { sha: base.sha, message: withoutEmails(base.message), date: base.date }
        : null,
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
      const { commits, lines } = await files.repo.blame(path);
      const named = Object.fromEntries(Object.entries(commits).map(([sha, c]) => [sha, byName(c)]));
      return { commits: named, lines };
    } catch (e) {
      if ((e as Error).message === 'File too large to blame') throw new PayloadTooLargeException();
      if ((e as { code?: string }).code === 'ENOENT') throw new NotFoundException('File not found');
      throw e;
    }
  }

  /** Named commit ("Salvar versão"). */
  commit(
    project: Project,
    user: User,
    message: string,
    paths?: string[],
  ): Promise<{ sha: string }> {
    if (message.length < 1 || message.length > 200 || /\p{Cc}/u.test(message)) {
      throw new BadRequestException('Invalid commit message');
    }
    const files = this.storage.open(project.id);
    for (const path of paths ?? []) checkPath(files, path);
    return this.lock.run(project.id, async () => {
      if (paths?.length === 0) throw new BadRequestException('Select at least one file');
      // Open docs may hold edits younger than the 2-10s store debounce.
      if (!paths) await this.sync.flushProject(project.id);
      for (const path of paths ?? []) await this.sync.flush(project.id, path);
      const sha = await commitAs(this.projects, files, project.id, user, message, paths ?? null)
        // A selected path that is now a folder is the request's fault, not a server error.
        .catch((e: { code?: string }) => {
          if (e.code === 'EISDIR') throw new BadRequestException('Not a file');
          throw e;
        });
      if (!sha) throw new ConflictException('Nothing to commit');
      return { sha };
    });
  }

  /** Commits only `path` ("Ctrl+S" on a single file), with a default message. */
  async commitFile(
    project: Project,
    user: User,
    path: string,
    message?: string,
  ): Promise<{ sha: string }> {
    const trimmed = (message ?? '').trim();
    return this.commit(project, user, trimmed || `Update ${basename(path)}`.slice(0, 200), [path]);
  }

  /** Writes the file as it was at `sha`, commits it and patches its open Y.Doc as a diff. */
  async restore(project: Project, user: User, sha: string, path: string): Promise<{ sha: string }> {
    const content = await this.fileAt(project, sha, path);
    return this.lock.run(project.id, async () => {
      const files = this.storage.open(project.id);
      await assertQuota(files, megabytes(this.config.PROJECT_QUOTA_MB), content.byteLength, path);
      const mb = this.config.USER_QUOTA_MB;
      await assertAccountQuota(this.projects, this.storage, mb, project, content.byteLength, path);
      await files.write(path, content);
      const message = `Restore ${path} from ${sha.slice(0, 7)}`;
      const created = await commitAs(
        this.projects,
        files,
        project.id,
        user,
        message,
        [path],
        false,
      );
      if (!created) throw new ConflictException('File already matches that version');
      // Binary files have no doc; replaceText then only drops a missing yjs_docs row.
      await this.sync.replaceText(project.id, path, Buffer.from(content).toString('utf8'));
      return { sha: created };
    });
  }
}
