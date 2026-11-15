import { BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Env } from '../config/env.js';
import { HealthService } from '../health/health.service.js';

// Graceful shutdown, on SIGTERM (enableShutdownHooks in main.ts). Nest closes
// the app in this order:
//
//   1. beforeApplicationShutdown (here): readiness turns false, then a short
//      drain while Kubernetes takes the pod out of the Service.
//   2. The HTTP server closes, letting requests in flight finish.
//   3. onApplicationShutdown: the Postgres pool, Redis and the metrics server close.
//
// All of it has SHUTDOWN_TIMEOUT (15s), which fits the Deployment's 20s
// terminationGracePeriodSeconds; past it the process exits anyway.
@Injectable()
export class ShutdownService implements BeforeApplicationShutdown {
  private readonly log = new Logger(ShutdownService.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly health: HealthService,
  ) {}

  async beforeApplicationShutdown(signal?: string): Promise<void> {
    // Only for a signal: tests close the app without one, and must not exit.
    if (signal) {
      const timeout = this.config.get('SHUTDOWN_TIMEOUT', { infer: true });
      setTimeout(() => {
        this.log.error(`shutdown took longer than ${timeout}ms, exiting`);
        process.exit(1);
      }, timeout).unref();
      this.log.log(`${signal} received, draining connections`);
    }
    this.health.stopAcceptingTraffic();
    if (signal) await sleep(this.config.get('SHUTDOWN_DRAIN', { infer: true }));
  }
}
