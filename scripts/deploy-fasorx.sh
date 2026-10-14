#!/usr/bin/env bash
# Publishes latex-studio on the FasorX server. Run by the `publish` job in ci.yml after it wrote
# $DEST/.env from the GitHub environment secrets; the code arrives as a `git archive` tarball.
# Builds, starts, applies the worker's database role, checks health, and rolls back on failure.
# DEST and the archive path can be overridden to rehearse it elsewhere.
set -euo pipefail

ARCHIVE=${1:-/tmp/latex-studio.tgz}
DEST=${DEST:-/srv/latex-studio}
IMAGES="latex-studio-api latex-studio-worker latex-studio-caddy"

compose() { docker compose -f docker-compose.yml -f docker-compose.fasorx.yml "$@"; }

[ -f "$ARCHIVE" ] || { echo "ERROR: no archive at $ARCHIVE" >&2; exit 1; }
[ -f "$DEST/.env" ] || { echo "ERROR: $DEST/.env missing (the workflow writes it)" >&2; exit 1; }
trap 'rm -f "$ARCHIVE"' EXIT

# --- rollback point: the current tree and the images it built ---------------
rm -rf "$DEST.previous"
cp -a "$DEST" "$DEST.previous"
for i in $IMAGES; do
  if docker image inspect "$i" >/dev/null 2>&1; then docker tag "$i" "$i:previous"; fi
done

rollback() {
  echo "==> Rolling back to the previous version." >&2
  rm -rf "$DEST"
  mv "$DEST.previous" "$DEST"
  for i in $IMAGES; do
    if docker image inspect "$i:previous" >/dev/null 2>&1; then docker tag "$i:previous" "$i"; fi
  done
  (cd "$DEST" && [ -f docker-compose.yml ] && compose up -d --no-build >/dev/null 2>&1) || true
}

logs() {
  for s in api worker caddy; do
    echo "--- $s ---" >&2
    (cd "$DEST" && compose logs --tail 25 "$s" 2>&1 | sed 's/^/    /' >&2) || true
  done
}

# --- new tree, keeping the .env (it never travels in the archive) -----------
NEW=$(mktemp -d)
tar -xzf "$ARCHIVE" -C "$NEW"
cp -a "$DEST/.env" "$NEW/.env"
rm -rf "$DEST"
mv "$NEW" "$DEST"
chmod 755 "$DEST"
cd "$DEST"

echo "==> Building."
if ! out=$(compose build 2>&1); then
  echo "ERROR: build failed." >&2
  echo "$out" | tail -30 >&2
  rollback
  exit 1
fi

# --- data services and the API first: the API runs the migrations at boot ---
echo "==> Starting Postgres, Redis and the API."
if ! compose up -d --wait postgres redis api >/dev/null 2>&1; then
  echo "ERROR: the API did not become healthy." >&2
  logs
  rollback
  exit 1
fi

# The worker's least-privilege role, re-applied after every migration (grants are per table). The
# password goes through stdin, never a command line where `ps` would show it.
set -a
# shellcheck disable=SC1091
. ./.env
set +a
if [ -n "${POSTGRES_WORKER_PASSWORD:-}" ]; then
  echo "==> Applying the worker's database role."
  { printf '%s\n' "\\set worker_password '$POSTGRES_WORKER_PASSWORD'"; cat docker/postgres/worker-role.sql; } |
    compose exec -T postgres psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null
fi

echo "==> Starting the worker and Caddy."
if ! compose up -d >/dev/null 2>&1; then
  echo "ERROR: the services did not start." >&2
  logs
  rollback
  exit 1
fi

# --- through Caddy, as the host proxy will reach it; and the worker must stay up (it refuses to
# start without its sandbox, which would otherwise look like a healthy deploy) ------------------
echo -n "==> Checking "
ok=0
for _ in $(seq 1 30); do
  code=$(curl -fsS -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:3010/api/health 2>/dev/null || echo 000)
  worker=$(docker inspect -f '{{.State.Running}} {{.RestartCount}}' "$(compose ps -q worker)" 2>/dev/null || echo "false 0")
  if [ "$code" = 200 ] && [ "$worker" = "true 0" ]; then ok=1; break; fi
  echo -n "."
  sleep 3
done
echo ""
if [ "$ok" != 1 ]; then
  echo "ERROR: health=$code worker=($worker), expected 200 and a running worker." >&2
  logs
  rollback
  exit 1
fi
# A worker that dies a few seconds after starting (sandbox probe, Redis) shows up now.
sleep 10
worker=$(docker inspect -f '{{.State.Running}} {{.RestartCount}}' "$(compose ps -q worker)" 2>/dev/null || echo "false 0")
if [ "$worker" != "true 0" ]; then
  echo "ERROR: the worker is not staying up ($worker)." >&2
  logs
  rollback
  exit 1
fi

rm -rf "$DEST.previous"
for i in $IMAGES; do docker image rm "$i:previous" >/dev/null 2>&1 || true; done
docker image prune -f >/dev/null 2>&1 || true

echo "==> latex-studio published."
compose ps --format '    {{.Service}}  {{.Status}}'
