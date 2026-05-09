// src/lib/auth/log-sample.ts
// Sampled logger for RBAC lookup failures — deduplicates per (userId, errorClass)
// within a 60-second window to prevent log flooding.

const WINDOW_MS = 60_000

// Size-bounded Map: at most MAX_ENTRIES keys. When full, the oldest entry
// (first insertion order in a Map) is evicted before adding a new key.
// This prevents unbounded memory growth on long-running servers with many
// unique (userId, errorClass) pairs. (Hermes BLOCKER-2 / Cassandra M-2)
const MAX_ENTRIES = 1_000
const lastLogAt = new Map<string, number>() // key: `${userId}:${errorClass}`

function evictOldestIfFull(map: Map<string, unknown>): void {
  if (map.size >= MAX_ENTRIES) {
    // Map iterates in insertion order — the first key is the oldest
    const oldestKey = map.keys().next().value
    if (oldestKey !== undefined) {
      map.delete(oldestKey)
    }
  }
}

/**
 * Log an error at ERROR level, but deduplicate within a 60-second window
 * keyed by (userId, errorClass). Subsequent calls with the same key within
 * the window are silently dropped.
 *
 * This is intentionally minimal — no external logger dependency.
 * The dedup window is in-process and non-durable (resets on restart).
 * Acceptable per PRD SEC-WS-03: "structured-log field; no new metrics infra required."
 */
export function logSampledError(args: {
  userId: string
  errorClass: string
  message: string
  eventName?: string
}): void {
  const key = `${args.userId}:${args.errorClass}`
  const now = Date.now()
  const last = lastLogAt.get(key) ?? 0
  if (now - last < WINDOW_MS) return
  // Evict oldest entry before inserting a new key (when at capacity)
  if (!lastLogAt.has(key)) {
    evictOldestIfFull(lastLogAt)
  }
  lastLogAt.set(key, now)
  console.error(
    `[auth] ${args.errorClass}: user=${args.userId} event=${args.eventName ?? 'n/a'} message="${args.message}"`,
  )
}
