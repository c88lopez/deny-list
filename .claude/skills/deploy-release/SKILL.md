---
name: deploy-release
description: How deny-list gets to the cluster - Argo CD deploys from k8s/ on main, releasing a version with make release, rolling back, Secrets and the Postgres connection budget. Use when releasing, deploying, rolling back, changing k8s/ manifests, the HPA maximum or DB_POOL_MAX, or running make secrets.
---

# Deploy and release

## How a change reaches the cluster

- Argo CD deploys `k8s/` from `main`. The Application lives in the separate platform repo, not here.
- Changes reach `main` through PRs. A merged PR that changes only `k8s/` (the ConfigMap, the HPA) is live within a few minutes, with no release. Such commits skip CI.
- Check a deploy with `make status`, and `curl http://192.168.68.57:30083/readyz`.

## Releasing a version

The version that runs is `newTag` in `k8s/kustomization.yaml`.

1. `make release VERSION=x.y.z` tags `vx.y.z` on the current commit and pushes the tag. Tag a commit that's on `main`. This is outward-facing: run it only when the user asks, with the version they gave.
2. CI builds the image from the tag and pushes `ghcr.io/c88lopez/deny-list:x.y.z`.
3. Argo CD Image Updater commits the new `newTag` to `main` itself, as `argocd-image-updater`, through its deploy key (the ruleset lets deploy keys push directly). Run `git pull` after a release before branching again.

Image Updater only takes `0.x.y` tags (`~0` in the platform repo's `manifests/argocd/deny-list-image-updater.yaml`). A `1.0.0` needs that range changed first.

## Rolling back

1. Add the bad tag to Image Updater's `ignoreTags` in the platform repo first.
2. Then set `newTag` back to the previous version on `main`, through a PR.

A revert without step 1 gets undone: Image Updater sees the bad tag as the newest and commits it again.

## Secrets

Secrets aren't in Git. `make secrets` creates or updates `deny-list-deps` (`DATABASE_URL`, `MIGRATE_DATABASE_URL`, `REDIS_URL`) from the `deny-list-postgres-role` and `redis-secret` Secrets in the `data` namespace. Then `make restart`.

## Postgres connection budget

`DATABASE_URL` points at PgBouncer (`postgres-pooler-rw` in `data`, transaction mode), which shares at most 20 real Postgres connections (its `default_pool_size`, in the platform repo) between all of deny-list's pods. `DB_POOL_MAX` (in `k8s/api/10-configmap.yaml`) and the HPA's `maxReplicas` only size connections to PgBouncer, so raising them doesn't touch Postgres's 100. If requests start waiting on the pool, the PgBouncer dashboard's "Clients waiting" panel shows it; the fix is then in the platform repo's Pooler. `MIGRATE_DATABASE_URL` goes straight to `postgres-rw`, for migrations (see the comment above the Makefile's `secrets` target).
