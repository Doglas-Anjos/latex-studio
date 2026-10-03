import type { Readable } from 'node:stream';
import type { SafePath } from '@latex-studio/core';
import type { GitRepository } from '@latex-studio/git-store';

export const PROJECT_STORAGE = Symbol('PROJECT_STORAGE');

/**
 * `write`, `writeStream` and `rename` validate paths with `safe`, refuse parents that resolve
 * outside the project through a symlink, and go through a temp file + rename, so a failed write
 * never leaves a truncated file behind. Use them for user content instead of `repo.writeFile`.
 */
export interface ProjectFiles {
  safe: SafePath;
  repo: GitRepository;
  write(path: string, content: string | Uint8Array): Promise<void>;
  writeStream(path: string, source: Readable | AsyncIterable<Uint8Array>): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** True for a regular file (not a folder or symlink). */
  isFile(path: string): Promise<boolean>;
  /** At most the first `maxBytes` of a file. */
  readHead(path: string, maxBytes: number): Promise<Buffer>;
}

export interface ProjectStorage {
  init(projectId: string): Promise<ProjectFiles>;
  open(projectId: string): ProjectFiles;
  remove(projectId: string): Promise<void>;
}
