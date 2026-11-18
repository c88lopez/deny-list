# deny-list: CRUD for deny-list entries (Prisma)

## Context
deny-list is still a skeleton (health, metrics, tracing, shutdown) with no features and no schema. It needs endpoints to add, check and remove denied values (IPs, emails, domains). Each entry is `type` + `value` + `created_at`, unique on (type, value). POST inserts with ON CONFLICT DO NOTHING, DELETE hard-deletes, GET only answers whether the entry exists.

Decisions from the user:
- A fixed set of types (`ip`, `email`, `domain`). Each value is validated and normalized for its type.
- GET returns **204** when the entry exists and **404** when it doesn't.
- **Prisma** is both the ORM and the migration tool.

## Data model: `prisma/schema.prisma`
```prisma
generator client {
  provider     = "prisma-client"
  output       = "../src/generated/prisma"
  moduleFormat = "esm"
}
datasource db { provider = "postgresql" }

enum EntryType { ip email domain  @@map("entry_type") }

model Entry {
  type      EntryType
  value     String
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  @@id([type, value])          // the uniqueness rule, and the lookup index
  @@map("entries")
}
```
- First migration: `prisma/migrations/<ts>_create_entries/migration.sql`, generated with `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`.
- Adding a type later is a schema change plus a migration (`ALTER TYPE ... ADD VALUE`).

## Prisma wiring
- Dependencies, all pinned to **7.10.1**: `@prisma/client` and `@prisma/adapter-pg` in dependencies, and **`prisma` in dependencies too**, because the migrate Job runs the CLI from the runtime image. Note: npm's `latest` tag for `prisma` is currently an 8.0 RC, so don't install it unpinned.
- `prisma.config.ts` (modeled on `backend/prisma.config.ts`): schema `prisma/schema.prisma`, migrations `prisma/migrations`, and the datasource URL from `MIGRATE_DATABASE_URL`. Migrations go straight to Postgres, because migrate takes a session advisory lock that PgBouncer can't hold. Check that `prisma generate` still works when that variable is unset (CI, Docker build). If `env()` throws, read `process.env` directly.
- The generated client goes in `src/generated/prisma`, which is gitignored. A `postinstall: prisma generate` script means `npm ci` produces it everywhere: locally, in CI and in the Docker build. Lint, format and coverage should ignore that directory.
- `src/database/database.module.ts`: add a `PRISMA` provider, `PrismaClient | null`. It's built with `new PrismaPg(pool)` on the **existing `PG_POOL`**, so `DB_POOL_MAX`, the connection timeout and the error listener all still apply, and it's `null` when the pool is `null`. Shutdown `$disconnect()`s Prisma before `pool.end()`. Check whether the adapter ends an external pool by itself, so the pool isn't ended twice.
- PgBouncer transaction mode: the adapter runs plain pg queries with no session state, so it's fine.

## Feature: `src/entries/`
- `entry.ts`: a pure zod schema, `parseEntry({type, value})`, that returns a normalized `{ type, value }` or zod issues:
  - `ip`: `z.ipv4()` or `z.ipv6()`. IPv6 is lowercased and compressed to its canonical form (`new URL('http://[v]').hostname` without the brackets).
  - `email`: trimmed, lowercased, `z.email()`.
  - `domain`: trimmed, lowercased, trailing dot removed, `z.hostname()` with at least one dot.
- `entry.spec.ts`: unit tests for valid, invalid and normalization cases.
- `entries.service.ts`: injects `PRISMA`, and throws `ServiceUnavailableException` when it's `null`.
  - `add`: `createManyAndReturn({ data, skipDuplicates: true })` (an INSERT … ON CONFLICT DO NOTHING RETURNING). If nothing came back, `findUnique` returns the existing row. The result says whether the row was created.
  - `exists`: `findUnique` with a `select` on the key.
  - `remove`: `deleteMany` filtered by key, returning the count, so a missing entry doesn't throw.
- `entries.controller.ts`, under `@Controller('entries')`:
  - `POST /entries`, body `{type, value}`: **201** with `{type, value, createdAt}` when the entry is created, **200** with the existing record when it was already there.
  - `GET /entries/:type/:value`: **204** if it exists, **404** if it doesn't. HEAD works the same way.
  - `DELETE /entries/:type/:value`: **204** when an entry was deleted, **404** when there was none.
  - Invalid type or value: **400** with the zod issues, through a small `ZodValidationPipe` (or an inline `parseEntry` call). No class-validator.
  - The type and value go in the path, not the query string, because Express's query parser turns `+` into a space (`a+b@x.com`). A value in the path must be URL-encoded (for example, the `:` in IPv6 addresses).
- `entries.module.ts`, registered in `src/app.module.ts`. The metrics middleware already labels requests with the route pattern (`/entries/:type/:value`).

## Migrations in the cluster
- `k8s/jobs/migrate.yaml`: copy `importer/k8s/jobs/migrate.yaml`, including the Argo CD PreSync hook, `backoffLimit: 0`, and the security context. Use image `ghcr.io/c88lopez/deny-list` and args `["node_modules/prisma/build/index.js", "migrate", "deploy"]` (the distroless entrypoint is `node`). Env comes from `deny-list-deps` (`MIGRATE_DATABASE_URL`). Add the Job to `k8s/kustomization.yaml`; Image Updater already rewrites the image there.
- `Dockerfile`: copy `prisma/` and `prisma.config.ts` into the runtime stage. **Risk:** the build stage runs on `$BUILDPLATFORM` with Alpine (musl), but the runtime is distroless Debian (glibc) on amd64 and arm64. If Prisma 7's migrate still uses a native schema-engine binary, set `PRISMA_CLI_BINARY_TARGETS` (for example `debian-openssl-3.0.x,linux-arm64-openssl-3.0.x`) before `npm ci` in the build stage. Verify by running the built image's migrate against the tunnel (see Verification). Also update the comment that says "dependencies have no native code".
- `Makefile`:
  - `migrate-local` runs `prisma migrate deploy` with `MIGRATE_DATABASE_URL=$(LOCAL_DATABASE_URL)`. The tunnel already forwards `postgres-rw`, so the connection is direct. Comment that this is the real database, as importer does.
  - `migration NAME=x` diffs the migrated test database against the schema into a new migration folder.
  - Update the `secrets` comment: `MIGRATE_DATABASE_URL` is now used.

## Tests
- `vitest.config.e2e.ts`: add a `globalSetup` that runs `prisma migrate deploy` against `TEST_DATABASE_URL`, and only when that variable is set.
- `test/entries.e2e-spec.ts`: reuse the `start()` pattern from `test/health.e2e-spec.ts`. Lift it into `test/app.ts`, or duplicate it.
  - `withDeps`, with entries truncated in `beforeEach`:
    - POST returns 201, then 200 for the same entry.
    - Normalization: POST `A@X.com`, then GET `a@x.com` returns 204.
    - GET returns 204 for an entry that exists and 404 for one that doesn't.
    - DELETE returns 204, then GET returns 404, then DELETE returns 404.
    - IPv6 values URL-encoded in the path.
    - An invalid type or value returns 400.
  - Without dependencies: every endpoint returns 503.
- CI (`.github/workflows/build.yml`) needs no change: `npm ci` generates the client, and the globalSetup migrates the Postgres container.

## Docs
- `README.md`: add the endpoint table rows, remove the "no deny-list features yet" line, and describe migrations.
- `CLAUDE.md`: add `make migrate-local` and `make migration` to the commands, add Prisma conventions (generated client location, schema-first migrations), and add `src/entries/` to the architecture section.
- `deploy-release` skill: a note that a sync runs the migrate Job first.

## Verification
1. `npm run lint`, `npm run format:check` and `npm run typecheck` are clean.
2. With `make tunnel` running, `make test` passes, and the entries e2e tests actually run instead of skipping.
3. `make image`, then run `docker run --rm -e MIGRATE_DATABASE_URL=<test db via host.docker.internal:5433> <image> node_modules/prisma/build/index.js migrate deploy`. This shows the CLI and engine work in the distroless image.
4. Run `make run`, then use curl to POST, GET, DELETE and GET again (204, then 404) against `:3000`.
5. Work on a branch and open a PR with `gh pr create`. Releasing is left to the user (`make release`).
