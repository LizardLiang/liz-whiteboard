// src/data/comment.ts
// Data access layer for the Comment entity (canvas comments / annotations,
// GH #110). Mirrors src/data/area.ts's structure and error-wrapping style.

import { createCommentSchema, updateCommentSchema } from './schema'
import type { CreateComment, UpdateComment } from './schema'
import type { Comment, CommentWithAuthor } from './models'
import { db, genId, insert, mapComment, nowMs, toDbBool, update } from '@/db'

/** Joins the User table so replies/roots always carry a display name/email,
 * even when the author is offline (never resolved from `activeUsers`). */
const SELECT_WITH_AUTHOR = `
  SELECT c.*, u."username" AS "authorName", u."email" AS "authorEmail"
  FROM "Comment" c
  INNER JOIN "User" u ON u."id" = c."authorId"
`

function mapCommentWithAuthor(
  r: Record<string, unknown> | undefined | null,
): CommentWithAuthor | null {
  if (!r) return null
  const comment = mapComment(r)
  if (!comment) return null
  return {
    ...comment,
    authorName: r.authorName as string,
    authorEmail: r.authorEmail as string,
  }
}

function findWithAuthorById(id: string): CommentWithAuthor | null {
  return mapCommentWithAuthor(
    db.prepare(`${SELECT_WITH_AUTHOR} WHERE c."id" = ?`).get(id),
  )
}

/**
 * Create a new comment (root thread or reply).
 * @param data - Comment creation data (validated with Zod)
 * @param authorId - Authenticated author's user id (server-resolved from the
 *   socket session — never trusted from the client payload, so it is a
 *   separate parameter rather than a schema field)
 * @returns Created comment, joined with author display fields
 * @throws Error if validation fails or database operation fails
 */
export async function createComment(
  data: CreateComment,
  authorId: string,
): Promise<CommentWithAuthor> {
  const validated = createCommentSchema.parse(data)

  try {
    const id = genId()
    const ts = nowMs()
    const isReply = validated.parentId != null
    const targetType = isReply ? 'thread' : validated.targetType

    // Last line of defense (defense-in-depth, independent of the socket
    // handler's IDOR guard which only checks targetType==='table'): scrub
    // target/position fields by BOTH isReply AND targetType so a payload
    // that lies about its target shape (e.g. targetType:'point' carrying a
    // foreign targetTableId) can never persist a cross-whiteboard FK. Only
    // the field matching the resolved targetType is ever written.
    insert('Comment', {
      id,
      whiteboardId: validated.whiteboardId,
      parentId: validated.parentId ?? null,
      targetType,
      targetTableId:
        targetType === 'table' ? (validated.targetTableId ?? null) : null,
      positionX: targetType === 'point' ? (validated.positionX ?? null) : null,
      positionY: targetType === 'point' ? (validated.positionY ?? null) : null,
      authorId,
      body: validated.body,
      resolved: 0,
      resolvedBy: null,
      resolvedAt: null,
      createdAt: ts,
      updatedAt: ts,
    })
    return findWithAuthorById(id)!
  } catch (error) {
    throw new Error(
      `Failed to create comment: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find a comment by ID (plain — no author join). Used for IDOR/ownership
 * checks and author-only edit/delete guards.
 * @param id - Comment UUID
 */
export async function findCommentById(id: string): Promise<Comment | null> {
  try {
    return mapComment(
      db.prepare('SELECT * FROM "Comment" WHERE "id" = ?').get(id),
    )
  } catch (error) {
    throw new Error(
      `Failed to fetch comment: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find every comment (roots + replies) belonging to a whiteboard, joined
 * with author display fields, oldest first (client groups roots/replies).
 * @param whiteboardId - Whiteboard UUID
 */
export async function findCommentsByWhiteboardId(
  whiteboardId: string,
): Promise<Array<CommentWithAuthor>> {
  try {
    return db
      .prepare(
        `${SELECT_WITH_AUTHOR} WHERE c."whiteboardId" = ? ORDER BY c."createdAt" ASC`,
      )
      .all(whiteboardId)
      .map((r) => mapCommentWithAuthor(r)!)
  } catch (error) {
    throw new Error(
      `Failed to fetch comments: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Find root comment ids anchored to a table (targetType==='table'). Used
 * before a table delete: the FK (`Comment_targetTableId_fkey`, ON DELETE
 * CASCADE — see schema-sql.ts) silently removes these rows, so the caller
 * must capture the affected thread ids first in order to broadcast
 * `comment:deleted` for each one (peers otherwise keep counting/rendering
 * pins for a comment thread whose table no longer exists).
 * @param tableId - Diagram table UUID
 */
export async function findCommentIdsByTableId(
  tableId: string,
): Promise<Array<string>> {
  try {
    return db
      .prepare(
        `SELECT "id" FROM "Comment" WHERE "targetTableId" = ? AND "targetType" = 'table'`,
      )
      .all(tableId)
      .map((r) => (r as { id: string }).id)
  } catch (error) {
    throw new Error(
      `Failed to fetch comments for table: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Update a comment's body (edit — author-only, enforced by the caller).
 * @param id - Comment UUID
 * @param data - `{ body }` (validated with Zod)
 * @returns Updated comment, joined with author display fields
 */
export async function updateComment(
  id: string,
  data: UpdateComment,
): Promise<CommentWithAuthor> {
  const validated = updateCommentSchema.parse(data)

  try {
    update('Comment', id, { body: validated.body, updatedAt: nowMs() })
    return findWithAuthorById(id)!
  } catch (error) {
    throw new Error(
      `Failed to update comment: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Resolve or reopen a root comment thread. Reopening clears resolvedBy/
 * resolvedAt back to null.
 * @param id - Root comment UUID
 * @param resolved - New resolved state
 * @param userId - The user performing the action (recorded when resolving)
 * @returns Updated comment, joined with author display fields
 */
export async function resolveComment(
  id: string,
  resolved: boolean,
  userId: string,
): Promise<CommentWithAuthor> {
  try {
    update('Comment', id, {
      resolved: toDbBool(resolved),
      resolvedBy: resolved ? userId : null,
      resolvedAt: resolved ? nowMs() : null,
      updatedAt: nowMs(),
    })
    return findWithAuthorById(id)!
  } catch (error) {
    throw new Error(
      `Failed to resolve comment: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}

/**
 * Delete a comment. Deleting a root cascades to its replies (FK ON DELETE
 * CASCADE); deleting a reply removes only that reply.
 * @param id - Comment UUID
 * @returns The deleted comment (pre-delete snapshot, plain — no author join)
 * @throws Error if the comment does not exist
 */
export async function deleteComment(id: string): Promise<Comment> {
  try {
    const existing = mapComment(
      db.prepare('SELECT * FROM "Comment" WHERE "id" = ?').get(id),
    )
    if (!existing) throw new Error('Comment not found')
    db.prepare('DELETE FROM "Comment" WHERE "id" = ?').run(id)
    return existing
  } catch (error) {
    throw new Error(
      `Failed to delete comment: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}
