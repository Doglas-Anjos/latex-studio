import { realpath } from 'node:fs/promises';
import path from 'node:path';

const SEGMENT = /^[A-Za-z0-9._ \-()]+$/;

/** Validates user-supplied relative paths and confines them to a root directory. */
export class SafePath {
  constructor(private readonly root: string) {}

  /** Returns the absolute path for `relative`, or throws if it could escape `root` or is malformed. */
  resolve(relative: string): string {
    const segments = relative.split('/');
    for (const s of segments) {
      if (s === '' || s === '.' || s === '..' || s === '.git' || !SEGMENT.test(s)) {
        throw new Error(`Invalid path: ${relative}`);
      }
    }
    return path.join(this.root, ...segments);
  }

  /** Like `resolve`, but also follows symlinks on disk and rejects targets outside `root`. */
  async resolveExisting(relative: string): Promise<string> {
    const target = this.resolve(relative);
    const [realRoot, realTarget] = await Promise.all([realpath(this.root), realpath(target)]);
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
      throw new Error(`Invalid path: ${relative}`);
    }
    return realTarget;
  }
}
