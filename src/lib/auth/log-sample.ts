// src/lib/auth/log-sample.ts
// Sampled logger for RBAC lookup failures — deduplicates per (userId, errorClass)
// within a 60-second window to prevent log flooding.

const WINDOW_MS = 60_000
const lastLogAt = new Map<string, number>() // key: `${userId}:${errorClass}`

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
  lastLogAt.set(key, now)
  console.error(
    `[auth] ${args.errorClass}: user=${args.userId} event=${args.eventName ?? 'n/a'} message="${args.message}"`,
  )
}
