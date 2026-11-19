---
name: deploy-release
description: How deny-list gets to the cluster - Argo CD deploys from k8s/ on main, every code merge to main released automatically (or by hand with make release), rolling back, Secrets and the Postgres connection budget. Use when releasing, deploying, rolling back, changing k8s/ manifests, the HPA maximum or DB_POOL_MAX, or running make secrets.
---

# Deploy and release

## How a change reaches the cluster

- Argo CD deploys `k8s/` from `main`. The Application lives in the separate platform repo, not here.
- Changes reach `main` through PRs. A merged PR that changes only `k8s/` (the ConfigMap, the HPA) is live within a few minutes, with no release. Such commits skip CI on `main` (their PR still runs it).
- Every sync first runs the `deny-list-migrate` Job (`k8s/jobs/migrate.yaml`, an Argo CD PreSync hook): `prisma migrate deploy` from the image being deployed, on `MIGRATE_DATABASE_URL`. If it fails, the sync stops and the old pods keep running; read its logs with `kubectl -n deny-list logs job/deny-list-migrate`. Migrations must work with the version still running, since its pods serve until the rollout replaces them.
- Check a deploy with `make status`, and `curl http://192.168.68.61:30083/readyz`.

## Releasing a version

The version that runs is `newTag` in `k8s/kustomization.yaml`.

Merging is releasing: every merged PR that changes code (anything besides `k8s/` and `*.md`) is released by CI's `release` job, after the tests and the image build on `main`.

1. The `release` job bumps the patch of the latest `v*` tag, or the minor (patch back to 0) when the merged PR has the `release:minor` label. A major bump isn't automatic.
2. It adds the version's tags (`x.y.z`, `x.y`, `latest`) to the image just pushed for that commit, without rebuilding, and pushes the git tag `vx.y.z`. That tag doesn't start another CI run.
3. Argo CD Image Updater commits the new `newTag` to `main` itself, as `argocd-image-updater`, through its deploy key (the ruleset lets deploy keys push directly). Run `git pull` after a release before branching again.

To release a version by hand (a commit CI skipped, or a version number the job wouldn't pick), `make release VERSION=x.y.z` tags the current commit and pushes the tag, and CI builds the image from it. Tag a commit that's on `main`. This is outward-facing: run it only when the user asks, with the version they gave.

Image Updater only takes `0.x.y` tags (`~0` in the platform repo's `manifests/argocd/deny-list-image-updater.yaml`). A `1.0.0` needs that range changed first.

## Rolling back

1. Add the bad tag to Image Updater's `ignoreTags` in the platform repo first.
2. Then set `newTag` back to the previous version on `main`, through a PR.

A revert without step 1 gets undone: Image Updater sees the bad tag as the newest and commits it again.

## Secrets

Secrets aren't in Git. `make secrets` creates or updates `deny-list-deps` (`DATABASE_URL`, `MIGRATE_DATABASE_URL`, `REDIS_URL`) from the `deny-list-postgres-role` and `redis-secret` Secrets in the `data` namespace. Then `make restart`. The migrate Job needs the Secret too: without it, the sync fails before deploying anything.

## Postgres connection budget

`DATABASE_URL` points at PgBouncer (`postgres-pooler-rw` in `data`, transaction mode), which shares at most 20 real Postgres connections (its `default_pool_size`, in the platform repo) between all of deny-list's pods. `DB_POOL_MAX` (in `k8s/api/10-configmap.yaml`) and the HPA's `maxReplicas` only size connections to PgBouncer, so raising them doesn't touch Postgres's 100. If requests start waiting on the pool, the PgBouncer dashboard's "Clients waiting" panel shows it; the fix is then in the platform repo's Pooler. `MIGRATE_DATABASE_URL` goes straight to `postgres-rw`, for migrations (see the comment above the Makefile's `secrets` target).
