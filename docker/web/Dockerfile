FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Every workspace package.json, so the frozen lockfile matches the workspace.
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/git-store/package.json packages/git-store/
COPY packages/latex-tools/package.json packages/latex-tools/
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_FASORX_URL
ARG VITE_FASORX_APP=latex
RUN pnpm --filter @latex-studio/web build

# The stock caddy binary is built on a Go stdlib and x/net with open CVEs; rebuild it on a
# patched Go. Drop this stage once caddy publishes an image built on it. Keep the xcaddy
# version below in sync with the final FROM tag (Dependabot only bumps the FROM).
FROM golang:1.27.2-alpine AS caddy
RUN go install github.com/caddyserver/xcaddy/cmd/xcaddy@v0.4.7
RUN xcaddy build v2.11.7 --output /caddy --replace golang.org/x/net=golang.org/x/net@v0.60.0

FROM caddy:2.11.7-alpine
# The base image ships brotli-libs and curl builds with HIGH CVEs fixed upstream; take the
# patched packages until the caddy image is rebuilt on them.
RUN apk upgrade --no-cache brotli-libs curl libcurl
COPY --from=caddy /caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /app/apps/web/dist /srv
