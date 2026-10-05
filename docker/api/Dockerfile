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
RUN pnpm --filter @latex-studio/api... build
# pnpm 12 deploy needs --legacy to flatten workspace packages
RUN pnpm --filter @latex-studio/api deploy --prod --legacy /out

FROM node:26-alpine
WORKDIR /app
# The image ships a `node` user (uid 1000); the data volumes are created owned by it.
# npm is not needed at runtime (CMD is plain node) and its bundled deps are what Trivy flags.
RUN mkdir -p /data/repos /data/builds && chown -R node:node /data     && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=builder --chown=node:node /out .
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
