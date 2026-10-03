import type { DynamicModule } from '@nestjs/common';
import { Global, Module } from '@nestjs/common';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.url(),
  API_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  REPOS_DIR: z.string().min(1),
  BUILDS_DIR: z.string().min(1),
  COMPILE_CONCURRENCY: z.coerce.number().int().positive().default(1),
  COMPILE_TIMEOUT_MS: z.coerce.number().int().positive().default(180000),
  COMPILE_MEMORY_MB: z.coerce.number().int().positive().default(1024),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(50),
  PROJECT_QUOTA_MB: z.coerce.number().positive().default(500),
  MAX_PROJECTS_PER_USER: z.coerce.number().int().positive().default(50),
  ADMIN_EMAIL: z.email(),
  ADMIN_PASSWORD: z.string().min(12),
});

export type AppConfig = z.output<typeof envSchema>;

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const fields = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${fields}`);
  }
  return result.data;
}

@Global()
@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest dynamic module convention
export class ConfigModule {
  static forRoot(): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig(process.env) }],
      exports: [APP_CONFIG],
    };
  }
}
