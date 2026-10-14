import type { Readable } from 'node:stream';
import type { Author } from '@latex-studio/git-store';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import type { User } from '../../users/domain/user';
import type { Project } from '../domain/project';
import type { ProjectRepository } from '../domain/project.repository';
import type { ProjectFiles, ProjectStorage } from '../domain/project-storage';

/** One multipart part, as yielded by `@fastify/multipart`'s `request.parts()`. */
export type UploadPart =
  | { type: 'field'; fieldname: string; value: unknown }
  | {
      type: 'file';
      fieldname: string;
      filename: string;
      file: Readable;
      toBuffer(): Promise<Buffer>;
    };

export const author = (user: User): Author => ({ name: user.name, email: user.email });

/**
 * Commits `paths` (every change when null) as `user`, with `Co-authored-by` for everyone else who
 * edited them collaboratively. `credit: false` (delete, restore: their text is gone) only clears
 * those records.
 */
export function commitAs(
  projects: ProjectRepository,
  files: ProjectFiles,
  projectId: string,
  user: User,
  message: string,
  paths: string[] | null,
  credit = true,
): Promise<string | null> {
  return projects.withEditors(projectId, paths, (editors) => {
    const co = credit ? editors.filter((e) => e.email !== user.email) : [];
    return paths
      ? files.repo.commitPaths(paths, message, author(user), co)
      : files.repo.commitAll(message, author(user), co);
  });
}

export const megabytes = (mb: number) => mb * 1024 * 1024;

const QUOTA_EXCEEDED = 'Project quota exceeded';

/** Per-file cap for the source scans (references, packages) that parse on the API event loop. */
export const MAX_SCAN_BYTES = 1024 * 1024;

/**
 * The project's files matching `re`, each up to MAX_SCAN_BYTES and 4 MB in all.
 * ponytail: files past the budget are skipped (in listing order); move the parsers to a worker
 * thread if large projects need every file scanned.
 */
export async function readSources(files: ProjectFiles, re: RegExp): Promise<Map<string, string>> {
  const sources = new Map<string, string>();
  let budget = 4 * MAX_SCAN_BYTES;
  for (const f of await files.repo.listFiles()) {
    if (f.size > MAX_SCAN_BYTES || f.size > budget || !re.test(f.path)) continue;
    budget -= f.size;
    sources.set(f.path, Buffer.from(await files.repo.readFile(f.path)).toString('utf8'));
  }
  return sources;
}

/** `.git`, `.gitignore`, ... anywhere in the path: SafePath rejects these, imports skip them. */
export const isGitPath = (path: string) =>
  path.split('/').some((s) => s.toLowerCase().startsWith('.git'));

/** Validates a user path, answering 400 instead of SafePath's plain Error. */
export function checkPath(files: ProjectFiles, path: string): void {
  // A repeated query parameter arrives as an array; refuse it before any string method runs.
  if (typeof path !== 'string') throw new BadRequestException('Invalid path');
  try {
    files.safe.resolve(path);
  } catch {
    throw new BadRequestException(`Invalid path: ${path}`);
  }
}

/** True if `path` exists (file or folder) inside the project, following symlinks safely. */
export async function pathExists(files: ProjectFiles, path: string): Promise<boolean> {
  checkPath(files, path);
  try {
    await files.safe.resolveExisting(path);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new BadRequestException(`Invalid path: ${path}`);
  }
}

/** Working tree (except `replacing`, a file about to be overwritten) plus history bytes. */
export async function usedBytes(files: ProjectFiles, replacing?: string): Promise<number> {
  const tree = (await files.repo.listFiles())
    .filter((f) => f.path !== replacing)
    .reduce((sum, f) => sum + f.size, 0);
  // History too: every save adds objects, and a quota on the working tree alone never fills.
  return tree + (await files.repo.storedBytes());
}

/** 413 unless `incomingBytes` more fit in the project quota (see usedBytes). */
export async function assertQuota(
  files: ProjectFiles,
  quotaBytes: number,
  incomingBytes: number,
  replacing?: string,
) {
  if ((await usedBytes(files, replacing)) + incomingBytes > quotaBytes) {
    throw new PayloadTooLargeException(QUOTA_EXCEEDED);
  }
}

export const accountQuotaExceeded = (mb?: number) =>
  new PayloadTooLargeException(`Cota de armazenamento da conta excedida (${mb} MB)`);

/**
 * Bytes the owner of `project` may still store under USER_QUOTA_MB (`mb`), counted over every
 * project they own: what collaborators write counts against the owner. Infinity when `mb` is
 * unset. `replacing` is a file of `project` about to be overwritten.
 * ponytail: rescans every owned project on each write (tree walk; storedBytes is cached 30 s),
 * and writes to two projects of one owner can pass at once (the lock is per project). Fine at
 * 50 MB; keep a usage column on users, updated on write, if owners hold many or large projects.
 */
export async function accountRoom(
  projects: ProjectRepository,
  storage: ProjectStorage,
  mb: number | undefined,
  project: Pick<Project, 'id' | 'ownerId'>,
  replacing?: string,
): Promise<number> {
  if (!mb) return Number.POSITIVE_INFINITY;
  let left = megabytes(mb);
  for (const id of await projects.ownedIds(project.ownerId)) {
    // A project whose folder is gone (being deleted right now) holds nothing; it must not turn
    // every write of its owner into a 500.
    left -= await usedBytes(storage.open(id), id === project.id ? replacing : undefined).catch(
      (e: { code?: string }) => {
        if (e.code === 'ENOENT') return 0;
        throw e;
      },
    );
  }
  return left;
}

/** 413 unless `incomingBytes` more fit in the owner's account quota (see accountRoom). */
export async function assertAccountQuota(
  projects: ProjectRepository,
  storage: ProjectStorage,
  mb: number | undefined,
  project: Pick<Project, 'id' | 'ownerId'>,
  incomingBytes: number,
  replacing?: string,
) {
  if (incomingBytes > (await accountRoom(projects, storage, mb, project, replacing))) {
    throw accountQuotaExceeded(mb);
  }
}

/**
 * Passes chunks through and throws `tooLarge(message)` once `budget.left` bytes are exceeded
 * (413 by default).
 */
export async function* limitBytes(
  source: AsyncIterable<Uint8Array>,
  budget: { left: number },
  tooLarge: (message: string) => Error = (m) => new PayloadTooLargeException(m),
) {
  for await (const chunk of source) {
    budget.left -= chunk.length;
    if (budget.left < 0) throw tooLarge(QUOTA_EXCEEDED);
    yield chunk;
  }
  // Over MAX_UPLOAD_MB, busboy ends the stream normally with `truncated` set and multipart only
  // raises its error on the next part; fail here so the truncated file is never renamed in.
  if ((source as { truncated?: boolean }).truncated) throw tooLarge('File too large');
}
