# deny-list

A NestJS service (REST, strict TypeScript) backed by Postgres and Redis. It runs in the Docker Desktop cluster next to [importer](https://github.com/c88lopez/importer) and deploys the same way.

It keeps a list of denied values (IP addresses, emails and domains) that clients add, check and remove.

## Endpoints

| Port | Path | What |
| --- | --- | --- |
| 3000 (`PORT`) | `POST /entries` | Adds `{"type", "value"}`: 201 with `{type, value, createdAt}` when it's new, 200 with the existing entry when it was already there. |
| 3000 | `GET /entries/:type/:value` | 204 when the entry exists, 404 when it doesn't. `HEAD` works the same way. |
| 3000 | `DELETE /entries/:type/:value` | 204 when an entry was removed, 404 when there was none. |
| 3000 | `GET /healthz` | Liveness: the process is up. Doesn't check dependencies. |
| 3000 | `GET /readyz` | Readiness: pings Postgres and Redis concurrently, 2s each. 503 when a dependency in `CRITICAL_DEPENDENCIES` fails or the pod is shutting down; 200 `degraded` when only another one fails; `skipped` for one that isn't configured. |
| 9464 (`METRICS_PORT`) | `GET /metrics` | Prometheus. Not in the Service, so not reachable through the NodePort. |

In the cluster: `http://192.168.68.57:30083`.

### Entries

`type` is `ip`, `email` or `domain`. Values are validated for their type and stored normalized, so any spelling of one finds it (`src/entries/entry.ts`):

- `ip`: IPv4, or IPv6 in its canonical form (`2001:DB8:0::1` is `2001:db8::1`).
- `email`: trimmed and lowercased.
- `domain`: trimmed, lowercased, without a trailing dot, and with at least one dot.

An unknown type or an invalid value is a 400 with zod's `issues`. Without `DATABASE_URL`, the endpoints are 503.

In `GET` and `DELETE`, the type and value are in the path, URL-encoded: `/entries/ip/2001%3Adb8%3A%3A1`. Not in the query string, where `+` would turn into a space.

## Configuration

Validated at startup (`src/config/env.ts`); an invalid value stops the pod with every problem listed.

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `3000` | |
| `METRICS_PORT` | `9464` | |
| `DATABASE_URL` | unset | Postgres. Unset: reported as skipped in `/readyz`. |
| `DB_POOL_MAX` | `5` | Connections per pod. node-postgres ignores a pool size in the URL. |
| `REDIS_URL` | unset | Redis. Every key gets the `deny-list:` prefix. |
| `CRITICAL_DEPENDENCIES` | `postgres` | Comma-separated: `postgres`, `redis`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | OTLP gRPC endpoint. Unset: tracing is off. |
| `SHUTDOWN_TIMEOUT` | `15s` | From SIGTERM to exit, at most. |
| `SHUTDOWN_DRAIN` | `3s` | How long the pod keeps serving after readiness turns false. |
| `LOG_LEVEL` | `info` | |

## Observability

- **Metrics**: `http_server_request_duration_seconds` by `http_route`, `http_request_method` and `http_response_status_code` (the same names and buckets as importer), plus `nodejs_*` and `process_*`. The probes aren't counted.
- **Traces**: OpenTelemetry for HTTP, Express, pg and ioredis, exported to Alloy, then Tempo. `src/tracing.ts` loads before the app (`node --import`) and hooks ESM imports with `module.registerHooks()`, which needs Node 24.11.1 or later; on an older Node it logs a warning and the app runs untraced.
- **Logs**: JSON on stdout (pino), one line per request except the probes, with `trace_id` and `span_id` when tracing is on. Grafana links `trace_id` in Loki to Tempo.

## Graceful shutdown

On SIGTERM: readiness turns false, the pod keeps serving for `SHUTDOWN_DRAIN` while Kubernetes takes it out of the Service, the HTTP server closes after requests in flight finish, then Postgres, Redis and the metrics server close. All within `SHUTDOWN_TIMEOUT` (15s), inside the Deployment's 20s grace period.

## Database and migrations

Prisma: `prisma/schema.prisma` is the schema, and `prisma/migrations/` holds the SQL that gets it there. The app queries through Prisma's pg adapter, on its own pool (`DB_POOL_MAX`), through PgBouncer. Migrations use `MIGRATE_DATABASE_URL`, straight to Postgres, because migrate takes a session advisory lock that PgBouncer's transaction mode can't hold.

- In the cluster, the `deny-list-migrate` Job (`k8s/jobs/migrate.yaml`) runs `prisma migrate deploy` before every Argo CD sync, from the image being deployed. A failed migration stops the sync.
- To change the schema: edit `prisma/schema.prisma`, then `make migration NAME=what_it_does` writes the SQL into a new folder (review it), and `npm run postinstall` regenerates the client.
- The client is generated into `src/generated/prisma` (gitignored) by `npm ci`'s postinstall.

## Development

Node 24. Postgres and Redis are the cluster's, through port-forwards (see the comments in the Makefile).

```sh
npm ci
make dev-setup   # once: the deny_list_test database
make tunnel      # in its own terminal
make test        # unit + e2e, the e2e dependency tests against the cluster (migrates the test database first)
make migrate-local  # apply migrations to the real deny_list database
make run         # :3000, metrics :9467
```

## Deploy

Argo CD deploys `k8s/` from `main`; the Application is in the [platform](https://github.com/c88lopez/platform) repo. `make release VERSION=x.y.z` tags a version, CI pushes `ghcr.io/c88lopez/deny-list:x.y.z`, and Argo CD Image Updater commits it to `k8s/kustomization.yaml`. Secrets aren't in Git: `make secrets` creates `deny-list-deps`.
