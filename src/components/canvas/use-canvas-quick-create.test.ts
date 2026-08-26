// src/components/canvas/use-canvas-quick-create.test.ts
// Wave 4 of the canvas quick-create-handles tactical plan: hover tracking,
// the creation-handle gesture, the delete cascade and the Alt+Arrow path.
//
// Driven through the REAL hook, the same way use-canvas-input.test.ts drives
// the text-commit lifecycle. jsdom has no 2D context, so `getMeasurer`
// returns null throughout — none of the paths here need text metrics.
//
// Every screen coordinate that has to land on a creation handle is computed
// with `creationHandleRects`, never written as a literal. That is the same
// export-what-you-draw contract the production code follows (input must test
// what the renderer drew), applied to the tests: a literal here would keep
// passing after a constant changed and the handle moved out from under it.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useCanvasInput } from './use-canvas-input'
import type { CanvasElement, Scene } from '@/lib/canvas-engine/scene'
import type { Camera } from '@/lib/canvas-engine/camera'
import type { CanvasTool } from './use-canvas-input'
import type { CreationHandleDirection } from '@/lib/canvas-engine/render'
import { DEFAULT_CAMERA } from '@/lib/canvas-engine/camera'
import {
  DEFAULT_CONNECTOR_ROUTING,
  DEFAULT_ELEMENT_STYLE,
  bounds,
  sceneFrom,
} from '@/lib/canvas-engine/scene'
import {
  connectorEndpointRects,
  creationHandleRects,
} from '@/lib/canvas-engine/render'
import { connectorPathOf } from '@/lib/canvas-engine/hit-test'
import { QUICK_CREATE_GAP } from '@/lib/canvas-engine/quick-create'

const SOURCE_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'
const CONNECTOR_ID = '33333333-3333-4333-8333-333333333333'

function makeRect(overrides: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id: SOURCE_ID,
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    zIndex: 0,
    text: null,
    style: { ...DEFAULT_ELEMENT_STYLE, stroke: '#ff0000' },
    ...overrides,
  }
}

function makeCanvas() {
  return {
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
    }),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    hasPointerCapture: vi.fn(() => true),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
}

function pointerEvent(overrides: Record<string, unknown> = {}) {
  return {
    button: 0,
    buttons: 1,
    pointerId: 1,
    clientX: 10,
    clientY: 10,
    shiftKey: false,
    preventDefault: vi.fn(),
    ...overrides,
  } as any
}

function keyEvent(key: string, overrides: Record<string, unknown> = {}) {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    nativeEvent: { isComposing: false },
    ...overrides,
  } as any
}

/** The centre of one creation handle, in screen coordinates. */
function handleCentre(
  element: CanvasElement,
  direction: CreationHandleDirection,
  camera: Camera = DEFAULT_CAMERA,
) {
  const rect = creationHandleRects(camera, bounds(element))[direction]
  return {
    clientX: rect.x + rect.width / 2,
    clientY: rect.y + rect.height / 2,
  }
}

function setup(
  initial: Array<CanvasElement> = [makeRect()],
  options: { readOnly?: boolean; tool?: CanvasTool } = {},
) {
  let scene: Scene = sceneFrom(initial)
  let camera: Camera = DEFAULT_CAMERA
  let tool: CanvasTool = options.tool ?? 'select'

  const callbacks = {
    onCreate: vi.fn(),
    onQuickCreate: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
  }
  const canvas = makeCanvas()
  const canvasRef = { current: canvas } as any

  const view = renderHook(() =>
    useCanvasInput({
      canvasRef,
      scene,
      setScene: ((updater: any) => {
        scene = typeof updater === 'function' ? updater(scene) : updater
      }) as any,
      camera,
      setCamera: ((updater: any) => {
        camera = typeof updater === 'function' ? updater(camera) : updater
      }) as any,
      tool,
      setTool: (next: CanvasTool) => {
        tool = next
      },
      readOnly: options.readOnly ?? false,
      getMeasurer: () => null,
      callbacks,
    }),
  )

  return {
    view,
    callbacks,
    canvas,
    get scene() {
      return scene
    },
    get api() {
      return view.result.current
    },
    /** Feed the mutated scene back in, as CanvasBoard's re-render would. */
    sync: () => view.rerender(),
  }
}

/**
 * Press a creation handle, optionally drag, and release — the whole gesture.
 * Returns the elements `onQuickCreate` was handed, or null if it never fired.
 */
function quickCreate(
  h: ReturnType<typeof setup>,
  source: CanvasElement,
  direction: CreationHandleDirection,
  release?: { clientX: number; clientY: number },
): Array<CanvasElement> | null {
  const start = handleCentre(source, direction)
  act(() => {
    h.api.canvasHandlers.onPointerDown(pointerEvent(start))
  })
  h.sync()
  if (release) {
    act(() => {
      h.api.canvasHandlers.onPointerMove(pointerEvent(release))
    })
    h.sync()
  }
  act(() => {
    h.api.canvasHandlers.onPointerUp(pointerEvent(release ?? start))
  })
  h.sync()
  const calls = h.callbacks.onQuickCreate.mock.calls
  if (calls.length === 0) return null
  return calls[0][0] as Array<CanvasElement>
}

/** Select an element and let the hook re-render with that selection. */
function select(h: ReturnType<typeof setup>, ids: Array<string>) {
  act(() => {
    h.api.setSelectedIds(new Set(ids))
  })
  h.sync()
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── step 9: hover ──────────────────────────────────────────────────────────

describe('idle hover decides where handles are drawn', () => {
  it('reports the element under an idle pointer', () => {
    const h = setup()
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 50, clientY: 50 }),
      )
    })
    h.sync()
    expect(h.api.hoveredId).toBe(SOURCE_ID)
  })

  it('clears when the pointer moves to empty board', () => {
    const h = setup()
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 50, clientY: 50 }),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 700, clientY: 500 }),
      )
    })
    h.sync()
    expect(h.api.hoveredId).toBeNull()
  })

  it('KEEPS hover while the pointer is over one of that element\'s handles', () => {
    // The handles sit OUTSIDE the element. Reaching for one leaves the
    // element's bounds, so a naive hit-test drops hover and the handle
    // vanishes exactly as the user arrives at it — ungrabbable.
    const h = setup()
    const source = makeRect()
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 50, clientY: 50 }),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent(handleCentre(source, 'right')),
      )
    })
    h.sync()
    expect(h.api.hoveredId).toBe(SOURCE_ID)
  })

  it('drops hover just beyond the handle', () => {
    // The counterpart of the test above: the sticky zone is the handle's own
    // hit rect, not "anywhere near the element".
    const h = setup()
    const source = makeRect()
    const centre = handleCentre(source, 'right')
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 50, clientY: 50 }),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: centre.clientX + 100, clientY: centre.clientY }),
      )
    })
    h.sync()
    expect(h.api.hoveredId).toBeNull()
  })

  it('never hovers on a read-only board', () => {
    // A read-only board sends every press to pan, so handles there would be
    // decoration that does nothing.
    const h = setup([makeRect()], { readOnly: true })
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 50, clientY: 50 }),
      )
    })
    h.sync()
    expect(h.api.hoveredId).toBeNull()
  })

  it('never hovers while a drawing tool owns the next press', () => {
    const h = setup([makeRect()], { tool: 'rectangle' })
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 50, clientY: 50 }),
      )
    })
    h.sync()
    expect(h.api.hoveredId).toBeNull()
  })

  it('clears when the pointer leaves the canvas', () => {
    const h = setup()
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 50, clientY: 50 }),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerLeave()
    })
    h.sync()
    expect(h.api.hoveredId).toBeNull()
  })
})

// ── step 10: the gesture ───────────────────────────────────────────────────

describe('a click on a creation handle', () => {
  it('creates a sibling one gap away plus the connector joining them', () => {
    const h = setup()
    select(h, [SOURCE_ID])
    const created = quickCreate(h, makeRect(), 'right')

    expect(created).not.toBeNull()
    expect(created).toHaveLength(2)
    const [element, connector] = created as Array<CanvasElement>
    expect(element.kind).toBe('rectangle')
    expect(element.x).toBe(100 + QUICK_CREATE_GAP)
    expect(element.y).toBe(0)
    expect(connector.kind).toBe('connector')
    expect(connector.connector).toEqual({
      // The line leaves the side that was actually grabbed, and joins the new
      // element on its facing side — not wherever a centre-to-centre ray
      // happens to cross the two borders.
      source: { kind: 'element', elementId: SOURCE_ID, attach: { x: 1, y: 0.5 } },
      target: {
        kind: 'element',
        elementId: element.id,
        attach: { x: 0, y: 0.5 },
      },
      routing: DEFAULT_CONNECTOR_ROUTING,
    })
  })

  it('inherits the source\'s kind, size and style', () => {
    const h = setup([makeRect({ kind: 'text', text: 'hi', width: 60, height: 30 })])
    select(h, [SOURCE_ID])
    const created = quickCreate(
      h,
      makeRect({ kind: 'text', text: 'hi', width: 60, height: 30 }),
      'bottom',
    )
    const element = (created as Array<CanvasElement>)[0]
    expect(element.kind).toBe('text')
    expect(element.width).toBe(60)
    expect(element.height).toBe(30)
    expect(element.style.stroke).toBe('#ff0000')
    // Inherits the SHAPE, never the content — a duplicated label would have
    // to be cleared every single time.
    expect(element.text).toBe('')
  })

  it('works from hover alone, with nothing selected', () => {
    const h = setup()
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 50, clientY: 50 }),
      )
    })
    h.sync()
    expect(quickCreate(h, makeRect(), 'left')).toHaveLength(2)
  })

  it('puts both new elements into the scene and selects the new one', () => {
    const h = setup()
    select(h, [SOURCE_ID])
    const created = quickCreate(h, makeRect(), 'right') as Array<CanvasElement>
    expect(h.scene.elements).toHaveLength(3)
    expect([...h.api.selectedIds]).toEqual([created[0].id])
  })

  it('opens the new element for typing WITHOUT persisting it a second time', () => {
    // `beginEditing(..., isNew: false)`: `onQuickCreate` already persisted
    // the element, so a commit must not also call `onCreate`. Passing true
    // would write the same element twice.
    const h = setup()
    select(h, [SOURCE_ID])
    quickCreate(h, makeRect(), 'right')
    expect(h.api.editing).not.toBeNull()
    act(() => {
      h.api.textInput.insertText('typed')
    })
    h.sync()
    act(() => {
      h.api.textInput.commitEditing()
    })
    expect(h.callbacks.onCreate).not.toHaveBeenCalled()
    expect(h.callbacks.onQuickCreate).toHaveBeenCalledTimes(1)
  })

  it('is one call, never two creates', () => {
    const h = setup()
    select(h, [SOURCE_ID])
    quickCreate(h, makeRect(), 'top')
    expect(h.callbacks.onQuickCreate).toHaveBeenCalledTimes(1)
    expect(h.callbacks.onCreate).not.toHaveBeenCalled()
  })

  it('slides past an element already occupying the slot', () => {
    const occupant = makeRect({ id: OTHER_ID, x: 100 + QUICK_CREATE_GAP, y: 0 })
    const h = setup([makeRect(), occupant])
    select(h, [SOURCE_ID])
    const created = quickCreate(h, makeRect(), 'right') as Array<CanvasElement>
    expect(created[0].x).toBeGreaterThanOrEqual(occupant.x + occupant.width)
  })
})

describe('a drag from a creation handle', () => {
  it('connects to an element it is dropped on, creating nothing else', () => {
    const target = makeRect({ id: OTHER_ID, x: 400, y: 400 })
    const h = setup([makeRect(), target])
    select(h, [SOURCE_ID])
    const created = quickCreate(h, makeRect(), 'right', {
      clientX: 450,
      clientY: 450,
    })

    expect(created).toHaveLength(1)
    expect((created as Array<CanvasElement>)[0].connector).toEqual({
      source: { kind: 'element', elementId: SOURCE_ID, attach: { x: 1, y: 0.5 } },
      // The target sits down AND to the right, almost diagonally: from the
      // departure point (100,50) its top face (495 units) is fractionally
      // nearer than its left (500). Asserted as the real answer rather than
      // the intuitive one — for a near-diagonal layout the two are genuinely
      // interchangeable, and pinning the wrong one would be pinning a guess.
      target: { kind: 'element', elementId: OTHER_ID, attach: { x: 0.5, y: 0 } },
      routing: DEFAULT_CONNECTOR_ROUTING,
    })
    // Two originals plus the connector — no third element was invented.
    expect(h.scene.elements).toHaveLength(3)
  })

  it('creates a sibling CENTRED on an empty release point', () => {
    const h = setup()
    select(h, [SOURCE_ID])
    const created = quickCreate(h, makeRect(), 'right', {
      clientX: 500,
      clientY: 300,
    }) as Array<CanvasElement>
    // Centred, because that is where the rubber band has been pointing.
    expect(created[0].x).toBe(500 - 50)
    expect(created[0].y).toBe(300 - 50)
  })

  it('does nothing when released back on the source', () => {
    const h = setup()
    select(h, [SOURCE_ID])
    const created = quickCreate(h, makeRect(), 'right', {
      clientX: 50,
      clientY: 50,
    })
    expect(created).toBeNull()
    expect(h.scene.elements).toHaveLength(1)
  })

  it('exposes the in-flight rubber band for the renderer', () => {
    const h = setup()
    select(h, [SOURCE_ID])
    act(() => {
      h.api.canvasHandlers.onPointerDown(
        pointerEvent(handleCentre(makeRect(), 'right')),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 400, clientY: 250 }),
      )
    })
    h.sync()
    expect(h.api.quickCreate).toEqual({
      fromId: SOURCE_ID,
      toWorld: { x: 400, y: 250 },
    })
  })

  it('takes the press before the resize grips do', () => {
    // Both affordances sit on the same four edge midpoints. A press on a
    // creation handle that started a resize instead would silently reshape
    // the source — with no visual difference at the moment of the press.
    const h = setup()
    select(h, [SOURCE_ID])
    act(() => {
      h.api.canvasHandlers.onPointerDown(
        pointerEvent(handleCentre(makeRect(), 'right')),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 400, clientY: 250 }),
      )
    })
    h.sync()
    // A resize would have changed the source's width; a quick-create does not.
    expect(h.scene.byId.get(SOURCE_ID)?.width).toBe(100)
    expect(h.api.quickCreate).not.toBeNull()
  })
})

// ── step 12: the delete cascade ────────────────────────────────────────────

function connectorBetween(
  sourceId: string,
  targetId: string,
  id = CONNECTOR_ID,
): CanvasElement {
  return {
    id,
    kind: 'connector',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    rotation: 0,
    zIndex: 5,
    text: null,
    style: { ...DEFAULT_ELEMENT_STYLE },
    connector: {
      source: { kind: 'element', elementId: sourceId },
      target: { kind: 'element', elementId: targetId },
      routing: DEFAULT_CONNECTOR_ROUTING,
    },
  }
}

describe('deleting an endpoint deletes its connectors', () => {
  it('includes attached connectors in the SAME delete call', () => {
    // One call means one undo entry: a connector removed by a second call
    // would need a second Ctrl+Z, and in between the board would show a
    // connector hanging off an element that no longer exists.
    const h = setup([
      makeRect(),
      makeRect({ id: OTHER_ID, x: 400 }),
      connectorBetween(SOURCE_ID, OTHER_ID),
    ])
    select(h, [SOURCE_ID])
    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('Delete'))
    })
    h.sync()

    const deleted = h.callbacks.onDelete.mock.calls[0][0] as Array<CanvasElement>
    expect(deleted.map((element) => element.id).sort()).toEqual(
      [SOURCE_ID, CONNECTOR_ID].sort(),
    )
    expect(h.scene.byId.has(CONNECTOR_ID)).toBe(false)
  })

  it('lists a connector ONCE when both its endpoints are deleted', () => {
    // Reached twice by the expansion. Twice in the list means two delete
    // operations for one row, and the second inverse would restore a row the
    // first had already restored.
    const h = setup([
      makeRect(),
      makeRect({ id: OTHER_ID, x: 400 }),
      connectorBetween(SOURCE_ID, OTHER_ID),
    ])
    select(h, [SOURCE_ID, OTHER_ID])
    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('Delete'))
    })

    const deleted = h.callbacks.onDelete.mock.calls[0][0] as Array<CanvasElement>
    expect(deleted).toHaveLength(3)
    expect(
      deleted.filter((element) => element.id === CONNECTOR_ID),
    ).toHaveLength(1)
  })

  it('leaves unrelated connectors alone', () => {
    const third = '44444444-4444-4444-8444-444444444444'
    const h = setup([
      makeRect(),
      makeRect({ id: OTHER_ID, x: 400 }),
      makeRect({ id: third, x: 800 }),
      connectorBetween(OTHER_ID, third),
    ])
    select(h, [SOURCE_ID])
    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('Delete'))
    })

    const deleted = h.callbacks.onDelete.mock.calls[0][0] as Array<CanvasElement>
    expect(deleted.map((element) => element.id)).toEqual([SOURCE_ID])
  })

  it('cascades from the empty-text delete inside commitEditing', () => {
    // The second, easily-missed delete site: a text element emptied to
    // nothing is destroyed there, not by deleteSelection.
    const text = makeRect({ kind: 'text', text: 'hello' })
    const h = setup([
      text,
      makeRect({ id: OTHER_ID, x: 400 }),
      connectorBetween(SOURCE_ID, OTHER_ID),
    ])
    select(h, [SOURCE_ID])
    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('Enter'))
    })
    h.sync()
    // One keystroke per render. `applyTextEdit` reads the `latest` ref, which
    // only refreshes on render — five backspaces inside one `act` would all
    // apply against the same stale caret and leave text behind.
    for (let i = 0; i < 'hello'.length; i += 1) {
      act(() => {
        h.api.textInput.onEditingKeyDown(keyEvent('Backspace'))
      })
      h.sync()
    }
    expect(h.scene.byId.get(SOURCE_ID)?.text).toBe('')
    act(() => {
      h.api.textInput.commitEditing()
    })
    h.sync()

    const deleted = h.callbacks.onDelete.mock.calls[0][0] as Array<CanvasElement>
    expect(deleted.map((element) => element.id).sort()).toEqual(
      [SOURCE_ID, CONNECTOR_ID].sort(),
    )
    expect(h.scene.byId.has(CONNECTOR_ID)).toBe(false)
  })
})

// ── step 13: the pointerless path ──────────────────────────────────────────

describe('Alt+Arrow quick-creates without a pointer', () => {
  it('matches what clicking the same handle does', () => {
    const byKey = setup()
    select(byKey, [SOURCE_ID])
    act(() => {
      byKey.api.boardHandlers.onKeyDown(keyEvent('ArrowRight', { altKey: true }))
    })
    byKey.sync()

    const byPointer = setup()
    select(byPointer, [SOURCE_ID])
    quickCreate(byPointer, makeRect(), 'right')

    const keyed = byKey.callbacks.onQuickCreate.mock
      .calls[0][0] as Array<CanvasElement>
    const clicked = byPointer.callbacks.onQuickCreate.mock
      .calls[0][0] as Array<CanvasElement>
    expect(keyed[0].x).toBe(clicked[0].x)
    expect(keyed[0].y).toBe(clicked[0].y)
    expect(keyed[0].kind).toBe(clicked[0].kind)
  })

  it('maps each arrow to its own side', () => {
    for (const [key, expected] of [
      ['ArrowUp', { x: 0, y: -QUICK_CREATE_GAP - 100 }],
      ['ArrowDown', { x: 0, y: 100 + QUICK_CREATE_GAP }],
      ['ArrowLeft', { x: -QUICK_CREATE_GAP - 100, y: 0 }],
    ] as const) {
      const h = setup()
      select(h, [SOURCE_ID])
      act(() => {
        h.api.boardHandlers.onKeyDown(keyEvent(key, { altKey: true }))
      })
      const created = h.callbacks.onQuickCreate.mock
        .calls[0][0] as Array<CanvasElement>
      expect({ x: created[0].x, y: created[0].y }).toEqual(expected)
    }
  })

  it('leaves a PLAIN arrow doing exactly what it did — nothing', () => {
    const h = setup()
    select(h, [SOURCE_ID])
    const event = keyEvent('ArrowRight')
    act(() => {
      h.api.boardHandlers.onKeyDown(event)
    })
    expect(h.callbacks.onQuickCreate).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('does nothing with more than one element selected', () => {
    // Which of the two would it extend? Ambiguous, so it declines rather
    // than picking.
    const h = setup([makeRect(), makeRect({ id: OTHER_ID, x: 400 })])
    select(h, [SOURCE_ID, OTHER_ID])
    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('ArrowRight', { altKey: true }))
    })
    expect(h.callbacks.onQuickCreate).not.toHaveBeenCalled()
  })

  it('does nothing when the selection is a connector', () => {
    const h = setup([
      makeRect(),
      makeRect({ id: OTHER_ID, x: 400 }),
      connectorBetween(SOURCE_ID, OTHER_ID),
    ])
    select(h, [CONNECTOR_ID])
    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('ArrowRight', { altKey: true }))
    })
    expect(h.callbacks.onQuickCreate).not.toHaveBeenCalled()
  })

  it('does nothing on a read-only board', () => {
    const h = setup([makeRect()], { readOnly: true })
    select(h, [SOURCE_ID])
    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('ArrowRight', { altKey: true }))
    })
    expect(h.callbacks.onQuickCreate).not.toHaveBeenCalled()
  })

  it('still ignores Ctrl+Arrow and Meta+Arrow', () => {
    const h = setup()
    select(h, [SOURCE_ID])
    act(() => {
      h.api.boardHandlers.onKeyDown(
        keyEvent('ArrowRight', { altKey: true, ctrlKey: true }),
      )
      h.api.boardHandlers.onKeyDown(
        keyEvent('ArrowRight', { altKey: true, metaKey: true }),
      )
    })
    expect(h.callbacks.onQuickCreate).not.toHaveBeenCalled()
  })

  it('does not swallow the tool shortcuts it used to sit in front of', () => {
    // The guard this branch replaced returned early on EVERY altKey press;
    // the unmodified single-letter shortcuts must be untouched.
    const h = setup()
    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('r'))
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerDown(
        pointerEvent({ clientX: 600, clientY: 400 }),
      )
      h.api.canvasHandlers.onPointerUp(
        pointerEvent({ clientX: 600, clientY: 400 }),
      )
    })
    h.sync()
    expect(h.callbacks.onCreate).toHaveBeenCalledTimes(1)
  })
})

// ── id reconciliation ──────────────────────────────────────────────────────

describe('remapElementId follows an element the server renamed', () => {
  it('repoints connector endpoints at the new id', () => {
    // A quick-created connector is built against the new element's CLIENT
    // uuid. Left unremapped it names a row that never existed: the line
    // stops being drawable and the delete cascade stops finding it.
    const h = setup([
      makeRect(),
      makeRect({ id: OTHER_ID, x: 400 }),
      connectorBetween(SOURCE_ID, OTHER_ID),
    ])
    const serverId = '55555555-5555-4555-8555-555555555555'
    act(() => {
      h.api.remapElementId(OTHER_ID, serverId)
    })
    h.sync()
    expect(h.scene.byId.get(CONNECTOR_ID)?.connector).toEqual({
        source: { kind: 'element', elementId: SOURCE_ID },
        target: { kind: 'element', elementId: serverId },
        routing: DEFAULT_CONNECTOR_ROUTING,
      })
  })

  it('repoints the pre-edit snapshot too, so the edit stays undoable', () => {
    // `recordUpdate` matches pre-state to post-state BY ID. A `before` still
    // holding the temporary id produces no operation at all, and the text the
    // user just typed silently becomes un-undoable.
    //
    // Asserted on the editing state itself rather than by driving a commit:
    // the element's OWN rename happens inside `useCanvasElements` (it swaps
    // the temporary element for the persisted row), which this harness does
    // not stand in for — only the remap callback is under test here.
    const h = setup([makeRect({ kind: 'text', text: 'hi' })])
    select(h, [SOURCE_ID])
    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('Enter'))
    })
    h.sync()
    expect(h.api.editing?.before?.id).toBe(SOURCE_ID)

    const serverId = '66666666-6666-4666-8666-666666666666'
    act(() => {
      h.api.remapElementId(SOURCE_ID, serverId)
    })
    h.sync()

    expect(h.api.editing?.elementId).toBe(serverId)
    expect(h.api.editing?.before?.id).toBe(serverId)
  })
})

// ── dragging a connector's ends ────────────────────────────────────────────

/** The page point of one endpoint grip of the selected connector. */
function gripPoint(h: ReturnType<typeof setup>, end: 'source' | 'target') {
  const connector = h.scene.byId.get(CONNECTOR_ID)!
  const path = connectorPathOf(h.scene, connector)
  const rects = connectorEndpointRects(DEFAULT_CAMERA, path)
  if (!rects) throw new Error('connector has no drawable path')
  const rect = rects[end]
  return {
    clientX: rect.x + rect.width / 2,
    clientY: rect.y + rect.height / 2,
  }
}

/** Press an endpoint grip, drag to a world point, release. */
function dragEnd(
  h: ReturnType<typeof setup>,
  end: 'source' | 'target',
  to: { clientX: number; clientY: number },
) {
  const from = gripPoint(h, end)
  act(() => {
    h.api.canvasHandlers.onPointerDown(pointerEvent(from))
  })
  h.sync()
  act(() => {
    h.api.canvasHandlers.onPointerMove(pointerEvent(to))
  })
  h.sync()
  act(() => {
    h.api.canvasHandlers.onPointerUp(pointerEvent(to))
  })
  h.sync()
}

/** A board with two rects joined by a connector, connector already selected. */
function connectedBoard() {
  const h = setup([
    makeRect(),
    makeRect({ id: OTHER_ID, x: 400, y: 0 }),
    connectorBetween(SOURCE_ID, OTHER_ID),
  ])
  select(h, [CONNECTOR_ID])
  return h
}

describe('dragging a connector end', () => {
  it('shows a grip at each end of the drawn path', () => {
    const h = connectedBoard()
    const path = connectorPathOf(h.scene, h.scene.byId.get(CONNECTOR_ID)!)!
    const rects = connectorEndpointRects(DEFAULT_CAMERA, path)!
    // Exactly the two ends of the line that was drawn — not the connector's
    // stored 1x1 placeholder, which sits nowhere near either.
    expect(rects.source.x + rects.source.width / 2).toBeCloseTo(path[0].x)
    expect(rects.target.x + rects.target.width / 2).toBeCloseTo(
      path[path.length - 1].x,
    )
  })

  it('moves to ANY point along an edge, not one of four midpoints', () => {
    const h = connectedBoard()
    // A fifth of the way along the source's bottom edge — deliberately NOT its
    // midpoint, which is the only place the old four-sided model could put it.
    dragEnd(h, 'source', { clientX: 20, clientY: 95 })

    const link = h.scene.byId.get(CONNECTOR_ID)!.connector!
    expect(link.source).toEqual({
      kind: 'element',
      elementId: SOURCE_ID,
      attach: { x: 0.2, y: 1 },
    })
    expect(h.callbacks.onUpdate).toHaveBeenCalledTimes(1)
    expect(h.callbacks.onUpdate.mock.calls[0][2]).toBe('reconnect')
  })

  it('stores the attachment NORMALISED, so it survives a resize', () => {
    // A world offset would slide off the shape the moment it grew; a fraction
    // of the box stays a fifth of the way along whatever the box becomes.
    const h = connectedBoard()
    dragEnd(h, 'source', { clientX: 20, clientY: 95 })
    const source = h.scene.byId.get(CONNECTOR_ID)!.connector!.source as {
      attach: { x: number; y: number }
    }
    expect(source.attach.x).toBeGreaterThanOrEqual(0)
    expect(source.attach.x).toBeLessThanOrEqual(1)
    // On the border: at least one component pinned to an edge.
    const { x, y } = source.attach
    expect(x === 0 || x === 1 || y === 0 || y === 1).toBe(true)
  })

  it('attaches to a DIFFERENT element, snapping to its nearest side', () => {
    const third = '44444444-4444-4444-8444-444444444444'
    const h = setup([
      makeRect(),
      makeRect({ id: OTHER_ID, x: 400, y: 0 }),
      makeRect({ id: third, x: 0, y: 400 }),
      connectorBetween(SOURCE_ID, OTHER_ID),
    ])
    select(h, [CONNECTOR_ID])
    // Near the TOP edge, a quarter along — dropping dead centre is
    // equidistant from all four edges, so that assertion would pin an
    // arbitrary tie-break rather than the rule.
    dragEnd(h, 'target', { clientX: 25, clientY: 410 })

    expect(h.scene.byId.get(CONNECTOR_ID)!.connector!.target).toEqual({
      kind: 'element',
      elementId: third,
      attach: { x: 0.25, y: 0 },
    })
  })

  it('DETACHES to a free point when dropped on empty board', () => {
    const h = connectedBoard()
    dragEnd(h, 'target', { clientX: 600, clientY: 500 })

    expect(h.scene.byId.get(CONNECTOR_ID)!.connector!.target).toEqual({
      kind: 'point',
      point: { x: 600, y: 500 },
    })
  })

  it('leaves the connector drawable with a free end', () => {
    const h = connectedBoard()
    dragEnd(h, 'target', { clientX: 600, clientY: 500 })
    const path = connectorPathOf(h.scene, h.scene.byId.get(CONNECTOR_ID)!)
    expect(path).not.toBeNull()
    expect(path![path!.length - 1]).toEqual({ x: 600, y: 500 })
  })

  it('can detach BOTH ends, leaving a line attached to nothing', () => {
    const h = connectedBoard()
    dragEnd(h, 'target', { clientX: 600, clientY: 500 })
    dragEnd(h, 'source', { clientX: 620, clientY: 200 })

    const link = h.scene.byId.get(CONNECTOR_ID)!.connector!
    expect(link.source.kind).toBe('point')
    expect(link.target.kind).toBe('point')
    expect(connectorPathOf(h.scene, h.scene.byId.get(CONNECTOR_ID)!)).not.toBeNull()
  })

  it('refuses a drop on the element the OTHER end holds', () => {
    // That would be a self-connector: the schema rejects it and it has no
    // drawable path. Reverting is less confusing than silently leaving the end
    // floating somewhere the user did not aim at.
    const h = connectedBoard()
    const before = h.scene.byId.get(CONNECTOR_ID)!.connector
    dragEnd(h, 'source', { clientX: 450, clientY: 50 })

    expect(h.scene.byId.get(CONNECTOR_ID)!.connector).toEqual(before)
    expect(h.callbacks.onUpdate).not.toHaveBeenCalled()
  })

  it('hands undo the connector as it stood BEFORE the drag', () => {
    const h = connectedBoard()
    dragEnd(h, 'target', { clientX: 600, clientY: 500 })

    const [after, before] = h.callbacks.onUpdate.mock.calls[0] as [
      Array<CanvasElement>,
      Array<CanvasElement>,
    ]
    expect(before[0].connector!.target).toEqual({
      kind: 'element',
      elementId: OTHER_ID,
    })
    expect(after[0].connector!.target.kind).toBe('point')
  })

  it('does not start from a grip when the connector is not selected', () => {
    // The grips are only drawn for a selected connector, so pressing where one
    // WOULD be must not start the gesture — export-what-you-draw, in the
    // direction that has already produced a real bug here.
    const h = setup([
      makeRect(),
      makeRect({ id: OTHER_ID, x: 400, y: 0 }),
      connectorBetween(SOURCE_ID, OTHER_ID),
    ])
    const path = connectorPathOf(h.scene, h.scene.byId.get(CONNECTOR_ID)!)!
    const rects = connectorEndpointRects(DEFAULT_CAMERA, path)!
    act(() => {
      h.api.canvasHandlers.onPointerDown(
        pointerEvent({
          clientX: rects.target.x + rects.target.width / 2,
          clientY: rects.target.y + rects.target.height / 2,
        }),
      )
      h.api.canvasHandlers.onPointerUp(pointerEvent({ clientX: 400, clientY: 50 }))
    })
    h.sync()
    expect(h.scene.byId.get(CONNECTOR_ID)!.connector!.target).toEqual({
      kind: 'element',
      elementId: OTHER_ID,
    })
  })
})

describe('the drag says whether it will connect, before you let go', () => {
  /** Press an endpoint grip and move to a point WITHOUT releasing. */
  function holdEnd(
    h: ReturnType<typeof setup>,
    end: 'source' | 'target',
    to: { clientX: number; clientY: number },
  ) {
    const from = gripPoint(h, end)
    act(() => {
      h.api.canvasHandlers.onPointerDown(pointerEvent(from))
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerMove(pointerEvent(to))
    })
    h.sync()
  }

  it('reports the element and the exact spot it would attach to', () => {
    const third = '44444444-4444-4444-8444-444444444444'
    const h = setup([
      makeRect(),
      makeRect({ id: OTHER_ID, x: 400, y: 0 }),
      makeRect({ id: third, x: 0, y: 400 }),
      connectorBetween(SOURCE_ID, OTHER_ID),
    ])
    select(h, [CONNECTOR_ID])
    holdEnd(h, 'target', { clientX: 25, clientY: 410 })

    expect(h.api.connectorAttach).toEqual({
      elementId: third,
      attach: { x: 0.25, y: 0 },
    })
  })

  it('reports NOTHING over empty board — which is how "this will detach" is shown', () => {
    const h = connectedBoard()
    holdEnd(h, 'target', { clientX: 700, clientY: 700 })
    expect(h.api.connectorAttach).toBeNull()
  })

  it('reports nothing over the element the OTHER end holds', () => {
    // No highlight means no attachment, which is exactly what releasing there
    // does — the drop is refused rather than making a self-connector.
    const h = connectedBoard()
    holdEnd(h, 'source', { clientX: 450, clientY: 50 })
    expect(h.api.connectorAttach).toBeNull()
  })

  it('previews the SAME attachment the release actually commits', () => {
    // One rule, consulted twice. If these could differ, the highlight would be
    // a promise the drop does not keep.
    const third = '44444444-4444-4444-8444-444444444444'
    const h = setup([
      makeRect(),
      makeRect({ id: OTHER_ID, x: 400, y: 0 }),
      makeRect({ id: third, x: 0, y: 400 }),
      connectorBetween(SOURCE_ID, OTHER_ID),
    ])
    select(h, [CONNECTOR_ID])
    const drop = { clientX: 70, clientY: 415 }
    holdEnd(h, 'target', drop)
    const previewed = h.api.connectorAttach

    act(() => {
      h.api.canvasHandlers.onPointerUp(pointerEvent(drop))
    })
    h.sync()

    expect(h.scene.byId.get(CONNECTOR_ID)!.connector!.target).toEqual({
      kind: 'element',
      elementId: previewed!.elementId,
      attach: previewed!.attach,
    })
  })
})
