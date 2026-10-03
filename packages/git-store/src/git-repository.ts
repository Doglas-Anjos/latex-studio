import fs from 'node:fs';
import { dirname, join } from 'node:path';
import git, { TREE } from 'isomorphic-git';

export type Author = { name: string; email: string };

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

  /** statusMatrix rows that differ from HEAD. */
  private async changes() {
    const rows = await git.statusMatrix({ fs, dir: this.dir });
    return rows.filter(([, head, workdir, stage]) => !(head === 1 && workdir === 1 && stage === 1));
  }

  async commitAll(message: string, author: Author): Promise<string | null> {
    const changed = await this.changes();
    if (changed.length === 0) return null;
    for (const [filepath, , workdir] of changed) {
      if (workdir === 0) await git.remove({ fs, dir: this.dir, filepath });
      else await git.add({ fs, dir: this.dir, filepath });
    }
    return git.commit({ fs, dir: this.dir, message, author, committer: author });
  }

  async log(
    limit = 50,
  ): Promise<Array<{ sha: string; message: string; author: Author; date: Date }>> {
    const commits = await git.log({ fs, dir: this.dir, depth: limit });
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

  async isDirty(): Promise<boolean> {
    return (await this.changes()).length > 0;
  }
}
