import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * The one ioredis call the lock needs; core does not depend on ioredis. Only `eval`, because
 * BullMQ's client proxy overrides `set` (no NX) but passes `eval` through to ioredis.
 */
export type LockRedis = {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
};

/** Redis client for `withProjectLock`; absent in unit tests, where only the in-process lock runs. */
export const PROJECT_LOCK_REDIS = Symbol('PROJECT_LOCK_REDIS');

const TTL_MS = 30_000;
const ACQUIRE = `return redis.call('set', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX')`;
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0`;
const EXTEND = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) end return 0`;

/**
 * Runs `fn` while holding `lock:project:<id>` in Redis, so the api and the worker never touch the
 * same git repo at once. Waits up to `waitMs` with backoff, then throws. The TTL is renewed while
 * `fn` runs, so a slow commit keeps the lock; a crashed holder frees it after 30 s.
 */
export async function withProjectLock<T>(
  redis: LockRedis,
  projectId: string,
  fn: () => Promise<T>,
  waitMs = 10_000,
): Promise<T> {
  const key = `lock:project:${projectId}`;
  const token = randomUUID();
  const deadline = Date.now() + waitMs;
  for (let delay = 20; (await redis.eval(ACQUIRE, 1, key, token, TTL_MS)) !== 'OK'; ) {
    if (Date.now() + delay > deadline) throw new Error(`Project ${projectId} is busy, try again`);
    await sleep(delay);
    delay = Math.min(delay * 2, 500);
  }
  const renew = setInterval(
    () => void redis.eval(EXTEND, 1, key, token, TTL_MS).catch(() => {}),
    TTL_MS / 3,
  );
  try {
    return await fn();
  } finally {
    clearInterval(renew);
    // A failed release only delays the next holder until the TTL runs out.
    await redis.eval(RELEASE, 1, key, token).catch(() => {});
  }
}
