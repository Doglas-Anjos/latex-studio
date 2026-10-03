import { expect, it } from 'vitest';
import { parseRedisUrl } from './queue.module';

it('splits a redis url into explicit connection parts', () => {
  expect(parseRedisUrl('redis://:p%40ss@redis:6380/2')).toEqual({
    host: 'redis',
    port: 6380,
    password: 'p@ss',
    db: 2,
  });
  expect(parseRedisUrl('redis://localhost')).toEqual({ host: 'localhost', port: 6379 });
});
