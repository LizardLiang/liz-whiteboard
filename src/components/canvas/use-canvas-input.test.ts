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
import { Z_MIN } from '@/lib/canvas-engine/z-order'

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

/**
 * A plain rectangle, built on `makeText`'s own defaults. Hoisted here
 * (Hermes review, Minor Issue) — three of the grouping `describe` blocks
 * below used to each define a byte-for-byte identical local copy of this.
 */
function makeRect(
  id: string,
  overrides: Partial<CanvasElement> = {},
): CanvasElement {
  return { ...makeText(), id, kind: 'rectangle', text: null, ...overrides }
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
    // CSS-pixel size, which is what alignment reads to work out which
    // elements are on screen. It must agree with the bounding rect above —
    // a stub that reported a different viewport would filter a different set
    // of alignment candidates than the same gesture does in a browser.
    clientWidth: 800,
    clientHeight: 600,
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
    // No `detail` field: a real `PointerEvent.detail` does NOT carry click-
    // count semantics the way `MouseEvent.detail` does — confirmed
    // empirically (a Wave 8 e2e probe), every browser tested reports a
    // constant `0` on `pointerdown` regardless of click count. An earlier
    // version of this fixture set `detail: 1`/`detail: 2` here and the app
    // read it to tell an isolated click from a rapid second one — a real
    // bug invisible to this whole suite until real browser input caught it.
    // Group-click-resolution (canvas-element-grouping tactical plan, Wave
    // 2/5) now tracks repeat-click detection itself, by REAL time+position
    // (`lastPointerDownRef` in use-canvas-input.ts), which two synchronous
    // `onPointerDown` calls at the same point already satisfy for free —
    // see the grouping describe blocks below for how each case is driven.
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

function setup(initial: Array<CanvasElement> = [makeText()]) {
  let scene: Scene = sceneFrom(initial)
  let camera: Camera = DEFAULT_CAMERA
  let tool: CanvasTool = 'select'

  const callbacks = {
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    onClone: vi.fn(),
    onGroup: vi.fn(),
    onUngroup: vi.fn(),
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

describe('grouping: selection resolution and entered-group depth (Wave 2)', () => {
  // outer > mid > a, two nested groups plus one leaf. `a` sits geometrically
  // inside both frames and has the highest zIndex, so a raw hit-test at any
  // point inside it always resolves to `a` itself, REGARDLESS of how deep
  // the caller has already entered — exactly the property `resolveClickTarget`
  // exists to handle (which of `a`, `mid`, `outer` a click actually SELECTS
  // depends on `enteredPath`, not on which element the raw hit-test finds).
  const A_ID = '11111111-1111-4111-8111-111111111111'
  const MID_ID = '22222222-2222-4222-8222-222222222222'
  const OUTER_ID = '33333333-3333-4333-8333-333333333333'

  function makeGroupScene(): Array<CanvasElement> {
    const a: CanvasElement = {
      ...makeText(),
      id: A_ID,
      kind: 'rectangle',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      zIndex: 2,
    }
    const mid: CanvasElement = {
      ...makeText(),
      id: MID_ID,
      kind: 'group',
      x: -10,
      y: -10,
      width: 70,
      height: 70,
      zIndex: 1,
      text: null,
      group: { childIds: [A_ID] },
    }
    const outer: CanvasElement = {
      ...makeText(),
      id: OUTER_ID,
      kind: 'group',
      x: -20,
      y: -20,
      width: 90,
      height: 90,
      zIndex: 0,
      text: null,
      group: { childIds: [MID_ID] },
    }
    return [a, mid, outer]
  }

  // The point every click/double-click below lands on: inside `a` (and
  // therefore inside `mid` and `outer` too), which is the whole point —
  // it is always the raw topmost hit, at every depth.
  const HIT = { clientX: 25, clientY: 25 }

  it('a single click on a nested member selects the outermost group', () => {
    const h = setup(makeGroupScene())
    act(() => {
      h.api.canvasHandlers.onPointerDown(pointerEvent(HIT))
    })
    h.sync()
    expect(h.api.selectedIds).toEqual(new Set([OUTER_ID]))
    expect(h.api.enteredPath).toEqual([])
  })

  it('one double-click descends one level and selects the immediate child', () => {
    const h = setup(makeGroupScene())
    // click 1 of the double-click: an isolated-looking press — nothing
    // preceded it, so `lastPointerDownRef` (the `PointerEvent.detail`
    // replacement — see `onPointerDown`'s own comment) is null and this is
    // unconditionally treated as isolated.
    act(() => {
      h.api.canvasHandlers.onPointerDown(pointerEvent(HIT))
    })
    h.sync()
    // click 2: close enough in time and position to click 1 (two
    // synchronous calls, same point) to count as a REPEAT click.
    act(() => {
      h.api.canvasHandlers.onPointerDown(pointerEvent(HIT))
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onDoubleClick(pointerEvent(HIT))
    })
    h.sync()

    expect(h.api.selectedIds).toEqual(new Set([MID_ID]))
    expect(h.api.enteredPath).toEqual([OUTER_ID])
    // `mid` is a group — never directly editable.
    expect(h.api.editing).toBeNull()
  })

  it('a further double-click on the newly selected group reaches the leaf and begins editing', () => {
    const h = setup(makeGroupScene())
    act(() => {
      h.api.canvasHandlers.onPointerDown(pointerEvent(HIT))
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerDown(pointerEvent(HIT))
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onDoubleClick(pointerEvent(HIT))
    })
    h.sync()
    expect(h.api.selectedIds).toEqual(new Set([MID_ID]))

    // A SECOND double-click, continuing the same rapid click train (still
    // within `lastPointerDownRef`'s repeat-click window and at the same
    // point) rather than a fresh, isolated one — what lets `enteredPath`
    // survive between the two double-clicks. See `onPointerDown`'s own
    // comment for why this is what makes FR-005's progressive descent
    // reachable at all.
    act(() => {
      h.api.canvasHandlers.onPointerDown(pointerEvent(HIT))
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerDown(pointerEvent(HIT))
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onDoubleClick(pointerEvent(HIT))
    })
    h.sync()

    expect(h.api.editing?.elementId).toBe(A_ID)
    expect(h.api.selectedIds).toEqual(new Set([A_ID]))
  })

  it('an isolated single click always resets to the outermost group, even mid-descent', () => {
    // FR-004 is unconditional: it does not carve out an exception for "the
    // user was already several levels deep". A fresh, isolated click (not
    // part of a rapid multi-click train) exits whatever was entered.
    //
    // Fake timers here, deliberately: this hook tracks a "repeat click" by
    // REAL elapsed time + position (`lastPointerDownRef`, the
    // `PointerEvent.detail` replacement — see `onPointerDown`'s own comment
    // for why `detail` cannot be used for this at all), not by a value this
    // test can hand-set on the event object. Proving a click AFTER the
    // window lapses is treated as isolated therefore needs REAL (simulated)
    // time to pass between the two click trains, which two synchronous
    // `act()` calls back to back do not provide on their own.
    vi.useFakeTimers()
    try {
      const h = setup(makeGroupScene())
      act(() => {
        h.api.canvasHandlers.onPointerDown(pointerEvent(HIT))
      })
      h.sync()
      act(() => {
        h.api.canvasHandlers.onPointerDown(pointerEvent(HIT))
      })
      h.sync()
      act(() => {
        h.api.canvasHandlers.onDoubleClick(pointerEvent(HIT))
      })
      h.sync()
      expect(h.api.selectedIds).toEqual(new Set([MID_ID]))
      expect(h.api.enteredPath).toEqual([OUTER_ID])

      // Past the repeat-click window (REPEAT_CLICK_WINDOW_MS, 1500ms) — a
      // real user's own multi-double-click "drilling down" session would
      // have lapsed by now too.
      vi.advanceTimersByTime(1600)

      act(() => {
        h.api.canvasHandlers.onPointerDown(pointerEvent(HIT))
      })
      h.sync()

      expect(h.api.selectedIds).toEqual(new Set([OUTER_ID]))
      expect(h.api.enteredPath).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('two isolated single clicks about 700ms apart on the same member BOTH select the outermost group (FR-004 is unconditional; fix round — Hermes code review, Major Issue)', () => {
    // No `onDoubleClick` fires here at all — this is two genuinely
    // independent single clicks, not a double-click gesture. 700ms is
    // deliberately INSIDE the wide `enteredPath`-preservation window
    // (1500ms) but OUTSIDE the tight raw-hit-target window (500ms) —
    // exactly the gap a single shared window used to get wrong, which
    // wrongly resolved the second click to the raw leaf instead of the
    // outermost group.
    vi.useFakeTimers()
    try {
      const h = setup(makeGroupScene())
      act(() => {
        h.api.canvasHandlers.onPointerDown(pointerEvent(HIT))
      })
      h.sync()
      expect(h.api.selectedIds).toEqual(new Set([OUTER_ID]))

      vi.advanceTimersByTime(700)

      act(() => {
        h.api.canvasHandlers.onPointerDown(pointerEvent(HIT))
      })
      h.sync()
      expect(h.api.selectedIds).toEqual(new Set([OUTER_ID]))
    } finally {
      vi.useRealTimers()
    }
  })

  it('Escape resets entered depth, so the next double-click only descends one level again', () => {
    const h = setup(makeGroupScene())
    act(() => {
      h.api.canvasHandlers.onPointerDown(pointerEvent(HIT))
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerDown(pointerEvent(HIT))
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onDoubleClick(pointerEvent(HIT))
    })
    h.sync()
    expect(h.api.enteredPath).toEqual([OUTER_ID])

    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('Escape'))
    })
    h.sync()
    expect(h.api.enteredPath).toEqual([])
    expect(h.api.selectedIds).toEqual(new Set())

    // A brand-new double-click lands back at depth 1 (`mid`), not depth 2
    // (`a`) — proof the reset actually took. `lastPointerDownRef` itself is
    // NOT reset by Escape (a real browser's own click-streak is a pure
    // mouse time+position fact, unaffected by an intervening keypress), but
    // that does not matter here: `enteredPath` — the only thing
    // `resolveClickTarget` actually reads — was already zeroed by Escape
    // above, so the double-click below resolves exactly as if it were the
    // very first one.
    act(() => {
      h.api.canvasHandlers.onPointerDown(pointerEvent(HIT))
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerDown(pointerEvent(HIT))
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onDoubleClick(pointerEvent(HIT))
    })
    h.sync()
    expect(h.api.selectedIds).toEqual(new Set([MID_ID]))
  })

  it('clicking empty canvas resets entered depth', () => {
    const h = setup(makeGroupScene())
    act(() => {
      h.api.canvasHandlers.onPointerDown(pointerEvent(HIT))
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerDown(pointerEvent(HIT))
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onDoubleClick(pointerEvent(HIT))
    })
    h.sync()
    expect(h.api.enteredPath).toEqual([OUTER_ID])

    act(() => {
      // Far outside every element's bounds — and far enough from HIT that
      // `lastPointerDownRef`'s own position check would treat this as
      // isolated even without the empty-canvas branch's own unconditional
      // reset.
      h.api.canvasHandlers.onPointerDown(
        pointerEvent({ clientX: 900, clientY: 900 }),
      )
    })
    h.sync()
    expect(h.api.enteredPath).toEqual([])
  })

  it('deleting the selection resets entered depth', () => {
    const h = setup(makeGroupScene())
    act(() => {
      h.api.canvasHandlers.onPointerDown(pointerEvent(HIT))
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerDown(pointerEvent(HIT))
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onDoubleClick(pointerEvent(HIT))
    })
    h.sync()
    expect(h.api.enteredPath).toEqual([OUTER_ID])

    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('Delete'))
    })
    h.sync()
    expect(h.api.enteredPath).toEqual([])
  })
})

describe('grouping: move and resize (Wave 3)', () => {
  // outer > mid > {a, b}: two nested group levels, two leaves. Geometry is
  // chosen so a click at OUTER_ONLY_POINT hits `outer`'s own frame directly
  // (outside mid's frame and outside both leaves) — membership is data
  // (`childIds`), not geometry, so nothing here needs the frames to
  // physically contain their members' positions (FR-003).
  const A_ID = '11111111-1111-4111-8111-111111111111'
  const B_ID = '44444444-4444-4444-8444-444444444444'
  const MID_ID = '22222222-2222-4222-8222-222222222222'
  const OUTER_ID = '33333333-3333-4333-8333-333333333333'

  function makeNestedGroupScene(): Array<CanvasElement> {
    const a: CanvasElement = {
      ...makeText(),
      id: A_ID,
      kind: 'rectangle',
      x: 0,
      y: 0,
      width: 30,
      height: 30,
      zIndex: 3,
    }
    const b: CanvasElement = {
      ...makeText(),
      id: B_ID,
      kind: 'rectangle',
      x: 100,
      y: 100,
      width: 30,
      height: 30,
      zIndex: 2,
    }
    const mid: CanvasElement = {
      ...makeText(),
      id: MID_ID,
      kind: 'group',
      x: -10,
      y: -10,
      width: 200,
      height: 200,
      zIndex: 1,
      text: null,
      group: { childIds: [A_ID, B_ID] },
    }
    const outer: CanvasElement = {
      ...makeText(),
      id: OUTER_ID,
      kind: 'group',
      x: -20,
      y: -20,
      width: 220,
      height: 220,
      zIndex: 0,
      text: null,
      group: { childIds: [MID_ID] },
    }
    return [a, b, mid, outer]
  }

  // Inside outer's frame (-20..200), outside mid's frame (-10..190), outside
  // both leaves — the raw hit-test can only resolve to `outer` itself.
  const OUTER_ONLY_POINT = { clientX: 195, clientY: 195 }

  it('dragging a group moves every member at every nesting depth by the same offset', () => {
    const h = setup(makeNestedGroupScene())

    act(() => {
      h.api.canvasHandlers.onPointerDown(pointerEvent(OUTER_ONLY_POINT))
    })
    h.sync()
    expect(h.api.selectedIds).toEqual(new Set([OUTER_ID]))

    const DX = 50
    const DY = 30
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({
          clientX: OUTER_ONLY_POINT.clientX + DX,
          clientY: OUTER_ONLY_POINT.clientY + DY,
        }),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerUp(
        pointerEvent({
          clientX: OUTER_ONLY_POINT.clientX + DX,
          clientY: OUTER_ONLY_POINT.clientY + DY,
        }),
      )
    })

    // ONE call carrying the WHOLE subtree — outer, mid, and both leaves —
    // not just the group row that was actually clicked (FR-006, FR-016).
    expect(h.callbacks.onUpdate).toHaveBeenCalledTimes(1)
    const [after, before, gesture] = h.callbacks.onUpdate.mock.calls[0]
    expect(after.map((e: CanvasElement) => e.id).sort()).toEqual(
      [A_ID, B_ID, MID_ID, OUTER_ID].sort(),
    )
    expect(gesture).toBe('move')

    for (const element of after as Array<CanvasElement>) {
      const pre = (before as Array<CanvasElement>).find(
        (e) => e.id === element.id,
      )!
      expect(element.x).toBe(pre.x + DX)
      expect(element.y).toBe(pre.y + DY)
      // Rigid body: sizes never change on a move.
      expect(element.width).toBe(pre.width)
      expect(element.height).toBe(pre.height)
    }
  })

  it('resizing a selected group changes only its own frame — verifies no hidden kind-allowlist blocks it (FR-007)', () => {
    // The plan's own "verify, not build" item: the single-element resize
    // path is gated on `!only.connector`, not a kind allowlist, so a group
    // should already qualify with zero code change. This test is the proof.
    const h = setup(makeNestedGroupScene())
    act(() => {
      h.api.setSelectedIds(new Set([OUTER_ID]))
    })
    h.sync()

    const before = h.scene.byId.get(OUTER_ID)!
    const midBefore = { ...h.scene.byId.get(MID_ID)! }
    const aBefore = { ...h.scene.byId.get(A_ID)! }
    const bBefore = { ...h.scene.byId.get(B_ID)! }

    // Grab the SE handle — outer's own bottom-right corner.
    act(() => {
      h.api.canvasHandlers.onPointerDown(
        pointerEvent({
          clientX: before.x + before.width,
          clientY: before.y + before.height,
        }),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({
          clientX: before.x + before.width + 40,
          clientY: before.y + before.height + 40,
        }),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerUp(
        pointerEvent({
          clientX: before.x + before.width + 40,
          clientY: before.y + before.height + 40,
        }),
      )
    })

    expect(h.callbacks.onUpdate).toHaveBeenCalledTimes(1)
    const [after, , gesture] = h.callbacks.onUpdate.mock.calls[0]
    expect(gesture).toBe('resize')
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe(OUTER_ID)
    expect(after[0].width).toBeGreaterThan(before.width)
    expect(after[0].height).toBeGreaterThan(before.height)

    // Frame-only: every member's own geometry is untouched (FR-007) —
    // resize never reaches into `gesture.ids` the way move does.
    expect(h.scene.byId.get(MID_ID)).toEqual(midBefore)
    expect(h.scene.byId.get(A_ID)).toEqual(aBefore)
    expect(h.scene.byId.get(B_ID)).toEqual(bBefore)
  })
})

describe('grouping: delete cascade and duplicate (Wave 4)', () => {
  // outer > mid > {a, b}, plus `c` (not a member) and a connector `con`
  // joining `a` (a member, two levels deep) to `c` (outside the group
  // entirely) — the connector must be swept by a group delete even though
  // neither of its own ends is the group itself.
  const A_ID = '11111111-1111-4111-8111-111111111111'
  const B_ID = '44444444-4444-4444-8444-444444444444'
  const C_ID = '55555555-5555-4555-8555-555555555555'
  const CON_ID = '66666666-6666-4666-8666-666666666666'
  const MID_ID = '22222222-2222-4222-8222-222222222222'
  const OUTER_ID = '33333333-3333-4333-8333-333333333333'

  function makeDeletableGroupScene(): Array<CanvasElement> {
    const a: CanvasElement = { ...makeText(), id: A_ID, kind: 'rectangle' }
    const b: CanvasElement = { ...makeText(), id: B_ID, kind: 'rectangle' }
    const c: CanvasElement = { ...makeText(), id: C_ID, kind: 'rectangle' }
    const con: CanvasElement = {
      ...makeText(),
      id: CON_ID,
      kind: 'connector',
      text: null,
      width: 1,
      height: 1,
      connector: {
        source: { kind: 'element', elementId: A_ID },
        target: { kind: 'element', elementId: C_ID },
        routing: 'straight',
      },
    }
    const mid: CanvasElement = {
      ...makeText(),
      id: MID_ID,
      kind: 'group',
      text: null,
      group: { childIds: [A_ID, B_ID] },
    }
    const outer: CanvasElement = {
      ...makeText(),
      id: OUTER_ID,
      kind: 'group',
      text: null,
      group: { childIds: [MID_ID] },
    }
    return [a, b, c, con, mid, outer]
  }

  it('deleting a group deletes every descendant and every connector touching any of them', () => {
    const h = setup(makeDeletableGroupScene())
    act(() => {
      h.api.setSelectedIds(new Set([OUTER_ID]))
    })
    h.sync()

    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('Delete'))
    })

    expect(h.callbacks.onDelete).toHaveBeenCalledTimes(1)
    const [deleted] = h.callbacks.onDelete.mock.calls[0]
    expect(new Set((deleted as Array<CanvasElement>).map((e) => e.id))).toEqual(
      new Set([OUTER_ID, MID_ID, A_ID, B_ID, CON_ID]),
    )
    // `c` is not a member and touches the group only through the now-gone
    // connector — it must survive.
    expect((deleted as Array<CanvasElement>).map((e) => e.id)).not.toContain(
      C_ID,
    )

    // The board reflects it too: every swept id is gone, `c` remains.
    for (const id of [OUTER_ID, MID_ID, A_ID, B_ID, CON_ID]) {
      expect(h.scene.byId.get(id)).toBeUndefined()
    }
    expect(h.scene.byId.get(C_ID)).toBeDefined()
  })

  it('duplicating a group deep-clones it with fresh, independent ids and internally consistent childIds', () => {
    const h = setup(makeDeletableGroupScene())
    act(() => {
      h.api.setSelectedIds(new Set([OUTER_ID]))
    })
    h.sync()

    act(() => {
      h.api.duplicateSelection()
    })

    expect(h.callbacks.onClone).toHaveBeenCalledTimes(1)
    const [cloned] = h.callbacks.onClone.mock.calls[0]
    const clonedElements = cloned as Array<CanvasElement>

    // The whole subtree was cloned — outer, mid, and both leaves — not just
    // the group row that was actually selected (FR-014).
    expect(clonedElements).toHaveLength(4)
    const originalIds = new Set([OUTER_ID, MID_ID, A_ID, B_ID])
    for (const element of clonedElements) {
      // No copy shares an id with ANY original — a fresh id, independent of
      // the original it came from.
      expect(originalIds.has(element.id)).toBe(false)
    }
    // No two copies share an id with each other either.
    expect(new Set(clonedElements.map((e) => e.id)).size).toBe(4)

    // Internally consistent: the copied groups' childIds point at COPIED
    // members, never at an original id.
    const copiedOuter = clonedElements.find(
      (e) => e.kind === 'group' && e.group!.childIds.length === 1,
    )!
    const copiedMid = clonedElements.find(
      (e) => e.kind === 'group' && e.group!.childIds.length === 2,
    )!
    const copiedLeafIds = new Set(
      clonedElements.filter((e) => e.kind === 'rectangle').map((e) => e.id),
    )
    expect(copiedOuter.group!.childIds).toEqual([copiedMid.id])
    for (const childId of copiedMid.group!.childIds) {
      expect(copiedLeafIds.has(childId)).toBe(true)
      expect(originalIds.has(childId)).toBe(false)
    }

    // The board now holds BOTH the original group and the independent copy.
    expect(h.scene.byId.get(OUTER_ID)).toBeDefined()
    expect(h.scene.byId.get(copiedOuter.id)).toBeDefined()
  })
})

describe('grouping: referential integrity on individual member delete (FR-018)', () => {
  // A single-level group `mid` with two members. This block exercises the
  // OTHER delete case Wave 4's cascade describe block above does not: a
  // member deleted on its OWN, with its owning group left intact — which
  // `withGroupMembers` never expands and so never sweeps automatically.
  const A_ID = '11111111-1111-4111-8111-111111111111'
  const B_ID = '44444444-4444-4444-8444-444444444444'
  const MID_ID = '22222222-2222-4222-8222-222222222222'

  function makeMemberScene(): Array<CanvasElement> {
    const a: CanvasElement = { ...makeText(), id: A_ID, kind: 'rectangle' }
    const b: CanvasElement = { ...makeText(), id: B_ID, kind: 'rectangle' }
    const mid: CanvasElement = {
      ...makeText(),
      id: MID_ID,
      kind: 'group',
      text: null,
      group: { childIds: [A_ID, B_ID] },
    }
    return [a, b, mid]
  }

  it("deleting one member of a multi-member group drops it from the group's childIds in the SAME entry, and the group survives", () => {
    const h = setup(makeMemberScene())
    act(() => {
      h.api.setSelectedIds(new Set([A_ID]))
    })
    h.sync()

    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('Delete'))
    })

    // Only `a` itself was deleted — no cascade, since `a` is not a group.
    expect(h.callbacks.onDelete).toHaveBeenCalledTimes(1)
    const [deleted] = h.callbacks.onDelete.mock.calls[0]
    expect((deleted as Array<CanvasElement>).map((e) => e.id)).toEqual([A_ID])

    // The group survives, and its childIds no longer name the deleted id.
    const group = h.scene.byId.get(MID_ID)
    expect(group).toBeDefined()
    expect(group?.group?.childIds).toEqual([B_ID])
  })

  it('folds the group cleanup into the SAME write/undo entry as the delete (third onDelete argument)', () => {
    const h = setup(makeMemberScene())
    act(() => {
      h.api.setSelectedIds(new Set([A_ID]))
    })
    h.sync()

    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('Delete'))
    })

    expect(h.callbacks.onDelete).toHaveBeenCalledTimes(1)
    const [, , groupUpdates] = h.callbacks.onDelete.mock.calls[0]
    const updates = groupUpdates as Array<{
      before: CanvasElement
      after: CanvasElement
    }>
    expect(updates).toHaveLength(1)
    expect(updates[0].before.id).toBe(MID_ID)
    expect(updates[0].before.group).toEqual({ childIds: [A_ID, B_ID] })
    expect(updates[0].after.group).toEqual({ childIds: [B_ID] })
  })

  it('deleting every member leaves the group intact with an empty childIds, not deleted itself', () => {
    const h = setup(makeMemberScene())
    act(() => {
      h.api.setSelectedIds(new Set([A_ID, B_ID]))
    })
    h.sync()

    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('Delete'))
    })

    const group = h.scene.byId.get(MID_ID)
    expect(group).toBeDefined()
    expect(group?.group?.childIds).toEqual([])
  })

  it('deleting the whole group (cascade) needs no cleanup update — the owner is gone too', () => {
    // The Wave-4-already-correct path: selecting the GROUP expands through
    // `withGroupMembers`, so the group itself is among the doomed ids and
    // must not also appear in the third `onDelete` argument.
    const h = setup(makeMemberScene())
    act(() => {
      h.api.setSelectedIds(new Set([MID_ID]))
    })
    h.sync()

    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('Delete'))
    })

    const [, , groupUpdates] = h.callbacks.onDelete.mock.calls[0]
    expect(groupUpdates).toEqual([])
  })
})

describe('grouping: membership drag-in/out, commit-on-drop (Wave 5)', () => {
  // `g1` is an EMPTY group frame covering (0,0)-(300,300). `a` starts as a
  // loose (non-member) shape well outside it; `b` starts as an existing
  // member, inside it.
  const G1_ID = '11111111-1111-4111-8111-111111111111'
  const A_ID = '22222222-2222-4222-8222-222222222222'
  const B_ID = '33333333-3333-4333-8333-333333333333'

  function makeFrameScene(): Array<CanvasElement> {
    const g1: CanvasElement = {
      ...makeText(),
      id: G1_ID,
      kind: 'group',
      text: null,
      x: 0,
      y: 0,
      width: 300,
      height: 300,
      group: { childIds: [B_ID] },
    }
    const a: CanvasElement = {
      ...makeText(),
      id: A_ID,
      kind: 'rectangle',
      x: 400,
      y: 400,
      width: 20,
      height: 20,
    }
    const b: CanvasElement = {
      ...makeText(),
      id: B_ID,
      kind: 'rectangle',
      x: 50,
      y: 50,
      width: 20,
      height: 20,
    }
    return [g1, a, b]
  }

  it("dropping a loose element inside a group's frame adds it to the group, in the SAME undo entry as the move", () => {
    const h = setup(makeFrameScene())

    // Drag `a` (400,400)-(420,420) to land its centre at (60,60), inside
    // g1's frame (0,0)-(300,300).
    act(() => {
      h.api.canvasHandlers.onPointerDown(
        pointerEvent({ clientX: 410, clientY: 410 }),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 60, clientY: 60 }),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerUp(
        pointerEvent({ clientX: 60, clientY: 60 }),
      )
    })

    expect(h.callbacks.onUpdate).toHaveBeenCalledTimes(1)
    const [after, before, gesture] = h.callbacks.onUpdate.mock.calls[0]
    expect(gesture).toBe('move')
    const afterElements = after as Array<CanvasElement>
    const beforeElements = before as Array<CanvasElement>

    // Position update for `a`.
    const afterA = afterElements.find((e) => e.id === A_ID)!
    expect(afterA.x).toBe(50)
    expect(afterA.y).toBe(50)

    // Membership update for `g1`, folded into the SAME call.
    const afterG1 = afterElements.find((e) => e.id === G1_ID)!
    const beforeG1 = beforeElements.find((e) => e.id === G1_ID)!
    expect(beforeG1.group).toEqual({ childIds: [B_ID] })
    expect(new Set(afterG1.group!.childIds)).toEqual(new Set([B_ID, A_ID]))

    // The board reflects it.
    expect(h.scene.byId.get(G1_ID)?.group?.childIds).toContain(A_ID)
  })

  it('dragging a member out past the frame edge removes it from the group and it becomes top-level', () => {
    const h = setup(makeFrameScene())

    // Drag `b` (50,50)-(70,70) far outside g1's frame. A PLAIN single click
    // on a member resolves to the OUTERMOST group (FR-004, Wave 2), so
    // dragging `b` INDIVIDUALLY requires the drag's own pointerdown to be a
    // REPEAT click (`lastPointerDownRef` — see `onPointerDown`'s own
    // comment for why this replaced `event.detail`) — the same
    // double-click-then-drag-without-releasing mechanism a real user would
    // use to grab an individual member. A preceding plain click at the same
    // point establishes that history; the drag's own press then lands
    // within the repeat-click window/position tolerance for free (two
    // synchronous calls at the same point).
    act(() => {
      h.api.canvasHandlers.onPointerDown(
        pointerEvent({ clientX: 60, clientY: 60 }),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerUp(
        pointerEvent({ clientX: 60, clientY: 60 }),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerDown(
        pointerEvent({ clientX: 60, clientY: 60 }),
      )
    })
    h.sync()
    expect(h.api.selectedIds).toEqual(new Set([B_ID]))
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 900, clientY: 900 }),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerUp(
        pointerEvent({ clientX: 900, clientY: 900 }),
      )
    })

    expect(h.callbacks.onUpdate).toHaveBeenCalledTimes(1)
    const [after, before] = h.callbacks.onUpdate.mock.calls[0]
    const afterElements = after as Array<CanvasElement>
    const beforeElements = before as Array<CanvasElement>

    const beforeG1 = beforeElements.find((e) => e.id === G1_ID)!
    const afterG1 = afterElements.find((e) => e.id === G1_ID)!
    expect(beforeG1.group).toEqual({ childIds: [B_ID] })
    // A13: the group persists, even now at zero members — it does not
    // auto-dissolve.
    expect(afterG1.group).toEqual({ childIds: [] })

    // `b` itself is never written to — membership lives on the group side
    // only (Wave 1) — but its position update is still present.
    const afterB = afterElements.find((e) => e.id === B_ID)!
    expect(afterB.x).toBe(890)
    expect(afterB.y).toBe(890)

    expect(h.scene.byId.get(G1_ID)?.group?.childIds).toEqual([])
  })

  it('crossing a frame mid-drag previews nothing; only the FINAL release position is evaluated', () => {
    const h = setup(makeFrameScene())

    act(() => {
      h.api.canvasHandlers.onPointerDown(
        pointerEvent({ clientX: 410, clientY: 410 }),
      )
    })
    h.sync()
    // Pass THROUGH g1's frame without releasing there.
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 60, clientY: 60 }),
      )
    })
    h.sync()
    // Mid-drag: no membership preview, no write of any kind yet.
    expect(h.scene.byId.get(G1_ID)?.group?.childIds).toEqual([B_ID])
    expect(h.callbacks.onUpdate).not.toHaveBeenCalled()

    // Keep dragging, back OUT of the frame, and release there.
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 900, clientY: 900 }),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerUp(
        pointerEvent({ clientX: 900, clientY: 900 }),
      )
    })

    // The FINAL drop point is outside every frame — no membership change
    // occurred at all, only the ordinary position update.
    expect(h.callbacks.onUpdate).toHaveBeenCalledTimes(1)
    const [after] = h.callbacks.onUpdate.mock.calls[0]
    expect((after as Array<CanvasElement>).map((e) => e.id)).toEqual([A_ID])
    expect(h.scene.byId.get(G1_ID)?.group?.childIds).toEqual([B_ID])
  })

  it('a group dragged together with its own members does not try to rejoin using a member position', () => {
    // `g1` itself is dragged (its single member `b` comes along via
    // `withGroupMembers`, Wave 3). The drop lands g1's OWN frame overlapping
    // where it started — this must not attempt to resolve `b` as a
    // candidate joining `g1` (or anything else) using `b`'s own dragged-
    // along position; `b` is not a TOP-LEVEL dragged id.
    const h = setup(makeFrameScene())
    act(() => {
      h.api.setSelectedIds(new Set([G1_ID]))
    })
    h.sync()

    // Grab g1 somewhere inside its own frame but outside `b` (e.g. (250,250)).
    act(() => {
      h.api.canvasHandlers.onPointerDown(
        pointerEvent({ clientX: 250, clientY: 250 }),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 260, clientY: 260 }),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerUp(
        pointerEvent({ clientX: 260, clientY: 260 }),
      )
    })

    expect(h.callbacks.onUpdate).toHaveBeenCalledTimes(1)
    const [after] = h.callbacks.onUpdate.mock.calls[0]
    // Only position updates for g1 and b — no membership rewrite at all.
    const afterG1 = (after as Array<CanvasElement>).find((e) => e.id === G1_ID)!
    expect(afterG1.group).toEqual({ childIds: [B_ID] })
    expect(h.scene.byId.get(G1_ID)?.group?.childIds).toEqual([B_ID])
  })
})

describe('grouping: drag-in preserves the group-below-members z-order invariant (fix round — Hermes code review, Major Issue)', () => {
  const G1_ID = '11111111-1111-4111-8111-111111111111'
  const A_ID = '22222222-2222-4222-8222-222222222222'

  function makeScene(memberZ: number): Array<CanvasElement> {
    const g1: CanvasElement = {
      ...makeText(),
      id: G1_ID,
      kind: 'group',
      text: null,
      x: 0,
      y: 0,
      width: 300,
      height: 300,
      zIndex: 9,
      group: { childIds: [] },
    }
    const a: CanvasElement = {
      ...makeText(),
      id: A_ID,
      kind: 'rectangle',
      x: 400,
      y: 400,
      width: 20,
      height: 20,
      zIndex: memberZ,
    }
    return [g1, a]
  }

  function dragAIntoG1(h: ReturnType<typeof setup>) {
    act(() => {
      h.api.canvasHandlers.onPointerDown(
        pointerEvent({ clientX: 410, clientY: 410 }),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 60, clientY: 60 }),
      )
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerUp(
        pointerEvent({ clientX: 60, clientY: 60 }),
      )
    })
  }

  it("bumps the joining element's zIndex above the group's own when it would otherwise land below the frame", () => {
    // A drops from z=3 into a group at z=9 — without the fix, the group's
    // frame (a flat rect test in hit-test's reverse-z scan) would occlude
    // `a` permanently the instant it joined.
    const h = setup(makeScene(3))
    dragAIntoG1(h)

    expect(h.callbacks.onUpdate).toHaveBeenCalledTimes(1)
    const [after] = h.callbacks.onUpdate.mock.calls[0]
    const afterA = (after as Array<CanvasElement>).find((e) => e.id === A_ID)!
    expect(afterA.zIndex).toBe(10) // one above g1's own zIndex (9)
    expect(h.scene.byId.get(A_ID)?.zIndex).toBe(10)
  })

  it('leaves zIndex untouched when the joining element is already above the group', () => {
    const h = setup(makeScene(20))
    dragAIntoG1(h)

    const [after] = h.callbacks.onUpdate.mock.calls[0]
    const afterA = (after as Array<CanvasElement>).find((e) => e.id === A_ID)!
    expect(afterA.zIndex).toBe(20)
  })

  // BLOCKER 1 (Hermes code review, round 2): the joining element is itself a
  // GROUP with its own members. The prior fix bumped only the joining
  // group's own row, never its subtree — dragging a group into another
  // group left the joining group's frame painting ABOVE its own members
  // (they never moved), breaking hitTest for every one of them. Neither
  // existing test above exercises this: both build the joining element as
  // `kind: 'rectangle'`.
  it("bumps a joining GROUP's whole subtree, not just its own row, when it joins another group", () => {
    const P_ID = '33333333-3333-4333-8333-333333333333'
    const M_ID = '44444444-4444-4444-8444-444444444444'
    const g1: CanvasElement = {
      ...makeText(),
      id: G1_ID,
      kind: 'group',
      text: null,
      x: 0,
      y: 0,
      width: 300,
      height: 300,
      zIndex: 9,
      group: { childIds: [] },
    }
    // P is the joining GROUP, dragged as a whole (a click at 410,410 lands
    // on P's own frame, outside M's rect, so P — not M — is what gets
    // selected and dragged).
    const p: CanvasElement = {
      ...makeText(),
      id: P_ID,
      kind: 'group',
      text: null,
      x: 400,
      y: 400,
      width: 100,
      height: 100,
      zIndex: 3,
      group: { childIds: [M_ID] },
    }
    const m: CanvasElement = {
      ...makeText(),
      id: M_ID,
      kind: 'rectangle',
      x: 420,
      y: 420,
      width: 20,
      height: 20,
      zIndex: 4, // above its own group P, per the group-below-members invariant
    }
    const h = setup([g1, p, m])

    // Same pointer path the two sibling tests use — the helper is
    // scene-agnostic (it takes only the harness), and (410,410) still lands
    // on P's own frame outside M's rect here.
    dragAIntoG1(h)

    expect(h.callbacks.onUpdate).toHaveBeenCalledTimes(1)
    const [after] = h.callbacks.onUpdate.mock.calls[0]
    const afterP = (after as Array<CanvasElement>).find((e) => e.id === P_ID)!
    const afterM = (after as Array<CanvasElement>).find((e) => e.id === M_ID)!
    // P bumped to one above g1's own zIndex (9) — same delta (+7) as M, so
    // M stays above P: the invariant is preserved, not just re-anchored at
    // the top.
    expect(afterP.zIndex).toBe(10)
    expect(afterM.zIndex).toBe(11)
    // Applied locally too, not just reported to the callback.
    expect(h.scene.byId.get(P_ID)?.zIndex).toBe(10)
    expect(h.scene.byId.get(M_ID)?.zIndex).toBe(11)
    expect(h.scene.byId.get(G1_ID)?.group?.childIds).toEqual([P_ID])
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

describe('grouping: groupSelection / ungroupSelection (Wave 6)', () => {
  const A_ID = '11111111-1111-4111-8111-111111111111'
  const B_ID = '22222222-2222-4222-8222-222222222222'
  const G_ID = '33333333-3333-4333-8333-333333333333'

  function twoShapes(): Array<CanvasElement> {
    return [
      makeRect(A_ID, { x: 0, y: 0, width: 100, height: 50, zIndex: 5 }),
      makeRect(B_ID, { x: 200, y: 100, width: 80, height: 40, zIndex: 10 }),
    ]
  }

  function groupOf(childIds: Array<string>): CanvasElement {
    return {
      ...makeText(),
      id: G_ID,
      kind: 'group',
      text: null,
      group: { childIds },
    }
  }

  it('groupSelection() is a no-op below 2 selected (FR-030/A1)', () => {
    const h = setup(twoShapes())
    act(() => {
      h.api.setSelectedIds(new Set([A_ID]))
    })
    h.sync()

    act(() => {
      h.api.groupSelection()
    })

    expect(h.callbacks.onGroup).not.toHaveBeenCalled()
    expect(h.scene.elements).toHaveLength(2)
  })

  it('groupSelection() binds the current selection into a new group at 2+ selected', () => {
    const h = setup(twoShapes())
    act(() => {
      h.api.setSelectedIds(new Set([A_ID, B_ID]))
    })
    h.sync()

    act(() => {
      h.api.groupSelection()
    })

    expect(h.callbacks.onGroup).toHaveBeenCalledTimes(1)
    const [group] = h.callbacks.onGroup.mock.calls[0] as [CanvasElement]
    expect(group.kind).toBe('group')
    // childIds is the selection AS GIVEN (FR-009: a selection that already
    // contains a group nests it with no extra work).
    expect(new Set(group.group!.childIds)).toEqual(new Set([A_ID, B_ID]))
    // The frame is the tight bounding box of the selection (A8).
    expect(group.x).toBe(0)
    expect(group.y).toBe(0)
    expect(group.width).toBe(280)
    expect(group.height).toBe(140)
    // Selection becomes the new group's id; whatever depth was entered resets.
    expect(h.api.selectedIds).toEqual(new Set([group.id]))
    expect(h.api.enteredPath).toEqual([])
    // On the board, not just reported to the callback.
    expect(h.scene.byId.get(group.id)).toBeDefined()
  })

  it("places the new group's zIndex one below its lowest member's", () => {
    // A group above its own members would shadow them in hit-test's reverse-z
    // scan — clicking a member would hit the group's own frame first.
    const h = setup(twoShapes()) // zIndex 5 and 10
    act(() => {
      h.api.setSelectedIds(new Set([A_ID, B_ID]))
    })
    h.sync()
    act(() => {
      h.api.groupSelection()
    })
    const [group] = h.callbacks.onGroup.mock.calls[0] as [CanvasElement]
    expect(group.zIndex).toBe(4)
  })

  it("clamps the new group's zIndex to Z_MIN rather than going below it", () => {
    const h = setup([
      makeRect(A_ID, { zIndex: Z_MIN }),
      makeRect(B_ID, { zIndex: Z_MIN + 3 }),
    ])
    act(() => {
      h.api.setSelectedIds(new Set([A_ID, B_ID]))
    })
    h.sync()
    act(() => {
      h.api.groupSelection()
    })
    const [group] = h.callbacks.onGroup.mock.calls[0] as [CanvasElement]
    expect(group.zIndex).toBe(Z_MIN)
  })

  it("renormalizes every member's zIndex upward instead of tying at Z_MIN when there's no room below the lowest member's (fix round — Hermes code review, Major Issue)", () => {
    // Without the fix, the group above would TIE with A_ID at Z_MIN, and
    // `ordered`'s id tie-break (not "the group is always below its
    // members") decides which one paints on top — breaking the invariant
    // roughly half the time.
    const h = setup([
      makeRect(A_ID, { zIndex: Z_MIN }),
      makeRect(B_ID, { zIndex: Z_MIN + 3 }),
    ])
    act(() => {
      h.api.setSelectedIds(new Set([A_ID, B_ID]))
    })
    h.sync()
    act(() => {
      h.api.groupSelection()
    })
    const [group, groupUpdates] = h.callbacks.onGroup.mock.calls[0] as [
      CanvasElement,
      Array<{ before: CanvasElement; after: CanvasElement }>,
    ]
    expect(group.zIndex).toBe(Z_MIN)
    const bumpA = groupUpdates.find((u) => u.after.id === A_ID)!
    const bumpB = groupUpdates.find((u) => u.after.id === B_ID)!
    expect(bumpA.after.zIndex).toBe(Z_MIN + 1)
    expect(bumpB.after.zIndex).toBe(Z_MIN + 4)
    // Applied locally too, not just reported.
    expect(h.scene.byId.get(A_ID)?.zIndex).toBe(Z_MIN + 1)
    expect(h.scene.byId.get(B_ID)?.zIndex).toBe(Z_MIN + 4)
  })

  it("renormalizes a member GROUP's own subtree too, not just its own row, at the Z_MIN floor (fix round — Hermes code review, Minor Issue tied to BLOCKER 1)", () => {
    // A is itself a group (containing C), selected alongside plain
    // rectangle B. Without the subtree-aware fix, C would stay at its old
    // zIndex while its own group A moved above it — the same "frame
    // paints above its members" defect BLOCKER 1 fixed for drag-in, one
    // level down inside this floor-renormalization path.
    const C_ID = '55555555-5555-4555-8555-555555555555'
    const a: CanvasElement = {
      ...makeText(),
      id: A_ID,
      kind: 'group',
      text: null,
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      zIndex: Z_MIN,
      group: { childIds: [C_ID] },
    }
    const c: CanvasElement = {
      ...makeText(),
      id: C_ID,
      kind: 'rectangle',
      x: 10,
      y: 10,
      width: 10,
      height: 10,
      zIndex: Z_MIN + 1, // above its own group A, per the invariant
    }
    const b = makeRect(B_ID, { zIndex: Z_MIN + 3 })
    const h = setup([a, c, b])
    act(() => {
      h.api.setSelectedIds(new Set([A_ID, B_ID]))
    })
    h.sync()
    act(() => {
      h.api.groupSelection()
    })
    const [group, groupUpdates] = h.callbacks.onGroup.mock.calls[0] as [
      CanvasElement,
      Array<{ before: CanvasElement; after: CanvasElement }>,
    ]
    expect(group.zIndex).toBe(Z_MIN)
    const bumpA = groupUpdates.find((u) => u.after.id === A_ID)!
    const bumpC = groupUpdates.find((u) => u.after.id === C_ID)!
    expect(bumpA.after.zIndex).toBe(Z_MIN + 1)
    expect(bumpC.after.zIndex).toBe(Z_MIN + 2)
    // Applied locally too, not just reported.
    expect(h.scene.byId.get(A_ID)?.zIndex).toBe(Z_MIN + 1)
    expect(h.scene.byId.get(C_ID)?.zIndex).toBe(Z_MIN + 2)
  })

  it('ungroupSelection() is a no-op unless the selection is exactly one group (FR-008)', () => {
    const h = setup(twoShapes())
    act(() => {
      h.api.setSelectedIds(new Set([A_ID]))
    })
    h.sync()

    act(() => {
      h.api.ungroupSelection()
    })

    expect(h.callbacks.onUngroup).not.toHaveBeenCalled()
    expect(h.scene.elements).toHaveLength(2)
  })

  it('ungroupSelection() is a no-op for a multi-selection that includes a group', () => {
    const h = setup([...twoShapes(), groupOf([A_ID, B_ID])])
    act(() => {
      h.api.setSelectedIds(new Set([A_ID, G_ID]))
    })
    h.sync()

    act(() => {
      h.api.ungroupSelection()
    })

    expect(h.callbacks.onUngroup).not.toHaveBeenCalled()
  })

  it('ungroupSelection() dissolves exactly one level, selects the direct children, writes nothing to members', () => {
    const h = setup([...twoShapes(), groupOf([A_ID, B_ID])])
    act(() => {
      h.api.setSelectedIds(new Set([G_ID]))
    })
    h.sync()

    act(() => {
      h.api.ungroupSelection()
    })

    expect(h.callbacks.onUngroup).toHaveBeenCalledTimes(1)
    const [dissolved] = h.callbacks.onUngroup.mock.calls[0] as [CanvasElement]
    expect(dissolved.id).toBe(G_ID)
    expect(dissolved.group!.childIds).toEqual([A_ID, B_ID])

    expect(h.scene.byId.get(G_ID)).toBeUndefined()
    expect(h.api.selectedIds).toEqual(new Set([A_ID, B_ID]))
    expect(h.api.enteredPath).toEqual([])
    // Membership lived only on the dissolved group's own row — members
    // themselves are never written to.
    expect(h.callbacks.onUpdate).not.toHaveBeenCalled()
    expect(h.scene.byId.get(A_ID)).toBeDefined()
    expect(h.scene.byId.get(B_ID)).toBeDefined()
  })
})

describe('grouping: referential integrity on group/ungroup writes (fix round — Hermes code review BLOCKER 1 & 2)', () => {
  const A_ID = '11111111-1111-4111-8111-111111111111'
  const B_ID = '22222222-2222-4222-8222-222222222222'
  const C_ID = '55555555-5555-4555-8555-555555555555'
  const G_ID = '33333333-3333-4333-8333-333333333333'
  const OUTER_ID = '66666666-6666-4666-8666-666666666666'

  it('groupSelection() detaches a member from its EXISTING owner before adopting it, in the SAME gesture (BLOCKER 2)', () => {
    const existingOwner: CanvasElement = {
      ...makeText(),
      id: G_ID,
      kind: 'group',
      text: null,
      group: { childIds: [A_ID] },
    }
    const h = setup([makeRect(A_ID), makeRect(B_ID), existingOwner])
    act(() => {
      h.api.setSelectedIds(new Set([A_ID, B_ID]))
    })
    h.sync()

    act(() => {
      h.api.groupSelection()
    })

    expect(h.callbacks.onGroup).toHaveBeenCalledTimes(1)
    const [newGroup, groupUpdates] = h.callbacks.onGroup.mock.calls[0] as [
      CanvasElement,
      Array<{ before: CanvasElement; after: CanvasElement }>,
    ]
    expect(new Set(newGroup.group!.childIds)).toEqual(new Set([A_ID, B_ID]))
    // The OLD owner's patch is reported to the callback...
    const detach = groupUpdates.find((u) => u.after.id === G_ID)!
    expect(detach.after.group).toEqual({ childIds: [] })
    // ...and applied locally, so A_ID never sits in two groups' `childIds`
    // at once — the corruption `repairGroupMembership` cannot heal.
    expect(h.scene.byId.get(G_ID)?.group?.childIds).toEqual([])
    expect(h.scene.byId.get(newGroup.id)?.group?.childIds).toContain(A_ID)
  })

  it('groupSelection() collapses a selection containing both a group and one of its own members to the group alone', () => {
    const inner: CanvasElement = {
      ...makeText(),
      id: G_ID,
      kind: 'group',
      text: null,
      group: { childIds: [A_ID] },
    }
    const h = setup([makeRect(A_ID), makeRect(B_ID), inner])
    act(() => {
      h.api.setSelectedIds(new Set([A_ID, G_ID, B_ID]))
    })
    h.sync()

    act(() => {
      h.api.groupSelection()
    })

    const [newGroup] = h.callbacks.onGroup.mock.calls[0] as [CanvasElement]
    // A_ID is a descendant of G_ID (also selected) — must not ALSO appear
    // directly in the new group's childIds.
    expect(new Set(newGroup.group!.childIds)).toEqual(new Set([G_ID, B_ID]))
  })

  it("ungroupSelection() patches a SURVIVING parent's childIds when the dissolved group is nested, in the SAME gesture (BLOCKER 1)", () => {
    const inner: CanvasElement = {
      ...makeText(),
      id: G_ID,
      kind: 'group',
      text: null,
      group: { childIds: [A_ID, B_ID] },
    }
    const outer: CanvasElement = {
      ...makeText(),
      id: OUTER_ID,
      kind: 'group',
      text: null,
      group: { childIds: [G_ID, C_ID] },
    }
    const h = setup([
      makeRect(A_ID),
      makeRect(B_ID),
      makeRect(C_ID),
      inner,
      outer,
    ])
    act(() => {
      h.api.setSelectedIds(new Set([G_ID]))
    })
    h.sync()

    act(() => {
      h.api.ungroupSelection()
    })

    expect(h.callbacks.onUngroup).toHaveBeenCalledTimes(1)
    const [dissolved, groupUpdates] = h.callbacks.onUngroup.mock.calls[0] as [
      CanvasElement,
      Array<{ before: CanvasElement; after: CanvasElement }>,
    ]
    expect(dissolved.id).toBe(G_ID)
    // The parent's patch is reported to the callback...
    const parentPatch = groupUpdates.find((u) => u.after.id === OUTER_ID)!
    expect(parentPatch.after.group!.childIds).toEqual([C_ID])
    // ...and applied locally, so the parent never names a deleted row —
    // the exact FR-018 defect class `cc42e31` fixed for delete but not
    // for a nested ungroup.
    expect(h.scene.byId.get(OUTER_ID)?.group?.childIds).toEqual([C_ID])
    expect(h.scene.byId.get(G_ID)).toBeUndefined()
  })

  it('ungroupSelection() filters the new selection through the current scene, dropping an id a collaborator already deleted', () => {
    const group: CanvasElement = {
      ...makeText(),
      id: G_ID,
      kind: 'group',
      text: null,
      // B_ID is named here but is NOT present on the board — the
      // collaborator-deleted-it-mid-selection case.
      group: { childIds: [A_ID, B_ID] },
    }
    const h = setup([makeRect(A_ID), group])
    act(() => {
      h.api.setSelectedIds(new Set([G_ID]))
    })
    h.sync()

    act(() => {
      h.api.ungroupSelection()
    })

    expect(h.api.selectedIds).toEqual(new Set([A_ID]))
  })
})

describe('grouping: Ctrl+G / Ctrl+Shift+G keyboard dispatch (Wave 6, FR-020)', () => {
  const A_ID = '11111111-1111-4111-8111-111111111111'
  const B_ID = '22222222-2222-4222-8222-222222222222'
  const G_ID = '33333333-3333-4333-8333-333333333333'

  it('Ctrl+G groups the current selection and suppresses the browser default', () => {
    const h = setup([makeRect(A_ID), makeRect(B_ID)])
    act(() => {
      h.api.setSelectedIds(new Set([A_ID, B_ID]))
    })
    h.sync()

    const event = keyEvent('g', { ctrlKey: true })
    act(() => {
      h.api.boardHandlers.onKeyDown(event)
    })

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(h.callbacks.onGroup).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+Shift+G ungroups the current selection and suppresses the browser default', () => {
    const group: CanvasElement = {
      ...makeText(),
      id: G_ID,
      kind: 'group',
      text: null,
      group: { childIds: [A_ID, B_ID] },
    }
    const h = setup([makeRect(A_ID), makeRect(B_ID), group])
    act(() => {
      h.api.setSelectedIds(new Set([G_ID]))
    })
    h.sync()

    const event = keyEvent('g', { ctrlKey: true, shiftKey: true })
    act(() => {
      h.api.boardHandlers.onKeyDown(event)
    })

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(h.callbacks.onUngroup).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+G still suppresses the browser default even when there is nothing to group', () => {
    // FR-020's suppression is unconditional on every Ctrl+G press, not only
    // when a group is actually created.
    const h = setup([makeRect(A_ID)])
    act(() => {
      h.api.setSelectedIds(new Set([A_ID]))
    })
    h.sync()

    const event = keyEvent('g', { ctrlKey: true })
    act(() => {
      h.api.boardHandlers.onKeyDown(event)
    })

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(h.callbacks.onGroup).not.toHaveBeenCalled()
  })

  it('a bare "g" (no modifier) still switches to the triangle tool, unaffected by Ctrl+G', () => {
    const h = setup([makeRect(A_ID)])
    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('g'))
    })
    h.sync()
    expect(h.tool).toBe('triangle')
  })

  it('Ctrl+G does not fall through to the triangle-tool shortcut', () => {
    const h = setup([makeRect(A_ID), makeRect(B_ID)])
    act(() => {
      h.api.setSelectedIds(new Set([A_ID, B_ID]))
    })
    h.sync()
    act(() => {
      h.api.boardHandlers.onKeyDown(keyEvent('g', { ctrlKey: true }))
    })
    h.sync()
    expect(h.tool).toBe('select')
  })
})

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

describe('alignment guides during a drag and a resize', () => {
  // Two rects of DIFFERENT sizes, for the same reason alignment.test.ts uses
  // different sizes: same-sized rects agree on left, centre and right at
  // once, so an assertion about any one of them would prove nothing.
  const DRAG_ID = '55555555-5555-4555-8555-555555555555'
  const NEIGHBOUR_ID = '66666666-6666-4666-8666-666666666666'

  /** Dragged rect at (100, 400) 80x40; neighbour at (200, 200) 100x60, whose
   * x lines are therefore 200 / 250 / 300. Camera is DEFAULT_CAMERA and the
   * stub canvas sits at the viewport origin, so world and client coordinates
   * are the same number throughout — every figure below is both. */
  function scene(): Array<CanvasElement> {
    return [
      makeRect(DRAG_ID, { x: 100, y: 400, width: 80, height: 40 }),
      makeRect(NEIGHBOUR_ID, { x: 200, y: 200, width: 100, height: 60 }),
    ]
  }

  /** A point inside the dragged rect, clear of its own grips. */
  const GRAB = { clientX: 140, clientY: 420 }

  function drag(h: ReturnType<typeof setup>, clientX: number, altKey = false) {
    act(() => {
      h.api.canvasHandlers.onPointerDown(pointerEvent(GRAB))
    })
    h.sync()
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX, clientY: GRAB.clientY, altKey }),
      )
    })
    h.sync()
  }

  it('pulls a dragged rect onto a neighbour’s edge and says which one', () => {
    const h = setup(scene())
    // +103 would put the left edge at 203 — three short of the neighbour's.
    drag(h, GRAB.clientX + 103)

    expect(h.scene.byId.get(DRAG_ID)!.x).toBeCloseTo(200)
    expect(h.api.alignmentGuides).toHaveLength(1)
    expect(h.api.alignmentGuides[0]).toMatchObject({
      axis: 'x',
      position: 200,
    })
  })

  it('lands the element on the aligned coordinate, not merely near it', () => {
    // The whole point of the feature: the guide is a claim about the stored
    // geometry, and a release that left 200.0001 behind would look identical
    // and be wrong.
    const h = setup(scene())
    drag(h, GRAB.clientX + 103)
    act(() => {
      h.api.canvasHandlers.onPointerUp(
        pointerEvent({ clientX: GRAB.clientX + 103, clientY: GRAB.clientY }),
      )
    })
    const [after] = h.callbacks.onUpdate.mock.calls[0]
    expect(after[0].x).toBe(200)
  })

  it('holding Alt suppresses both the snap and the guides', () => {
    const h = setup(scene())
    drag(h, GRAB.clientX + 103, true)
    expect(h.scene.byId.get(DRAG_ID)!.x).toBeCloseTo(203)
    expect(h.api.alignmentGuides).toEqual([])
  })

  it('does not accumulate the correction from frame to frame', () => {
    // The regression this pins: the drag used to shift by a delta measured
    // from the PREVIOUS frame. With snapping added, a frame that pulled the
    // element 3 units would make the next frame start from the snapped
    // position, so the correction compounded and the shape crept away from
    // the pointer. Frame 2 leaves the snap zone entirely, so its position is
    // pure pointer arithmetic: 100 + 130.
    const h = setup(scene())
    drag(h, GRAB.clientX + 103)
    expect(h.scene.byId.get(DRAG_ID)!.x).toBeCloseTo(200)

    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: GRAB.clientX + 130, clientY: GRAB.clientY }),
      )
    })
    h.sync()
    expect(h.scene.byId.get(DRAG_ID)!.x).toBe(230)
    expect(h.api.alignmentGuides).toEqual([])
  })

  it('never aligns an element to itself', () => {
    // With no neighbour there is nothing to align to, so the element must
    // follow the pointer exactly. An implementation that forgot to exclude
    // the dragged ids would find its own edges 0 away and never move at all.
    const h = setup([
      makeRect(DRAG_ID, { x: 100, y: 400, width: 80, height: 40 }),
    ])
    drag(h, GRAB.clientX + 103)
    expect(h.scene.byId.get(DRAG_ID)!.x).toBe(203)
    expect(h.api.alignmentGuides).toEqual([])
  })

  it('snaps the resized edge the grip is holding, and only that one', () => {
    const h = setup(scene())
    act(() => {
      h.api.setSelectedIds(new Set([DRAG_ID]))
    })
    h.sync()

    // The SE grip, at the dragged rect's own bottom-right corner.
    act(() => {
      h.api.canvasHandlers.onPointerDown(
        pointerEvent({ clientX: 180, clientY: 440 }),
      )
    })
    h.sync()
    // A right edge at 297 — three short of the neighbour's right edge.
    act(() => {
      h.api.canvasHandlers.onPointerMove(
        pointerEvent({ clientX: 297, clientY: 440 }),
      )
    })
    h.sync()

    const resized = h.scene.byId.get(DRAG_ID)!
    expect(resized.x + resized.width).toBeCloseTo(300)
    // The edge the grip is NOT holding stays exactly where it was.
    expect(resized.x).toBe(100)
    expect(h.api.alignmentGuides).toHaveLength(1)
    expect(h.api.alignmentGuides[0]).toMatchObject({ axis: 'x', position: 300 })
  })

  it('clears the guides when the gesture ends', () => {
    const h = setup(scene())
    drag(h, GRAB.clientX + 103)
    expect(h.api.alignmentGuides).toHaveLength(1)
    act(() => {
      h.api.canvasHandlers.onPointerUp(
        pointerEvent({ clientX: GRAB.clientX + 103, clientY: GRAB.clientY }),
      )
    })
    h.sync()
    expect(h.api.alignmentGuides).toEqual([])
  })
})
