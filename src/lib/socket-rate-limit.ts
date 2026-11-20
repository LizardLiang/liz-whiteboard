// src/lib/socket-rate-limit.ts
// Per-socket event limits and a per-user concurrent-connection cap for both
// Socket.IO namespaces (/whiteboard/:id and /canvas/:id). Applied in one place,
// guardSocketHandlers (src/lib/socket-safe.ts), so every listener is covered.
//
// Each limit is a token bucket: `burst` events at once, refilled at `perSecond`.
// Every number was set above the measured legitimate peak (see each `source`).
// A refused event gets an ack error when it has an ack, plus a sampled log
// line; the socket stays connected.

interface BucketSpec {
  burst: number
  perSecond: number
}

/** Every other event: table/column/relationship/area/shape/connector writes, canvas element:* and board:settings-update. */
const MUTATION: BucketSpec = { burst: 1000, perSecond: 200 }
// source: the largest legitimate burst is 500 table:move calls, which is the
// `.max(500)` of the MCP positions tool (liz-whiteboard-mcp
// src/mcp/tools/positions.ts, one awaited emitWithAck each, so roughly
// 100-300/s on a local network). The browser's first-load placement of pending
// tables (ReactFlowWhiteboard.tsx, one table:move per pending table) and a
// multi-select commit are the same order of size. 1000 covers two full MCP
// batches back to back; 200/s sustained is above that round-trip rate. Normal
// human use (drags emit once, on drag stop) stays far below.

const COMMENT: BucketSpec = { burst: 20, perSecond: 2 }
// source: comment:create/update/resolve/delete are one per human action
// (use-whiteboard-comments.ts emits on submit/click, no loop). A person cannot
// sustain more than about 1 per second; 20 burst allows rapid resolve clicks.

const SYNC: BucketSpec = { burst: 10, perSecond: 0.5 }
// source: sync:request reads the whole board. use-collaboration.ts emits it
// once per reconnect; each reconnect is a NEW socket with a fresh bucket, so a
// healthy client sends at most a handful per socket.

const HEARTBEAT: BucketSpec = { burst: 5, perSecond: 0.2 }
// source: use-collaboration.ts sends activity:heartbeat every 2 minutes
// (2 * 60 * 1000 ms). 5 burst / one per 5 s is about 25x the client rate.

const EXEMPT_EVENTS = new Set([
  // cursor:update has its own 60/s limiter in collaboration.ts.
  'cursor:update',
])

export function bucketFor(event: string): BucketSpec | null {
  if (EXEMPT_EVENTS.has(event)) return null
  if (event === 'sync:request') return SYNC
  if (event === 'activity:heartbeat') return HEARTBEAT
  if (event.startsWith('comment:')) return COMMENT
  return MUTATION
}

interface BucketState {
  tokens: number
  last: number
  refused: number
}

/**
 * One limiter per socket. Returns `{ ok: true }` when the event may run;
 * otherwise `{ ok: false, sample }` where `sample` is true on the 1st refusal
 * and every 100th after it for that event (the caller logs only sampled ones).
 */
export function createSocketEventLimiter(now: () => number = Date.now) {
  const buckets = new Map<string, BucketState>()
  return (event: string): { ok: true } | { ok: false; sample: boolean } => {
    const spec = bucketFor(event)
    if (!spec) return { ok: true }
    const t = now()
    // One bucket per class, not per event name, so a flood cannot dodge the
    // limit by rotating through names.
    const key =
      spec === SYNC
        ? 'sync'
        : spec === HEARTBEAT
          ? 'heartbeat'
          : spec === COMMENT
            ? 'comment'
            : 'mutation'
    let state = buckets.get(key)
    if (!state) {
      state = { tokens: spec.burst, last: t, refused: 0 }
      buckets.set(key, state)
    }
    const elapsed = Math.max(0, t - state.last) / 1000
    state.tokens = Math.min(spec.burst, state.tokens + elapsed * spec.perSecond)
    state.last = t
    if (state.tokens >= 1) {
      state.tokens -= 1
      return { ok: true }
    }
    state.refused += 1
    return { ok: false, sample: state.refused % 100 === 1 }
  }
}

/** Concurrent sockets one user may hold across both namespaces. */
export const MAX_SOCKETS_PER_USER = 100
// source: a browser tab holds one socket per open board; the MCP server keeps
// one socket per board and never closes idle ones (socket-manager.ts). 100 is
// well above any realistic tab + agent count. There is no measurement behind it.

const socketsPerUser = new Map<string, number>()

/**
 * Count a new socket for `userId`. Returns false (and counts nothing) when the
 * user is already at MAX_SOCKETS_PER_USER; the caller disconnects that socket.
 * The count drops when the socket disconnects.
 */
export function admitUserConnection(
  socket: { on: (event: string, listener: () => void) => unknown },
  userId: string,
): boolean {
  const current = socketsPerUser.get(userId) ?? 0
  if (current >= MAX_SOCKETS_PER_USER) return false
  socketsPerUser.set(userId, current + 1)
  let released = false
  socket.on('disconnect', () => {
    if (released) return
    released = true
    const left = (socketsPerUser.get(userId) ?? 1) - 1
    if (left <= 0) socketsPerUser.delete(userId)
    else socketsPerUser.set(userId, left)
  })
  return true
}

/** Clears the connection counts. For tests only. */
export function _resetUserConnectionsForTests(): void {
  socketsPerUser.clear()
}

/** Tell a refused socket why, log it, and close it. */
export function refuseConnection(
  socket: {
    emit: (event: string, payload: unknown) => unknown
    disconnect: (close?: boolean) => unknown
  },
  userId: string,
): void {
  console.warn(
    `[socket] connection refused: user ${userId} already holds ${MAX_SOCKETS_PER_USER} sockets`,
  )
  socket.emit('error', {
    event: 'connection',
    error: 'TOO_MANY_CONNECTIONS',
    message: 'Too many open connections for this account',
  })
  socket.disconnect(true)
}
