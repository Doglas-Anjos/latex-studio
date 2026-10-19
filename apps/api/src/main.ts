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

async function bootstrap() {
  // With a verifier the API sits behind exactly one trusted hop (Caddy), so request.ip is the real
  // client for rate limiting. In local/LAN mode nothing fronts it (it binds the interface directly),
  // so trust no hop: request.ip is the socket peer and a forged X-Forwarded-For is ignored — else a
  // LAN peer could send `X-Forwarded-For: 127.0.0.1` to fake a loopback address and be granted owner.
  const hasVerifier = !!(process.env.AUTH_JWKS_URL || process.env.AUTH_SECRET);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: hasVerifier ? (_address, hop) => hop < 1 : false }),
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
      // Same origin as the app, or — with LAN share on — the LAN address the peer loaded it from
      // (its Origin host equals this upgrade's Host: same server, not a foreign site). onAuthenticate
      // re-checks origin against host; a cross-site page keeps its own Origin and is refused there.
      const origin = request.headers.origin;
      const lanOrigin =
        config.LAN_SHARE &&
        !!origin &&
        !!request.headers.host &&
        safeHost(origin) === request.headers.host;
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
        // The socket peer address, as a header the client cannot forge: drop any copy it sent, then
        // set the real one. onAuthenticate uses it to gate the local-mode owner grant to loopback.
        headers.delete('x-peer-ip');
        if (request.socket.remoteAddress) headers.set('x-peer-ip', request.socket.remoteAddress);
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
