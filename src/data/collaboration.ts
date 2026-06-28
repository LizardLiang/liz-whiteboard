// src/data/collaboration.ts
// Data access layer for CollaborationSession entity

import { createSessionSchema, updateSessionSchema } from './schema'
import type { CreateSession, UpdateSession } from './schema'
import type { CollaborationSession } from './models'
import {
  db,
  genId,
  insert,
  mapCollaborationSession,
  nowMs,
  toDbDate,
  toDbJson,
  update,
} from '@/db'

/**
 * Create a new collaboration session
 * @param data - Session creation data (validated with Zod)
 * @returns Created session
 * @throws Error if validation fails or database operation fails
 */
export async function createCollaborationSession(
  data: CreateSession,
): Promise<CollaborationSession> {
  // Validate input with Zod schema
  const validated = createSessionSchema.parse(data)

  try {
    const id = genId()
    const ts = nowMs()
    insert('CollaborationSession', {
      id,
      whiteboardId: validated.whiteboardId,
      userId: validated.userId,
      socketId: validated.socketId,
      cursor: toDbJson(validated.cursor),
      lastActivityAt: ts,
      createdAt: ts,
    })
    return mapCollaborationSession(
      db.prepare('SELECT * FROM "CollaborationSession" WHERE "id" = ?').get(id),
    )!
  } catch (error) {
    throw new Error(
      `Failed to create collaboration session: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find active collaboration sessions for a whiteboard
 * Active = sessions with activity in the last 5 minutes
 * @param whiteboardId - Whiteboard UUID
 * @returns Array of active sessions
 */
export async function findActiveCollaborators(
  whiteboardId: string,
): Promise<Array<CollaborationSession>> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)

  try {
    return db
      .prepare(
        'SELECT * FROM "CollaborationSession" WHERE "whiteboardId" = ? AND "lastActivityAt" >= ? ORDER BY "lastActivityAt" DESC',
      )
      .all(whiteboardId, toDbDate(fiveMinutesAgo))
      .map((r) => mapCollaborationSession(r)!)
  } catch (error) {
    throw new Error(
      `Failed to fetch active collaborators: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find a session by socket ID
 * @param socketId - Socket.IO socket ID
 * @returns Session or null if not found
 */
export async function findSessionBySocketId(
  socketId: string,
): Promise<CollaborationSession | null> {
  try {
    return mapCollaborationSession(
      db
        .prepare('SELECT * FROM "CollaborationSession" WHERE "socketId" = ?')
        .get(socketId),
    )
  } catch (error) {
    throw new Error(
      `Failed to fetch session: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Update a collaboration session
 * @param socketId - Socket.IO socket ID
 * @param data - Partial session data to update (validated with Zod)
 * @returns Updated session
 * @throws Error if session not found or validation fails
 */
export async function updateCollaborationSession(
  socketId: string,
  data: UpdateSession,
): Promise<CollaborationSession> {
  // Validate input with Zod schema
  const validated = updateSessionSchema.parse(data)

  try {
    const existing = mapCollaborationSession(
      db
        .prepare('SELECT * FROM "CollaborationSession" WHERE "socketId" = ?')
        .get(socketId),
    )
    if (!existing) throw new Error('Collaboration session not found')

    // lastActivityAt mirrors Prisma's @updatedAt — bump it on every update
    const values: Record<string, unknown> = { lastActivityAt: nowMs() }
    if (validated.cursor !== undefined)
      values.cursor = toDbJson(validated.cursor)
    update('CollaborationSession', existing.id, values)
    return mapCollaborationSession(
      db
        .prepare('SELECT * FROM "CollaborationSession" WHERE "socketId" = ?')
        .get(socketId),
    )!
  } catch (error) {
    throw new Error(
      `Failed to update collaboration session: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Update session activity timestamp (heartbeat)
 * @param socketId - Socket.IO socket ID
 * @returns Updated session
 */
export async function updateSessionActivity(
  socketId: string,
): Promise<CollaborationSession> {
  try {
    const existing = mapCollaborationSession(
      db
        .prepare('SELECT * FROM "CollaborationSession" WHERE "socketId" = ?')
        .get(socketId),
    )
    if (!existing) throw new Error('Collaboration session not found')

    update('CollaborationSession', existing.id, { lastActivityAt: nowMs() })
    return mapCollaborationSession(
      db
        .prepare('SELECT * FROM "CollaborationSession" WHERE "socketId" = ?')
        .get(socketId),
    )!
  } catch (error) {
    throw new Error(
      `Failed to update session activity: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Delete a collaboration session (on disconnect)
 * @param socketId - Socket.IO socket ID
 * @returns Deleted session
 * @throws Error if session not found
 */
export async function deleteCollaborationSession(
  socketId: string,
): Promise<CollaborationSession> {
  try {
    const existing = mapCollaborationSession(
      db
        .prepare('SELECT * FROM "CollaborationSession" WHERE "socketId" = ?')
        .get(socketId),
    )
    if (!existing) throw new Error('Collaboration session not found')
    db.prepare('DELETE FROM "CollaborationSession" WHERE "socketId" = ?').run(
      socketId,
    )
    return existing
  } catch (error) {
    throw new Error(
      `Failed to delete collaboration session: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Delete stale sessions (inactive for more than 5 minutes)
 * Should be run periodically as a cleanup job
 * @returns Count of deleted sessions
 */
export async function deleteStaleSession(): Promise<number> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)

  try {
    const row = db
      .prepare(
        'SELECT count(*) AS c FROM "CollaborationSession" WHERE "lastActivityAt" < ?',
      )
      .get(toDbDate(fiveMinutesAgo))
    const count = Number(row?.c ?? 0)
    db.prepare(
      'DELETE FROM "CollaborationSession" WHERE "lastActivityAt" < ?',
    ).run(toDbDate(fiveMinutesAgo))
    return count
  } catch (error) {
    throw new Error(
      `Failed to delete stale sessions: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}
