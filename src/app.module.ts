import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { IncomingMessage } from 'node:http';
import { LoggerModule } from 'nestjs-pino';
import { type Env, validateEnv } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { EntriesModule } from './entries/entries.module.js';
import { HealthModule } from './health/health.module.js';
import { ShutdownService } from './lifecycle/shutdown.service.js';
import { MetricsModule } from './metrics/metrics.module.js';
import { RedisModule } from './redis/redis.module.js';

@Module({
  imports: [
    // Validated in a load factory rather than with `validate`, which reads
    // process.env once, when this file is imported. skipProcessEnv: get()
    // returns only parsed values, never a raw variable.
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      skipProcessEnv: true,
      load: [() => validateEnv(process.env)],
    }),
    // JSON on stdout, one line per request. With tracing on, src/tracing.ts
    // adds trace_id and span_id to every line, and Grafana links them to Tempo.
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          autoLogging: {
            ignore: (req: IncomingMessage) =>
              req.url === '/healthz' || req.url === '/readyz',
          },
        },
      }),
    }),
    DatabaseModule,
    RedisModule,
    MetricsModule,
    HealthModule,
    EntriesModule,
  ],
  providers: [ShutdownService],
})
export class AppModule {}
