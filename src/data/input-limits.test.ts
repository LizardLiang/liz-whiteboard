// src/data/input-limits.test.ts
// Audit M10: size caps on user-controlled input (schemas + snapshot retention).
import { beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_TEXT_SOURCE_LENGTH,
  createColumnSchema,
  createTableSchema,
  createWhiteboardSchema,
  recentBoardsLimitSchema,
  updateColumnSchema,
  updateTableSchema,
  updateWhiteboardSchema,
} from './schema'
import {
  MAX_SNAPSHOTS_PER_BOARD,
  captureWhiteboardState,
  createWhiteboardSnapshot,
  findSnapshotsByWhiteboardId,
} from './whiteboard-snapshot'
import {
  makeProject,
  makeUser,
  makeWhiteboard,
  resetDb,
} from '@/test/db-helpers'

const UUID = '20000000-0000-4000-8000-000000000001'

describe('schema size caps', () => {
  it('rejects an oversized textSource on create and update', () => {
    const big = 'x'.repeat(MAX_TEXT_SOURCE_LENGTH + 1)
    expect(
      createWhiteboardSchema.safeParse({
        name: 'n',
        projectId: UUID,
        textSource: big,
      }).success,
    ).toBe(false)
    expect(updateWhiteboardSchema.safeParse({ textSource: big }).success).toBe(
      false,
    )
    expect(
      updateWhiteboardSchema.safeParse({ textSource: 'x'.repeat(1000) })
        .success,
    ).toBe(true)
  })

  it('rejects oversized table and column descriptions', () => {
    const big = 'd'.repeat(MAX_DESCRIPTION_LENGTH + 1)
    expect(
      createTableSchema.safeParse({
        whiteboardId: UUID,
        name: 't',
        description: big,
      }).success,
    ).toBe(false)
    expect(updateTableSchema.safeParse({ description: big }).success).toBe(
      false,
    )
    expect(updateColumnSchema.safeParse({ description: big }).success).toBe(
      false,
    )
    expect(
      createColumnSchema.safeParse({
        tableId: UUID,
        name: 'c',
        dataType: 'string',
        description: big,
      }).success,
    ).toBe(false)
  })

  it('bounds the getRecentWhiteboards limit', () => {
    expect(recentBoardsLimitSchema.safeParse(8).success).toBe(true)
    for (const bad of [0, -1, 101, 1.5, Number.NaN, '5']) {
      expect(recentBoardsLimitSchema.safeParse(bad).success).toBe(false)
    }
  })
})

describe('snapshot retention', () => {
  beforeEach(() => resetDb())

  it('keeps only the newest MAX_SNAPSHOTS_PER_BOARD per board', async () => {
    const { id: userId } = makeUser()
    const project = makeProject({ ownerId: userId })
    const board = makeWhiteboard({ projectId: project.id })
    const other = makeWhiteboard({ projectId: project.id })
    const payload = await captureWhiteboardState(board.id)
    await createWhiteboardSnapshot({
      whiteboardId: other.id,
      label: 'other',
      createdByUserId: userId,
      isAuto: false,
      payload,
    })
    for (let i = 0; i < MAX_SNAPSHOTS_PER_BOARD + 5; i++) {
      await createWhiteboardSnapshot({
        whiteboardId: board.id,
        label: `s${i}`,
        createdByUserId: userId,
        isAuto: false,
        payload,
      })
    }
    const list = await findSnapshotsByWhiteboardId(board.id)
    expect(list).toHaveLength(MAX_SNAPSHOTS_PER_BOARD)
    const labels = list.map((s) => s.label)
    expect(labels).toContain(`s${MAX_SNAPSHOTS_PER_BOARD + 4}`)
    expect(labels).not.toContain('s0')
    expect(await findSnapshotsByWhiteboardId(other.id)).toHaveLength(1)
  })
})
