// src/hooks/use-canvas-elements.test.ts
// Optimistic-mutation and acked-rollback tests for useCanvasElements
// (Wave 4, step 13).
//
// Drives the real hook via renderHook. Only `sonner` and the socket are
// mocked; the scene reducers and the storage<->engine adapter are the real
// ones, so a rename regression in `toEngineElement` fails here rather than
// passing against a stub.
//
// What these prove is the half of D-4 that is easy to claim and hard to see:
// that a REJECTED mutation actually restores the board. A hook that only
// applies the optimistic change and shows a toast passes a naive test suite
// and loses the user's data on the first server refusal.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { toast } from 'sonner'
import { useCanvasElements } from './use-canvas-elements'
import type { CanvasElement, Scene } from '@/lib/canvas-engine/scene'
import type { CanvasElementRecord } from '@/data/models'
import { DEFAULT_ELEMENT_STYLE, sceneFrom } from '@/lib/canvas-engine/scene'
import { toEngineElement } from '@/lib/canvas-element-adapter'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

const BOARD_ID = '11111111-1111-4111-8111-111111111111'
const EXISTING_ID = '22222222-2222-4222-8222-222222222222'
const TEMP_ID = 'temp-client-generated-id'
const SERVER_ID = '33333333-3333-4333-8333-333333333333'

function makeRecord(
  overrides: Partial<CanvasElementRecord> = {},
): CanvasElementRecord {
  return {
    id: EXISTING_ID,
    boardId: BOARD_ID,
    kind: 'rectangle',
    positionX: 10,
    positionY: 20,
    width: 100,
    height: 50,
    rotation: 0,
    zIndex: 0,
    text: null,
    style: { ...DEFAULT_ELEMENT_STYLE },
    props: { kind: 'rectangle' },
    revision: 1,
    createdAt: new Date('2026-08-24T10:00:00Z'),
    updatedAt: new Date('2026-08-24T11:00:00Z'),
    ...overrides,
  }
}

function makeElement(overrides: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id: TEMP_ID,
    kind: 'rectangle',
    x: 300,
    y: 400,
    width: 60,
    height: 30,
    rotation: 0,
    zIndex: 1,
    text: null,
    style: { ...DEFAULT_ELEMENT_STYLE },
    ...overrides,
  }
}

/**
 * A socket stand-in that records emissions and hands back their ack
 * callbacks, so a test can decide per-call whether the server accepted.
 */
function makeSocket() {
  const sent: Array<{
    event: string
    data: any
    ack?: (res: any) => void
  }> = []
  const listeners = new Map<string, Array<(...args: Array<any>) => void>>()

  return {
    sent,
    emit: (event: string, data: any, ack?: (res: any) => void) => {
      sent.push({ event, data, ack })
    },
    on: (event: string, handler: (...args: Array<any>) => void) => {
      const list = listeners.get(event) ?? []
      list.push(handler)
      listeners.set(event, list)
    },
    off: (event: string, handler: (...args: Array<any>) => void) => {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((h) => h !== handler),
      )
    },
    receive: (event: string, payload: unknown) => {
      for (const handler of listeners.get(event) ?? []) handler(payload)
    },
    ackLast: (res: unknown) => {
      sent[sent.length - 1].ack?.(res)
    },
    ackAll: (res: unknown) => {
      for (const entry of sent) entry.ack?.(res)
    },
  }
}

/**
 * Renders the hook over a real, mutable `Scene`, mirroring how CanvasBoard
 * owns the scene and hands the setter down.
 */
function setup(initialRecords: Array<CanvasElementRecord> = [makeRecord()]) {
  const socket = makeSocket()
  const reconciled: Array<[string, string]> = []
  let scene: Scene = sceneFrom(initialRecords.map(toEngineElement))

  const setScene = ((updater: any) => {
    scene = typeof updater === 'function' ? updater(scene) : updater
  }) as any

  const view = renderHook(() =>
    useCanvasElements({
      boardId: BOARD_ID,
      enabled: true,
      initialElements: initialRecords,
      setScene,
      on: socket.on,
      off: socket.off,
      emit: socket.emit,
      onElementIdReconciled: (from, to) => reconciled.push([from, to]),
    }),
  )

  return {
    socket,
    reconciled,
    view,
    get scene() {
      return scene
    },
    /** Mirrors what use-canvas-input already did before calling the hook. */
    applyLocally: (next: (current: Scene) => Scene) => {
      scene = next(scene)
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createElement', () => {
  it('emits element:create with the storage vocabulary', () => {
    const h = setup()
    act(() => {
      h.view.result.current.createElement(makeElement())
    })

    expect(h.socket.sent).toHaveLength(1)
    expect(h.socket.sent[0].event).toBe('element:create')
    expect(h.socket.sent[0].data).toMatchObject({
      boardId: BOARD_ID,
      kind: 'rectangle',
      positionX: 300,
      positionY: 400,
      props: { kind: 'rectangle' },
    })
  })

  it('swaps the temporary element for the persisted row on ack', () => {
    const h = setup()
    const drawn = makeElement()
    h.applyLocally((scene) => ({
      elements: [...scene.elements, drawn],
      byId: new Map(scene.byId).set(drawn.id, drawn),
    }))

    act(() => { h.view.result.current.createElement(drawn) })
    act(() =>
      h.socket.ackLast({
        ok: true,
        entity: makeRecord({ id: SERVER_ID, positionX: 300, positionY: 400 }),
      }),
    )

    expect(h.scene.byId.has(TEMP_ID)).toBe(false)
    expect(h.scene.byId.has(SERVER_ID)).toBe(true)
    expect(h.scene.byId.get(SERVER_ID)?.x).toBe(300)
    expect(h.reconciled).toEqual([[TEMP_ID, SERVER_ID]])
  })

  it('removes the optimistic element when the server refuses', () => {
    const h = setup()
    const drawn = makeElement()
    h.applyLocally((scene) => ({
      elements: [...scene.elements, drawn],
      byId: new Map(scene.byId).set(drawn.id, drawn),
    }))
    expect(h.scene.byId.has(TEMP_ID)).toBe(true)

    act(() => { h.view.result.current.createElement(drawn) })
    act(() =>
      h.socket.ackLast({ ok: false, message: 'Insufficient permission' }),
    )

    expect(h.scene.byId.has(TEMP_ID)).toBe(false)
    expect(toast.error).toHaveBeenCalledWith('Insufficient permission')
  })
})

describe('updateElements — acked rollback', () => {
  it('restores the last SERVER-CONFIRMED element when the update is refused', () => {
    // The scene is the drag state, so by the time the gesture ends it already
    // holds the dragged position. Rolling back to a snapshot taken at emit
    // time would restore the rejected value; this asserts it restores the
    // loaded one instead.
    const h = setup([makeRecord({ positionX: 10, positionY: 20 })])
    const dragged = { ...h.scene.byId.get(EXISTING_ID)!, x: 999, y: 888 }
    h.applyLocally((scene) => sceneFrom(
      scene.elements.map((e) => (e.id === EXISTING_ID ? dragged : e)),
    ))
    expect(h.scene.byId.get(EXISTING_ID)?.x).toBe(999)

    act(() => { h.view.result.current.updateElements([dragged]) })
    act(() => h.socket.ackLast({ ok: false, message: 'nope' }))

    expect(h.scene.byId.get(EXISTING_ID)?.x).toBe(10)
    expect(h.scene.byId.get(EXISTING_ID)?.y).toBe(20)
    expect(toast.error).toHaveBeenCalledWith('nope')
  })

  it('applies the server row on success and rolls back to it next time', () => {
    const h = setup([makeRecord({ positionX: 10, positionY: 20 })])
    const dragged = { ...h.scene.byId.get(EXISTING_ID)!, x: 55, y: 66 }

    act(() => { h.view.result.current.updateElements([dragged]) })
    act(() =>
      h.socket.ackLast({
        ok: true,
        entity: makeRecord({ positionX: 55, positionY: 66 }),
      }),
    )
    expect(h.scene.byId.get(EXISTING_ID)?.x).toBe(55)

    // A second, refused update must now fall back to 55/66 — the newly
    // confirmed state — not to the original 10/20.
    const draggedAgain = { ...h.scene.byId.get(EXISTING_ID)!, x: 777 }
    h.applyLocally((scene) =>
      sceneFrom(
        scene.elements.map((e) => (e.id === EXISTING_ID ? draggedAgain : e)),
      ),
    )
    act(() => { h.view.result.current.updateElements([draggedAgain]) })
    act(() => h.socket.ackLast({ ok: false }))

    expect(h.scene.byId.get(EXISTING_ID)?.x).toBe(55)
  })

  it('emits one update per element in a multi-selection', () => {
    const second = makeRecord({ id: SERVER_ID })
    const h = setup([makeRecord(), second])

    act(() => {
      h.view.result.current.updateElements([
        h.scene.byId.get(EXISTING_ID)!,
        h.scene.byId.get(SERVER_ID)!,
      ])
    })

    expect(h.socket.sent.map((s) => s.event)).toEqual([
      'element:update',
      'element:update',
    ])
    expect(h.socket.sent.map((s) => s.data.elementId)).toEqual([
      EXISTING_ID,
      SERVER_ID,
    ])
  })

  it('rolls back only the element whose update was refused', () => {
    const h = setup([
      makeRecord({ positionX: 10 }),
      makeRecord({ id: SERVER_ID, positionX: 500 }),
    ])
    const a = { ...h.scene.byId.get(EXISTING_ID)!, x: 111 }
    const b = { ...h.scene.byId.get(SERVER_ID)!, x: 222 }
    h.applyLocally(() => sceneFrom([a, b]))

    act(() => { h.view.result.current.updateElements([a, b]) })
    act(() => h.socket.sent[0].ack?.({ ok: false }))
    act(() =>
      h.socket.sent[1].ack?.({
        ok: true,
        entity: makeRecord({ id: SERVER_ID, positionX: 222 }),
      }),
    )

    expect(h.scene.byId.get(EXISTING_ID)?.x).toBe(10)
    expect(h.scene.byId.get(SERVER_ID)?.x).toBe(222)
  })
})

describe('deleteElements — acked rollback', () => {
  it('restores the element when the server refuses the delete', () => {
    const h = setup()
    // use-canvas-input already removed it locally before calling the hook.
    h.applyLocally((scene) =>
      sceneFrom(scene.elements.filter((e) => e.id !== EXISTING_ID)),
    )

    act(() => { h.view.result.current.deleteElements([EXISTING_ID]) })
    expect(h.scene.byId.has(EXISTING_ID)).toBe(false)

    act(() => h.socket.ackLast({ ok: false, message: 'denied' }))

    expect(h.scene.byId.has(EXISTING_ID)).toBe(true)
    expect(h.scene.byId.get(EXISTING_ID)?.x).toBe(10)
    expect(toast.error).toHaveBeenCalledWith('denied')
  })

  it('keeps the element gone when the server accepts', () => {
    const h = setup()
    act(() => { h.view.result.current.deleteElements([EXISTING_ID]) })
    act(() => h.socket.ackLast({ ok: true, entity: {} }))
    expect(h.scene.byId.has(EXISTING_ID)).toBe(false)
  })

  it('does not emit for an id the hook has never seen', () => {
    // No create in flight and no confirmed state: there is nothing on the
    // server to delete, and emitting would only produce a NOT_FOUND the user
    // would see as a spurious error toast.
    const h = setup()
    act(() => { h.view.result.current.deleteElements(['never-seen-at-all']) })
    expect(h.socket.sent).toHaveLength(0)
  })

  it('deletes an element on the server when the delete beat the create ack', () => {
    // Dropping the delete silently leaves an orphan row on the server, and
    // the create ack then RE-ADDS the element the user deleted. The delete
    // has to be deferred and re-issued against the reconciled id.
    const h = setup([])
    const drawn = makeElement()
    h.applyLocally((scene) => ({
      elements: [...scene.elements, drawn],
      byId: new Map(scene.byId).set(drawn.id, drawn),
    }))

    act(() => { h.view.result.current.createElement(drawn) })
    act(() => { h.view.result.current.deleteElements([TEMP_ID]) })
    // Nothing to delete yet — the server has not named the row.
    expect(h.socket.sent.map((entry) => entry.event)).toEqual([
      'element:create',
    ])

    act(() =>
      h.socket.sent[0].ack?.({
        ok: true,
        entity: makeRecord({ id: SERVER_ID }),
      }),
    )

    expect(h.socket.sent.map((entry) => entry.event)).toEqual([
      'element:create',
      'element:delete',
    ])
    expect(h.socket.sent[1].data).toEqual({ elementId: SERVER_ID })
    // And it must NOT come back on screen.
    expect(h.scene.byId.has(SERVER_ID)).toBe(false)
    expect(h.scene.byId.has(TEMP_ID)).toBe(false)
  })

  it('restores a collaborator update that arrived DURING the delete emit-to-ack window, not the pre-delete snapshot (Hermes review, W-B)', () => {
    // Undo makes REVISION_MISMATCH the EXPECTED refusal path here, not a rare
    // edge case. If the rollback target were captured at emit time (or if
    // the broadcast never updated `confirmedRef` because the element was
    // already optimistically removed from the scene), the restore would
    // revert PAST the collaborator's write and the client would permanently
    // disagree with the server about this element's content.
    const h = setup([makeRecord({ positionX: 10 })])
    h.applyLocally((scene) =>
      sceneFrom(scene.elements.filter((e) => e.id !== EXISTING_ID)),
    )

    act(() => { h.view.result.current.deleteElements([EXISTING_ID]) })

    act(() =>
      h.socket.receive('element:updated', {
        elementId: EXISTING_ID,
        positionX: 400,
        updatedBy: 'someone-else',
      }),
    )
    act(() => h.socket.ackLast({ ok: false, message: 'denied' }))

    expect(h.scene.byId.get(EXISTING_ID)?.x).toBe(400)
  })

  it('does not emit a deferred delete when the create itself failed', () => {
    const h = setup([])
    const drawn = makeElement()
    act(() => { h.view.result.current.createElement(drawn) })
    act(() => { h.view.result.current.deleteElements([TEMP_ID]) })
    act(() => h.socket.sent[0].ack?.({ ok: false, message: 'refused' }))

    expect(h.socket.sent.map((entry) => entry.event)).toEqual([
      'element:create',
    ])
    expect(h.scene.byId.has(TEMP_ID)).toBe(false)
  })
})

describe('live sync from collaborators', () => {
  it('adds a broadcast element and ignores a duplicate id', () => {
    const h = setup([])
    act(() =>
      h.socket.receive('element:created', {
        ...makeRecord({ id: SERVER_ID }),
        createdBy: 'someone-else',
      }),
    )
    expect(h.scene.elements).toHaveLength(1)

    act(() =>
      h.socket.receive('element:created', {
        ...makeRecord({ id: SERVER_ID }),
        createdBy: 'someone-else',
      }),
    )
    expect(h.scene.elements).toHaveLength(1)
  })

  it('accepts a broadcast from the SAME user in another tab', () => {
    // The shapes hook drops these by comparing `createdBy` to the local
    // userId. `socket.broadcast.emit` already excludes the sending socket, so
    // that filter can only ever discard the same user's second window — the
    // exact case the plan's manual validation asks to verify.
    const h = setup([])
    act(() =>
      h.socket.receive('element:created', {
        ...makeRecord({ id: SERVER_ID }),
        createdBy: 'me',
      }),
    )
    expect(h.scene.byId.has(SERVER_ID)).toBe(true)
  })

  it('translates positionX/positionY into x/y on a remote update', () => {
    // Spreading the broadcast onto the engine element would add two fields
    // the renderer never reads and leave the element exactly where it was.
    const h = setup()
    act(() =>
      h.socket.receive('element:updated', {
        elementId: EXISTING_ID,
        positionX: 700,
        positionY: 800,
        updatedBy: 'someone-else',
      }),
    )
    expect(h.scene.byId.get(EXISTING_ID)?.x).toBe(700)
    expect(h.scene.byId.get(EXISTING_ID)?.y).toBe(800)
  })

  it('leaves unmentioned fields untouched on a partial remote update', () => {
    const h = setup([makeRecord({ width: 100, text: 'hello' })])
    act(() =>
      h.socket.receive('element:updated', {
        elementId: EXISTING_ID,
        positionX: 700,
        updatedBy: 'someone-else',
      }),
    )
    const element = h.scene.byId.get(EXISTING_ID)!
    expect(element.width).toBe(100)
    expect(element.text).toBe('hello')
    expect(element.y).toBe(20)
  })

  it('removes an element deleted by a collaborator', () => {
    const h = setup()
    act(() =>
      h.socket.receive('element:deleted', {
        elementId: EXISTING_ID,
        deletedBy: 'someone-else',
      }),
    )
    expect(h.scene.byId.has(EXISTING_ID)).toBe(false)
  })

  it('makes a remote update that arrived BEFORE the emit the rollback target', () => {
    const h = setup([makeRecord({ positionX: 10 })])
    act(() =>
      h.socket.receive('element:updated', {
        elementId: EXISTING_ID,
        positionX: 400,
        updatedBy: 'someone-else',
      }),
    )

    const dragged = { ...h.scene.byId.get(EXISTING_ID)!, x: 999 }
    h.applyLocally(() => sceneFrom([dragged]))
    act(() => { h.view.result.current.updateElements([dragged]) })
    act(() => h.socket.ackLast({ ok: false }))

    expect(h.scene.byId.get(EXISTING_ID)?.x).toBe(400)
  })

  it('makes a remote update that arrived DURING the emit-to-ack window the rollback target', () => {
    // The previous test delivers the broadcast before the emit, so a
    // rollback target captured at emit time passes it. This one lands the
    // broadcast in the window the round-trip actually opens: capture at emit
    // time rolls back PAST a server-confirmed change, and nothing resyncs it.
    const h = setup([makeRecord({ positionX: 10 })])

    const dragged = { ...h.scene.byId.get(EXISTING_ID)!, x: 999 }
    h.applyLocally(() => sceneFrom([dragged]))
    act(() => { h.view.result.current.updateElements([dragged]) })

    act(() =>
      h.socket.receive('element:updated', {
        elementId: EXISTING_ID,
        positionX: 400,
        updatedBy: 'someone-else',
      }),
    )
    act(() => h.socket.ackLast({ ok: false }))

    expect(h.scene.byId.get(EXISTING_ID)?.x).toBe(400)
  })

  it('registers no listeners when disabled', () => {
    const socket = makeSocket()
    const onSpy = vi.fn(socket.on)
    renderHook(() =>
      useCanvasElements({
        boardId: BOARD_ID,
        enabled: false,
        initialElements: [],
        setScene: (() => {}) as any,
        on: onSpy,
        off: socket.off,
        emit: socket.emit,
      }),
    )
    expect(onSpy).not.toHaveBeenCalled()
  })
})

describe('ack timeout (W3)', () => {
  it('rolls back an update whose ack never arrives', () => {
    // Socket.IO acks never time out on their own. Without this the element
    // stays optimistic forever: no rollback, no error, and a board that
    // silently disagrees with the server until the next reload.
    vi.useFakeTimers()
    try {
      const h = setup([makeRecord({ positionX: 10 })])
      const dragged = { ...h.scene.byId.get(EXISTING_ID)!, x: 999 }
      h.applyLocally(() => sceneFrom([dragged]))

      act(() => { h.view.result.current.updateElements([dragged]) })
      expect(h.scene.byId.get(EXISTING_ID)?.x).toBe(999)

      act(() => {
        vi.advanceTimersByTime(10_000)
      })

      expect(h.scene.byId.get(EXISTING_ID)?.x).toBe(10)
      expect(toast.error).toHaveBeenCalledWith(
        'The server did not respond. Your change was not saved.',
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores a reply that arrives after the timeout already fired', () => {
    vi.useFakeTimers()
    try {
      const h = setup([makeRecord({ positionX: 10 })])
      const dragged = { ...h.scene.byId.get(EXISTING_ID)!, x: 999 }
      h.applyLocally(() => sceneFrom([dragged]))

      act(() => { h.view.result.current.updateElements([dragged]) })
      act(() => {
        vi.advanceTimersByTime(10_000)
      })
      act(() =>
        h.socket.ackLast({
          ok: true,
          entity: makeRecord({ positionX: 999 }),
        }),
      )

      // The rollback stands: re-applying here would resurrect a mutation the
      // user was already told had failed.
      expect(h.scene.byId.get(EXISTING_ID)?.x).toBe(10)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not fire the timeout once the server has replied', () => {
    vi.useFakeTimers()
    try {
      const h = setup([makeRecord({ positionX: 10 })])
      const dragged = { ...h.scene.byId.get(EXISTING_ID)!, x: 999 }
      h.applyLocally(() => sceneFrom([dragged]))

      act(() => { h.view.result.current.updateElements([dragged]) })
      act(() =>
        h.socket.ackLast({
          ok: true,
          entity: makeRecord({ positionX: 999 }),
        }),
      )
      act(() => {
        vi.advanceTimersByTime(30_000)
      })

      expect(h.scene.byId.get(EXISTING_ID)?.x).toBe(999)
      expect(toast.error).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('revision tracking and conditional writes (board-undo tactical plan, Wave 3)', () => {
  it('seeds getRevision from the initial load', () => {
    const h = setup([makeRecord({ revision: 5 })])
    expect(h.view.result.current.getRevision(EXISTING_ID)).toBe(5)
  })

  it('resolves createElement with the acknowledged id and revision', async () => {
    const h = setup([])
    const drawn = makeElement()

    const pending = h.view.result.current.createElement(drawn)
    act(() => {
      h.socket.ackLast({
        ok: true,
        entity: makeRecord({ id: SERVER_ID, revision: 3 }),
      })
    })
    const resolved = await pending
    expect(resolved).toEqual({ id: SERVER_ID, ok: true, revision: 3 })
    expect(h.view.result.current.getRevision(SERVER_ID)).toBe(3)
  })

  it('resolves updateElements with a per-element revision, keyed by the ORIGINAL element id', async () => {
    const h = setup([makeRecord({ revision: 1 })])
    const dragged = { ...h.scene.byId.get(EXISTING_ID)!, x: 50 }

    const pending = h.view.result.current.updateElements([dragged])
    act(() => {
      h.socket.ackLast({
        ok: true,
        entity: makeRecord({ positionX: 50, revision: 2 }),
      })
    })
    const [result] = await pending
    expect(result).toEqual({ id: EXISTING_ID, ok: true, revision: 2 })
    expect(h.view.result.current.getRevision(EXISTING_ID)).toBe(2)
  })

  it('resolves deleteElements ok:false for an id the hook has never seen', async () => {
    const h = setup([])
    const results = await h.view.result.current.deleteElements([
      'never-seen-at-all',
    ])
    expect(results).toEqual([{ id: 'never-seen-at-all', ok: false }])
  })

  it('forwards expectedRevisions as element:update.expectedRevision', () => {
    const h = setup([makeRecord()])
    const dragged = { ...h.scene.byId.get(EXISTING_ID)!, x: 50 }

    act(() => {
      h.view.result.current.updateElements([dragged], {
        expectedRevisions: new Map([[EXISTING_ID, 4]]),
      })
    })

    expect(h.socket.sent[0].data).toMatchObject({
      elementId: EXISTING_ID,
      expectedRevision: 4,
    })
  })

  it('omits expectedRevision on an ordinary forward update (last-write-wins)', () => {
    const h = setup([makeRecord()])
    const dragged = { ...h.scene.byId.get(EXISTING_ID)!, x: 50 }

    act(() => {
      h.view.result.current.updateElements([dragged])
    })

    expect(h.socket.sent[0].data).not.toHaveProperty('expectedRevision')
  })

  it('forwards expectedRevisions as element:delete.expectedRevision', () => {
    const h = setup([makeRecord()])

    act(() => {
      h.view.result.current.deleteElements([EXISTING_ID], {
        expectedRevisions: new Map([[EXISTING_ID, 4]]),
      })
    })

    expect(h.socket.sent[0].data).toMatchObject({
      elementId: EXISTING_ID,
      expectedRevision: 4,
    })
  })

  it('sends the element id on element:create when restoreOriginalId is set (undo restore)', () => {
    const h = setup([])
    const restored = makeElement({ id: EXISTING_ID })

    act(() => {
      h.view.result.current.createElement(restored, { restoreOriginalId: true })
    })

    expect(h.socket.sent[0].data).toMatchObject({ id: EXISTING_ID })
  })

  it('sends minRevision alongside restoreOriginalId (Hermes review, W-C)', () => {
    const h = setup([])
    const restored = makeElement({ id: EXISTING_ID })

    act(() => {
      h.view.result.current.createElement(restored, {
        restoreOriginalId: true,
        minRevision: 4,
      })
    })

    expect(h.socket.sent[0].data).toMatchObject({
      id: EXISTING_ID,
      minRevision: 4,
    })
  })

  it('never sends an id on an ordinary create', () => {
    const h = setup([])
    act(() => {
      h.view.result.current.createElement(makeElement())
    })
    expect(h.socket.sent[0].data).not.toHaveProperty('id')
  })

  it('deletes getRevision entry when the element is deleted', () => {
    const h = setup([makeRecord({ revision: 1 })])
    act(() => {
      h.view.result.current.deleteElements([EXISTING_ID])
    })
    act(() => h.socket.ackLast({ ok: true, entity: {} }))
    expect(h.view.result.current.getRevision(EXISTING_ID)).toBeUndefined()
  })

  it('resolves deleteElements with the pre-delete revision (Hermes review, W-C)', async () => {
    const h = setup([makeRecord({ revision: 3 })])
    const pending = h.view.result.current.deleteElements([EXISTING_ID])
    act(() => {
      h.socket.ackLast({ ok: true, entity: { elementId: EXISTING_ID, revision: 3 } })
    })
    const [result] = await pending
    expect(result).toEqual({ id: EXISTING_ID, ok: true, revision: 3 })
  })

  it('updates getRevision from a collaborator broadcast', () => {
    const h = setup([makeRecord({ revision: 1 })])
    act(() =>
      h.socket.receive('element:updated', {
        elementId: EXISTING_ID,
        positionX: 700,
        revision: 9,
        updatedBy: 'someone-else',
      }),
    )
    expect(h.view.result.current.getRevision(EXISTING_ID)).toBe(9)
  })
})

describe('ephemeral writes suppress the generic error toast (board-undo tactical plan, Wave 4)', () => {
  // An ephemeral write is always issued BY use-canvas-undo.ts (an inverse or
  // a redo reapplication), which owns its own named, non-attributing report
  // for a refusal. This hook's generic `toast.error(res.message)` would
  // either duplicate that report or, for a plain reconciliation write nobody
  // asked about, show an error with nothing for the user to act on.

  it('does not toast on a failed ephemeral create', () => {
    const h = setup([])
    const drawn = makeElement()
    act(() => {
      h.view.result.current.createElement(drawn, { ephemeral: true })
    })
    act(() => h.socket.ackLast({ ok: false, message: 'contested' }))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('still toasts on a failed ORDINARY (non-ephemeral) create', () => {
    const h = setup([])
    const drawn = makeElement()
    act(() => {
      h.view.result.current.createElement(drawn)
    })
    act(() => h.socket.ackLast({ ok: false, message: 'contested' }))
    expect(toast.error).toHaveBeenCalledWith('contested')
  })

  it('does not toast on a failed ephemeral update', () => {
    const h = setup([makeRecord()])
    const dragged = { ...h.scene.byId.get(EXISTING_ID)!, x: 999 }
    act(() => {
      h.view.result.current.updateElements([dragged], { ephemeral: true })
    })
    act(() => h.socket.ackLast({ ok: false, message: 'contested' }))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('does not toast on a failed ephemeral delete', () => {
    const h = setup([makeRecord()])
    act(() => {
      h.view.result.current.deleteElements([EXISTING_ID], { ephemeral: true })
    })
    act(() => h.socket.ackLast({ ok: false, message: 'contested' }))
    expect(toast.error).not.toHaveBeenCalled()
  })
})
