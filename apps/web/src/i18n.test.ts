import { describe, expect, it } from 'vitest';
import { normalizeLang } from './i18n';

describe('normalizeLang', () => {
  it('maps BCP-47 tags to a supported UI language, defaulting to pt-BR', () => {
    expect(normalizeLang('en-US')).toBe('en');
    expect(normalizeLang('EN')).toBe('en');
    expect(normalizeLang('es-419')).toBe('es');
    expect(normalizeLang('pt-BR')).toBe('pt-BR');
    expect(normalizeLang('pt')).toBe('pt-BR');
    expect(normalizeLang('fr-FR')).toBe('pt-BR');
    expect(normalizeLang('')).toBe('pt-BR');
    expect(normalizeLang(null)).toBe('pt-BR');
    expect(normalizeLang(undefined)).toBe('pt-BR');
  });
});
