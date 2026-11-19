# The version deployed is the newTag in k8s/kustomization.yaml; VERSION
# defaults to it.
VERSION   ?= $(shell sed -n "s/^ *newTag: *//p" k8s/kustomization.yaml | head -1)
REGISTRY  := ghcr.io/c88lopez
NAMESPACE := deny-list
# Where Postgres and Redis run (the platform repo's manifests/data/).
DATA_NS   := data

.PHONY: tunnel dev-setup run test cover migrate-local migration image release secrets status logs restart

## --- local ---
# Local runs use the cluster's Postgres and Redis through `make tunnel`, with
# credentials read from their Secrets (each value is fetched once, and only by
# targets that use it). Override with the LOCAL_* variables.
#
#   run    the real deny_list database and Redis DB 2
#   test   deny_list_test and Redis DB 3
secret = $(shell kubectl -n $(DATA_NS) get secret $(1) -o jsonpath='{.data.$(2)}' | base64 -d)
# Percent-encoded: a password with @, / or : would otherwise break the URL.
uri    = $(shell jq -rn --arg v '$(1)' '$$v|@uri')
PG_PASS = $(eval PG_PASS := $(call uri,$(call secret,deny-list-postgres-role,password)))$(PG_PASS)
RD_PASS = $(eval RD_PASS := $(call uri,$(call secret,redis-secret,REDIS_PASSWORD)))$(RD_PASS)

# sslmode=disable: Postgres only accepts TLS 1.3, which Prisma's schema engine
# can't do on macOS (it uses the system's TLS, P1011 "bad protocol version").
# The port-forward is already encrypted up to the cluster.
LOCAL_DATABASE_URL      ?= postgres://deny_list:$(PG_PASS)@localhost:5433/deny_list?sslmode=disable
LOCAL_TEST_DATABASE_URL ?= postgres://deny_list:$(PG_PASS)@localhost:5433/deny_list_test?sslmode=disable
# Redis DB 0 and 1 are importer's. Keys are under deny-list: in any case.
LOCAL_REDIS_URL         ?= redis://:$(RD_PASS)@localhost:6380/2
LOCAL_TEST_REDIS_URL    ?= redis://:$(RD_PASS)@localhost:6380/3

# Leave it running in its own terminal. The same ports as importer's tunnel,
# so either one serves both repos (run only one of them).
tunnel: ## forward the cluster's Postgres (5433) and Redis (6380) to localhost
	@trap 'kill 0' INT TERM EXIT; \
	kubectl -n $(DATA_NS) port-forward svc/postgres-rw 5433:5432 & \
	kubectl -n $(DATA_NS) port-forward svc/redis 6380:6379 & \
	wait

dev-setup: ## once: create the test database in the cluster (needs the deny_list role from the platform repo)
	kubectl apply -f k8s/dev/

# Port 9467 for metrics: importer's run-api already uses 9464 locally.
run: export DATABASE_URL = $(LOCAL_DATABASE_URL)
run: export REDIS_URL = $(LOCAL_REDIS_URL)
run: export METRICS_PORT = 9467
run: ## run on your machine against the cluster (needs make tunnel): :3000, metrics on :9467
	npm run start:dev

test: export TEST_DATABASE_URL = $(LOCAL_TEST_DATABASE_URL)
test: export TEST_REDIS_URL = $(LOCAL_TEST_REDIS_URL)
test: ## unit and e2e tests, the e2e ones against the cluster's test database and Redis DB 3 (needs make tunnel)
	npm test
	npm run test:e2e

cover: export TEST_DATABASE_URL = $(LOCAL_TEST_DATABASE_URL)
cover: export TEST_REDIS_URL = $(LOCAL_TEST_REDIS_URL)
cover: ## the tests with coverage, in coverage/unit and coverage/e2e (needs make tunnel)
	npm run test:cov

# The real deny_list database, the one the cluster serves: in the cluster the
# migrate Job (k8s/jobs/migrate.yaml) does this on every sync. The tunnel
# forwards postgres-rw, so this goes straight to Postgres, as migrate needs.
migrate-local: export MIGRATE_DATABASE_URL = $(LOCAL_DATABASE_URL)
migrate-local: ## apply pending migrations to the real deny_list database (needs make tunnel)
	npx prisma migrate deploy

# Diffs the test database, brought up to date first, against
# prisma/schema.prisma, into a new migration. Review the SQL before
# committing it.
migration: export MIGRATE_DATABASE_URL = $(LOCAL_TEST_DATABASE_URL)
migration: ## after changing prisma/schema.prisma: make migration NAME=add_reason (needs make tunnel)
	@test -n "$(NAME)" || { echo "usage: make migration NAME=what_it_does"; exit 1; }
	npx prisma migrate deploy
	@dir=prisma/migrations/$$(date -u +%Y%m%d%H%M%S)_$(NAME); mkdir -p $$dir; \
	npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > $$dir/migration.sql; \
	echo "wrote $$dir/migration.sql"

image: ## build the image locally to try it (CI builds the one the cluster uses)
	docker build -t $(REGISTRY)/deny-list:$(VERSION) .

## --- kubernetes ---
# Argo CD deploys it from there: Image Updater commits the new tag to
# k8s/kustomization.yaml, and Argo CD rolls it out.
release: ## tag a version: CI builds the image, Argo CD deploys it: make release VERSION=0.2.0
	git tag v$(VERSION)
	git push origin v$(VERSION)

# DATABASE_URL goes through PgBouncer (postgres-pooler-rw, in the platform
# repo's manifests/data/postgres.yaml), not straight to Postgres. DB_POOL_MAX
# (k8s/api/10-configmap.yaml) caps each pod's pool, but those are connections to
# PgBouncer, which are cheap: 3*5 = 15 at the HPA's maximum. PgBouncer shares at
# most its default_pool_size (20) real connections between them, and that is
# what counts against Postgres's 100, however many pods there are.
#
# PgBouncer is in transaction mode: consecutive transactions may run on
# different real connections, so nothing can rely on session state (session
# advisory locks, LISTEN/NOTIFY, SET outside a transaction, temp tables).
# MIGRATE_DATABASE_URL goes straight to postgres-rw because migration tools
# take a session advisory lock: the migrate Job (k8s/jobs/migrate.yaml) uses it.
#
# --server-side: a client-side `kubectl apply` would keep a plain-text copy of
# the URLs (with their passwords) in the last-applied-configuration annotation.
# --force-conflicts: this target owns the Secret, so a changed value replaces
# the old one.
# The namespace is Argo CD's: only create it if it doesn't exist yet (before the
# first sync). Applying it over Argo CD's copy drops its tracking annotation, and
# the Application shows OutOfSync until the next commit.
# @: make expands the passwords into the command before echoing it, so without
# it they'd be printed in plain text.
secrets: ## create or update the service's Secret from the cluster's Postgres and Redis Secrets
	kubectl get namespace $(NAMESPACE) >/dev/null 2>&1 || kubectl apply -f k8s/00-namespace.yaml
	@echo "kubectl -n $(NAMESPACE) create secret generic deny-list-deps (DATABASE_URL, MIGRATE_DATABASE_URL, REDIS_URL)"
	@kubectl -n $(NAMESPACE) create secret generic deny-list-deps \
	  --from-literal=DATABASE_URL="postgres://deny_list:$(PG_PASS)@postgres-pooler-rw.$(DATA_NS).svc.cluster.local:5432/deny_list" \
	  --from-literal=MIGRATE_DATABASE_URL="postgres://deny_list:$(PG_PASS)@postgres-rw.$(DATA_NS).svc.cluster.local:5432/deny_list" \
	  --from-literal=REDIS_URL="redis://:$(RD_PASS)@redis.$(DATA_NS).svc.cluster.local:6379/2" \
	  --dry-run=client -o yaml | kubectl apply --server-side --force-conflicts -f -

status: ## show everything running in the namespace
	kubectl -n $(NAMESPACE) get all,configmap -o wide

logs: ## stream the pods' logs
	kubectl -n $(NAMESPACE) logs -l app=deny-list -f --prefix

restart: ## recreate the pods (e.g. after changing the ConfigMap or Secret)
	kubectl -n $(NAMESPACE) rollout restart deployment/deny-list
	kubectl -n $(NAMESPACE) rollout status deployment/deny-list
