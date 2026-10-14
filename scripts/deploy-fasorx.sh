#!/usr/bin/env bash
# Publishes latex-studio on the FasorX server. Run by the `publish` job in ci.yml after it wrote
# $DEST/.env.next from the GitHub environment secrets; the code arrives as a `git archive` tarball.
# Builds, starts, applies the worker's database role, checks health, and rolls back on failure:
# the previous code, images and .env come back.
# DEST and the archive path can be overridden to rehearse it elsewhere.
# ponytail: rollback does not undo migrations (they only go forward).
set -euo pipefail

ARCHIVE=${1:-/tmp/latex-studio.tgz}
DEST=${DEST:-/srv/latex-studio}
# Next to DEST, so it survives a rollback; the Actions log of a public repo only gets its path.
FAILURE_LOG="$DEST.last-failure.log"
IMAGES="latex-studio-api latex-studio-worker latex-studio-caddy"

compose() { docker compose -f docker-compose.yml -f docker-compose.fasorx.yml "$@"; }

[ -f "$ARCHIVE" ] || { echo "ERROR: no archive at $ARCHIVE" >&2; exit 1; }
[ -f "$DEST/.env.next" ] || { echo "ERROR: $DEST/.env.next missing (the workflow writes it)" >&2; exit 1; }
trap 'rm -f "$ARCHIVE"' EXIT

# --- rollback point: the current tree (with its own .env) and the images it built ---
rm -rf "$DEST.previous"
cp -a "$DEST" "$DEST.previous"
rm -f "$DEST.previous/.env.next"
for i in $IMAGES; do
  if docker image inspect "$i" >/dev/null 2>&1; then docker tag "$i" "$i:previous"; fi
done

# Stops here with the failure's logs saved and the previous version running again.
fail() {
  echo "ERROR: $1" >&2
  for s in api worker caddy; do
    echo "--- $s ---"
    (cd "$DEST" && compose logs --tail 50 "$s" 2>&1) || true
  done >"$FAILURE_LOG" 2>&1
  chmod 600 "$FAILURE_LOG"
  echo "    Logs: $FAILURE_LOG (on the server)" >&2
  echo "==> Rolling back to the previous version." >&2
  # First deploy: nothing to go back to, so stop what this run started.
  if [ ! -f "$DEST.previous/docker-compose.yml" ]; then (cd "$DEST" && compose down) || true; fi
  rm -rf "$DEST"
  mv "$DEST.previous" "$DEST"
  for i in $IMAGES; do
    if docker image inspect "$i:previous" >/dev/null 2>&1; then docker tag "$i:previous" "$i"; fi
  done
  if [ -f "$DEST/docker-compose.yml" ]; then
    (cd "$DEST" && compose up -d --no-build >/dev/null 2>&1) || true
  fi
  exit 1
}

# --- new tree with the new .env (it never travels in the archive) -----------
NEW=$(mktemp -d)
tar -xzf "$ARCHIVE" -C "$NEW"
cp -a "$DEST/.env.next" "$NEW/.env"
rm -rf "$DEST"
mv "$NEW" "$DEST"
chmod 755 "$DEST"
cd "$DEST"

echo "==> Building."
if ! out=$(compose build 2>&1); then
  echo "$out" | tail -30 >&2
  fail "build failed."
fi

# --- data services and the API first: the API runs the migrations at boot ---
echo "==> Starting Postgres, Redis and the API."
compose up -d --wait --wait-timeout 180 postgres redis api >/dev/null 2>&1 ||
  fail "the API did not become healthy."

# The worker's least-privilege role, re-applied after every migration (grants are per table). The
# password goes through stdin, never a command line where `ps` would show it; .env is read, not
# sourced, so no value in it can run as a command.
WORKER_PASSWORD=$(sed -n 's/^POSTGRES_WORKER_PASSWORD=//p' .env)
if [ -n "$WORKER_PASSWORD" ]; then
  echo "==> Applying the worker's database role."
  { printf '%s\n' "\\set worker_password '$WORKER_PASSWORD'"; cat docker/postgres/worker-role.sql; } |
    compose exec -T postgres sh -c 'psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null ||
    fail "applying docker/postgres/worker-role.sql failed."
fi

echo "==> Starting the worker and Caddy."
compose up -d >/dev/null 2>&1 || fail "the services did not start."

# --- through Caddy, as the host proxy will reach it; and the worker must stay up (it refuses to
# start without its sandbox, which would otherwise look like a healthy deploy). An unchanged worker
# keeps its container, so compare its restarts with the count it has now, not with zero. --------
restarts() { docker inspect -f '{{.State.Running}} {{.RestartCount}}' "$(compose ps -q worker)" 2>/dev/null || echo "false -"; }
baseline=$(restarts | cut -d' ' -f2)
echo -n "==> Checking "
ok=0
for _ in $(seq 1 30); do
  code=$(curl -fsS -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:3010/api/health 2>/dev/null || echo 000)
  if [ "$code" = 200 ] && [ "$(restarts)" = "true $baseline" ]; then ok=1; break; fi
  echo -n "."
  sleep 3
done
echo ""
[ "$ok" = 1 ] || fail "health=$code worker=($(restarts)), expected 200 and a running worker."
# A worker that dies a few seconds after starting (sandbox probe, Redis) shows up now.
sleep 10
[ "$(restarts)" = "true $baseline" ] || fail "the worker is not staying up ($(restarts))."

rm -rf "$DEST.previous"
for i in $IMAGES; do docker image rm "$i:previous" >/dev/null 2>&1 || true; done
docker image prune -f >/dev/null 2>&1 || true

echo "==> latex-studio published."
compose ps --format '    {{.Service}}  {{.Status}}'
