import { validateEnv } from './env.js';

describe('validateEnv', () => {
  it('has defaults for everything but the URLs', () => {
    const env = validateEnv({});
    expect(env).toMatchObject({
      PORT: 3000,
      METRICS_PORT: 9464,
      DB_POOL_MAX: 5,
      CRITICAL_DEPENDENCIES: ['postgres'],
      SHUTDOWN_TIMEOUT: 15_000,
      SHUTDOWN_DRAIN: 3_000,
    });
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.REDIS_URL).toBeUndefined();
  });

  it('treats an empty URL as unset', () => {
    expect(validateEnv({ DATABASE_URL: '' }).DATABASE_URL).toBeUndefined();
  });

  it('parses durations', () => {
    const env = validateEnv({
      SHUTDOWN_TIMEOUT: '10s',
      SHUTDOWN_DRAIN: '500ms',
    });
    expect(env.SHUTDOWN_TIMEOUT).toBe(10_000);
    expect(env.SHUTDOWN_DRAIN).toBe(500);
  });

  it('parses the critical dependencies list', () => {
    expect(
      validateEnv({ CRITICAL_DEPENDENCIES: 'postgres, redis' })
        .CRITICAL_DEPENDENCIES,
    ).toEqual(['postgres', 'redis']);
    expect(
      validateEnv({ CRITICAL_DEPENDENCIES: '' }).CRITICAL_DEPENDENCIES,
    ).toEqual([]);
  });

  it('rejects an unknown critical dependency, so a typo fails at startup', () => {
    expect(() => validateEnv({ CRITICAL_DEPENDENCIES: 'postgress' })).toThrow(
      /CRITICAL_DEPENDENCIES/,
    );
  });

  it('rejects a malformed URL', () => {
    expect(() => validateEnv({ REDIS_URL: 'not a url' })).toThrow(/REDIS_URL/);
  });
});
