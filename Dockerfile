# Pinned: the built react-dom 19.x bundle does not parse on Bun < 1.4.4.
FROM oven/bun:1.4.4

WORKDIR /app

# ── Layer: dependencies (cached until lockfile changes) ──────────────────────
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ── Layer: source ────────────────────────────────────────────────────────────
COPY . .

# ── Layer: Vite / Nitro build ────────────────────────────────────────────────
# VITE_E2E_HOOKS=1 publishes window.__canvasEngine for Playwright
# (src/components/canvas/canvas-test-hook.ts). Vite reads VITE_* at build time,
# so it must be a build arg. Empty by default: production images omit the hook.
ARG VITE_E2E_HOOKS=
ENV VITE_E2E_HOOKS=$VITE_E2E_HOOKS
RUN bun run build
# Result: .output/ (Nitro middleware bundle + public assets)

# ── Runtime environment ──────────────────────────────────────────────────────
# Absolute path avoids CWD-relative ambiguity for SQLite. The data/ dir and the
# schema are created automatically on first DB connection (see src/db.ts).
ENV DATABASE_URL=file:/app/data/app.db
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Runs as root for now. The prod data volume is root-owned and the mcp service
# (root) writes the same SQLite file and its -wal/-shm, so a non-root app would
# lose write access. Switching needs both services on one uid plus a one-time
# chown of the volume.
RUN chmod +x /app/entrypoint.sh \
 && mkdir -p /app/data
CMD ["/app/entrypoint.sh"]
