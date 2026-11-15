import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { configureApp } from './app.js';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';
import { MetricsService } from './metrics/metrics.service.js';

// Tracing starts before this file runs: `node --import ./dist/tracing.js
// dist/main.js` (the Dockerfile's CMD, and npm run start:prod).
async function bootstrap() {
  // Logs from startup are held until the pino logger takes over, so every
  // line is JSON.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);
  // SIGTERM runs the graceful shutdown in src/lifecycle/shutdown.service.ts.
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  await app
    .get(MetricsService)
    .listen(config.get('METRICS_PORT', { infer: true }));
  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
