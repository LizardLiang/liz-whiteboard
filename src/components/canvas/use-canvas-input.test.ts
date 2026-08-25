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

    act(() => {
      h.api.textInput.onEditingKeyDown(keyEvent('Escape'))
      h.api.textInput.commitEditing()
    })

    expect(h.callbacks.onUpdate).toHaveBeenCalledTimes(1)
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
    expect(h.callbacks.onDelete).toHaveBeenCalledWith([TEXT_ID])
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
      h.api.canvasHandlers.onPointerDown(pointerEvent({ clientX: 10, clientY: 10 }))
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
    get api() {
      return view.result.current
    },
    sync: () => view.rerender(),
  }
}
