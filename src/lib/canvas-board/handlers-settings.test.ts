// Tests for the `board:settings-update` socket handler.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerCanvasBoardSettingsHandlers } from './handlers'
import type { CanvasSocket } from './handlers'
import { updateCanvasBoardSettings } from '@/data/canvas-board'
import { requireCanvasBoardRole } from '@/lib/auth/require-role'

vi.mock('@/data/canvas-board', () => ({ updateCanvasBoardSettings: vi.fn() }))
vi.mock('@/data/canvas-element', () => ({
  RevisionMismatchError: class extends Error {},
  createCanvasElement: vi.fn(),
  deleteCanvasElement: vi.fn(),
  findCanvasElementById: vi.fn(),
  nextCanvasZIndex: vi.fn(),
  updateCanvasElement: vi.fn(),
}))
vi.mock('@/lib/auth/require-role', () => ({
  requireCanvasBoardRole: vi.fn(),
}))

const BOARD_ID = '11111111-1111-4111-8111-111111111111'
const SETTINGS = { diagramStyle: 'classic', flowDots: 'path' } as const

function harness() {
  const handlers: Record<string, (d: unknown, cb?: unknown) => Promise<void>> =
    {}
  const broadcast: Array<{ event: string; payload: unknown }> = []
  const socket: CanvasSocket = {
    data: { userId: 'u1', sessionExpiresAt: Date.now() + 60_000 },
    on: (e, h) => {
      handlers[e] = h as never
    },
    emit: vi.fn(),
    broadcast: { emit: (event, payload) => broadcast.push({ event, payload }) },
    disconnect: vi.fn(),
  }
  registerCanvasBoardSettingsHandlers(socket, BOARD_ID, 'u1')
  return { handlers, broadcast }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireCanvasBoardRole).mockResolvedValue(false)
  vi.mocked(updateCanvasBoardSettings).mockResolvedValue({
    settings: SETTINGS,
  } as never)
})

describe('board:settings-update', () => {
  it('requires EDITOR, persists, broadcasts full settings and acks', async () => {
    const h = harness()
    const cb = vi.fn()
    await h.handlers['board:settings-update']({ diagramStyle: 'classic' }, cb)
    expect(requireCanvasBoardRole).toHaveBeenCalledWith(
      expect.anything(),
      BOARD_ID,
      'board:settings-update',
      'EDITOR',
    )
    expect(updateCanvasBoardSettings).toHaveBeenCalledWith(BOARD_ID, {
      diagramStyle: 'classic',
    })
    expect(h.broadcast).toEqual([
      {
        event: 'board:settings-updated',
        payload: { settings: SETTINGS, updatedBy: 'u1' },
      },
    ])
    expect(cb).toHaveBeenCalledWith({ ok: true, entity: SETTINGS })
  })

  it('denies a non-editor and writes nothing', async () => {
    vi.mocked(requireCanvasBoardRole).mockResolvedValue(true)
    const h = harness()
    const cb = vi.fn()
    await h.handlers['board:settings-update']({ diagramStyle: 'classic' }, cb)
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, code: 'FORBIDDEN' }),
    )
    expect(updateCanvasBoardSettings).not.toHaveBeenCalled()
    expect(h.broadcast).toHaveLength(0)
  })

  it('rejects an invalid payload without broadcasting', async () => {
    const h = harness()
    const cb = vi.fn()
    await h.handlers['board:settings-update']({ diagramStyle: 'neon' }, cb)
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, code: 'VALIDATION_ERROR' }),
    )
    expect(updateCanvasBoardSettings).not.toHaveBeenCalled()
    expect(h.broadcast).toHaveLength(0)
  })
})
