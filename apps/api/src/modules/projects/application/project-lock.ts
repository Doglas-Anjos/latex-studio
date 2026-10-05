import { type LockRedis, PROJECT_LOCK_REDIS, withProjectLock } from '@latex-studio/core';
import { Inject, Injectable, Optional } from '@nestjs/common';

/**
 * Serializes mutations per project (git index, quota checks, exists-then-write). The in-process
 * chain orders this process's callers; each turn then takes the Redis lock shared with the worker's
 * autocommit (and other api replicas). Without a Redis client (unit tests) only the chain runs.
 */
@Injectable()
export class ProjectLock {
  private readonly tails = new Map<string, Promise<unknown>>();

  constructor(@Optional() @Inject(PROJECT_LOCK_REDIS) private readonly redis?: LockRedis) {}

  run<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const turn = this.redis ? () => withProjectLock(this.redis as LockRedis, projectId, fn) : fn;
    const result = (this.tails.get(projectId) ?? Promise.resolve()).then(turn, turn);
    const tail = result.catch(() => {});
    this.tails.set(projectId, tail);
    void tail.then(() => {
      if (this.tails.get(projectId) === tail) this.tails.delete(projectId);
    });
    return result;
  }
}
