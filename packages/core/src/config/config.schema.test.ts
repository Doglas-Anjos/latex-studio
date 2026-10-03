import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.schema';

const valid = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:8080',
  API_PORT: '4000',
  DATABASE_URL: 'postgres://latex:latex@localhost:5432/latex',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_SECRET: 'x'.repeat(32),
  REPOS_DIR: '/data/repos',
  BUILDS_DIR: '/data/builds',
  COMPILE_TIMEOUT_MS: '1000',
  ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD: 'long-enough-password',
};

describe('loadConfig', () => {
  it('returns a typed object with coerced numbers and defaults', () => {
    const config = loadConfig(valid);
    expect(config.API_PORT).toBe(4000);
    expect(config.COMPILE_TIMEOUT_MS).toBe(1000);
    expect(config.COMPILE_CONCURRENCY).toBe(1);
    expect(config.DATABASE_URL).toBe(valid.DATABASE_URL);
  });

  it('names the invalid field when SESSION_SECRET is missing', () => {
    const { SESSION_SECRET: _omit, ...env } = valid;
    expect(() => loadConfig(env)).toThrow(/SESSION_SECRET/);
  });
});
