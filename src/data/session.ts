// src/data/session.ts
// Data access layer for auth Session entity (not CollaborationSession)

import type { Session } from '@/data/models'
import { db, genId, insert, mapSession, nowMs, toDbDate } from '@/db'

/**
 * Session joined with a minimal user selection (mirrors the Prisma
 * `include: { user: { select: { id, username, email } } }` shape).
 */
export type SessionWithUser = Session & {
  user: { id: string; username: string; email: string }
}

/**
 * Create an auth session
 * @param data - Session data
 * @returns Created session
 */
export async function createAuthSession(data: {
  tokenHash: string
  userId: string
  expiresAt: Date
}): Promise<Session> {
  const id = genId()
  const ts = nowMs()
  insert('Session', {
    id,
    tokenHash: data.tokenHash,
    userId: data.userId,
    expiresAt: toDbDate(data.expiresAt),
    createdAt: ts,
  })
  return mapSession(
    db.prepare('SELECT * FROM "Session" WHERE "id" = ?').get(id),
  )!
}

/**
 * Find an auth session by token hash
 * @param tokenHash - SHA-256 hash of the raw session token
 * @returns Session with user or null if not found
 */
export async function findAuthSessionByTokenHash(
  tokenHash: string,
): Promise<SessionWithUser | null> {
  const session = mapSession(
    db.prepare('SELECT * FROM "Session" WHERE "tokenHash" = ?').get(tokenHash),
  )
  if (!session) return null

  const user = db
    .prepare('SELECT "id", "username", "email" FROM "User" WHERE "id" = ?')
    .get(session.userId)
  if (!user) return null

  return {
    ...session,
    user: {
      id: user.id as string,
      username: user.username as string,
      email: user.email as string,
    },
  }
}

/**
 * Delete an auth session by ID
 * @param id - Session UUID
 */
export async function deleteAuthSession(id: string): Promise<void> {
  try {
    db.prepare('DELETE FROM "Session" WHERE "id" = ?').run(id)
  } catch {
    // ignore
  }
}

/**
 * Delete all expired auth sessions
 * @returns Count of deleted sessions
 */
export async function deleteExpiredAuthSessions(): Promise<number> {
  const ts = nowMs()
  const count = Number(
    db
      .prepare('SELECT count(*) AS c FROM "Session" WHERE "expiresAt" < ?')
      .get(ts)!.c,
  )
  db.prepare('DELETE FROM "Session" WHERE "expiresAt" < ?').run(ts)
  return count
}
