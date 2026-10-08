import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { diffLines } from 'diff';
import git, { TREE, WORKDIR } from 'isomorphic-git';

export type Author = { name: string; email: string };
export type FileChange = { path: string; type: 'add' | 'modify' | 'remove' };
export type BlameRun = { from: number; to: number; sha: string | null };
export type Blame = {
  commits: Record<string, { author: Author; date: Date; message: string }>;
  lines: BlameRun[];
};

const MAX_BLAME_CHARS = 1024 * 1024;
/** One deadline for all the diffs of a blame request; the API is single-threaded. */
const BLAME_DIFF_BUDGET_MS = 1000;
/** Commits + texts per `${head}:${path}`, the costly part that does not depend on the working tree. */
const blameCache = new Map<string, Promise<{ oids: string[]; texts: string[] }>>();
const storedBytesCache = new Map<string, { bytes: number; at: number }>();
const remember = <T>(cache: Map<string, Promise<T>>, key: string, make: () => Promise<T>) => {
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size >= 200) cache.clear();
  const value = make().catch((e) => {
    cache.delete(key);
    throw e;
  });
  cache.set(key, value);
  return value;
};
const SYMLINK_MODE = 0o120000;

const dec = new TextDecoder();
const countLines = (s: string) => s.split('\n').length - (s === '' || s.endsWith('\n') ? 1 : 0);
const withCoAuthors = (message: string, coAuthors: Author[]) =>
  coAuthors.length
    ? `${message}\n\n${coAuthors.map((a) => `Co-authored-by: ${a.name} <${a.email}>`).join('\n')}`
    : message;

export class GitRepository {
  private constructor(private readonly dir: string) {}

  static async init(dir: string): Promise<GitRepository> {
    await fs.promises.mkdir(dir, { recursive: true });
    await git.init({ fs, dir, defaultBranch: 'main' });
    return new GitRepository(dir);
  }

  static open(dir: string): GitRepository {
    return new GitRepository(dir);
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const full = join(this.dir, path);
    await fs.promises.mkdir(dirname(full), { recursive: true });
    await fs.promises.writeFile(full, content);
  }

  async readFile(path: string): Promise<Uint8Array> {
    return fs.promises.readFile(join(this.dir, path));
  }

  async deleteFile(path: string): Promise<void> {
    await fs.promises.rm(join(this.dir, path));
  }

  async rename(from: string, to: string): Promise<void> {
    const dest = join(this.dir, to);
    await fs.promises.mkdir(dirname(dest), { recursive: true });
    await fs.promises.rename(join(this.dir, from), dest);
  }

  /**
   * Bytes of history on disk (`.git/objects`), counted toward the project quota: otherwise
   * rewriting one file over and over grows the repository without bound.
   * ponytail: walks the object store, cached 30 s per repository; writes inside that window can
   * overshoot the quota by what the rate limits allow. Keep a running total if that matters.
   */
  async storedBytes(): Promise<number> {
    const hit = storedBytesCache.get(this.dir);
    if (hit && Date.now() - hit.at < 30_000) return hit.bytes;
    const walk = async (dir: string): Promise<number> => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
      const sizes = await Promise.all(
        entries.map(async (e) => {
          const p = join(dir, e.name);
          if (e.isDirectory()) return walk(p);
          return e.isFile() ? (await fs.promises.stat(p)).size : 0;
        }),
      );
      return sizes.reduce((a, b) => a + b, 0);
    };
    const bytes = await walk(join(this.dir, '.git', 'objects'));
    if (storedBytesCache.size > 1000) storedBytesCache.clear();
    storedBytesCache.set(this.dir, { bytes, at: Date.now() });
    return bytes;
  }

  async listFiles(): Promise<Array<{ path: string; size: number }>> {
    const out: Array<{ path: string; size: number }> = [];
    const walk = async (rel: string): Promise<void> => {
      const entries = await fs.promises.readdir(join(this.dir, rel), { withFileTypes: true });
      for (const e of entries) {
        if (rel === '' && e.name === '.git') continue;
        const p = rel === '' ? e.name : `${rel}/${e.name}`;
        if (e.isDirectory()) await walk(p);
        else if (e.isFile())
          out.push({ path: p, size: (await fs.promises.stat(join(this.dir, p))).size });
      }
    };
    await walk('');
    return out;
  }

  // ponytail: statusMatrix trusts mtime (seconds) + size, plus the inode except on Windows. On
  // Linux every ProjectFiles.write is a temp-file rename (new inode), so nothing is missed; on a
  // Windows dev box a same-size edit within the same second as the previous add is missed until
  // the next change. Hash every file, as commitPaths does, if Windows ever runs in production.
  /** statusMatrix rows that differ from HEAD. */
  private async changes() {
    const rows = await git.statusMatrix({ fs, dir: this.dir });
    return rows.filter(([, head, workdir, stage]) => !(head === 1 && workdir === 1 && stage === 1));
  }

  async commitAll(
    message: string,
    author: Author,
    coAuthors: Author[] = [],
  ): Promise<string | null> {
    const changed = await this.changes();
    if (changed.length === 0) return null;
    const toAdd: string[] = [];
    for (const [filepath, , workdir] of changed) {
      if (workdir === 0) await git.remove({ fs, dir: this.dir, filepath });
      else toAdd.push(filepath);
    }
    // One add for all: each call rewrites the whole index.
    if (toAdd.length) await git.add({ fs, dir: this.dir, filepath: toAdd });
    const full = withCoAuthors(message, coAuthors);
    return git.commit({ fs, dir: this.dir, message: full, author, committer: author });
  }

  async log(
    limit = 50,
  ): Promise<Array<{ sha: string; message: string; author: Author; date: Date }>> {
    // Empty repo: HEAD does not resolve yet.
    const commits = await git.log({ fs, dir: this.dir, depth: limit }).catch((e) => {
      if ((e as { code?: string }).code === 'NotFoundError') return [];
      throw e;
    });
    return commits.map(({ oid, commit }) => ({
      sha: oid,
      message: commit.message.trim(),
      author: { name: commit.author.name, email: commit.author.email },
      date: new Date(commit.author.timestamp * 1000),
    }));
  }

  async readFileAt(sha: string, path: string): Promise<Uint8Array | null> {
    try {
      return (await git.readBlob({ fs, dir: this.dir, oid: sha, filepath: path })).blob;
    } catch (e) {
      if ((e as { code?: string }).code === 'NotFoundError') return null;
      throw e;
    }
  }

  async changedFiles(
    fromSha: string,
    toSha: string,
  ): Promise<Array<{ path: string; type: 'add' | 'modify' | 'remove' }>> {
    const result: Array<{ path: string; type: 'add' | 'modify' | 'remove' }> = [];
    await git.walk({
      fs,
      dir: this.dir,
      trees: [TREE({ ref: fromSha }), TREE({ ref: toSha })],
      map: async (filepath, [a, b]) => {
        if ((a && (await a.type()) === 'tree') || (b && (await b.type()) === 'tree')) return true;
        if ((await a?.oid()) !== (await b?.oid())) {
          result.push({ path: filepath, type: !a ? 'add' : !b ? 'remove' : 'modify' });
        }
        return true;
      },
    });
    return result;
  }

  /**
   * Commits that changed `path`, newest first: compares its blob at each commit against its
   * parent, like `changedFiles`. (isomorphic-git's own `log({ filepath })` resolves the mode from
   * the index entry it last saw and can misreport an unrelated commit as a change after a path has
   * been rewritten through a temp-file-plus-rename, which `ProjectFiles.write` always does.)
   * ponytail: only `limit` commits are scanned; the oldest one is reported as a change if its
   * state before that window is unknown.
   */
  async fileLog(
    path: string,
    limit = 50,
  ): Promise<Array<{ sha: string; message: string; author: Author; date: Date }>> {
    const commits = await this.log(limit);
    const blobOid = (sha: string) =>
      git.readBlob({ fs, dir: this.dir, oid: sha, filepath: path }).then(
        (r) => r.oid,
        (e: { code?: string }) => {
          if (e.code === 'NotFoundError') return null;
          throw e;
        },
      );
    const oids = await Promise.all(commits.map((c) => blobOid(c.sha)));
    return commits.filter((_, i) => oids[i] !== (oids[i + 1] ?? null));
  }

  /** HEAD's sha, or null for an empty repo. */
  head(): Promise<string | null> {
    return git.resolveRef({ fs, dir: this.dir, ref: 'HEAD' }).catch(() => null);
  }

  /**
   * Commits only `paths` (added, modified or deleted), with `Co-authored-by` trailers for
   * `coAuthors`. Returns null when none of them differs from HEAD.
   */
  async commitPaths(
    paths: string[],
    message: string,
    author: Author,
    coAuthors: Author[] = [],
  ): Promise<string | null> {
    // Content hashes, not statusMatrix: its mtime+size shortcut misses a same-size edit made in
    // the same second, which is exactly what Ctrl+S right after typing produces.
    const head = await this.head();
    const toAdd: string[] = [];
    let removed = 0;
    for (const filepath of paths) {
      const content = await fs.promises.readFile(join(this.dir, filepath)).catch(() => null);
      const inHead = head
        ? await git
            .readBlob({ fs, dir: this.dir, oid: head, filepath })
            .then((r) => r.oid)
            .catch(() => null)
        : null;
      const now = content ? (await git.hashBlob({ object: content })).oid : null;
      if (now === inHead) continue;
      if (content !== null) toAdd.push(filepath);
      else {
        await git.remove({ fs, dir: this.dir, filepath });
        removed++;
      }
    }
    if (toAdd.length + removed === 0) return null;
    // One add for all: each call rewrites the whole index.
    if (toAdd.length) await git.add({ fs, dir: this.dir, filepath: toAdd });
    const full = withCoAuthors(message, coAuthors);
    return git.commit({ fs, dir: this.dir, message: full, author, committer: author });
  }

  /** Files that differ between commit `fromSha` (empty tree when null) and the working tree. */
  async workingChanges(fromSha: string | null): Promise<FileChange[]> {
    const result: FileChange[] = [];
    await git.walk({
      fs,
      dir: this.dir,
      trees: fromSha ? [TREE({ ref: fromSha }), WORKDIR()] : [WORKDIR()],
      map: async (filepath, entries) => {
        if (filepath === '.git' || filepath.startsWith('.git/')) return null;
        const [a, b] = fromSha ? entries : [null, entries[0]];
        const types = await Promise.all([a?.type(), b?.type()]);
        if (types.includes('tree')) return true;
        if (types.includes('special') || (b && (await b.mode()) === SYMLINK_MODE)) return null;
        if ((await a?.oid()) !== (await b?.oid())) {
          result.push({ path: filepath, type: !a ? 'add' : !b ? 'remove' : 'modify' });
        }
        return true;
      },
    });
    return result;
  }

  /**
   * Per-line owner of the working-tree text: walks commits newest to oldest, pushing each
   * still-unattributed line back through the diffs. null = uncommitted.
   * ponytail: O(commits x lines) diffs per request, capped at `maxCommits` and 1 MB.
   */
  async blame(path: string, maxCommits = 100): Promise<Blame> {
    const full = join(this.dir, path);
    if ((await fs.promises.stat(full)).size > MAX_BLAME_CHARS) {
      throw new Error('File too large to blame');
    }
    const current = dec.decode(await this.readFile(path));
    const head = (await this.head()) ?? '';
    const { oids, texts } = await remember(blameCache, `${this.dir}:${head}:${path}`, async () => {
      const cache = {};
      // force:false stops at the file's creation; a never-committed file has no history at all.
      const log = await git
        .log({ fs, dir: this.dir, filepath: path, depth: maxCommits, cache })
        .catch((e: { code?: string }) => {
          if (e.code === 'NotFoundError') return [];
          throw e;
        });
      const texts: string[] = [];
      for (const c of log) {
        const blob = await git
          .readBlob({ fs, dir: this.dir, oid: c.oid, filepath: path, cache })
          .then((r) => r.blob)
          .catch(() => null);
        if (blob && blob.length > MAX_BLAME_CHARS) throw new Error('File too large to blame');
        texts.push(blob ? dec.decode(blob) : '');
      }
      return { oids: log.map((c) => c.oid), texts };
    });
    const commits = await this.commitsByOid(oids);
    const deadline = Date.now() + BLAME_DIFF_BUDGET_MS;
    const owner: Array<string | null> = Array(countLines(current)).fill(null);
    // Walks diffLines(before, after) with a line counter per side.
    const walk = (
      before: string,
      after: string,
      onAdded: (iAfter: number) => void,
      onSame: (iBefore: number, iAfter: number) => void,
    ) => {
      let b = 0;
      let a = 0;
      const parts = diffLines(before, after, { timeout: Math.max(1, deadline - Date.now()) });
      if (!parts) throw new Error('File too large to blame');
      for (const part of parts) {
        const n = countLines(part.value);
        for (let k = 0; k < n; k++) {
          if (part.added) onAdded(a + k);
          else if (!part.removed) onSame(b + k, a + k);
        }
        if (!part.added) b += n;
        if (!part.removed) a += n;
      }
    };
    // pending: line index in the text being compared -> index in `current`.
    let pending = new Map<number, number>();
    if (oids.length > 0)
      walk(
        texts[0] ?? '',
        current,
        () => {},
        (ib, ia) => pending.set(ib, ia),
      );
    for (let i = 0; i < oids.length && pending.size > 0; i++) {
      const sha = oids[i] as string;
      const next = new Map<number, number>();
      walk(
        texts[i + 1] ?? '',
        texts[i] ?? '',
        (ic) => {
          const cur = pending.get(ic);
          if (cur !== undefined) owner[cur] = sha;
        },
        (ip, ic) => {
          const cur = pending.get(ic);
          if (cur !== undefined) next.set(ip, cur);
        },
      );
      pending = next;
    }
    const lines: BlameRun[] = [];
    for (const [i, sha] of owner.entries()) {
      const last = lines.at(-1);
      if (last && last.sha === sha) last.to = i + 1;
      else lines.push({ from: i + 1, to: i + 1, sha });
    }
    const used: Blame['commits'] = {};
    for (const { sha } of lines) {
      const c = sha && commits.get(sha);
      if (c) used[sha] = c;
    }
    return { commits: used, lines };
  }

  private async commitsByOid(oids: string[]): Promise<Map<string, Blame['commits'][string]>> {
    const out = new Map<string, Blame['commits'][string]>();
    for (const oid of oids) {
      const { commit } = await git.readCommit({ fs, dir: this.dir, oid });
      out.set(oid, {
        author: { name: commit.author.name, email: commit.author.email },
        date: new Date(commit.author.timestamp * 1000),
        message: commit.message.trim(),
      });
    }
    return out;
  }

  async isDirty(): Promise<boolean> {
    return (await this.changes()).length > 0;
  }
}
