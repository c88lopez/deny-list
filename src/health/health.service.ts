import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Env } from '../config/env.js';
import { PG_POOL } from '../database/database.module.js';
import { REDIS } from '../redis/redis.module.js';
import { type Check, evaluate, type Readiness } from './readiness.js';

@Injectable()
export class HealthService implements OnApplicationBootstrap {
  // False until the app has started and again from SIGTERM on (see
  // ShutdownService), so Kubernetes stops sending traffic before the server closes.
  private ready = false;
  private readonly checks: Check[];

  constructor(
    config: ConfigService<Env, true>,
    @Inject(PG_POOL) pool: pg.Pool | null,
    @Inject(REDIS) redis: Redis | null,
  ) {
    const critical = new Set(
      config.get('CRITICAL_DEPENDENCIES', { infer: true }),
    );
    // The pool and the client are shared with the rest of the app; their
    // modules own and close them.
    this.checks = [
      {
        name: 'postgres',
        critical: critical.has('postgres'),
        run: pool ? () => pool.query('SELECT 1') : undefined,
      },
      {
        name: 'redis',
        critical: critical.has('redis'),
        run: redis ? () => redis.ping() : undefined,
      },
    ];
  }

  onApplicationBootstrap(): void {
    this.ready = true;
  }

  stopAcceptingTraffic(): void {
    this.ready = false;
  }

  async readiness(): Promise<Readiness> {
    if (!this.ready) return { code: 503, body: { status: 'shutting down' } };
    return evaluate(this.checks);
  }
}
