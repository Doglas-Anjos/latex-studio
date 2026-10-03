import 'reflect-metadata';
import { join } from 'node:path';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import type { Hocuspocus } from '@hocuspocus/server';
import {
  APP_CONFIG,
  type AppConfig,
  DATABASE,
  type Database,
  runMigrations,
} from '@latex-studio/core';
import { HttpException, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { WebSocketServer } from 'ws';
import { AppModule } from './app.module';
import { HOCUSPOCUS } from './modules/collab/infrastructure/hocuspocus.server';

// Local development reads the repo's .env; containers get their environment from compose.
try {
  process.loadEnvFile(join(__dirname, '..', '..', '..', '.env'));
} catch {}

async function bootstrap() {
  // Exactly one trusted hop (Caddy), so request.ip is the real client for rate limiting.
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: (_address, hop) => hop < 1 }),
  );
  const config = app.get<AppConfig>(APP_CONFIG);
  app.enableShutdownHooks();

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        workerSrc: ["'self'", 'blob:'], // PDF.js worker
        objectSrc: ["'none'"],
      },
    },
  });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  // ponytail: in-memory store is per process; the Redis store comes in with the queue (BullMQ).
  // Login/register override this with 5/min via @RouteConfig.
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    cache: 10000,
    // One IPv6 client usually owns a whole /64, so key on the prefix.
    keyGenerator: ({ ip }) => (ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip),
    // Nest's exception handler turns plain errors into 500; an HttpException keeps the 429.
    errorResponseBuilder: (_request, context) =>
      new HttpException(`Rate limit exceeded, retry in ${context.after}`, 429),
  });
  // Consumed as streams via request.parts(); the per-file limit is enforced while streaming.
  await app.register(multipart, {
    limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 200 },
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // Migrations must run before listen(): onApplicationBootstrap seeds the first admin.
  await runMigrations(app.get<Database>(DATABASE));
  app.setGlobalPrefix('api');
  await app.init();

  // Collaborative editing shares the HTTP server. Upgrades skip Nest guards: Hocuspocus'
  // onAuthenticate checks the Origin, the signed sid cookie and the project role itself.
  const hocuspocus = app.get<Hocuspocus>(HOCUSPOCUS);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
  app
    .getHttpAdapter()
    .getInstance()
    .server.on('upgrade', (request, socket, head) => {
      if (!request.url?.startsWith('/collab')) return socket.destroy();
      wss.handleUpgrade(request, socket, head, (ws) => {
        const headers = new Headers();
        for (let i = 0; i < request.rawHeaders.length; i += 2) {
          headers.append(request.rawHeaders[i] as string, request.rawHeaders[i + 1] as string);
        }
        const connection = hocuspocus.handleConnection(
          ws,
          new Request(`http://localhost${request.url}`, { headers }),
        );
        // Default binaryType is nodebuffer: each message arrives as one Buffer.
        ws.on('message', (data) => connection.handleMessage(new Uint8Array(data as Buffer)));
        ws.on('close', (code, reason) =>
          connection.handleClose({ code, reason: reason.toString() }),
        );
        // An unhandled 'error' event would crash the process; ws closes the socket after it.
        ws.on('error', () => {});
      });
    });

  await app.listen(config.API_PORT, '0.0.0.0');
}

void bootstrap();
