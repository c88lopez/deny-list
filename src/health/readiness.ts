import type { Dependency } from '../config/env.js';

// Per dependency, so one slow dependency can't make the others look down.
// The readiness probe's timeoutSeconds (3) leaves room for it.
export const CHECK_TIMEOUT_MS = 2_000;

// One dependency's check. No run means the dependency isn't configured (its
// URL env var is empty), and it's reported as "skipped". Only critical
// dependencies make the pod not ready when they fail.
export interface Check {
  name: Dependency;
  critical: boolean;
  run?: () => Promise<unknown>;
}

export interface CheckResult {
  status: 'ok' | 'error' | 'skipped';
  critical: boolean;
  latency_ms?: number;
  error?: string;
}

export interface Readiness {
  code: 200 | 503;
  body: {
    status: 'ready' | 'degraded' | 'not ready' | 'shutting down';
    checks?: Record<string, CheckResult>;
  };
}

// Runs the checks concurrently. A critical failure returns 503 ("not ready");
// a non-critical one returns 200 with status "degraded", so it's visible
// without pulling the pod out of the Service.
export async function evaluate(
  checks: Check[],
  timeoutMs = CHECK_TIMEOUT_MS,
): Promise<Readiness> {
  const results = await Promise.all(
    checks.map(async (c): Promise<[string, CheckResult]> => {
      if (!c.run) return [c.name, { status: 'skipped', critical: c.critical }];
      const start = performance.now();
      try {
        await withTimeout(c.run(), timeoutMs);
        return [
          c.name,
          { status: 'ok', critical: c.critical, latency_ms: elapsed(start) },
        ];
      } catch (err) {
        return [
          c.name,
          {
            status: 'error',
            critical: c.critical,
            latency_ms: elapsed(start),
            error: err instanceof Error ? err.message : String(err),
          },
        ];
      }
    }),
  );

  const failed = results.filter(([, r]) => r.status === 'error');
  const body: Readiness['body'] = {
    status: 'ready',
    checks: Object.fromEntries(results),
  };
  if (failed.some(([, r]) => r.critical)) {
    return { code: 503, body: { ...body, status: 'not ready' } };
  }
  if (failed.length > 0) body.status = 'degraded';
  return { code: 200, body };
}

function elapsed(start: number): number {
  return Math.round((performance.now() - start) * 10) / 10;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
