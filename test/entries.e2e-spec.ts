import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PRISMA } from '../src/database/database.module.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { MetricsService } from '../src/metrics/metrics.service.js';
import { start, TEST_DATABASE_URL, TEST_REDIS_URL, withDeps } from './app.js';

describe('entries without Postgres configured', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    app = await start({});
  });
  afterAll(async () => {
    await app.close();
  });

  it('every endpoint is 503', async () => {
    const http = request(app.getHttpServer());
    await http
      .post('/entries')
      .send({ type: 'ip', value: '192.0.2.1' })
      .expect(503);
    await http.get('/entries/ip/192.0.2.1').expect(503);
    await http.delete('/entries/ip/192.0.2.1').expect(503);
  });

  it('still validates first: 400 for an invalid entry', async () => {
    const res = await request(app.getHttpServer())
      .post('/entries')
      .send({ type: 'phone', value: '123' })
      .expect(400);
    expect(res.body.message).toBe('invalid entry');
    expect(res.body.issues).toEqual(expect.any(Array));
  });
});

withDeps('entries with Postgres', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    app = await start({
      DATABASE_URL: TEST_DATABASE_URL ?? '',
      REDIS_URL: TEST_REDIS_URL ?? '',
    });
  });
  beforeEach(async () => {
    await app.get<PrismaClient>(PRISMA).entry.deleteMany();
  });
  afterAll(async () => {
    await app.close();
  });

  it('POST is 201 for a new entry, then 200 with the same one', async () => {
    const http = request(app.getHttpServer());
    const entry = { type: 'domain', value: 'example.com' };
    const created = await http.post('/entries').send(entry).expect(201);
    expect(created.body).toEqual({
      ...entry,
      createdAt: expect.any(String),
    });
    const again = await http.post('/entries').send(entry).expect(200);
    expect(again.body).toEqual(created.body);
  });

  it('stores values normalized, so any spelling finds them', async () => {
    const http = request(app.getHttpServer());
    const res = await http
      .post('/entries')
      .send({ type: 'email', value: ' A+b@X.com' })
      .expect(201);
    expect(res.body.value).toBe('a+b@x.com');
    await http.get('/entries/email/a+b@x.com').expect(204);
    await http.get('/entries/email/A%2Bb%40x.COM').expect(204);
  });

  it('GET and HEAD are 204 for an entry that exists, 404 otherwise', async () => {
    const http = request(app.getHttpServer());
    await http.post('/entries').send({ type: 'ip', value: '192.0.2.1' });
    await http.get('/entries/ip/192.0.2.1').expect(204);
    await http.head('/entries/ip/192.0.2.1').expect(204);
    await http.get('/entries/ip/192.0.2.2').expect(404);
    await http.head('/entries/ip/192.0.2.2').expect(404);
  });

  it('DELETE is 204, after which GET and DELETE are 404', async () => {
    const http = request(app.getHttpServer());
    await http.post('/entries').send({ type: 'ip', value: '192.0.2.1' });
    await http.delete('/entries/ip/192.0.2.1').expect(204);
    await http.get('/entries/ip/192.0.2.1').expect(404);
    await http.delete('/entries/ip/192.0.2.1').expect(404);
  });

  it('takes IPv6 addresses URL-encoded in the path', async () => {
    const http = request(app.getHttpServer());
    await http
      .post('/entries')
      .send({ type: 'ip', value: '2001:DB8:0:0:0:0:0:1' })
      .expect(201);
    await http
      .get(`/entries/ip/${encodeURIComponent('2001:db8::1')}`)
      .expect(204);
    await http
      .get(`/entries/ip/${encodeURIComponent('2001:db8:0::1')}`)
      .expect(204);
  });

  it('is 400 for an unknown type or an invalid value', async () => {
    const http = request(app.getHttpServer());
    await http.post('/entries').send({ type: 'phone', value: '1' }).expect(400);
    await http.post('/entries').send({ type: 'ip', value: 'x' }).expect(400);
    await http.post('/entries').send({}).expect(400);
    await http.get('/entries/phone/1').expect(400);
    await http.delete('/entries/domain/localhost').expect(400);
  });

  it('labels the metrics with the route, not the value', async () => {
    await request(app.getHttpServer()).get('/entries/ip/192.0.2.9').expect(404);
    const metrics = await app.get(MetricsService).registry.metrics();
    expect(metrics).toContain('http_route="/entries/:type/:value"');
    expect(metrics).not.toContain('192.0.2.9');
  });
});
