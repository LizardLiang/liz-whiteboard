#!/bin/sh
set -e

# The data layer creates the SQLite schema on first connection (src/db.ts runs
# the CREATE TABLE IF NOT EXISTS statements), so booting needs no separate
# "apply schema" step.
#
# The container runs as the non-root `bun` user. A data volume created by an
# older root-running image is root-owned and unwritable; SQLite would then fail
# on the first write, so stop early with the fix instead.
DATA_DIR="$(dirname "${DATABASE_URL#file:}")"
if [ -d "$DATA_DIR" ] && [ ! -w "$DATA_DIR" ]; then
  echo "[entrypoint] ERROR: $DATA_DIR is not writable by $(id -un) (uid $(id -u))." >&2
  echo "[entrypoint] One-time fix for a volume created by a root-running image:" >&2
  echo "[entrypoint]   docker run --rm -u 0 -v <volume>:$DATA_DIR oven/bun:1.4.4 chown -R $(id -u):$(id -g) $DATA_DIR" >&2
  exit 1
fi

# Seeding is DESTRUCTIVE — seed.ts DELETEs all diagram data before inserting the
# demo project. It must therefore be opt-in so a production database (or a
# migrated one) is never wiped on container start. Enable with SEED_ON_START=true
# only for throwaway/dev databases.
if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] SEED_ON_START=true → seeding database (destructive)..."
  bun seed.ts
fi

echo "[entrypoint] Starting production server on port ${PORT:-3000}..."
exec bun server.prod.ts
