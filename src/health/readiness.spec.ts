import { evaluate, type Check } from './readiness.js';

const ok = () => Promise.resolve();
const fail = () => Promise.reject(new Error('connection refused'));

describe('evaluate', () => {
  it('is ready when every check passes', async () => {
    const r = await evaluate([
      { name: 'postgres', critical: true, run: ok },
      { name: 'redis', critical: false, run: ok },
    ]);
    expect(r.code).toBe(200);
    expect(r.body.status).toBe('ready');
    expect(r.body.checks?.postgres?.status).toBe('ok');
    expect(r.body.checks?.redis?.status).toBe('ok');
  });

  it('is not ready when a critical dependency fails', async () => {
    const r = await evaluate([
      { name: 'postgres', critical: true, run: fail },
      { name: 'redis', critical: false, run: ok },
    ]);
    expect(r.code).toBe(503);
    expect(r.body.status).toBe('not ready');
    expect(r.body.checks?.postgres).toMatchObject({
      status: 'error',
      critical: true,
      error: 'connection refused',
    });
  });

  it('stays in the Service, degraded, when only a non-critical dependency fails', async () => {
    const r = await evaluate([
      { name: 'postgres', critical: true, run: ok },
      { name: 'redis', critical: false, run: fail },
    ]);
    expect(r.code).toBe(200);
    expect(r.body.status).toBe('degraded');
    expect(r.body.checks?.redis?.status).toBe('error');
  });

  it('skips dependencies that are not configured, even critical ones', async () => {
    const r = await evaluate([
      { name: 'postgres', critical: true },
      { name: 'redis', critical: false },
    ]);
    expect(r.code).toBe(200);
    expect(r.body.status).toBe('ready');
    expect(r.body.checks?.postgres).toEqual({
      status: 'skipped',
      critical: true,
    });
  });

  it('fails a check that takes longer than the budget', async () => {
    const hang: Check = {
      name: 'postgres',
      critical: true,
      run: () => new Promise(() => {}),
    };
    const r = await evaluate([hang], 20);
    expect(r.code).toBe(503);
    expect(r.body.checks?.postgres?.error).toBe('timed out after 20ms');
  });

  it('runs the checks concurrently', async () => {
    const slow = () => new Promise((resolve) => setTimeout(resolve, 50));
    const start = performance.now();
    await evaluate([
      { name: 'postgres', critical: true, run: slow },
      { name: 'redis', critical: true, run: slow },
    ]);
    expect(performance.now() - start).toBeLessThan(95);
  });
});
