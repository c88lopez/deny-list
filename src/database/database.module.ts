import {
  Global,
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pg from 'pg';
import type { Env } from '../config/env.js';

export const PG_POOL = Symbol('PG_POOL');

// The pool connects lazily, so the app starts even when Postgres is down; the
// failure shows up in /readyz. null when DATABASE_URL is unset.
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): pg.Pool | null => {
        const connectionString = config.get('DATABASE_URL', { infer: true });
        if (!connectionString) return null;
        const pool = new pg.Pool({
          connectionString,
          // node-postgres ignores a pool size in the URL, so it's set here.
          max: config.get('DB_POOL_MAX', { infer: true }),
          connectionTimeoutMillis: 2_000,
        });
        // An idle client losing its connection emits here; without a listener
        // it would crash the process.
        const log = new Logger('Postgres');
        pool.on('error', (err) =>
          log.warn(`idle client error: ${err.message}`),
        );
        return pool;
      },
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool | null) {}

  // After the HTTP server has closed (Nest runs shutdown hooks last), so no
  // request still in flight loses its connection.
  async onApplicationShutdown(): Promise<void> {
    await this.pool?.end();
  }
}
