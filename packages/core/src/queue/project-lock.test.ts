import { describe, expect, it } from 'vitest';
import { type LockRedis, withProjectLock } from './project-lock';

/** In-memory SET NX / compare-and-delete scripts, enough to model one shared Redis. */
const fakeRedis = (): LockRedis & { keys: Map<string, string> } => {
  const keys = new Map<string, string>();
  return {
    keys,
    eval: async (script, _n, key, token) => {
      const k = String(key);
      if (script.includes("'NX'")) {
        if (keys.has(k)) return null;
        keys.set(k, String(token));
        return 'OK';
      }
      if (keys.get(k) !== token) return 0;
      if (script.includes("'del'")) keys.delete(k);
      return 1;
    },
  };
};

const tick = () => new Promise((r) => setTimeout(r, 30));

describe('withProjectLock', () => {
  it('never lets two runners on the same project overlap', async () => {
    const redis = fakeRedis();
    let inside = 0;
    let max = 0;
    let runs = 0;
    const runner = () =>
      withProjectLock(redis, 'p1', async () => {
        max = Math.max(max, ++inside);
        await tick();
        inside--;
        runs++;
      });
    await Promise.all([runner(), runner(), runner()]);
    expect({ runs, max }).toEqual({ runs: 3, max: 1 });
    expect(redis.keys.size).toBe(0);
  });

  it('runs different projects in parallel and releases on error', async () => {
    const redis = fakeRedis();
    let inside = 0;
    let max = 0;
    const run = (id: string) =>
      withProjectLock(redis, id, async () => {
        max = Math.max(max, ++inside);
        await tick();
        inside--;
      });
    await Promise.all([run('a'), run('b')]);
    expect(max).toBe(2);
    await expect(
      withProjectLock(redis, 'a', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(redis.keys.size).toBe(0);
  });

  it('gives up after waitMs while another holder keeps the lock', async () => {
    const redis = fakeRedis();
    redis.keys.set('lock:project:p1', 'other');
    await expect(withProjectLock(redis, 'p1', async () => 1, 50)).rejects.toThrow('busy');
    expect(redis.keys.get('lock:project:p1')).toBe('other');
  });
});
