import type { INestApplication } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { MetricsService } from './metrics/metrics.service.js';

// What main.ts sets up on the app before it listens. The e2e tests call it
// too, so they test the app the way it runs.
export function configureApp(app: INestApplication): void {
  app.useLogger(app.get(Logger));
  app.use(app.get(MetricsService).middleware);
}
