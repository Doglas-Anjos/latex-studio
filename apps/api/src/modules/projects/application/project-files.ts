import type { Readable } from 'node:stream';
import type { Author } from '@latex-studio/git-store';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import type { User } from '../../users/domain/user';
import type { ProjectFiles } from '../domain/project-storage';

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

export const megabytes = (mb: number) => mb * 1024 * 1024;

const QUOTA_EXCEEDED = 'Project quota exceeded';

/** `.git`, `.gitignore`, ... anywhere in the path: SafePath rejects these, imports skip them. */
export const isGitPath = (path: string) =>
  path.split('/').some((s) => s.toLowerCase().startsWith('.git'));

/** Validates a user path, answering 400 instead of SafePath's plain Error. */
export function checkPath(files: ProjectFiles, path: string): void {
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

/**
 * 413 unless `incomingBytes` more fit in the quota (the working tree is the usage). The size of
 * `replacing`, a file about to be overwritten, is not counted.
 */
export async function assertQuota(
  files: ProjectFiles,
  quotaBytes: number,
  incomingBytes: number,
  replacing?: string,
) {
  const used = (await files.repo.listFiles())
    .filter((f) => f.path !== replacing)
    .reduce((sum, f) => sum + f.size, 0);
  if (used + incomingBytes > quotaBytes) throw new PayloadTooLargeException(QUOTA_EXCEEDED);
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
