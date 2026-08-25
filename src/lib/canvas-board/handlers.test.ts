// src/lib/canvas-board/handlers.test.ts
// Tests for the canvas element socket handlers (Wave 4, step 14).
//
// These drive the REAL `registerCanvasElementHandlers`. That is a deliberate
// departure from src/routes/api/collaboration.test.ts, which reimplements the
// shape handler bodies in the test file because
// `setupCollaborationEventHandlers` is not exported — a suite that goes green
// when the source and the copy disagree. Exporting the canvas registrar costs
// nothing and makes these assertions about the shipped code.
//
// Only the data layer and the RBAC guard are mocked. The Zod schemas are the
// real ones, so the validation cases below fail for the reason they claim to.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerCanvasElementHandlers } from './handlers'
import type { CanvasAckResult, CanvasSocket } from './handlers'
import {
  createCanvasElement,
  deleteCanvasElement,
  findCanvasElementById,
  nextCanvasZIndex,
  updateCanvasElement,
} from '@/data/canvas-element'
import { requireCanvasBoardRole } from '@/lib/auth/require-role'
import { DEFAULT_ELEMENT_STYLE } from '@/lib/canvas-engine/scene'

vi.mock('@/data/canvas-element', () => ({
  createCanvasElement: vi.fn(),
  deleteCanvasElement: vi.fn(),
  findCanvasElementById: vi.fn(),
  updateCanvasElement: vi.fn(),
  findCanvasElementsByBoard: vi.fn(),
  nextCanvasZIndex: vi.fn(),
}))

vi.mock('@/lib/auth/require-role', () => ({
  requireCanvasBoardRole: vi.fn(),
}))

const BOARD_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_BOARD_ID = '22222222-2222-4222-8222-222222222222'
const ELEMENT_ID = '33333333-3333-4333-8333-333333333333'
const USER_ID = 'user-canvas-001'

interface Harness {
  socket: CanvasSocket
  handlers: Record<string, (data: any, cb?: any) => Promise<void>>
  emitted: Array<{ event: string; payload: any }>
  broadcast: Array<{ event: string; payload: any }>
  disconnected: boolean
}

function makeHarness(sessionExpiresAt = Date.now() + 60_000): Harness {
  const handlers: Harness['handlers'] = {}
  const emitted: Harness['emitted'] = []
  const broadcast: Harness['broadcast'] = []
  const harness = {
    handlers,
    emitted,
    broadcast,
    disconnected: false,
  } as Harness

  harness.socket = {
    data: { userId: USER_ID, sessionExpiresAt },
    on: (event, handler) => {
      handlers[event] = handler as any
    },
    emit: (event, payload) => {
      emitted.push({ event, payload })
    },
    broadcast: {
      emit: (event, payload) => {
        broadcast.push({ event, payload })
      },
    },
    disconnect: () => {
      harness.disconnected = true
    },
  }

  registerCanvasElementHandlers(harness.socket, BOARD_ID, USER_ID)
  return harness
}

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: ELEMENT_ID,
    boardId: BOARD_ID,
    kind: 'rectangle' as const,
    positionX: 10,
    positionY: 20,
    width: 100,
    height: 50,
    rotation: 0,
    zIndex: 0,
    text: null,
    style: { ...DEFAULT_ELEMENT_STYLE },
    props: { kind: 'rectangle' as const },
    createdAt: new Date('2026-08-24T10:00:00Z'),
    updatedAt: new Date('2026-08-24T11:00:00Z'),
    ...overrides,
  }
}

const VALID_CREATE = {
  kind: 'rectangle',
  positionX: 10,
  positionY: 20,
  width: 100,
  height: 50,
  props: { kind: 'rectangle' },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireCanvasBoardRole).mockResolvedValue(false)
  vi.mocked(nextCanvasZIndex).mockResolvedValue(7)
})

describe('canvas handlers — authorisation', () => {
  it.each(['element:create', 'element:update', 'element:delete'])(
    'requires EDITOR on %s, exactly as the shape mutations do',
    async (event) => {
      const h = makeHarness()
      await h.handlers[event]({ elementId: ELEMENT_ID, ...VALID_CREATE })
      expect(requireCanvasBoardRole).toHaveBeenCalledWith(
        expect.anything(),
        BOARD_ID,
        event,
        'EDITOR',
      )
    },
  )

  it.each(['element:create', 'element:update', 'element:delete'])(
    'denies %s with FORBIDDEN and writes nothing when the role check fails',
    async (event) => {
      vi.mocked(requireCanvasBoardRole).mockResolvedValue(true)
      const h = makeHarness()
      const cb = vi.fn()
      await h.handlers[event]({ elementId: ELEMENT_ID, ...VALID_CREATE }, cb)

      expect(cb).toHaveBeenCalledWith({
        ok: false,
        code: 'FORBIDDEN',
        message: 'Insufficient permission',
      })
      expect(createCanvasElement).not.toHaveBeenCalled()
      expect(updateCanvasElement).not.toHaveBeenCalled()
      expect(deleteCanvasElement).not.toHaveBeenCalled()
      expect(h.broadcast).toHaveLength(0)
    },
  )

  it.each(['element:create', 'element:update', 'element:delete'])(
    'rejects %s on an expired session, before the role check',
    async (event) => {
      const h = makeHarness(Date.now() - 1)
      const cb = vi.fn()
      await h.handlers[event]({ elementId: ELEMENT_ID, ...VALID_CREATE }, cb)

      expect(cb).toHaveBeenCalledWith({
        ok: false,
        code: 'SESSION_EXPIRED',
        message: 'Session expired',
      })
      expect(h.disconnected).toBe(true)
      expect(requireCanvasBoardRole).not.toHaveBeenCalled()
      expect(createCanvasElement).not.toHaveBeenCalled()
      expect(updateCanvasElement).not.toHaveBeenCalled()
      expect(deleteCanvasElement).not.toHaveBeenCalled()
    },
  )
})

describe('element:create', () => {
  it('persists the element and broadcasts element:created with createdBy', async () => {
    const record = makeRecord()
    vi.mocked(createCanvasElement).mockResolvedValue(record as any)
    const h = makeHarness()
    const cb = vi.fn()

    await h.handlers['element:create'](VALID_CREATE, cb)

    expect(createCanvasElement).toHaveBeenCalledTimes(1)
    expect(h.broadcast).toEqual([
      { event: 'element:created', payload: { ...record, createdBy: USER_ID } },
    ])
    expect(cb).toHaveBeenCalledWith({ ok: true, entity: record })
  })

  it('takes zIndex from the server, never from the payload', async () => {
    // The client computes its z-index from a local scene that is stale the
    // moment a collaborator adds anything, so two clients drawing at once
    // would both claim the same top slot.
    vi.mocked(createCanvasElement).mockResolvedValue(makeRecord() as any)
    const h = makeHarness()

    await h.handlers['element:create']({ ...VALID_CREATE, zIndex: 999 }, vi.fn())

    expect(nextCanvasZIndex).toHaveBeenCalledWith(BOARD_ID)
    expect(vi.mocked(createCanvasElement).mock.calls[0][0].zIndex).toBe(7)
  })

  it('takes boardId from the namespace, never from the payload', async () => {
    // The payload is client-controlled. A create naming another board must
    // still be written to the board this socket was authorised for — the role
    // check above proved access to BOARD_ID and to nothing else.
    vi.mocked(createCanvasElement).mockResolvedValue(makeRecord() as any)
    const h = makeHarness()

    await h.handlers['element:create'](
      { ...VALID_CREATE, boardId: OTHER_BOARD_ID },
      vi.fn(),
    )

    expect(vi.mocked(createCanvasElement).mock.calls[0][0].boardId).toBe(
      BOARD_ID,
    )
  })

  it('rejects a kind/props.kind mismatch without writing', async () => {
    const h = makeHarness()
    const cb = vi.fn()

    await h.handlers['element:create'](
      { ...VALID_CREATE, kind: 'text', props: { kind: 'rectangle' } },
      cb,
    )

    expect(createCanvasElement).not.toHaveBeenCalled()
    expect(h.broadcast).toHaveLength(0)
    expect(cb.mock.calls[0][0].ok).toBe(false)
    expect(cb.mock.calls[0][0].code).toBe('VALIDATION_ERROR')
  })

  it('does not broadcast when the write throws', async () => {
    vi.mocked(createCanvasElement).mockRejectedValue(new Error('disk on fire'))
    const h = makeHarness()
    const cb = vi.fn()

    await h.handlers['element:create'](VALID_CREATE, cb)

    expect(h.broadcast).toHaveLength(0)
    expect(cb.mock.calls[0][0]).toMatchObject({
      ok: false,
      code: 'VALIDATION_ERROR',
    })
  })
})

describe('element:update', () => {
  it('updates and broadcasts element:updated with updatedAt and updatedBy', async () => {
    const existing = makeRecord()
    const updated = makeRecord({
      positionX: 99,
      updatedAt: new Date('2026-08-24T12:00:00Z'),
    })
    vi.mocked(findCanvasElementById).mockResolvedValue(existing as any)
    vi.mocked(updateCanvasElement).mockResolvedValue(updated as any)
    const h = makeHarness()
    const cb = vi.fn()

    await h.handlers['element:update']({ elementId: ELEMENT_ID, positionX: 99 }, cb)

    expect(updateCanvasElement).toHaveBeenCalledWith(ELEMENT_ID, {
      positionX: 99,
    })
    expect(h.broadcast[0].event).toBe('element:updated')
    expect(h.broadcast[0].payload).toMatchObject({
      elementId: ELEMENT_ID,
      positionX: 99,
      updatedAt: updated.updatedAt,
      updatedBy: USER_ID,
    })
    expect(cb).toHaveBeenCalledWith({ ok: true, entity: updated })
  })

  it('refuses an element belonging to another board (IDOR)', async () => {
    vi.mocked(findCanvasElementById).mockResolvedValue(
      makeRecord({ boardId: OTHER_BOARD_ID }) as any,
    )
    const h = makeHarness()
    const cb = vi.fn()

    await h.handlers['element:update']({ elementId: ELEMENT_ID, positionX: 99 }, cb)

    expect(updateCanvasElement).not.toHaveBeenCalled()
    expect(h.broadcast).toHaveLength(0)
    expect(cb).toHaveBeenCalledWith({
      ok: false,
      code: 'NOT_FOUND',
      message: 'Canvas element not found on this board',
    })
  })

  it('returns NOT_FOUND for an unknown element', async () => {
    vi.mocked(findCanvasElementById).mockResolvedValue(null)
    const h = makeHarness()
    const cb = vi.fn()

    await h.handlers['element:update']({ elementId: ELEMENT_ID, positionX: 9 }, cb)

    expect(updateCanvasElement).not.toHaveBeenCalled()
    expect(cb).toHaveBeenCalledWith({
      ok: false,
      code: 'NOT_FOUND',
      message: 'Canvas element not found on this board',
    })
  })

  it('answers identically for an unknown id and a foreign one (no oracle)', async () => {
    // The implementation notes claim this refusal is generic so a caller
    // cannot tell "exists elsewhere" from "does not exist". Distinct codes
    // would let any editor on any board probe an id and learn whether it
    // exists somewhere in the instance. This is that claim, checked.
    vi.mocked(findCanvasElementById).mockResolvedValue(null)
    const unknownHarness = makeHarness()
    const unknown = vi.fn()
    await unknownHarness.handlers['element:update'](
      { elementId: ELEMENT_ID, width: 5 },
      unknown,
    )

    vi.mocked(findCanvasElementById).mockResolvedValue(
      makeRecord({ boardId: OTHER_BOARD_ID }) as any,
    )
    const foreignHarness = makeHarness()
    const foreign = vi.fn()
    await foreignHarness.handlers['element:update'](
      { elementId: ELEMENT_ID, width: 5 },
      foreign,
    )

    expect(foreign.mock.calls[0][0]).toEqual(unknown.mock.calls[0][0])
    expect(foreignHarness.emitted[0].payload).toEqual(
      unknownHarness.emitted[0].payload,
    )
  })

  it('rejects a non-uuid elementId before touching the database', async () => {
    const h = makeHarness()
    const cb = vi.fn()

    await h.handlers['element:update']({ elementId: 'not-a-uuid' }, cb)

    expect(findCanvasElementById).not.toHaveBeenCalled()
    expect(cb).toHaveBeenCalledWith({
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'Invalid element:update payload',
    })
  })

  it('never forwards elementId into the update patch', async () => {
    // `updateCanvasElementSchema` has no `elementId`; leaking it through would
    // make the parse fail on a payload that is actually valid.
    vi.mocked(findCanvasElementById).mockResolvedValue(makeRecord() as any)
    vi.mocked(updateCanvasElement).mockResolvedValue(makeRecord() as any)
    const h = makeHarness()

    await h.handlers['element:update'](
      { elementId: ELEMENT_ID, width: 42 },
      vi.fn(),
    )

    expect(vi.mocked(updateCanvasElement).mock.calls[0][1]).not.toHaveProperty(
      'elementId',
    )
  })
})

describe('element:delete', () => {
  it('deletes and broadcasts element:deleted with deletedBy', async () => {
    const existing = makeRecord()
    vi.mocked(findCanvasElementById).mockResolvedValue(existing as any)
    vi.mocked(deleteCanvasElement).mockResolvedValue(existing as any)
    const h = makeHarness()
    const cb = vi.fn()

    await h.handlers['element:delete']({ elementId: ELEMENT_ID }, cb)

    expect(deleteCanvasElement).toHaveBeenCalledWith(ELEMENT_ID)
    expect(h.broadcast).toEqual([
      {
        event: 'element:deleted',
        payload: { elementId: ELEMENT_ID, deletedBy: USER_ID },
      },
    ])
    expect(cb).toHaveBeenCalledWith({
      ok: true,
      entity: { elementId: ELEMENT_ID, updatedAt: existing.updatedAt },
    })
  })

  it('refuses an element belonging to another board (IDOR)', async () => {
    vi.mocked(findCanvasElementById).mockResolvedValue(
      makeRecord({ boardId: OTHER_BOARD_ID }) as any,
    )
    const h = makeHarness()
    const cb = vi.fn()

    await h.handlers['element:delete']({ elementId: ELEMENT_ID }, cb)

    expect(deleteCanvasElement).not.toHaveBeenCalled()
    expect(h.broadcast).toHaveLength(0)
    expect((cb.mock.calls[0][0] as CanvasAckResult).ok).toBe(false)
  })

  it('rejects a non-uuid elementId before touching the database', async () => {
    const h = makeHarness()
    const cb = vi.fn()

    await h.handlers['element:delete']({ elementId: 'nope' }, cb)

    expect(findCanvasElementById).not.toHaveBeenCalled()
    expect(cb).toHaveBeenCalledWith({
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'Invalid element:delete payload',
    })
  })
})

describe('browser clients without an ack callback', () => {
  it('completes every handler when cb is undefined', async () => {
    // Browser clients emit without a callback; `cb?.()` everywhere is what
    // stops a missing ack from throwing inside the handler and skipping the
    // broadcast.
    vi.mocked(createCanvasElement).mockResolvedValue(makeRecord() as any)
    vi.mocked(findCanvasElementById).mockResolvedValue(makeRecord() as any)
    vi.mocked(updateCanvasElement).mockResolvedValue(makeRecord() as any)
    vi.mocked(deleteCanvasElement).mockResolvedValue(makeRecord() as any)
    const h = makeHarness()

    await h.handlers['element:create'](VALID_CREATE)
    await h.handlers['element:update']({ elementId: ELEMENT_ID, width: 5 })
    await h.handlers['element:delete']({ elementId: ELEMENT_ID })

    expect(h.broadcast.map((b) => b.event)).toEqual([
      'element:created',
      'element:updated',
      'element:deleted',
    ])
  })
})
