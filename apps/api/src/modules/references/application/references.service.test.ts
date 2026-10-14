import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '@latex-studio/core';
import { afterEach, expect, it } from 'vitest';
import type { Project } from '../../projects/domain/project';
import { FsProjectStorage } from '../../projects/infrastructure/fs-project-storage';
import { ReferencesService } from './references.service';

let dir = '';
afterEach(() => rm(dir, { recursive: true, force: true }));

it('reads at most 4 MB of a project in all', async () => {
  dir = await mkdtemp(join(tmpdir(), 'references-'));
  const config = { REPOS_DIR: dir, BUILDS_DIR: join(dir, 'builds') } as AppConfig;
  const storage = new FsProjectStorage(config);
  const files = await storage.init('p1');
  for (const n of [1, 2, 3, 4, 5])
    await files.repo.writeFile(`c${n}.tex`, `\\label{c${n}}\n${' '.repeat(1_000_000)}`);
  const { labels } = await new ReferencesService(storage, config).index({ id: 'p1' } as Project);
  expect(labels).toHaveLength(4);
});
