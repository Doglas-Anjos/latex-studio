import type { OnApplicationShutdown } from '@nestjs/common';
import { Global, Inject, Module } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { AppConfig } from '../config/config.schema';
import { APP_CONFIG } from '../config/config.schema';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;

export const DATABASE = Symbol('DATABASE');
const PG_CLIENT = Symbol('PG_CLIENT');

@Global()
@Module({
  providers: [
    {
      provide: PG_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => postgres(config.DATABASE_URL),
    },
    {
      provide: DATABASE,
      inject: [PG_CLIENT],
      useFactory: (client: postgres.Sql): Database => drizzle(client, { schema }),
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_CLIENT) private readonly client: postgres.Sql) {}

  async onApplicationShutdown() {
    await this.client.end();
  }
}
