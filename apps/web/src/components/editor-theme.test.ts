import { describe, expect, it } from 'vitest';
import { SYNTAX_TOKENS } from '../settings-store';
import { TOKEN_FOR_TAG } from './editor-theme';

describe('editor theme', () => {
  it('maps every syntax token', () => {
    const used = new Set(TOKEN_FOR_TAG.map((r) => r.token));
    for (const { token } of SYNTAX_TOKENS) expect(used.has(token), token).toBe(true);
  });
});
