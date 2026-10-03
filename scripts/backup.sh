#!/usr/bin/env sh
# Nightly backup: Postgres dump + tar of the git repositories. Run from the repo root on the VPS,
# e.g. with cron: `0 3 * * * cd /srv/latex-studio && ./scripts/backup.sh /srv/backups`.
set -eu
dest="${1:-./backups}"
stamp="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$dest"
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-latex}" -d "${POSTGRES_DB:-latex}" \
  | gzip > "$dest/db-$stamp.sql.gz"
docker run --rm -v latex-studio_repos_data:/data:ro -v "$(cd "$dest" && pwd)":/out alpine \
  tar czf "/out/repos-$stamp.tar.gz" -C /data .
# Keep the last 14 of each.
ls -1t "$dest"/db-*.sql.gz | tail -n +15 | xargs -r rm --
ls -1t "$dest"/repos-*.tar.gz | tail -n +15 | xargs -r rm --
echo "backup written to $dest ($stamp)"
