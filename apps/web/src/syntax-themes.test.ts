import { expect, it } from 'vitest';
import { SYNTAX_TOKENS } from './settings-store';
import { SYNTAX_THEMES, themePalette } from './syntax-themes';

const HEX = /^#[0-9a-f]{6}$/;

it('every family defines all tokens in both modes as lowercase hex', () => {
  for (const [id, theme] of Object.entries(SYNTAX_THEMES)) {
    for (const mode of ['dark', 'light'] as const) {
      for (const { token } of SYNTAX_TOKENS) {
        const color = theme[mode][token];
        expect(color, `${id}.${mode}.${token}`).toMatch(HEX);
      }
    }
  }
});

it('themePalette returns the mode palette, or null for the default', () => {
  expect(themePalette('darcula', 'dark')).toBe(SYNTAX_THEMES.darcula?.dark);
  expect(themePalette('darcula', 'light')).toBe(SYNTAX_THEMES.darcula?.light);
  expect(themePalette('', 'dark')).toBeNull();
  expect(themePalette('nope', 'light')).toBeNull();
});
