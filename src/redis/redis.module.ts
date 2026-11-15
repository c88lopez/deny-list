import {
  Global,
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Env } from '../config/env.js';

export const REDIS = Symbol('REDIS');

// Every key this service writes starts with it: Redis is shared with other apps.
export const KEY_PREFIX = 'deny-list:';

// ioredis connects in the background and keeps reconnecting, so the app
// starts even when Redis is down. Commands give up after one retry instead of
// waiting for it to come back: callers (and /readyz) see the failure. null
// when REDIS_URL is unset.
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Redis | null => {
        const url = config.get('REDIS_URL', { infer: true });
        if (!url) return null;
        const redis = new Redis(url, {
          keyPrefix: KEY_PREFIX,
          connectTimeout: 2_000,
          maxRetriesPerRequest: 1,
        });
        // Connection errors are emitted on every retry; without a listener
        // ioredis prints each one unformatted.
        const log = new Logger('Redis');
        redis.on('error', (err: Error) => log.warn(err.message));
        return redis;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis | null) {}

  // After the HTTP server has closed, like the Postgres pool.
  async onApplicationShutdown(): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.quit();
    } catch {
      // Not connected: nothing to close gracefully.
      this.redis.disconnect();
    }
  }
}
