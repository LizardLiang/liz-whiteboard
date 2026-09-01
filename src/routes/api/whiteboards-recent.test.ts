// src/routes/api/whiteboards-recent.test.ts
// Integration test for getRecentWhiteboards' UNION ALL over Whiteboard and
// CanvasBoard (navigator-create-canvas-board tactical plan, step 4;
// spec-delta requirement "Recent List Covers Both Board Kinds").
//
// The createServerFn wrapper is not directly callable outside a real
// request — same constraint documented in whiteboards.test.ts. This mirrors
// the query's REAL SQL (copied verbatim from
// src/routes/api/whiteboards.ts's getRecentWhiteboards handler) against a
// real in-memory DB, so a query typo or an access-filter mismatch between
// the two UNION halves fails for the reason this test claims.

import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import {
  makeCanvasBoard,
  makeProject,
  makeUser,
  makeWhiteboard,
  resetDb,
} from '@/test/db-helpers'

interface RecentBoardRow {
  id: string
  name: string
  updatedAt: Date
  kind: 'whiteboard' | 'canvas'
}

/** Verbatim mirror of getRecentWhiteboards' SQL (whiteboards.ts). */
function getRecentBoardsHandler(
  userId: string,
  limit: number = 10,
): Array<RecentBoardRow> {
  const rows = db
    .prepare(
      `SELECT w."id" AS "id", w."name" AS "name", w."updatedAt" AS "updatedAt", 'whiteboard' AS "kind"
       FROM "Whiteboard" w
       JOIN "Project" p ON p."id" = w."projectId"
       WHERE p."ownerId" = ?
          OR EXISTS (
            SELECT 1 FROM "ProjectMember" m
            WHERE m."projectId" = p."id" AND m."userId" = ?
          )
       UNION ALL
       SELECT c."id" AS "id", c."name" AS "name", c."updatedAt" AS "updatedAt", 'canvas' AS "kind"
       FROM "CanvasBoard" c
       JOIN "Project" p ON p."id" = c."projectId"
       WHERE p."ownerId" = ?
          OR EXISTS (
            SELECT 1 FROM "ProjectMember" m
            WHERE m."projectId" = p."id" AND m."userId" = ?
          )
       ORDER BY "updatedAt" DESC
       LIMIT ?`,
    )
    .all(userId, userId, userId, userId, limit)
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    updatedAt: new Date(Number(r.updatedAt)),
    kind: r.kind as 'whiteboard' | 'canvas',
  }))
}

/** Directly set a row's updatedAt so ordering is deterministic in tests. */
function touchUpdatedAt(table: 'Whiteboard' | 'CanvasBoard', id: string, ms: number) {
  db.prepare(`UPDATE "${table}" SET "updatedAt" = ? WHERE "id" = ?`).run(ms, id)
}

beforeEach(() => {
  resetDb()
})

describe('getRecentWhiteboards: UNION ALL over Whiteboard and CanvasBoard', () => {
  it('a canvas board more recently updated than any whiteboard leads the list, linked by kind', () => {
    const user = makeUser()
    const project = makeProject({ ownerId: user.id })
    const wb = makeWhiteboard({ projectId: project.id, name: 'Older Whiteboard' })
    const canvas = makeCanvasBoard({ projectId: project.id, name: 'Newer Canvas' })

    const now = Date.now()
    touchUpdatedAt('Whiteboard', wb.id, now - 10_000)
    touchUpdatedAt('CanvasBoard', canvas.id, now)

    const rows = getRecentBoardsHandler(user.id)

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: canvas.id, kind: 'canvas' })
    expect(rows[1]).toMatchObject({ id: wb.id, kind: 'whiteboard' })
  })

  it('stays scoped to projects the user owns or is a member of', () => {
    const user = makeUser()
    const otherUser = makeUser()
    const ownProject = makeProject({ ownerId: user.id })
    const otherProject = makeProject({ ownerId: otherUser.id })

    const ownedBoard = makeCanvasBoard({ projectId: ownProject.id, name: 'Mine' })
    makeCanvasBoard({ projectId: otherProject.id, name: 'Not mine' })
    const ownedWhiteboard = makeWhiteboard({
      projectId: ownProject.id,
      name: 'Mine WB',
    })
    makeWhiteboard({ projectId: otherProject.id, name: 'Not mine WB' })

    const rows = getRecentBoardsHandler(user.id)
    const ids = rows.map((r) => r.id)

    expect(ids).toContain(ownedBoard.id)
    expect(ids).toContain(ownedWhiteboard.id)
    expect(ids).toHaveLength(2)
  })

  it('respects the limit across the combined result', () => {
    const user = makeUser()
    const project = makeProject({ ownerId: user.id })
    makeWhiteboard({ projectId: project.id })
    makeCanvasBoard({ projectId: project.id })
    makeCanvasBoard({ projectId: project.id })

    const rows = getRecentBoardsHandler(user.id, 2)

    expect(rows).toHaveLength(2)
  })
})
