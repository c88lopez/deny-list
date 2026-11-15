# --- build stage: compile TypeScript, keep only production dependencies ---
# Runs on the build machine's own arch: the output is JavaScript and the
# dependencies have no native code, so building for amd64 on an arm64 Mac
# doesn't need slow emulation.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
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
# Numeric UID (distroless "nonroot"): the kubelet can only verify runAsNonRoot
# from a number, since it can't look up user names inside the image.
USER 65532:65532
# The image's entrypoint is node. Tracing loads first, before anything it
# instruments (src/tracing.ts).
CMD ["--import", "./dist/tracing.js", "dist/main.js"]
