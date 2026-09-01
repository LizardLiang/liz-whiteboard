// src/components/canvas/use-canvas-input.test.ts
// Regression tests for the text-commit lifecycle (Hermes review, BLOCKER +
// W5).
//
// These drive the real hook. jsdom has no 2D context, so `getMeasurer`
// returns null throughout — which is fine here, because none of the paths
// under test need text metrics. Anything that DOES need metrics (caret
// placement, click-to-caret, wrapping) is not asserted in this file and is
// still Wave 5's e2e job.
//
// The commit tests all share one shape: two commits inside a SINGLE `act()`.
// That is not an artificial construction — it is exactly what happens in
// production, where both commit triggers fire in the same synchronous handler
// with no render between them, so the `latest` ref that guards re-entry has
// not refreshed.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useCanvasInput } from './use-canvas-input'
import type { CanvasElement, Scene } from '@/lib/canvas-engine/scene'
import type { Camera } from '@/lib/canvas-engine/camera'
import type { CanvasTool } from './use-canvas-input'
import { DEFAULT_CAMERA } from '@/lib/canvas-engine/camera'
import { DEFAULT_ELEMENT_STYLE, sceneFrom } from '@/lib/canvas-engine/scene'

const TEXT_ID = '11111111-1111-4111-8111-111111111111'

function makeText(overrides: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id: TEXT_ID,
    kind: 'text',
    x: 0,
    y: 0,
    width: 240,
    height: 48,
    rotation: 0,
    zIndex: 0,
    text: 'hello',
    style: { ...DEFAULT_ELEMENT_STYLE },
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

function keyEvent(key: string) {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    nativeEvent: { isComposing: false },
  } as any
}

function setup(initial: Array<CanvasElement> = [makeText()]) {
  let scene: Scene = sceneFrom(initial)
  let camera: Camera = DEFAULT_CAMERA
  let tool: CanvasTool = 'select'

  const callbacks = {
    onCreate: vi.fn(),
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
      readOnly: false,
      // jsdom has no canvas context. Every path under test avoids text
      // metrics; nothing here silently substitutes a guessed width.
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
    get tool() {
      return tool
    },
    get api() {
      return view.result.current
    },
    /** Feed the mutated scene back in, as CanvasBoard's re-render would. */
    sync: () => view.rerender(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('text commit is idempotent within one synchronous handler', () => {
  it('persists a new text element ONCE via the pointer path', () => {
    // The production sequence, verbatim: CanvasBoard's pointerdown wrapper
    // focuses the container (blurring the proxy, which commits), then calls
    // onPointerDown, whose `if (editing) commitEditing()` commits again.
    // Two element:create emits for one temp id means two server rows.
    // Text tool: the click creates the element and starts editing (isNew).
    const withTextTool = setupWithTool('text')
    act(() => {
      withTextTool.api.canvasHandlers.onPointerDown(pointerEvent())
    })
    withTextTool.sync()
    act(() => {
      withTextTool.api.textInput.insertText('hello')
    })
    withTextTool.sync()

    act(() => {
      // 1. the blur triggered by containerRef.focus()
      withTextTool.api.textInput.commitEditing()
      // 2. onPointerDown's own `if (editing) commitEditing()`
      withTextTool.api.canvasHandlers.onPointerDown(
        pointerEvent({ clientX: 500, clientY: 500 }),
      )
    })

    expect(withTextTool.callbacks.onCreate).toHaveBeenCalledTimes(1)
  })

  it('persists an edited text element ONCE via the Escape path', () => {
    // Pointer-free path: Escape commits, `active` flips false, and the
    // proxy's own effect blurs — firing onBlur={commitEditing} a second time
    // before the parent's `latest` ref has refreshed.
    const h = setup([makeText()])

    act(() => {
      h.api.setSelectedIds(new Set([TEXT_ID]))
    })
    h.sync()
    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('Enter'))
    })
    h.sync()

    // Type something. An edit session that changed NOTHING is deliberately
    // not persisted (see `commitEditing`), so a session with no keystroke in
    // it would assert zero here and stop testing the re-entry guard this is
    // actually about.
    act(() => {
      h.api.textInput.insertText('!')
    })
    h.sync()

    act(() => {
      h.api.textInput.onEditingKeyDown(keyEvent('Escape'))
      h.api.textInput.commitEditing()
    })

    expect(h.callbacks.onUpdate).toHaveBeenCalledTimes(1)
    expect(h.callbacks.onUpdate.mock.calls[0][2]).toBe('text-edit')
  })

  it('persists an edited text element ONCE via the Tab path', () => {
    const h = setup([makeText()])

    act(() => {
      h.api.setSelectedIds(new Set([TEXT_ID]))
    })
    h.sync()
    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('Enter'))
    })
    h.sync()

    // Type something. An edit session that changed NOTHING is deliberately
    // not persisted (see `commitEditing`), so a session with no keystroke in
    // it would assert zero here and stop testing the re-entry guard this is
    // actually about.
    act(() => {
      h.api.textInput.insertText('!')
    })
    h.sync()

    act(() => {
      h.api.textInput.onEditingKeyDown(keyEvent('Tab'))
      h.api.textInput.commitEditing()
    })

    expect(h.callbacks.onUpdate).toHaveBeenCalledTimes(1)
  })

  it('deletes an emptied existing text element ONCE, never twice', () => {
    // The second delete acks NOT_FOUND, and use-canvas-elements' rollback
    // then RESURRECTS the element the user just emptied, with an error toast.
    const h = setup([makeText({ text: '' })])

    act(() => {
      h.api.setSelectedIds(new Set([TEXT_ID]))
    })
    h.sync()
    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('Enter'))
    })
    h.sync()

    act(() => {
      h.api.textInput.commitEditing()
      h.api.textInput.commitEditing()
    })

    expect(h.callbacks.onDelete).toHaveBeenCalledTimes(1)
    // Wave 3: onDelete now carries the full element (undo's inverse needs
    // every persisted property to restore it faithfully), not just the id.
    expect(h.callbacks.onDelete).toHaveBeenCalledWith([
      expect.objectContaining({ id: TEXT_ID }),
    ])
  })

  it('records the ORIGINAL text on an emptied EXISTING element, not the erased text (Hermes review, BLOCKER B2)', () => {
    // The emptying was never persisted — the row `onDelete` deletes
    // server-side still holds 'hi'. Recording the current (emptied) scene
    // value would restore an invisible, un-findable box on undo.
    const h = setup([makeText({ text: 'hi' })])

    act(() => {
      h.api.setSelectedIds(new Set([TEXT_ID]))
    })
    h.sync()
    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('Enter'))
    })
    h.sync()

    act(() => {
      h.api.textInput.onEditingKeyDown(keyEvent('Backspace'))
    })
    h.sync()
    act(() => {
      h.api.textInput.onEditingKeyDown(keyEvent('Backspace'))
    })
    h.sync()

    act(() => {
      h.api.textInput.commitEditing()
    })

    expect(h.callbacks.onDelete).toHaveBeenCalledTimes(1)
    const [[deleted]] = h.callbacks.onDelete.mock.calls[0]
    expect(deleted.text).toBe('hi')
  })

  it('reports NOTHING for an edit session that changed no text', () => {
    // Opening a text box, reading it and clicking away is not an edit. It used
    // to be reported as one, and the cost landed on the NEXT Ctrl+Z: the no-op
    // entry sat on top of the undo stack and was consumed silently, so the
    // gesture the user meant to reverse needed a second press with nothing to
    // show for the first.
    //
    // The quick-create-by-click path walks straight into it — it opens the new
    // element for typing — which is how "one Ctrl+Z reverses a quick-create"
    // started needing two.
    const h = setup([makeText()])

    act(() => {
      h.api.setSelectedIds(new Set([TEXT_ID]))
    })
    h.sync()
    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('Enter'))
    })
    h.sync()
    act(() => {
      h.api.textInput.commitEditing()
    })

    expect(h.callbacks.onUpdate).not.toHaveBeenCalled()
    expect(h.callbacks.onCreate).not.toHaveBeenCalled()
    expect(h.callbacks.onDelete).not.toHaveBeenCalled()
  })

  it('reports an edit that types and then deletes back to the original', () => {
    // The comparison is against the PRE-SESSION text, not against "were there
    // keystrokes" — a session that ends where it started has changed nothing,
    // whatever happened in between.
    const h = setup([makeText()])

    act(() => {
      h.api.setSelectedIds(new Set([TEXT_ID]))
    })
    h.sync()
    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('Enter'))
    })
    h.sync()
    act(() => {
      h.api.textInput.insertText('!')
    })
    h.sync()
    act(() => {
      h.api.textInput.onEditingKeyDown(keyEvent('Backspace'))
    })
    h.sync()
    act(() => {
      h.api.textInput.commitEditing()
    })

    expect(h.callbacks.onUpdate).not.toHaveBeenCalled()
  })

  it('still commits a SECOND, genuinely new edit after the first finished', () => {
    // The re-entry guard must not latch: opening a new edit has to persist.
    const h = setup([makeText()])

    act(() => {
      h.api.setSelectedIds(new Set([TEXT_ID]))
    })
    h.sync()
    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('Enter'))
    })
    h.sync()
    // Both sessions type, for the reason the Escape/Tab tests above document:
    // a no-op session is not persisted, so an untyped first session would
    // make this pass for the wrong reason.
    act(() => {
      h.api.textInput.insertText('?')
    })
    h.sync()
    act(() => {
      h.api.textInput.commitEditing()
    })
    h.sync()

    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('Enter'))
    })
    h.sync()
    act(() => {
      h.api.textInput.insertText('!')
    })
    h.sync()
    act(() => {
      h.api.textInput.commitEditing()
    })

    expect(h.callbacks.onUpdate).toHaveBeenCalledTimes(2)
  })
})

describe('board shortcuts stay out of the way while typing', () => {
  // The text proxy is a CHILD of the container this handler sits on, so
  // keydown from the focused textarea bubbles into it. In a real browser this
  // made typing impossible: "r" switched to the rectangle tool, Backspace
  // deleted the element being edited, space panned the board.
  function startEditing(h: ReturnType<typeof setup>) {
    act(() => {
      h.api.setSelectedIds(new Set([TEXT_ID]))
    })
    h.sync()
    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('Enter'))
    })
    h.sync()
  }

  it('does not switch tools when a letter is typed', () => {
    const h = setup([makeText()])
    startEditing(h)

    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('r'))
      h.api.boardHandlers.onKeyDown(keyEvent('v'))
      h.api.boardHandlers.onKeyDown(keyEvent('t'))
      h.api.boardHandlers.onKeyDown(keyEvent('h'))
    })

    expect(h.tool).toBe('select')
  })

  it('does not delete the element being edited on Backspace or Delete', () => {
    const h = setup([makeText()])
    startEditing(h)

    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('Backspace'))
      h.api.boardHandlers.onKeyDown(keyEvent('Delete'))
    })

    expect(h.callbacks.onDelete).not.toHaveBeenCalled()
    expect(h.scene.byId.has(TEXT_ID)).toBe(true)
  })

  it('does not swallow space as a pan modifier', () => {
    const h = setup([makeText()])
    startEditing(h)

    const space = keyEvent(' ')
    act(() => {
      h.api.boardHandlers.onKeyDown(space)
    })

    // preventDefault here would stop the space character being typed.
    expect(space.preventDefault).not.toHaveBeenCalled()
  })

  it('still handles shortcuts once the edit is committed', () => {
    const h = setup([makeText()])
    startEditing(h)
    act(() => {
      h.api.textInput.commitEditing()
    })
    h.sync()

    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('r'))
    })

    expect(h.tool).toBe('rectangle')
  })
})

describe('lost pointer capture ends the gesture (W5)', () => {
  it('stops applying a drag after capture is lost without a cancel event', () => {
    // touchAction is 'none' on the canvas, so an OS gesture takeover on
    // touch/pen revokes capture with no pointercancel. Without this handler
    // the gesture ref never resets and the element keeps following the
    // pointer — a ghost drag the user cannot stop.
    const element: CanvasElement = {
      ...makeText(),
      kind: 'rectangle',
      width: 100,
      height: 100,
    }
    const h = setup([element])

    act(() => {
      h.api.canvasHandlers.onPointerDown(
        pointerEvent({ clientX: 10, clientY: 10 }),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 60, clientY: 10 }),
      )
    })
    h.sync()
    const draggedX = h.scene.byId.get(TEXT_ID)!.x
    expect(draggedX).toBeGreaterThan(0)

    act(() => {
      h.api.canvasHandlers.onLostPointerCapture(pointerEvent())
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 400, clientY: 10 }),
      )
    })

    expect(h.scene.byId.get(TEXT_ID)!.x).toBe(draggedX)
  })
})

describe('pre-state capture for undo (board-undo tactical plan, Wave 3)', () => {
  it('passes the pre-drag position as `before` on a single-element move', () => {
    const rect: CanvasElement = {
      ...makeText(),
      kind: 'rectangle',
      x: 10,
      y: 10,
      width: 100,
      height: 100,
    }
    const h = setup([rect])

    act(() => {
      h.api.canvasHandlers.onPointerDown(
        pointerEvent({ clientX: 15, clientY: 15 }),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 65, clientY: 15 }),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerUp(
        pointerEvent({ clientX: 65, clientY: 15 }),
      )
    })

    expect(h.callbacks.onUpdate).toHaveBeenCalledTimes(1)
    const [after, before, gesture] = h.callbacks.onUpdate.mock.calls[0]
    expect(after).toHaveLength(1)
    expect(before).toHaveLength(1)
    expect(before[0].x).toBe(10)
    expect(before[0].y).toBe(10)
    expect(after[0].x).toBeGreaterThan(10)
    // Wave 4: the gesture kind lets the undo toast say "moved", not a
    // generic "updated" that also covers resize and text edits.
    expect(gesture).toBe('move')
  })

  it('records ONE onUpdate call carrying every element for a multi-select move', () => {
    const a: CanvasElement = {
      ...makeText(),
      id: 'aaaaaaaa-1111-4111-8111-111111111111',
      kind: 'rectangle',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    }
    const b: CanvasElement = {
      ...makeText(),
      id: 'bbbbbbbb-2222-4222-8222-222222222222',
      kind: 'rectangle',
      x: 200,
      y: 200,
      width: 50,
      height: 50,
    }
    const h = setup([a, b])

    // Marquee-select both, then drag from inside one of them.
    act(() => {
      h.api.setSelectedIds(new Set([a.id, b.id]))
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerDown(
        pointerEvent({ clientX: 10, clientY: 10 }),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 60, clientY: 10 }),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerUp(
        pointerEvent({ clientX: 60, clientY: 10 }),
      )
    })

    // ONE call, not one per element — one-gesture-one-entry is structural.
    expect(h.callbacks.onUpdate).toHaveBeenCalledTimes(1)
    const [after, before] = h.callbacks.onUpdate.mock.calls[0]
    expect(after.map((e: CanvasElement) => e.id).sort()).toEqual(
      [a.id, b.id].sort(),
    )
    expect(before.map((e: CanvasElement) => e.id).sort()).toEqual(
      [a.id, b.id].sort(),
    )
    const beforeA = before.find((e: CanvasElement) => e.id === a.id)
    expect(beforeA.x).toBe(0)
    expect(beforeA.y).toBe(0)
    expect(h.callbacks.onUpdate.mock.calls[0][2]).toBe('move')
  })

  it('passes the pre-resize bounds as `before` on a resize', () => {
    const rect: CanvasElement = {
      ...makeText(),
      kind: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    }
    const h = setup([rect])
    act(() => {
      h.api.setSelectedIds(new Set([rect.id]))
    })
    h.sync()

    act(() => {
      // Grab the south-east handle (bottom-right corner of the element).
      h.api.canvasHandlers.onPointerDown(
        pointerEvent({ clientX: 100, clientY: 100 }),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 150, clientY: 150 }),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerUp(
        pointerEvent({ clientX: 150, clientY: 150 }),
      )
    })

    expect(h.callbacks.onUpdate).toHaveBeenCalledTimes(1)
    const [after, before, gesture] = h.callbacks.onUpdate.mock.calls[0]
    expect(before[0].width).toBe(100)
    expect(before[0].height).toBe(100)
    expect(after[0].width).toBeGreaterThan(100)
    expect(gesture).toBe('resize')
  })

  it('passes null `before` for a brand-new element (nothing existed to capture)', () => {
    const withTextTool = setupWithTool('text')
    act(() => {
      withTextTool.api.canvasHandlers.onPointerDown(pointerEvent())
    })
    withTextTool.sync()
    act(() => {
      withTextTool.api.textInput.insertText('hello')
    })
    withTextTool.sync()
    act(() => {
      withTextTool.api.textInput.commitEditing()
    })

    expect(withTextTool.callbacks.onCreate).toHaveBeenCalledTimes(1)
    // onCreate has no `before` parameter at all — create has nothing to undo
    // TO except non-existence, which delete already models.
    expect(withTextTool.callbacks.onCreate.mock.calls[0]).toHaveLength(1)
  })

  it('passes the full pre-delete element(s), not just ids, to onDelete', () => {
    const rect: CanvasElement = {
      ...makeText(),
      kind: 'rectangle',
      x: 5,
      y: 6,
      width: 20,
      height: 30,
    }
    const h = setup([rect])
    act(() => {
      h.api.setSelectedIds(new Set([rect.id]))
    })
    h.sync()
    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('Delete'))
    })

    expect(h.callbacks.onDelete).toHaveBeenCalledTimes(1)
    const [deleted] = h.callbacks.onDelete.mock.calls[0]
    expect(deleted).toEqual([rect])
  })
})

/** A harness whose tool starts as something other than `select`. */
function setupWithTool(startTool: CanvasTool) {
  let scene: Scene = sceneFrom([])
  let camera: Camera = DEFAULT_CAMERA
  let tool: CanvasTool = startTool

  const callbacks = {
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
  }
  const canvasRef = { current: makeCanvas() } as any

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
      readOnly: false,
      getMeasurer: () => null,
      callbacks,
    }),
  )

  return {
    view,
    callbacks,
    get scene() {
      return scene
    },
    get tool() {
      return tool
    },
    get api() {
      return view.result.current
    },
    sync: () => view.rerender(),
  }
}

describe('shape tools', () => {
  const SHORTCUTS = [
    ['r', 'rectangle'],
    ['o', 'ellipse'],
    ['d', 'diamond'],
    ['g', 'triangle'],
  ] as const

  it.each(SHORTCUTS)(
    'selects the %s tool from its shortcut',
    (key, expected) => {
      const h = setup([])
      act(() => {
        h.api.boardHandlers.onKeyDown(keyEvent(key))
      })
      expect(h.tool).toBe(expected)
    },
  )

  it.each(SHORTCUTS)('drags out a %s of the drawn kind', (_key, kind) => {
    const h = setupWithTool(kind)
    act(() => {
      h.api.canvasHandlers.onPointerDown(
        pointerEvent({ clientX: 20, clientY: 30 }),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 140, clientY: 110 }),
      )
    })
    h.sync()
    // The in-flight preview is the same kind as the element the release will
    // commit — a draft that always drew a rectangle would show the wrong
    // shape for the whole drag.
    expect(h.api.draft?.kind).toBe(kind)
    act(() => {
      h.api.canvasHandlers.onPointerUp(
        pointerEvent({ clientX: 140, clientY: 110 }),
      )
    })
    h.sync()

    const created = h.scene.elements[0]
    expect(created.kind).toBe(kind)
    expect(created.width).toBe(120)
    expect(created.height).toBe(80)
    expect(h.callbacks.onCreate).toHaveBeenCalledTimes(1)
    // Every shape tool is one-shot, exactly as the rectangle tool has always
    // been: the board returns to select so the new shape can be moved.
    expect(h.tool).toBe('select')
  })

  it('creates a default-sized shape from a click rather than a drag', () => {
    const h = setupWithTool('ellipse')
    act(() => {
      h.api.canvasHandlers.onPointerDown(
        pointerEvent({ clientX: 20, clientY: 30 }),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerUp(
        pointerEvent({ clientX: 21, clientY: 31 }),
      )
    })
    h.sync()

    const created = h.scene.elements[0]
    expect(created.kind).toBe('ellipse')
    expect(created.width).toBe(160)
    expect(created.height).toBe(100)
  })

  it('finishes a drag as the shape it STARTED as, not the live tool', () => {
    // A shortcut still fires while the pointer is down. Reading the tool at
    // release would silently turn a half-drawn ellipse into a diamond.
    const h = setupWithTool('ellipse')
    act(() => {
      h.api.canvasHandlers.onPointerDown(
        pointerEvent({ clientX: 0, clientY: 0 }),
      )
    })
    h.sync()
    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('d'))
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerUp(
        pointerEvent({ clientX: 100, clientY: 100 }),
      )
    })
    h.sync()

    expect(h.scene.elements[0].kind).toBe('ellipse')
  })

  it.each(SHORTCUTS)('shows a crosshair for the %s tool', (_key, kind) => {
    expect(setupWithTool(kind).api.cursor).toBe('crosshair')
  })
})

describe('dragging a curved connector by its bend grip', () => {
  const A = '33333333-3333-4333-8333-333333333333'
  const B = '44444444-4444-4444-8444-444444444444'
  const LINK = '55555555-5555-4555-8555-555555555555'

  function box(id: string, x: number): CanvasElement {
    return {
      ...makeText(),
      id,
      kind: 'rectangle',
      x,
      y: 0,
      width: 100,
      height: 100,
      text: null,
    }
  }

  /**
   * Two boxes 200 apart with a connector between them, so the line runs from
   * (100,50) to (300,50) and its bend grip sits at (200,50) — the same point
   * in world and screen space at the default camera, which is what lets these
   * tests name one pair of numbers instead of two.
   */
  function board(routing: 'curved' | 'straight'): Array<CanvasElement> {
    return [
      box(A, 0),
      box(B, 300),
      {
        ...makeText(),
        id: LINK,
        kind: 'connector',
        // The degenerate placeholder a connector actually stores.
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        text: null,
        zIndex: 2,
        connector: {
          source: { kind: 'element', elementId: A },
          target: { kind: 'element', elementId: B },
          routing,
        },
      },
    ]
  }

  function grabBend(h: ReturnType<typeof setup>) {
    act(() => {
      h.api.setSelectedIds(new Set([LINK]))
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerDown(
        pointerEvent({ clientX: 200, clientY: 50 }),
      )
    })
    h.sync()
  }

  it('bows the line live during the drag, before anything is persisted', () => {
    // The "mutate the scene live, persist at gesture end" rule every other
    // gesture in this file follows — without it the curve would not move
    // until the server acked, a whole round trip later.
    const h = setup(board('curved'))
    grabBend(h)
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 200, clientY: 10 }),
      )
    })
    h.sync()

    // 40 world units up a 200-unit chord.
    expect(h.scene.byId.get(LINK)!.connector!.curvature).toBeCloseTo(0.2, 6)
    expect(h.callbacks.onUpdate).not.toHaveBeenCalled()
  })

  it('persists the bow on release, with the pre-gesture connector as `before`', () => {
    const h = setup(board('curved'))
    grabBend(h)
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 200, clientY: 10 }),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerUp(
        pointerEvent({ clientX: 200, clientY: 10 }),
      )
    })

    expect(h.callbacks.onUpdate).toHaveBeenCalledTimes(1)
    const [after, before, gesture] = h.callbacks.onUpdate.mock.calls[0]
    expect(gesture).toBe('bend')
    expect(after[0].connector.curvature).toBeCloseTo(0.2, 6)
    // The pre-state is what Ctrl+Z restores. A legacy connector had NO
    // curvature at all, and the snapshot has to say so rather than reporting
    // a zero it never held.
    expect(before[0].connector).not.toHaveProperty('curvature')
  })

  it('bows the other way for a drag to the other side', () => {
    // Positive is the LEFT-hand normal of source -> target; this line runs
    // left to right, so downward on screen is negative.
    const h = setup(board('curved'))
    grabBend(h)
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 200, clientY: 110 }),
      )
    })
    h.sync()
    expect(h.scene.byId.get(LINK)!.connector!.curvature).toBeCloseTo(-0.3, 6)
  })

  it('does not start a bend on a STRAIGHT connector', () => {
    // Input must not test an affordance the renderer declined to draw — a
    // 20px rectangle sitting invisibly on the middle of every straight
    // connector would swallow presses meant for whatever lies under it.
    const h = setup(board('straight'))
    grabBend(h)
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 200, clientY: 10 }),
      )
    })
    h.sync()
    expect(h.scene.byId.get(LINK)!.connector).not.toHaveProperty('curvature')

    act(() => {
      h.api.canvasHandlers.onPointerUp(
        pointerEvent({ clientX: 200, clientY: 10 }),
      )
    })
    for (const call of h.callbacks.onUpdate.mock.calls) {
      expect(call[2]).not.toBe('bend')
    }
  })

  it('writes nothing for a press that never bent anything', () => {
    // Otherwise a stray click on the grip pushes an undo entry whose undo is
    // a no-op — "Undid bending a connector" for a connector nobody bent.
    const h = setup(board('curved'))
    grabBend(h)
    act(() => {
      h.api.canvasHandlers.onPointerUp(
        pointerEvent({ clientX: 200, clientY: 50 }),
      )
    })
    expect(h.callbacks.onUpdate).not.toHaveBeenCalled()
  })

  it('recomputes from the pointer each frame rather than accumulating', () => {
    // A drag out and back must land exactly where it started. Frame-by-frame
    // deltas would not — each frame's clamp would become the next one's
    // starting point, the same drift `resize`'s `startBounds` exists to stop.
    const h = setup(board('curved'))
    grabBend(h)
    for (const y of [10, -400, 250, 50]) {
      act(() => {
        h.api.canvasHandlers.onPointerMove(
          pointerEvent({ clientX: 200, clientY: y }),
        )
      })
      h.sync()
    }
    expect(h.scene.byId.get(LINK)!.connector!.curvature).toBeCloseTo(0, 6)
  })

  it('still grabs an ENDPOINT grip in preference to the bend grip', () => {
    // Tested first on purpose: on a short connector the three grips crowd
    // together, and a mis-grabbed end lands the line on the wrong element
    // while a mis-grabbed bend is merely a curve the user can drag back.
    const h = setup(board('curved'))
    act(() => {
      h.api.setSelectedIds(new Set([LINK]))
    })
    h.sync()
    act(() => {
      // The source end of the drawn line.
      h.api.canvasHandlers.onPointerDown(
        pointerEvent({ clientX: 100, clientY: 50 }),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 60, clientY: 90 }),
      )
    })
    h.sync()

    const link = h.scene.byId.get(LINK)!.connector!
    expect(link.source.kind).toBe('point')
    expect(link).not.toHaveProperty('curvature')
  })
})
