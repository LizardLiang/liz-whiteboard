// Tests for board-level canvas settings: schema defaults, the db row mapping,
// the additive column migration, and the merge-update data function.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_CANVAS_BOARD_SETTINGS,
  canvasBoardSettingsPatchSchema,
  canvasBoardSettingsSchema,
  parseCanvasBoardSettings,
} from './canvas-board-settings'
import { findCanvasBoardById, updateCanvasBoardSettings } from './canvas-board'
import { db, ensureCanvasBoardSettingsColumn, genId, insert, nowMs } from '@/db'
import { resetDb } from '@/test/db-helpers'

function seedBoard(settings?: string | null): string {
  const projectId = genId()
  insert('Project', {
    id: projectId,
    name: 'P',
    createdAt: nowMs(),
    updatedAt: nowMs(),
  })
  const id = genId()
  insert('CanvasBoard', {
    id,
    name: 'B',
    projectId,
    folderId: null,
    settings: settings ?? null,
    createdAt: nowMs(),
    updatedAt: nowMs(),
  })
  return id
}

describe('canvas board settings schema', () => {
  it('defaults to card + path for null, empty and partial input', () => {
    expect(DEFAULT_CANVAS_BOARD_SETTINGS).toEqual({
      diagramStyle: 'card',
      flowDots: 'path',
    })
    expect(parseCanvasBoardSettings(null)).toEqual(
      DEFAULT_CANVAS_BOARD_SETTINGS,
    )
    expect(parseCanvasBoardSettings({})).toEqual(DEFAULT_CANVAS_BOARD_SETTINGS)
    expect(parseCanvasBoardSettings({ flowDots: 'always' })).toEqual({
      diagramStyle: 'card',
      flowDots: 'always',
    })
  })

  it('falls back to defaults for malformed stored values', () => {
    expect(parseCanvasBoardSettings({ diagramStyle: 'neon' })).toEqual(
      DEFAULT_CANVAS_BOARD_SETTINGS,
    )
  })

  it('keeps a valid key when a sibling key is bad', () => {
    expect(
      parseCanvasBoardSettings({ diagramStyle: 'classic', flowDots: 'neon' }),
    ).toEqual({ diagramStyle: 'classic', flowDots: 'path' })
  })

  it('rejects an empty patch', () => {
    expect(canvasBoardSettingsPatchSchema.safeParse({}).success).toBe(false)
  })

  it('rejects unknown keys on write', () => {
    expect(canvasBoardSettingsSchema.safeParse({ extra: 1 }).success).toBe(
      false,
    )
    expect(canvasBoardSettingsPatchSchema.safeParse({ extra: 1 }).success).toBe(
      false,
    )
  })
})

describe('CanvasBoard.settings persistence', () => {
  beforeEach(() => resetDb())

  it('reads a board with no stored settings as the defaults', async () => {
    const id = seedBoard()
    const board = await findCanvasBoardById(id)
    expect(board?.settings).toEqual(DEFAULT_CANVAS_BOARD_SETTINGS)
  })

  it('merges a partial update and keeps the other key', async () => {
    const id = seedBoard()
    await updateCanvasBoardSettings(id, { diagramStyle: 'classic' })
    const second = await updateCanvasBoardSettings(id, { flowDots: 'always' })
    expect(second.settings).toEqual({
      diagramStyle: 'classic',
      flowDots: 'always',
    })
    expect((await findCanvasBoardById(id))?.settings).toEqual(second.settings)
  })

  it('refuses an invalid patch and an unknown board', async () => {
    const id = seedBoard()
    await expect(
      updateCanvasBoardSettings(id, { diagramStyle: 'x' as never }),
    ).rejects.toThrow()
    await expect(
      updateCanvasBoardSettings(genId(), { flowDots: 'always' }),
    ).rejects.toThrow(/not found/)
  })

  it('adds the column to a CanvasBoard table that predates it', () => {
    db.exec('PRAGMA foreign_keys = OFF')
    db.exec('ALTER TABLE "CanvasBoard" DROP COLUMN "settings"')
    const cols = () =>
      (
        db.prepare('PRAGMA table_info("CanvasBoard")').all() as Array<{
          name: string
        }>
      ).map((c) => c.name)
    expect(cols()).not.toContain('settings')
    ensureCanvasBoardSettingsColumn(db)
    expect(cols()).toContain('settings')
    ensureCanvasBoardSettingsColumn(db)
    expect(cols().filter((c) => c === 'settings')).toHaveLength(1)
    db.exec('PRAGMA foreign_keys = ON')
  })
})
