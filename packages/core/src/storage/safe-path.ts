import { realpath } from 'node:fs/promises';
import path from 'node:path';

// Letters, marks and digits of any script, plus `._ -()+`. Everything else stays out: separators
// and their lookalikes (∕ ／ ．), `\`, `:` (NTFS streams), `~` (8.3 names), `$` (CONIN$), every
// control, format or bidi character (\p{C}), invisible letters/marks (Hangul fillers, variation
// selectors: \p{DI}) and a leading combining mark.
const SEGMENT = /^(?!\p{M})[\p{L}\p{M}\p{N}._ \-()+]+$/u;
const INVISIBLE = /\p{DI}/u;
// Windows strips trailing dots/spaces and maps device names to devices; `.git*` covers the repo
// dir and git config files (.gitignore, .gitattributes, .gitmodules) in any case.
const FORBIDDEN = /^(\.git|(con|prn|aux|nul|com[0-9]|lpt[0-9])( *\..*)?$)|[. ]$/i;
const valid = (s: string) => SEGMENT.test(s) && !INVISIBLE.test(s) && !FORBIDDEN.test(s);

/** Validates user-supplied relative paths and confines them to a root directory. */
export class SafePath {
  constructor(private readonly root: string) {}

  /** Returns the absolute path for `relative`, or throws if it could escape `root` or is malformed. */
  resolve(relative: string): string {
    const segments = relative.split('/');
    for (const s of segments) {
      // One spelling per name: NFC only (an NFD twin would be a second file that looks the same),
      // and still valid after NFKC, so `ＣＯＭ¹` or `.ｇｉｔ` cannot pass as plain letters. 200 bytes
      // keeps build outputs (`.synctex.gz`) under the 255-byte filesystem limit.
      if (
        !valid(s) ||
        s.normalize('NFC') !== s ||
        !valid(s.normalize('NFKC')) ||
        Buffer.byteLength(s) > 200
      ) {
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
