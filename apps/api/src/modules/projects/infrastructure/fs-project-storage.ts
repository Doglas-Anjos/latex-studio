import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { APP_CONFIG, type AppConfig, SafePath } from '@latex-studio/core';
import { GitRepository } from '@latex-studio/git-store';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { ProjectFiles, ProjectStorage } from '../domain/project-storage';

@Injectable()
export class FsProjectStorage implements ProjectStorage {
  private readonly root: SafePath;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.root = new SafePath(config.REPOS_DIR);
  }

  async init(projectId: string): Promise<ProjectFiles> {
    const dir = this.root.resolve(projectId);
    return this.files(dir, await GitRepository.init(dir));
  }

  open(projectId: string): ProjectFiles {
    const dir = this.root.resolve(projectId);
    return this.files(dir, GitRepository.open(dir));
  }

  /** Deletes the repository and the project's compile outputs. */
  async remove(projectId: string): Promise<void> {
    await rm(this.root.resolve(projectId), { recursive: true, force: true });
    const builds = new SafePath(this.config.BUILDS_DIR).resolve(projectId);
    await rm(builds, { recursive: true, force: true });
  }

  private files(dir: string, repo: GitRepository): ProjectFiles {
    const safe = new SafePath(dir);
    // Temp files live under .git so listFiles, git status and the quota never see them.
    const tempDir = join(dir, '.git', 'tmp');

    /** mkdir -p the parent of `path`, then refuse it if a symlink leads it outside the project. */
    const parentInside = async (path: string) => {
      const target = safe.resolve(path);
      await mkdir(dirname(target), { recursive: true });
      const [realRoot, realParent] = await Promise.all([realpath(dir), realpath(dirname(target))]);
      if (realParent !== realRoot && !realParent.startsWith(realRoot + sep)) {
        throw new BadRequestException('Invalid path');
      }
      return target;
    };

    const writeStream: ProjectFiles['writeStream'] = async (path, source) => {
      const target = await parentInside(path);
      await mkdir(tempDir, { recursive: true });
      const temp = join(tempDir, randomUUID());
      try {
        await pipeline(source, createWriteStream(temp, { flags: 'wx' }));
        await rename(temp, target);
      } catch (e) {
        await rm(temp, { force: true });
        throw e;
      }
    };

    return {
      safe,
      repo,
      writeStream,
      write: (path, content) => writeStream(path, Readable.from([content])),
      async isFile(path) {
        const stats = await lstat(safe.resolve(path)).catch(() => null);
        return stats?.isFile() ?? false;
      },
      async readHead(path, maxBytes) {
        const handle = await open(await safe.resolveExisting(path), 'r');
        try {
          const { buffer, bytesRead } = await handle.read(Buffer.alloc(maxBytes), 0, maxBytes, 0);
          return buffer.subarray(0, bytesRead);
        } finally {
          await handle.close();
        }
      },
      async rename(from, to) {
        const target = await parentInside(to);
        await rename(await safe.resolveExisting(from), target);
      },
    };
  }
}
