# --- build stage: compile TypeScript, keep only production dependencies ---
# Runs on the build machine's own arch: the output is JavaScript, so building
# for amd64 on an arm64 Mac doesn't need slow emulation. The one native piece
# is Prisma's schema engine, which the migrate Job runs (k8s/jobs/migrate.yaml):
# npm ci would fetch it for this stage (Alpine, musl), so it's told to fetch
# the runtime image's instead (distroless Debian 12, glibc, OpenSSL 3), for
# both archs CI builds.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /src
ENV PRISMA_CLI_BINARY_TARGETS=debian-openssl-3.0.x,linux-arm64-openssl-3.0.x
COPY package.json package-lock.json ./
# npm ci's postinstall runs prisma generate, which needs the schema.
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npx nest build && npm prune --omit=dev

# --- runtime stage: Node and the app, no shell or package manager, non-root ---
FROM gcr.io/distroless/nodejs24-debian12:nonroot
WORKDIR /app
# package.json for "type": "module", which makes Node load dist/ as ESM.
COPY --from=build /src/package.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/dist ./dist
# For the migrate Job: node_modules/prisma/build/index.js migrate deploy.
COPY --from=build /src/prisma.config.ts ./
COPY --from=build /src/prisma ./prisma
# Numeric UID (distroless "nonroot"): the kubelet can only verify runAsNonRoot
# from a number, since it can't look up user names inside the image.
USER 65532:65532
# The image's entrypoint is node. Tracing loads first, before anything it
# instruments (src/tracing.ts).
CMD ["--import", "./dist/tracing.js", "dist/main.js"]
