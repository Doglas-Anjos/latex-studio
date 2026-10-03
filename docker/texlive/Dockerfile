FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @latex-studio/worker... build
# pnpm 12 deploy needs --legacy to flatten workspace packages
RUN pnpm --filter @latex-studio/worker deploy --prod --legacy /out

# Full TeX Live (latexmk, texcount included); pandoc from Debian; node copied from the official image
FROM texlive/texlive:latest
RUN apt-get update && apt-get install -y --no-install-recommends pandoc     && rm -rf /var/lib/apt/lists/*
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
RUN groupadd -g 1000 worker && useradd -u 1000 -g worker worker     && mkdir -p /data/repos /data/builds /app && chown -R worker:worker /data /app
WORKDIR /app
COPY --from=builder --chown=worker:worker /out .
# kpathsea reads these from the environment: paranoid file access, no shell escape
ENV openin_any=p openout_any=p shell_escape=f HOME=/tmp
USER worker
CMD ["node", "dist/main.js"]
