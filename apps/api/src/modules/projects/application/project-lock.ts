import { Injectable } from '@nestjs/common';

/**
 * Serializes mutations per project (git index, quota checks, exists-then-write).
 * ponytail: per process only; a second API replica needs a Redis lock instead.
 */
@Injectable()
export class ProjectLock {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const result = (this.tails.get(projectId) ?? Promise.resolve()).then(fn, fn);
    const tail = result.catch(() => {});
    this.tails.set(projectId, tail);
    void tail.then(() => {
      if (this.tails.get(projectId) === tail) this.tails.delete(projectId);
    });
    return result;
  }
}
