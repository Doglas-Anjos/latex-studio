import { cp, lstat, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { SafePath } from '@latex-studio/core';

/**
 * Copies the project's working tree into a fresh temp dir (caller removes it).
 * ponytail: O(project size) per job. Upgrade path: `git archive` of a commit or a CoW filesystem.
 */
export async function snapshotProject(reposDir: string, projectId: string): Promise<string> {
  const repoDir = new SafePath(reposDir).resolve(projectId);
  const tmp = await mkdtemp(join(tmpdir(), 'ls-build-'));
  await cp(repoDir, tmp, {
    recursive: true,
    // No top-level dot-entries (.git hooks, .texmf-*, .config, .cache) and no symlinks
    // (they could point outside the project).
    filter: async (src) =>
      !relative(repoDir, src).startsWith('.') && !(await lstat(src)).isSymbolicLink(),
  });
  return tmp;
}
