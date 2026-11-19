import { z } from 'zod';

export const DEPENDENCIES = ['postgres', 'redis'] as const;
export type Dependency = (typeof DEPENDENCIES)[number];

// "15s", "500ms" or a plain number of milliseconds, as milliseconds.
const duration = z
  .string()
  .regex(/^\d+(ms|s)?$/, 'want a duration like 15s or 500ms')
  .transform((v) =>
    v.endsWith('ms')
      ? Number(v.slice(0, -2))
      : v.endsWith('s')
        ? Number(v.slice(0, -1)) * 1000
        : Number(v),
  );

// An unset variable and an empty one mean the same: Kubernetes and the
// Makefile both produce empty strings for "not configured".
const optionalUrl = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(z.url().optional());

export const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  // Prometheus scrapes this port (k8s/api/40-podmonitor.yaml). It isn't in the
  // Service, so /metrics isn't reachable through the NodePort.
  METRICS_PORT: z.coerce.number().int().positive().default(9464),
  // Unset: the dependency isn't configured and /readyz reports it as skipped.
  DATABASE_URL: optionalUrl,
  REDIS_URL: optionalUrl,
  // Connections per pod, to PgBouncer: PgBouncer, not this, caps the real
  // Postgres connections (see "secrets" in the Makefile).
  DB_POOL_MAX: z.coerce.number().int().positive().default(5),
  // Only these make the pod not ready when they fail; others just show in /readyz.
  CRITICAL_DEPENDENCIES: z
    .string()
    .default('postgres')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(DEPENDENCIES))),
  // Read by src/tracing.ts before Nest starts; here only so a typo fails validation.
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,
  // Everything between SIGTERM and exit: it must fit the Deployment's 20s
  // terminationGracePeriodSeconds.
  SHUTDOWN_TIMEOUT: duration.default(15_000),
  // How long the pod keeps serving after readiness turns false, so Kubernetes
  // takes it out of the Service before the server stops accepting connections.
  SHUTDOWN_DRAIN: duration.default(3_000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
});

export type Env = z.output<typeof envSchema>;

// For ConfigModule: throws with every invalid variable listed, so the pod
// fails at startup instead of misbehaving later.
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`invalid environment:\n${z.prettifyError(result.error)}`);
  }

  return result.data;
}
