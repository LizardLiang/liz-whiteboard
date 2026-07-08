FROM oven/bun:1

WORKDIR /app

# ── Layer: dependencies (cached until lockfile changes) ──────────────────────
# Note: not using --frozen-lockfile so the integration-test image builds even
# when the working-tree lockfile is mid-development / not perfectly synced.
COPY package.json bun.lock ./
RUN bun install

# ── Layer: source ────────────────────────────────────────────────────────────
COPY . .

# ── Layer: Vite / Nitro build ────────────────────────────────────────────────
RUN bun run build
# Result: .output/ (Nitro middleware bundle + public assets)

# ── Runtime environment ──────────────────────────────────────────────────────
# Absolute path avoids CWD-relative ambiguity for SQLite. The data/ dir and the
# schema are created automatically on first DB connection (see src/db.ts).
ENV DATABASE_URL=file:/app/data/app.db
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

RUN chmod +x /app/entrypoint.sh
CMD ["/app/entrypoint.sh"]
