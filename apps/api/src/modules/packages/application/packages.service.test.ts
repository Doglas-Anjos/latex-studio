import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '@latex-studio/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeDocumentSync } from '../../collab/testing/fake-document-sync';
import { ProjectLock } from '../../projects/application/project-lock';
import type { Project } from '../../projects/domain/project';
import { FsProjectStorage } from '../../projects/infrastructure/fs-project-storage';
import { FakeProjects } from '../../projects/testing/fake-project.repository';
import type { User } from '../../users/domain/user';
import { PackagesService } from './packages.service';

const user: User = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'ana@example.com',
  name: 'Ana',
  createdAt: new Date(),
};

const MAIN =
  '\\documentclass{article}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amsmath}\n\\begin{document}\nHi\n\\end{document}\n';

describe('PackagesService', () => {
  let dir: string;
  let storage: FsProjectStorage;
  let service: PackagesService;
  let sync: FakeDocumentSync;
  const project = { id: 'p1', mainFile: 'main.tex' } as Project;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'packages-'));
    storage = new FsProjectStorage({
      REPOS_DIR: dir,
      BUILDS_DIR: join(dir, 'builds'),
    } as AppConfig);
    const files = await storage.init(project.id);
    await files.repo.writeFile('main.tex', MAIN);
    await files.repo.commitAll('Initial commit', { name: 'Ana', email: 'ana@example.com' });
    sync = new FakeDocumentSync();
    service = new PackagesService(storage, new ProjectLock(), sync, new FakeProjects());
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  const text = async (path: string) =>
    Buffer.from(await storage.open(project.id).repo.readFile(path)).toString();
  const lastMessage = async () => (await storage.open(project.id).repo.log())[0]?.message;

  it('set writes the manifest and the tex, and commits', async () => {
    const manifest = await service.set(project, user, [
      { name: 'b', enabled: false, order: 5 },
      { name: 'a', options: 'x', enabled: true, order: 1 },
    ]);
    expect(manifest.map((e) => [e.name, e.order])).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
    expect(JSON.parse(await text('latex-packages.json'))).toEqual(manifest);
    expect(await text('latex-packages.tex')).toContain(
      '\\usepackage[x]{a}\n% disabled: b (bypass: later \\usepackage{b} lines are skipped)\n\\expandafter\\def\\csname ver@b.sty\\endcsname{0000/00/00}',
    );
    expect(await lastMessage()).toBe('Update packages');
    expect(await service.get(project)).toEqual(manifest);
  });

  it('usage lists packages with file and line', async () => {
    expect(await service.usage(project)).toEqual([
      { name: 'inputenc', options: 'utf8', path: 'main.tex', line: 2 },
      { name: 'amsmath', path: 'main.tex', line: 3 },
    ]);
  });

  it('set bypasses a disabled package that main.tex still uses', async () => {
    await service.set(project, user, [{ name: 'amsmath', enabled: false, order: 0 }]);
    expect(await text('latex-packages.tex')).toContain(
      '\\expandafter\\def\\csname ver@amsmath.sty\\endcsname{0000/00/00}',
    );
    expect(await text('main.tex')).toContain('\\input{latex-packages}');
    expect(sync.calls).toContain('replace main.tex');
  });

  it('migrate moves the preamble packages once', async () => {
    const result = await service.migrate(project, user);
    expect(result.moved).toBe(2);
    expect(result.manifest?.map((e) => e.name)).toEqual(['inputenc', 'amsmath']);
    const main = await text('main.tex');
    expect(main).toContain('\\input{latex-packages}');
    expect(main).not.toContain('\\usepackage');
    expect(await text('latex-packages.tex')).toContain('\\usepackage[utf8]{inputenc}');
    expect(await lastMessage()).toBe('Move 2 packages to the manifest');
    expect(sync.calls).toEqual([
      'replace main.tex',
      'replace latex-packages.json',
      'replace latex-packages.tex',
    ]);
    expect(sync.texts.get('main.tex')).toBe(main);

    expect(await service.migrate(project, user)).toEqual({ moved: 0 });
    expect(await service.get(project)).toHaveLength(2);
  });
});
