import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types.js';
import { configureApp } from '../src/app.js';
import { AppModule } from '../src/app.module.js';

// The Postgres and Redis tests run only with TEST_DATABASE_URL and
// TEST_REDIS_URL set (make test, with make tunnel running; CI sets them to
// its service containers). Without them they're skipped.
export const { TEST_DATABASE_URL, TEST_REDIS_URL } = process.env;
export const withDeps: ReturnType<typeof describe.runIf> = describe.runIf(
  TEST_DATABASE_URL && TEST_REDIS_URL,
);

// The app as main.ts sets it up, with only the given variables set.
export async function start(
  env: Record<string, string>,
): Promise<INestApplication<App>> {
  // The app validates process.env once, when the module is compiled.
  const keys = [
    'DATABASE_URL',
    'REDIS_URL',
    'CRITICAL_DEPENDENCIES',
    'LOG_LEVEL',
  ];
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, { LOG_LEVEL: 'warn' }, env);

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({
    bufferLogs: true,
  });
  configureApp(app);
  await app.init();

  return app;
}
