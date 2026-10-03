import 'reflect-metadata';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Local development reads the repo's .env; containers get their environment from compose.
try {
  process.loadEnvFile(join(__dirname, '..', '..', '..', '.env'));
} catch {}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
}

void bootstrap();
