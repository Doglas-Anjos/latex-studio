FROM node:26-alpine AS builder
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

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /app/apps/web/dist /srv
