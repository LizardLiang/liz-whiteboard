#!/bin/sh
set -e

# Seeding imports the data layer, which creates the SQLite schema on first
# connection (src/db.ts runs the CREATE TABLE IF NOT EXISTS statements), so no
# separate "apply schema" step is needed.
echo "[entrypoint] Seeding database..."
bun seed.ts

echo "[entrypoint] Starting production server on port ${PORT:-3000}..."
exec bun server.prod.ts
