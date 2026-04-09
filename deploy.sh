#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────
# Deploy script for liz-whiteboard
# Builds locally, syncs to VPS, runs migrations,
# and restarts the app via PM2.
# ──────────────────────────────────────────────

# Configuration
SSH_HOST="dev-server"
DEPLOY_PATH="/var/www/liz-whiteboard"
APP_NAME="liz-whiteboard"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log()  { echo -e "${GREEN}[deploy]${NC} $1"; }
warn() { echo -e "${YELLOW}[deploy]${NC} $1"; }
err()  { echo -e "${RED}[deploy]${NC} $1" >&2; }

# ── Pre-flight checks ────────────────────────
log "Running pre-flight checks..."

if ! command -v bun &>/dev/null; then
  err "bun is not installed locally"; exit 1
fi

if ! command -v rsync &>/dev/null; then
  err "rsync is not installed locally"; exit 1
fi

if ! ssh -q "$SSH_HOST" exit 2>/dev/null; then
  err "Cannot connect to $SSH_HOST"; exit 1
fi

# ── Step 1: Build ─────────────────────────────
log "Installing dependencies..."
bun install --frozen-lockfile

log "Generating Prisma client..."
bun run db:generate

log "Building application..."
bun run build

if [ ! -d ".output" ]; then
  err "Build failed — .output directory not found"; exit 1
fi

log "Build complete."

# ── Step 2: Sync files to VPS ─────────────────
log "Ensuring remote directory exists..."
ssh "$SSH_HOST" "mkdir -p $DEPLOY_PATH/{logs,node_modules/.prisma,node_modules/@prisma}"

log "Syncing files to $SSH_HOST:$DEPLOY_PATH..."
rsync -azP --delete \
  .output/ \
  "$SSH_HOST:$DEPLOY_PATH/.output/"

rsync -azP \
  package.json \
  bun.lock \
  server.prod.ts \
  ecosystem.config.cjs \
  tsconfig.json \
  "$SSH_HOST:$DEPLOY_PATH/"

# Sync source files needed by server.ts (collaboration module + dependencies)
rsync -azP --delete \
  --include='*/' \
  --include='*.ts' \
  --exclude='*.test.*' \
  --exclude='*.spec.*' \
  src/ \
  "$SSH_HOST:$DEPLOY_PATH/src/"

rsync -azP --delete \
  prisma/ \
  "$SSH_HOST:$DEPLOY_PATH/prisma/"

# Sync node_modules needed for production (Prisma client, etc.)
rsync -azP --delete \
  node_modules/.prisma/ \
  "$SSH_HOST:$DEPLOY_PATH/node_modules/.prisma/"

rsync -azP --delete \
  node_modules/@prisma/ \
  "$SSH_HOST:$DEPLOY_PATH/node_modules/@prisma/"

log "Files synced."

# ── Step 3: Install production deps on server ──
log "Installing production dependencies on server..."
ssh "$SSH_HOST" "cd $DEPLOY_PATH && bun install --frozen-lockfile"

# ── Step 4: Restart application via PM2 ───────
log "Restarting application..."
ssh "$SSH_HOST" "cd $DEPLOY_PATH && pm2 describe $APP_NAME >/dev/null 2>&1 \
  && pm2 reload ecosystem.config.cjs \
  || pm2 start ecosystem.config.cjs"

# ── Done ──────────────────────────────────────
log "Deployment complete!"
ssh "$SSH_HOST" "pm2 show $APP_NAME --no-color" 2>/dev/null | head -20

echo ""
log "View logs: ssh $SSH_HOST 'pm2 logs $APP_NAME'"
