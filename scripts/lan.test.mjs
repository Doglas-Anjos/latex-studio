import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { freshEnv, lanOverrides, setEnv } from './lan.mjs';

describe('pnpm lan', () => {
  it('rewrites every line of a key, appends a missing one, and keeps $ in values literal', () => {
    const out = setEnv('A=1\nLAN_SECRET=\nB=2\nLAN_SECRET=short', { LAN_SECRET: 'a$&b', NEW: 'x' });
    expect(out).toBe('A=1\nLAN_SECRET=a$&b\nB=2\nLAN_SECRET=a$&b\nNEW=x\n');
    expect(parseEnv(out).LAN_SECRET).toBe('a$&b'); // the loader keeps the last duplicate
  });

  it('builds a fresh .env that points the services here and leaves LAN share out', () => {
    const example =
      'POSTGRES_USER=latex\nPOSTGRES_PASSWORD=pw\nPOSTGRES_DB=db\nREDIS_PASSWORD=rp\nLAN_SHARE=\n';
    const env = parseEnv(freshEnv(example, 'C:\\my #repo'));
    expect(env).toMatchObject({
      APP_URL: 'http://localhost:5173',
      DATABASE_URL: 'postgres://latex:pw@localhost:5432/db',
      REDIS_URL: 'redis://:rp@localhost:6379',
      REPOS_DIR: 'C:/my #repo/data/repos', // quoted, so " #" is not read as a comment
      LAN_SHARE: '', // a later plain `pnpm dev` stays local
    });
  });

  it('forces local mode and keeps only an http://localhost:<port> APP_URL', () => {
    const o = lanOverrides({ APP_URL: 'http://localhost:5175/', AUTH_SECRET: 'x' });
    expect(o).toMatchObject({
      APP_URL: 'http://localhost:5175',
      AUTH_SECRET: '',
      LAN_SHARE: 'true',
    });
    for (const APP_URL of [
      'https://localhost',
      'http://localhost',
      'https://latex.example.com',
      'x',
    ]) {
      expect(lanOverrides({ APP_URL }).APP_URL).toBe('http://localhost:5173');
    }
  });
});
