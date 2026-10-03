import { realpath } from 'node:fs/promises';
import path from 'node:path';

const SEGMENT = /^[A-Za-z0-9._ \-()]{1,200}$/;
// Windows strips trailing dots/spaces and maps device names to devices; `.git*` covers the repo
// dir and git config files (.gitignore, .gitattributes, .gitmodules) in any case.
const FORBIDDEN = /^(\.git|(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$)|[. ]$/i;

/** Validates user-supplied relative paths and confines them to a root directory. */
export class SafePath {
  constructor(private readonly root: string) {}

  /** Returns the absolute path for `relative`, or throws if it could escape `root` or is malformed. */
  resolve(relative: string): string {
    const segments = relative.split('/');
    for (const s of segments) {
      if (!SEGMENT.test(s) || FORBIDDEN.test(s)) {
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
