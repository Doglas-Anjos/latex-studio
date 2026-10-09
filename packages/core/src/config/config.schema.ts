import type { DynamicModule } from '@nestjs/common';
import { Global, Module } from '@nestjs/common';
import { z } from 'zod';

/** Everything the worker needs: no API secrets. */
const baseSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  REPOS_DIR: z.string().min(1),
  BUILDS_DIR: z.string().min(1),
  COMPILE_CONCURRENCY: z.coerce.number().int().positive().default(1),
  // Export/format/wordcount jobs run in parallel per worker, independently of compiles.
  TOOLS_CONCURRENCY: z.coerce.number().int().positive().default(1),
  COMPILE_TIMEOUT_MS: z.coerce.number().int().positive().default(180000),
  COMPILE_MEMORY_MB: z.coerce.number().int().positive().default(1024),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(50),
  PROJECT_QUOTA_MB: z.coerce.number().positive().default(500),
  MAX_PROJECTS_PER_USER: z.coerce.number().int().positive().default(50),
  // LuaTeX's io.input/io.output and os.getenv bypass kpathsea's paranoid mode, so a document can
  // read and write any file the worker can (other projects, /proc/<worker>/environ). Only for a
  // server whose every user is trusted, until compiles run in an OS sandbox.
  // OS sandbox (bubblewrap) around latexmk/pandoc/texcount so a document cannot read other
  // projects or the worker's environment: 'auto' uses it when available, 'require' refuses to
  // start without it, 'off' disables it (and on non-Linux dev it is always off).
  COMPILE_SANDBOX: z.enum(['auto', 'off', 'require']).default('auto'),
  COMPILE_ALLOW_LUALATEX: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

const optional = (schema: z.ZodType<string>) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

/**
 * Identity comes from the application in front (FasorX) as a signed JWT in `Authorization`.
 * Without a verifier (neither AUTH_JWKS_URL nor AUTH_SECRET) the API runs in local mode: every
 * request is the local user. That is only allowed when APP_URL is localhost, so a published
 * install cannot be left open by forgetting a variable.
 */
const envSchema = baseSchema
  .extend({
    APP_URL: z.url(),
    API_PORT: z.coerce.number().int().positive().default(3000),
    AUTH_JWKS_URL: optional(z.url()),
    AUTH_SECRET: optional(z.string().min(32)),
    AUTH_ISSUER: optional(z.string().min(1)),
    AUTH_AUDIENCE: optional(z.string().min(1)),
    AUTH_MAX_TOKEN_TTL_S: z.coerce.number().int().positive().default(900),
    // Platform superadmins, as a comma-separated list of e-mails. They can view and govern every
    // project and see all users, regardless of membership. Operator-controlled, so it works the
    // same on the hosted instance and on a self-hosted university install. Empty = no admins
    // (except the local user in local mode).
    SUPERADMIN_EMAILS: optional(z.string()),
  })
  .refine((c) => c.AUTH_JWKS_URL || c.AUTH_SECRET || new URL(c.APP_URL).hostname === 'localhost', {
    message: 'AUTH_JWKS_URL or AUTH_SECRET is required unless APP_URL is localhost',
  })
  // The same key signs tokens for every app of that issuer: pin who signs and for whom.
  .refine((c) => !(c.AUTH_JWKS_URL || c.AUTH_SECRET) || (c.AUTH_ISSUER && c.AUTH_AUDIENCE), {
    message: 'AUTH_ISSUER and AUTH_AUDIENCE are required with a verifier',
  });

export type AppConfig = z.output<typeof envSchema>;
export type WorkerConfig = z.output<typeof baseSchema>;

export const APP_CONFIG = Symbol('APP_CONFIG');

function parse<T extends z.ZodType>(schema: T, env: NodeJS.ProcessEnv): z.output<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const fields = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${fields}`);
  }
  return result.data;
}

export const loadConfig = (env: NodeJS.ProcessEnv): AppConfig => parse(envSchema, env);
export const loadWorkerConfig = (env: NodeJS.ProcessEnv): WorkerConfig => parse(baseSchema, env);

@Global()
@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest dynamic module convention
export class ConfigModule {
  static forRoot(): DynamicModule {
    return ConfigModule.provide(() => loadConfig(process.env));
  }

  /** APP_CONFIG as a WorkerConfig: the worker starts without the API secrets. */
  static forWorker(): DynamicModule {
    return ConfigModule.provide(() => loadWorkerConfig(process.env));
  }

  private static provide(load: () => WorkerConfig): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useFactory: load }],
      exports: [APP_CONFIG],
    };
  }
}
