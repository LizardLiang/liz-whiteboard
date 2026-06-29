#!/bin/sh
set -e

# The data layer creates the SQLite schema on first connection (src/db.ts runs
# the CREATE TABLE IF NOT EXISTS statements), so booting needs no separate
# "apply schema" step.
#
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
