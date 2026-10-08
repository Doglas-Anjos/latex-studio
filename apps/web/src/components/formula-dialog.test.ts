import { describe, expect, it } from 'vitest';
import { unwrapFormula, wrapFormula } from './formula-dialog';

describe('wrapFormula / unwrapFormula', () => {
  it.each(['inline', 'display', 'equation', 'align'] as const)('round-trips %s', (mode) => {
    const label = mode === 'equation' ? 'eq:a' : '';
    const text = wrapFormula('x^2 + y', mode, label);
    expect(unwrapFormula(text)).toEqual({ body: 'x^2 + y', mode, label });
  });

  it('accepts the other math delimiters', () => {
    expect(unwrapFormula('$$a$$')).toEqual({ body: 'a', mode: 'display', label: '' });
    expect(unwrapFormula('\\(a\\)')?.mode).toBe('inline');
  });

  it('keeps align labels inside the body', () => {
    const src = '\\begin{align}a &= b \\label{eq:first} \\\\ c &= d\\end{align}';
    expect(unwrapFormula(src)).toEqual({
      body: 'a &= b \\label{eq:first} \\\\ c &= d',
      mode: 'align',
      label: '',
    });
  });

  it('returns null for what it cannot represent', () => {
    expect(unwrapFormula('x + 1')).toBeNull();
    expect(unwrapFormula('\\begin{align*} a \\end{align*}')).toBeNull();
    expect(unwrapFormula('\\begin{eqnarray} a \\end{eqnarray}')).toBeNull();
  });

  it('stays linear on repeated \\label{', () => {
    const t = performance.now();
    unwrapFormula(`\\begin{equation}${'\\label{'.repeat(8000)}\\end{equation}`);
    expect(performance.now() - t).toBeLessThan(100);
  });
});
