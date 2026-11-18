# CLAUDE.md

A NestJS service (REST only, strict TypeScript, ESM) on Postgres and Redis. README.md is the reference for endpoints, env vars and observability.

## Commands

There are no local copies of Postgres or Redis. Local runs and tests use the cluster's, through port-forwards, with credentials read from Secrets in the `data` namespace by the Makefile (so `kubectl` must point at the `docker-desktop` context, and `jq` must be installed).

```sh
make dev-setup     # once: the deny_list_test database in the cluster
make tunnel        # keep running in its own terminal: Postgres :5433, Redis :6380 (importer's tunnel works too)
make test          # unit tests, then e2e against deny_list_test and Redis DB 3
make cover         # the same with coverage, in coverage/unit and coverage/e2e
make run           # :3000, metrics :9467, against the real deny_list database and Redis DB 2
make migrate-local # prisma migrate deploy on the real deny_list database
make migration NAME=x  # after changing prisma/schema.prisma: a new migration from the diff
npm run lint       # oxlint, type-aware; CI runs it
npm run typecheck  # tsc --noEmit
npm run format     # prettier; CI runs format:check
```

- e2e tests that need Postgres and Redis **skip** when `TEST_DATABASE_URL` / `TEST_REDIS_URL` are unset, so a plain `npm run test:e2e` passes while skipping them. Use `make test`.
- `make run` and `make migrate-local` hit the **real** `deny_list` database, the one the cluster serves.
- The e2e `globalSetup` (`test/migrate.ts`) runs `prisma migrate deploy` on the test database first.
- CI (`.github/workflows/build.yml`) runs lint, format check, typecheck and the tests with coverage against throwaway containers, then builds the image. Commits touching only `k8s/` or `*.md` skip CI. Its `test` job is a required check on `main`.

## Conventions

- ESM: relative imports end in `.js`, and there's no `__dirname` (use `import.meta.dirname`).
- Tests are Vitest: `vi.fn()`, not `jest.fn()`. Unit tests are `src/**/*.spec.ts`, e2e tests `test/**/*.e2e-spec.ts`.
- Config comes from `ConfigService<Env, true>` with `{ infer: true }`. A new variable goes in the zod schema in `src/config/env.ts` first; `get()` never sees raw `process.env`.
- Redis keys are prefixed `deny-list:` by the client (`src/redis/redis.module.ts`); don't add the prefix by hand.
- In the cluster, Postgres is reached through PgBouncer in transaction mode, so code can't rely on session state: no session advisory locks, `LISTEN/NOTIFY`, `SET` outside a transaction, or temp tables. Keep such state inside one transaction (`SET LOCAL`, `pg_advisory_xact_lock`). Migrations use `MIGRATE_DATABASE_URL`, which goes straight to Postgres.
- Prisma: the schema (`prisma/schema.prisma`) comes first, and each change gets a migration (`make migration`); never edit an applied one. The client is generated into `src/generated/prisma` (gitignored, by `npm ci`'s postinstall; rerun `npm run postinstall` after a schema change) and imported from `../generated/prisma/client.js`. Lint, format and coverage skip it.
- Prisma packages are pinned to an exact 7.x: npm's `latest` for `prisma` is an 8.0 RC. `prisma` is a runtime dependency because the migrate Job runs the CLI from the image.
- Postgres and Redis are optional at runtime: their providers are `null` when the URL is unset. Code that uses them handles that.
- The NestJS version here is likely newer than what you know: https://docs.nestjs.com/llms.txt indexes its docs.

## Definition of done

A change isn't done until all of these pass, and the results are reported (with output if anything fails):

1. `npm run lint`, `npm run format:check` and `npm run typecheck` are clean.
2. `make test` passes with `make tunnel` running, so the Postgres and Redis e2e tests actually run instead of skipping. If the tunnel or cluster isn't reachable, say so instead of reporting a plain `npm test` as passing.

## Changes reach main through PRs

`main` is protected by a ruleset: PRs only (squash or rebase), the CI `test` check required, no force-push. Work on a branch and open a PR with `gh pr create`. The only direct pushes are Image Updater's `newTag` commits, through its deploy key.

## Architecture

- `src/main.ts` boots Nest; `src/tracing.ts` runs before it (`node --import`), and `src/app.ts` is the setup shared with the e2e tests.
- `src/health/`: `/healthz` and `/readyz`. The readiness logic is the pure `evaluate()` in `readiness.ts`; `CRITICAL_DEPENDENCIES` decides which failures make the pod not ready.
- `src/metrics/`: prom-client registry, the request histogram middleware, and the metrics server on its own port.
- `src/database/`: the `PG_POOL` pg pool and the `PRISMA` client on top of it (`PrismaPg`), both `null` without `DATABASE_URL`.
- `src/entries/`: the deny-list itself. `entry.ts` validates and normalizes a type and value (pure, unit-tested), the service queries Prisma, and the controller maps results to status codes.
- `src/lifecycle/shutdown.service.ts`: the SIGTERM sequence and its time budget. Modules close their own clients in `onApplicationShutdown`, which Nest runs after the HTTP server has closed.

## Deploy and release

Argo CD deploys `k8s/` from `main`. Releasing, rolling back, Secrets and the Postgres connection budget are in the `deploy-release` skill (`.claude/skills/deploy-release/SKILL.md`).
