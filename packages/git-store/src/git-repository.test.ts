import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { GitRepository } from './git-repository';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

it('commits, logs, diffs and reads history', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'git-store-'));
  dirs.push(dir);
  const author = { name: 'Ana', email: 'ana@example.com' };
  const repo = await GitRepository.init(dir);

  await repo.writeFile('main.tex', 'v1');
  await repo.writeFile('old.tex', 'x');
  expect(await repo.isDirty()).toBe(true);
  const first = await repo.commitAll('first', author);
  expect(first).toMatch(/^[0-9a-f]{40}$/);
  expect(await repo.commitAll('noop', author)).toBeNull();
  expect(await repo.isDirty()).toBe(false);

  await repo.writeFile('main.tex', 'version two');
  await repo.writeFile('sub/dir/new.tex', 'n');
  await repo.deleteFile('old.tex');
  const second = await repo.commitAll('second', author);
  expect(second).not.toBeNull();

  const log = await repo.log();
  expect(log.map((c) => c.message)).toEqual(['second', 'first']);
  expect(log[0]?.author).toEqual(author);

  const changes = await repo.changedFiles(first as string, second as string);
  expect(changes).toEqual(
    expect.arrayContaining([
      { path: 'main.tex', type: 'modify' },
      { path: 'sub/dir/new.tex', type: 'add' },
      { path: 'old.tex', type: 'remove' },
    ]),
  );
  expect(changes).toHaveLength(3);

  expect(
    new TextDecoder().decode((await repo.readFileAt(first as string, 'main.tex')) as Uint8Array),
  ).toBe('v1');
  expect(await repo.readFileAt(first as string, 'nope.tex')).toBeNull();

  await repo.rename('main.tex', 'moved/main.tex');
  expect((await repo.listFiles()).map((f) => f.path).sort()).toEqual([
    'moved/main.tex',
    'sub/dir/new.tex',
  ]);
});
