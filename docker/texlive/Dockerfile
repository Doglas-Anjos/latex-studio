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
RUN pnpm --filter @latex-studio/worker... build
# pnpm 12 deploy needs --legacy to flatten workspace packages
RUN pnpm --filter @latex-studio/worker deploy --prod --legacy /out

# Full TeX Live (latexmk, texcount, latexindent included); pandoc and latexindent's Perl modules
# from Debian; node copied from the official image
FROM texlive/texlive:latest
RUN apt-get update && apt-get install -y --no-install-recommends pandoc bubblewrap \
    libyaml-tiny-perl libfile-homedir-perl liblog-log4perl-perl libunicode-linebreak-perl \
    && rm -rf /var/lib/apt/lists/*
RUN latexindent --version
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
# uid 1000 may or may not exist in the base image; the process and the volumes use the number.
RUN (getent passwd 1000 >/dev/null || (groupadd -g 1000 worker && useradd -u 1000 -g 1000 worker)) \
    && mkdir -p /data/repos /data/builds /app && chown -R 1000:1000 /data /app
WORKDIR /app
COPY --from=builder --chown=1000:1000 /out .
# kpathsea reads these from the environment: paranoid file access, no shell escape
ENV openin_any=p openout_any=p shell_escape=f HOME=/tmp
USER 1000
CMD ["node", "dist/main.js"]
