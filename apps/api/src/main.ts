import 'reflect-metadata';
import { join } from 'node:path';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import type { Hocuspocus } from '@hocuspocus/server';
import {
  APP_CONFIG,
  type AppConfig,
  DATABASE,
  type Database,
  parseRedisUrl,
  runMigrations,
} from '@latex-studio/core';
import { HttpException, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import Redis from 'ioredis';
import { WebSocketServer } from 'ws';
import { AppModule } from './app.module';
import { IdentityService, rateLimitKey } from './modules/auth/application/identity.service';
import { HOCUSPOCUS } from './modules/collab/infrastructure/hocuspocus.server';

// Local development reads the repo's .env; containers get their environment from compose.
try {
  process.loadEnvFile(join(__dirname, '..', '..', '..', '.env'));
} catch {}

// Loopback socket address (IPv4 127/8, ::1, IPv4-mapped): a proxy we may trust X-Forwarded-* from.
const LOOPBACK = /^(?:::ffff:)?127\.\d+\.\d+\.\d+$|^::1$/;

async function bootstrap() {
  // With a verifier the API sits behind exactly one trusted hop (Caddy). In local/LAN mode the only
  // thing that fronts it is the dev proxy (Vite) on loopback, so trust X-Forwarded-* only from a
  // loopback source: request.ip/hostname are then the real client (for the owner gate and rate
  // limits), while a LAN peer hitting the API directly cannot forge them (its socket is not loopback).
  const hasVerifier = !!(process.env.AUTH_JWKS_URL || process.env.AUTH_SECRET);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: hasVerifier ? (_address, hop) => hop < 1 : 'loopback' }),
  );
  const config = app.get<AppConfig>(APP_CONFIG);
  const identity = app.get(IdentityService);
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
  // Counters live in Redis so every API process shares them.
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    redis: new Redis({
      ...parseRedisUrl(config.REDIS_URL),
      connectTimeout: 500,
      maxRetriesPerRequest: 1,
    }),
    // Fail closed: with Redis down or full the project lock and the queues fail anyway, and failing
    // open would silently lift every limit (compile, upload, spell suggest).
    skipOnError: false,
    keyGenerator: (request) => rateLimitKey(identity, request),
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

  await runMigrations(app.get<Database>(DATABASE));
  app.setGlobalPrefix('api');
  await app.init();

  // Collaborative editing shares the HTTP server. Upgrades skip Nest guards: Hocuspocus'
  // onAuthenticate checks the Origin, the bearer token and the project role itself. A foreign
  // Origin is refused here already, before a socket is held open for it.
  const hocuspocus = app.get<Hocuspocus>(HOCUSPOCUS);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
  const appOrigin = new URL(config.APP_URL).origin;
  const safeHost = (url: string): string | null => {
    try {
      return new URL(url).host;
    } catch {
      return null;
    }
  };
  app
    .getHttpAdapter()
    .getInstance()
    .server.on('upgrade', (request, socket, head) => {
      if (!request.url?.startsWith('/collab')) return socket.destroy();
      // The real client, trusting X-Forwarded-* only from a loopback proxy (Vite): the raw Host is
      // rewritten to localhost by the proxy, so a LAN peer must not be judged by it. A peer hitting
      // the API directly has a non-loopback socket, so its forged headers are ignored.
      const socketIp = request.socket.remoteAddress ?? '';
      const fromProxy = LOOPBACK.test(socketIp);
      const fwd = (name: string) =>
        fromProxy
          ? (request.headers[name] as string | undefined)?.split(',')[0]?.trim()
          : undefined;
      const realIp = fwd('x-forwarded-for') || socketIp;
      const realHost = fwd('x-forwarded-host') || request.headers.host || '';
      // Same origin as the app, or — with LAN share on — the LAN address the peer loaded it from
      // (its Origin host equals this upgrade's real Host: same server, not a foreign site).
      const origin = request.headers.origin;
      const lanOrigin = config.LAN_SHARE && !!origin && !!realHost && safeHost(origin) === realHost;
      if (origin !== appOrigin && !lanOrigin) {
        return socket.end(
          'HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
        );
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        const headers = new Headers();
        for (let i = 0; i < request.rawHeaders.length; i += 2) {
          headers.append(request.rawHeaders[i] as string, request.rawHeaders[i + 1] as string);
        }
        // Overwrite host and peer-ip with the real (unforgeable) values, so onAuthenticate gates the
        // local-mode owner grant on the true client address, not the proxy's rewritten localhost.
        headers.set('host', realHost);
        headers.delete('x-peer-ip');
        headers.set('x-peer-ip', realIp);
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

  // Local mode trusts a request only when it is addressed to localhost AND arrives from a loopback
  // peer (IdentityService), so binding all interfaces is safe once that holds. Without a verifier
  // and without LAN share, stay loopback only ('localhost' binds 127.0.0.1 and ::1), which also
  // leaves a proxy in another container (Caddy) unable to reach it.
  const verifier = config.AUTH_JWKS_URL || config.AUTH_SECRET;
  await app.listen(config.API_PORT, verifier || config.LAN_SHARE ? '0.0.0.0' : 'localhost');
}

void bootstrap();
