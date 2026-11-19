import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { HealthService } from '../src/health/health.service.js';
import { MetricsService } from '../src/metrics/metrics.service.js';
import { start, TEST_DATABASE_URL, TEST_REDIS_URL, withDeps } from './app.js';

describe('without dependencies configured', () => {
  let app: INestApplication<App>;
  beforeEach(async () => {
    app = await start({});
  });
  afterEach(async () => {
    await app.close();
  });

  it('GET /healthz is ok', async () => {
    await request(app.getHttpServer())
      .get('/healthz')
      .expect(200, { status: 'ok' });
  });

  it('GET /readyz is ready, with both dependencies skipped', async () => {
    const res = await request(app.getHttpServer()).get('/readyz').expect(200);
    expect(res.body).toEqual({
      status: 'ready',
      checks: {
        postgres: { status: 'skipped', critical: true },
        redis: { status: 'skipped', critical: false },
      },
    });
  });

  it('GET /readyz is 503 once shutdown has started', async () => {
    app.get(HealthService).stopAcceptingTraffic();
    await request(app.getHttpServer())
      .get('/readyz')
      .expect(503, { status: 'shutting down' });
  });

  it('records requests by route, leaving out the probes', async () => {
    await request(app.getHttpServer()).get('/healthz');
    await request(app.getHttpServer()).get('/nope').expect(404);
    const metrics = await app.get(MetricsService).registry.metrics();
    expect(metrics).toContain(
      'http_server_request_duration_seconds_count{http_request_method="GET",http_route="unmatched",http_response_status_code="404"} 1',
    );
    expect(metrics).not.toContain('http_route="/healthz"');
  });
});

describe('with an unreachable dependency', () => {
  let app: INestApplication<App>;
  afterEach(async () => {
    await app.close();
  });

  it('is not ready when it is critical', async () => {
    app = await start({ DATABASE_URL: 'postgres://u:p@127.0.0.1:1/db' });
    const res = await request(app.getHttpServer()).get('/readyz').expect(503);
    expect(res.body.status).toBe('not ready');
    expect(res.body.checks.postgres.status).toBe('error');
  });

  it('is degraded, still ready, when it is not', async () => {
    app = await start({ REDIS_URL: 'redis://127.0.0.1:1/0' });
    const res = await request(app.getHttpServer()).get('/readyz').expect(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.redis.status).toBe('error');
  });
});

withDeps('with Postgres and Redis', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    app = await start({
      DATABASE_URL: TEST_DATABASE_URL ?? '',
      REDIS_URL: TEST_REDIS_URL ?? '',
      CRITICAL_DEPENDENCIES: 'postgres,redis',
    });
  });
  afterAll(async () => {
    await app.close();
  });

  it('GET /readyz is ready, with both checks ok', async () => {
    const res = await request(app.getHttpServer()).get('/readyz').expect(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.checks.postgres).toMatchObject({
      status: 'ok',
      critical: true,
    });
    expect(res.body.checks.redis).toMatchObject({
      status: 'ok',
      critical: true,
    });
  });
});
