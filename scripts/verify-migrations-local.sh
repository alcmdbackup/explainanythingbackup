#!/bin/bash
# Verifies that all migrations in supabase/migrations/ apply cleanly against a
# fresh, empty postgres. Uses an ephemeral Docker postgres container on a random
# port — never touches the user's live local Supabase DB (port 54322).
#
# Exit codes:
#   0 — all migrations applied successfully
#   1 — a migration failed, or required tooling missing
#
# Kill switches:
#   MIGRATION_VERIFY_SKIP=true — exits 0 with stderr warning (last-resort bypass)
#
# Used by /finalize Step 5.5 when supabase/migrations/** is in the PR's diff.

set -u

if [[ "${MIGRATION_VERIFY_SKIP:-}" = "true" ]]; then
  echo "migration verify skipped via MIGRATION_VERIFY_SKIP" >&2
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  cat >&2 <<'EOF'
migration:verify requires Docker.

Install Docker:
  Linux:   sudo apt-get install -y docker.io && sudo usermod -aG docker $USER
  macOS:   brew install --cask docker  (then launch Docker Desktop once)
  Windows: download Docker Desktop from docker.com

Or set MIGRATION_VERIFY_SKIP=true to bypass (not recommended).
EOF
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but the daemon isn't running. Start Docker Desktop or 'sudo systemctl start docker'." >&2
  exit 1
fi

# Portable random port picker in the ephemeral range (49152-65535).
# Uses ss on Linux, lsof as fallback (macOS).
pick_port() {
  local p
  for _ in 1 2 3 4 5; do
    p=$(( 49152 + RANDOM % 16384 ))
    if command -v ss >/dev/null 2>&1; then
      if ! ss -tan 2>/dev/null | awk '{print $4}' | grep -q ":$p$"; then
        echo "$p"
        return 0
      fi
    elif command -v lsof >/dev/null 2>&1; then
      if ! lsof -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
        echo "$p"
        return 0
      fi
    else
      # No port checker — just trust $RANDOM
      echo "$p"
      return 0
    fi
  done
  echo "could not find a free ephemeral port after 5 tries" >&2
  return 1
}

SHADOW_PORT=$(pick_port) || exit 1
echo "→ Starting ephemeral postgres on localhost:$SHADOW_PORT"

CONTAINER_ID=$(docker run --rm -d \
  -p "${SHADOW_PORT}:5432" \
  -e POSTGRES_PASSWORD=shadow \
  -e POSTGRES_DB=postgres \
  postgres:15-alpine 2>&1)
DOCKER_RC=$?

if [[ $DOCKER_RC -ne 0 ]]; then
  echo "Failed to start postgres container:" >&2
  echo "$CONTAINER_ID" >&2
  echo "If this is a transient registry error, retry. Otherwise check docker pull permissions." >&2
  exit 1
fi

# Ensure container is reaped on any exit path (including SIGINT/SIGTERM)
cleanup() {
  docker stop "$CONTAINER_ID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# Wait for postgres ready, capped at 30s (150 × 0.2s)
echo "→ Waiting for postgres to be ready..."
READY=0
for _ in $(seq 1 150); do
  if docker exec "$CONTAINER_ID" pg_isready -q -U postgres 2>/dev/null; then
    READY=1
    break
  fi
  sleep 0.2
done

if [[ $READY -eq 0 ]]; then
  echo "postgres did not become ready within 30s" >&2
  exit 1
fi

CONN_STRING="postgresql://postgres:shadow@localhost:${SHADOW_PORT}/postgres"

# Best-effort fetch so migration set is computed against current upstream
git fetch origin main --quiet --depth=50 2>/dev/null || true

# Apply all migrations in lexicographic order (matches Supabase CLI's order).
# Use ON_ERROR_STOP so any failure aborts the run.
echo "→ Applying migrations..."
SHOPT_RESET=$(shopt -p nullglob)
shopt -s nullglob
MIGRATIONS=(supabase/migrations/*.sql)
$SHOPT_RESET

if [[ ${#MIGRATIONS[@]} -eq 0 ]]; then
  echo "No migrations found in supabase/migrations/ — nothing to verify."
  exit 0
fi

for migration in "${MIGRATIONS[@]}"; do
  if ! PGPASSWORD=shadow psql "$CONN_STRING" -v ON_ERROR_STOP=1 -q -f "$migration" 2>&1; then
    echo "" >&2
    echo "FAIL: migration did not apply cleanly: $migration" >&2
    echo "" >&2
    echo "Tables in shadow DB at failure point:" >&2
    docker exec "$CONTAINER_ID" psql -U postgres -c '\dt' >&2 2>/dev/null || true
    echo "" >&2
    echo "Fix the migration, then re-run /finalize from Step 5.5." >&2
    echo "Your live local DB was not touched (verification ran in an ephemeral Docker postgres)." >&2
    exit 1
  fi
done

# Idempotency lint
if [[ -f "scripts/lint-migrations-idempotent.ts" ]]; then
  echo "→ Linting migration idempotency..."
  if ! npx --no-install tsx scripts/lint-migrations-idempotent.ts 2>&1; then
    echo "FAIL: migration idempotency lint" >&2
    exit 1
  fi
fi

echo ""
echo "PASS: all ${#MIGRATIONS[@]} migration(s) applied cleanly to a fresh DB"
exit 0
