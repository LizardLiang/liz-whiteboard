// src/lib/auth/socket-registry.ts
// Live-socket registry: lets the server cut a user's sockets when their
// access changes (logout, password reset, membership removal/demotion) and
// re-validates every socket periodically.
//
// Why a registry and not io.in('user:<id>'): namespaces are per board
// (`/whiteboard/<uuid>`, `/canvas/<uuid>`), so a user's sockets live in many
// namespaces; one process-wide map is simpler than iterating them. State sits
// on globalThis because server.prod.ts loads this module from both the built
// bundle and the raw source (see the Phase 6 note in collaboration.ts).
//
// Dev caveat: in dev, sockets live in the server.dev.ts process, which the
// Vite process (running server functions) cannot reach, so immediate
// disconnects do not cross that boundary there. The periodic recheck below
// still cuts such sockets within RECHECK_INTERVAL_MS.

import { db } from '@/db'

export const RECHECK_INTERVAL_MS = 60_000

export interface RegistrableSocket {
  id?: string
  data: Record<string, unknown>
  emit?: (event: string, payload?: unknown) => unknown
  disconnect: (close?: boolean) => unknown
  on: (event: string, cb: () => void) => unknown
}

interface Entry {
  socket: RegistrableSocket
  timer: ReturnType<typeof setInterval>
}

declare global {
  var __lizSocketRegistry: Map<string, Set<Entry>> | undefined
}

function registry(): Map<string, Set<Entry>> {
  return (globalThis.__lizSocketRegistry ??= new Map())
}

function sessionStillValid(socket: RegistrableSocket): boolean {
  const exp = socket.data.sessionExpiresAt
  if (!Number.isFinite(exp) || Date.now() > (exp as number)) return false
  const sessionId = socket.data.sessionId
  // JWT (MCP) sockets have no DB session; their expiry check above is all
  // there is, and their role is re-checked through `hasAccess`.
  if (typeof sessionId !== 'string' || sessionId === '') return true
  const row = db
    .prepare('SELECT 1 AS ok FROM "Session" WHERE "id" = ? AND "expiresAt" > ?')
    .get(sessionId, Date.now())
  return !!row
}

function cut(socket: RegistrableSocket, reason: string): void {
  try {
    socket.emit?.('session_expired', { reason })
  } catch {
    // socket may already be closing
  }
  socket.disconnect(true)
}

/**
 * Register a connected socket and start its periodic recheck. `hasAccess`
 * (optional) re-evaluates board access, e.g. role >= VIEWER; a false or a
 * throw cuts the socket. Returns a function that unregisters it.
 */
export function trackSocket(
  socket: RegistrableSocket,
  hasAccess?: () => Promise<boolean> | boolean,
  intervalMs: number = RECHECK_INTERVAL_MS,
): () => void {
  const userId = socket.data.userId
  if (typeof userId !== 'string' || userId === '') return () => {}

  const timer = setInterval(() => {
    void (async () => {
      try {
        if (!sessionStillValid(socket)) return cut(socket, 'session')
        if (hasAccess && !(await hasAccess())) return cut(socket, 'access')
      } catch {
        cut(socket, 'recheck_failed')
      }
    })()
  }, intervalMs)
  timer.unref()

  const entry: Entry = { socket, timer }
  const map = registry()
  let set = map.get(userId)
  if (!set) map.set(userId, (set = new Set()))
  set.add(entry)

  const untrack = () => {
    clearInterval(timer)
    const s = map.get(userId)
    if (!s) return
    s.delete(entry)
    if (s.size === 0) map.delete(userId)
  }
  socket.on('disconnect', untrack)
  return untrack
}

/** Disconnect every live socket of a user (all boards, all sessions). */
export function disconnectUserSockets(userId: string, reason = 'access_changed'): number {
  const set = registry().get(userId)
  if (!set) return 0
  const entries = [...set]
  for (const e of entries) cut(e.socket, reason)
  return entries.length
}

/** Disconnect only the cookie sockets that handshook with this auth Session. */
export function disconnectSessionSockets(sessionId: string, reason = 'logout'): number {
  let n = 0
  for (const set of registry().values()) {
    for (const e of [...set]) {
      if (e.socket.data.sessionId === sessionId) {
        cut(e.socket, reason)
        n++
      }
    }
  }
  return n
}

/** Number of tracked sockets. For tests. */
export function trackedSocketCount(): number {
  let n = 0
  for (const set of registry().values()) n += set.size
  return n
}

/** Clears the registry and its timers. For tests only. */
export function _resetSocketRegistryForTests(): void {
  for (const set of registry().values()) for (const e of set) clearInterval(e.timer)
  registry().clear()
}
