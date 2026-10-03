import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { AUTOSAVE_AUTHOR, AUTOSAVE_MESSAGE, GitRepository } from './git-repository';

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

it('baseline skips autosaves and workingChanges compares against the working tree', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'git-store-'));
  dirs.push(dir);
  const ana = { name: 'Ana', email: 'ana@example.com' };
  const repo = await GitRepository.init(dir);
  expect(await repo.baseline()).toBeNull();

  await repo.writeFile('a.tex', 'one');
  await repo.writeFile('b.tex', 'bee');
  const v1 = (await repo.commitAll('v1', ana)) as string;
  await repo.writeFile('a.tex', 'two');
  await repo.commitAll(AUTOSAVE_MESSAGE, AUTOSAVE_AUTHOR);
  expect((await repo.baseline())?.sha).toBe(v1);

  await repo.writeFile('a.tex', 'three');
  await repo.writeFile('c.tex', 'sea');
  await repo.deleteFile('b.tex');
  const sort = (l: Array<{ path: string }>) => l.sort((x, y) => x.path.localeCompare(y.path));
  expect(sort(await repo.workingChanges(v1))).toEqual([
    { path: 'a.tex', type: 'modify' },
    { path: 'b.tex', type: 'remove' },
    { path: 'c.tex', type: 'add' },
  ]);
  expect(sort(await repo.workingChanges(null))).toEqual([
    { path: 'a.tex', type: 'add' },
    { path: 'c.tex', type: 'add' },
  ]);
});

it('blames lines like git blame, with null for uncommitted lines', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'git-store-'));
  dirs.push(dir);
  const ana = { name: 'Ana', email: 'ana@example.com' };
  const bruno = { name: 'Bruno', email: 'bruno@example.com' };
  const repo = await GitRepository.init(dir);
  expect((await repo.blame('x.tex').catch(() => 'missing')) as unknown).toBe('missing');

  await repo.writeFile('m.tex', 'a\nb\nc\n');
  const c1 = (await repo.commitAll('c1', ana)) as string;
  await repo.writeFile('m.tex', 'a\nb\nc\nd\n');
  const c2 = (await repo.commitAll('c2', ana)) as string;
  await repo.writeFile('m.tex', 'a\nBB\nc\nd\n');
  const c3 = (await repo.commitAll('c3', bruno)) as string;
  await repo.writeFile('m.tex', 'a\nBB\nc\nd\ne\n');

  expect([c1, c2, c3].every(Boolean)).toBe(true);
  const { lines, commits } = await repo.blame('m.tex');
  expect(lines).toEqual([
    { from: 1, to: 1, sha: c1 },
    { from: 2, to: 2, sha: c3 },
    { from: 3, to: 3, sha: c1 },
    { from: 4, to: 4, sha: c2 },
    { from: 5, to: 5, sha: null },
  ]);
  expect(Object.keys(commits).sort()).toEqual([c1, c2, c3].sort());
  expect(commits[c3]?.author.name).toBe('Bruno');
  expect(commits[c1]?.author.name).toBe('Ana');
});
