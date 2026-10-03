FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @latex-studio/api... build
# pnpm 12 deploy needs --legacy to flatten workspace packages
RUN pnpm --filter @latex-studio/api deploy --prod --legacy /out

FROM node:22-alpine
WORKDIR /app
RUN addgroup -g 1000 app && adduser -D -u 1000 -G app app     && mkdir -p /data/repos /data/builds && chown -R app:app /data
COPY --from=builder --chown=app:app /out .
USER app
EXPOSE 3000
CMD ["node", "dist/main.js"]
