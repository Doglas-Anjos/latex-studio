import 'reflect-metadata';
import {
  APP_CONFIG,
  type AppConfig,
  DATABASE,
  type Database,
  runMigrations,
} from '@latex-studio/core';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  app.enableShutdownHooks();
  await runMigrations(app.get<Database>(DATABASE));
  app.setGlobalPrefix('api');
  await app.listen(app.get<AppConfig>(APP_CONFIG).API_PORT, '0.0.0.0');
}

void bootstrap();
