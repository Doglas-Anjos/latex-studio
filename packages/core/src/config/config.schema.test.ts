import { describe, expect, it } from 'vitest';
import { loadConfig, loadWorkerConfig } from './config.schema';

const valid = {
  APP_URL: 'http://localhost:8080',
  API_PORT: '4000',
  DATABASE_URL: 'postgres://latex:latex@localhost:5432/latex',
  REDIS_URL: 'redis://localhost:6379',
  REPOS_DIR: '/data/repos',
  BUILDS_DIR: '/data/builds',
  COMPILE_TIMEOUT_MS: '1000',
};

describe('loadConfig', () => {
  it('returns a typed object with coerced numbers and defaults', () => {
    const config = loadConfig(valid);
    expect(config.API_PORT).toBe(4000);
    expect(config.COMPILE_TIMEOUT_MS).toBe(1000);
    expect(config.COMPILE_CONCURRENCY).toBe(1);
    expect(config.TOOLS_CONCURRENCY).toBe(1);
    expect(config.AUTH_MAX_TOKEN_TTL_S).toBe(900);
    expect(config.AUTH_JWKS_URL).toBeUndefined();
  });

  it('allows local mode (no verifier) only on localhost', () => {
    expect(() => loadConfig({ ...valid, APP_URL: 'https://latex.example.com' })).toThrow(
      /AUTH_JWKS_URL or AUTH_SECRET/,
    );
    const env = { ...valid, APP_URL: 'https://latex.example.com', AUTH_SECRET: 's'.repeat(32) };
    expect(() => loadConfig(env)).toThrow(/AUTH_ISSUER and AUTH_AUDIENCE/);
    const full = { ...env, AUTH_ISSUER: 'https://fasorx.example', AUTH_AUDIENCE: 'latex' };
    expect(loadConfig(full).AUTH_SECRET).toBe(env.AUTH_SECRET);
  });

  it('treats empty strings as unset', () => {
    const jwks = { ...valid, AUTH_JWKS_URL: 'https://fasorx.example/.well-known/jwks.json' };
    expect(() => loadConfig(jwks)).toThrow(/AUTH_ISSUER and AUTH_AUDIENCE/);
    expect(() => loadConfig({ ...jwks, AUTH_ISSUER: 'x', AUTH_AUDIENCE: '' })).toThrow();
    const config = loadConfig({
      ...jwks,
      AUTH_ISSUER: 'https://fasorx.example',
      AUTH_AUDIENCE: 'latex',
    });
    expect(config.AUTH_AUDIENCE).toBe('latex');
  });
});

describe('loadWorkerConfig', () => {
  it('accepts an env without the API variables', () => {
    const { APP_URL: _u, API_PORT: _p, ...env } = valid;
    const config = loadWorkerConfig(env);
    expect(config.COMPILE_TIMEOUT_MS).toBe(1000);
    expect('APP_URL' in config).toBe(false);
  });
});
