import { Global, Module } from '@nestjs/common';
import type { WorkerConfig } from '../config/config.schema';
import { APP_CONFIG } from '../config/config.schema';

export const COMPILE_QUEUE = 'compile';
export const TOOLS_QUEUE = 'tools';

export type CompileJobData = { buildId: string; projectId: string };

export type ExportFormat = 'docx' | 'md' | 'html';
export type ToolJobData =
  | { projectId: string; kind: 'wordcount' }
  | { projectId: string; kind: 'export'; format: ExportFormat }
  | { projectId: string; kind: 'format'; path: string; text: string };

/** BullMQ `ConnectionOptions`; core does not depend on bullmq, so the shape is spelled out. */
export type QueueConnection = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
};

/** ioredis 6 sends HELLO before AUTH when only a url is given, so the parts are passed explicitly. */
export function parseRedisUrl(url: string): QueueConnection {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    ...(u.username && { username: decodeURIComponent(u.username) }),
    ...(u.password && { password: decodeURIComponent(u.password) }),
    ...(u.pathname.length > 1 && { db: Number(u.pathname.slice(1)) }),
  };
}

export const QUEUE_CONNECTION = Symbol('QUEUE_CONNECTION');

/**
 * BullMQ root options. Every Queue instance (api and worker) rewrites the events stream cap in
 * Redis on startup, so all of them must use this: the default (10k events, each holding the job's
 * return value) can fill a 64 MB noeviction Redis.
 */
export const queueOptions = (connection: QueueConnection) => ({
  connection,
  streams: { events: { maxLen: 200 } },
});

/**
 * Redis connection for BullMQ. Apps wire it with
 * `BullModule.forRootAsync({ inject: [QUEUE_CONNECTION], useFactory: queueOptions })`.
 */
@Global()
@Module({
  providers: [
    {
      provide: QUEUE_CONNECTION,
      inject: [APP_CONFIG],
      useFactory: (config: WorkerConfig): QueueConnection => parseRedisUrl(config.REDIS_URL),
    },
  ],
  exports: [QUEUE_CONNECTION],
})
export class QueueModule {}
