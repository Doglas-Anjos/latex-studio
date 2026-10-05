import { expect, it } from 'vitest';
import { parseRedisUrl, queueOptions } from './queue.module';

it('splits a redis url into explicit connection parts', () => {
  expect(parseRedisUrl('redis://:p%40ss@redis:6380/2')).toEqual({
    host: 'redis',
    port: 6380,
    password: 'p@ss',
    db: 2,
  });
  expect(parseRedisUrl('redis://localhost')).toEqual({ host: 'localhost', port: 6379 });
});

it('caps the BullMQ events stream, which copies every return value into Redis', () => {
  const connection = { host: 'redis', port: 6379 };
  expect(queueOptions(connection)).toEqual({ connection, streams: { events: { maxLen: 200 } } });
});
