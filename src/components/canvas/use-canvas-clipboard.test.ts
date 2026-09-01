// src/components/canvas/use-canvas-clipboard.test.ts
// Copy, cut, paste and duplicate as the input hook performs them (canvas
// copy-paste-duplicate tactical plan, step 2).
//
// Drives the real hook. `planClone` is tested on its own in
// canvas-engine/clone.test.ts — what is asserted HERE is the wiring the
// planner cannot see: which gesture reads the buffer and which does not,
// what lands in the local scene, what the selection becomes afterwards, and
// which callback fires with which name.
//
// jsdom has no 2D context, so `getMeasurer` returns null throughout. No path
// here needs text metrics.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useCanvasInput } from './use-canvas-input'
import type { CanvasTool } from './use-canvas-input'
import type { CanvasElement, Scene } from '@/lib/canvas-engine/scene'
import type { Camera } from '@/lib/canvas-engine/camera'
import { DEFAULT_CAMERA } from '@/lib/canvas-engine/camera'
import { DEFAULT_ELEMENT_STYLE, sceneFrom } from '@/lib/canvas-engine/scene'
import { CLONE_OFFSET } from '@/lib/canvas-engine/clone'

function shape(id: string, patch: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id,
    kind: 'rectangle',
    x: 100,
    y: 200,
    width: 160,
    height: 100,
    rotation: 0,
    zIndex: 0,
    text: null,
    style: { ...DEFAULT_ELEMENT_STYLE },
    ...patch,
  }
}

function connectorBetween(id: string, from: string, to: string): CanvasElement {
  return shape(id, {
    kind: 'connector',
    width: 1,
    height: 1,
    connector: {
      source: { kind: 'element', elementId: from },
      target: { kind: 'element', elementId: to },
      routing: 'straight',
    },
  })
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

/** A keydown carrying the platform's clipboard modifier. */
function chord(key: string, patch: Record<string, unknown> = {}) {
  return {
    key,
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    preventDefault: vi.fn(),
    nativeEvent: { isComposing: false },
    ...patch,
  } as any
}

function setup(
  initial: Array<CanvasElement>,
  { readOnly = false }: { readOnly?: boolean } = {},
) {
  let scene: Scene = sceneFrom(initial)
  let camera: Camera = DEFAULT_CAMERA
  let tool: CanvasTool = 'select'
  let locked = readOnly

  const callbacks = {
    onCreate: vi.fn(),
    onClone: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
  }

  const view = renderHook(() =>
    useCanvasInput({
      canvasRef: { current: makeCanvas() } as any,
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
      readOnly: locked,
      getMeasurer: () => null,
      callbacks,
    }),
  )

  const api = () => view.result.current

  return {
    callbacks,
    api,
    get scene() {
      return scene
    },
    select(...ids: Array<string>) {
      act(() => {
        api().setSelectedIds(new Set(ids))
      })
      view.rerender()
    },
    press(key: string, patch: Record<string, unknown> = {}) {
      act(() => {
        api().boardHandlers.onKeyDown(chord(key, patch))
      })
      view.rerender()
    },
    /** Flip the board editable, as granting permission mid-session would. */
    unlock() {
      locked = false
      view.rerender()
    },
    sync: () => view.rerender(),
  }
}

/** Everything that was NOT in the starting scene. */
function added(scene: Scene, originals: Array<string>): Array<CanvasElement> {
  return scene.elements.filter((element) => !originals.includes(element.id))
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ───────────────────────────────────────────────────────────────────────────

describe('copy', () => {
  it('changes nothing on the board', () => {
    const board = setup([shape('a')])
    board.select('a')
    board.press('c')
    expect(board.scene.elements).toHaveLength(1)
    expect(board.callbacks.onClone).not.toHaveBeenCalled()
    expect(board.callbacks.onDelete).not.toHaveBeenCalled()
  })

  it('copying nothing leaves the previous buffer intact', () => {
    const board = setup([shape('a')])
    board.select('a')
    board.press('c')
    board.select()
    board.press('c')
    board.press('v')
    // The empty copy did not clear what was already held.
    expect(board.callbacks.onClone).toHaveBeenCalledTimes(1)
  })
})

describe('paste', () => {
  it('creates a copy offset from the original and leaves the original alone', () => {
    const board = setup([shape('a', { x: 100, y: 200 })])
    board.select('a')
    board.press('c')
    board.press('v')

    const copies = added(board.scene, ['a'])
    expect(copies).toHaveLength(1)
    expect(copies[0].x).toBe(100 + CLONE_OFFSET)
    expect(copies[0].y).toBe(200 + CLONE_OFFSET)
    expect(board.scene.byId.get('a')).toMatchObject({ x: 100, y: 200 })
  })

  it('names the gesture when it reports the creation', () => {
    const board = setup([shape('a')])
    board.select('a')
    board.press('c')
    board.press('v')
    expect(board.callbacks.onClone).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ kind: 'rectangle' })]),
      'paste',
    )
  })

  it('selects what it created, not what was copied', () => {
    const board = setup([shape('a')])
    board.select('a')
    board.press('c')
    board.press('v')
    const copy = added(board.scene, ['a'])[0]
    expect([...board.api().selectedIds]).toEqual([copy.id])
  })

  it('fans out on repeated pastes instead of stacking on one spot', () => {
    const board = setup([shape('a', { x: 0, y: 0 })])
    board.select('a')
    board.press('c')
    board.press('v')
    board.press('v')
    board.press('v')

    const xs = added(board.scene, ['a'])
      .map((element) => element.x)
      .sort((l, r) => l - r)
    expect(xs).toEqual([CLONE_OFFSET, CLONE_OFFSET * 2, CLONE_OFFSET * 3])
  })

  it('restarts the cascade when a fresh copy is taken', () => {
    const board = setup([shape('a', { x: 0, y: 0 }), shape('b', { x: 500, y: 0 })])
    board.select('a')
    board.press('c')
    board.press('v')
    board.press('v')

    board.select('b')
    board.press('c')
    board.press('v')
    const fromB = board.scene.elements.filter(
      (element) => element.x === 500 + CLONE_OFFSET,
    )
    expect(fromB).toHaveLength(1)
  })

  it('does nothing at all when nothing was ever copied', () => {
    const board = setup([shape('a')])
    board.select('a')
    board.press('v')
    expect(board.scene.elements).toHaveLength(1)
    expect(board.callbacks.onClone).not.toHaveBeenCalled()
  })

  it('ignores a key REPEAT, so a held chord cannot storm the board', () => {
    const board = setup([shape('a')])
    board.select('a')
    board.press('c')
    board.press('v')
    board.press('v', { repeat: true })
    board.press('v', { repeat: true })
    expect(added(board.scene, ['a'])).toHaveLength(1)
  })
})

describe('duplicate', () => {
  it('copies the live selection without anything having been copied first', () => {
    const board = setup([shape('a')])
    board.select('a')
    board.press('d')
    expect(added(board.scene, ['a'])).toHaveLength(1)
    expect(board.callbacks.onClone).toHaveBeenCalledWith(expect.anything(), 'duplicate')
  })

  it('cascades, because each duplicate copies the PREVIOUS one', () => {
    // The selection hand-off is what makes this work: without it the second
    // press would copy the original again and land on top of the first copy.
    const board = setup([shape('a', { x: 0, y: 0 })])
    board.select('a')
    board.press('d')
    board.press('d')
    const xs = added(board.scene, ['a'])
      .map((element) => element.x)
      .sort((l, r) => l - r)
    expect(xs).toEqual([CLONE_OFFSET, CLONE_OFFSET * 2])
  })

  it('does NOT clobber the copy buffer', () => {
    const board = setup([shape('a', { x: 0, y: 0 }), shape('b', { x: 500, y: 0 })])
    board.select('a')
    board.press('c')

    board.select('b')
    board.press('d')

    board.press('v')
    // The paste must produce a copy of `a` — what was copied — not of `b`.
    const pasted = board.scene.elements.filter(
      (element) => element.x === CLONE_OFFSET,
    )
    expect(pasted).toHaveLength(1)
  })

  it('is reachable without the keyboard', () => {
    const board = setup([shape('a')])
    board.select('a')
    act(() => {
      board.api().duplicateSelection()
    })
    board.sync()
    expect(added(board.scene, ['a'])).toHaveLength(1)
  })

  it('does nothing with an empty selection', () => {
    const board = setup([shape('a')])
    board.press('d')
    expect(board.scene.elements).toHaveLength(1)
  })
})

describe('cut', () => {
  it('removes the selection and reports the gesture by name', () => {
    const board = setup([shape('a')])
    board.select('a')
    board.press('x')
    expect(board.scene.elements).toHaveLength(0)
    expect(board.callbacks.onDelete).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'a' })]),
      'cut',
    )
  })

  it('cascades to attached connectors, exactly as Delete does', () => {
    const board = setup([
      shape('a'),
      shape('b'),
      connectorBetween('con', 'a', 'b'),
    ])
    board.select('a')
    board.press('x')
    expect(board.scene.byId.has('con')).toBe(false)
  })

  it('fills the buffer, so what was cut can be pasted back', () => {
    const board = setup([shape('a', { x: 0, y: 0 })])
    board.select('a')
    board.press('x')
    board.press('v')
    expect(board.scene.elements).toHaveLength(1)
    expect(board.scene.elements[0].x).toBe(CLONE_OFFSET)
  })

  it('does nothing with an empty selection', () => {
    const board = setup([shape('a')])
    board.press('x')
    expect(board.scene.elements).toHaveLength(1)
    expect(board.callbacks.onDelete).not.toHaveBeenCalled()
  })
})

describe('connectors travel with what they join', () => {
  it('copies a connector whose BOTH ends were selected, rewired to the copies', () => {
    const board = setup([
      shape('a'),
      shape('b', { x: 400 }),
      connectorBetween('con', 'a', 'b'),
    ])
    board.select('a', 'b', 'con')
    board.press('c')
    board.press('v')

    const copies = added(board.scene, ['a', 'b', 'con'])
    const copiedConnector = copies.find((element) => element.kind === 'connector')
    const copiedIds = copies.map((element) => element.id)
    expect(copiedConnector).toBeDefined()
    const ends = copiedConnector?.connector
    expect(ends?.source.kind === 'element' && copiedIds.includes(ends.source.elementId)).toBe(
      true,
    )
    expect(ends?.target.kind === 'element' && copiedIds.includes(ends.target.elementId)).toBe(
      true,
    )
  })

  it('drops a connector with one end left behind', () => {
    const board = setup([
      shape('a'),
      shape('b', { x: 400 }),
      connectorBetween('con', 'a', 'b'),
    ])
    board.select('a', 'con')
    board.press('c')
    board.press('v')
    const copies = added(board.scene, ['a', 'b', 'con'])
    expect(copies.map((element) => element.kind)).toEqual(['rectangle'])
  })

  it('hands the recorder non-connectors first, connectors last', () => {
    // The persistence contract: a connector cannot be written until the
    // elements it joins have server ids.
    const board = setup([
      shape('a'),
      shape('b', { x: 400 }),
      connectorBetween('con', 'a', 'b'),
    ])
    board.select('a', 'b', 'con')
    board.press('c')
    board.press('v')

    const handed = board.callbacks.onClone.mock.calls[0][0] as Array<CanvasElement>
    expect(handed.map((element) => element.kind)).toEqual([
      'rectangle',
      'rectangle',
      'connector',
    ])
  })
})

describe('read-only boards', () => {
  it('refuses all four gestures', () => {
    const board = setup([shape('a')], { readOnly: true })
    board.select('a')
    board.press('c')
    board.press('v')
    board.press('d')
    board.press('x')
    expect(board.scene.elements).toHaveLength(1)
    expect(board.callbacks.onClone).not.toHaveBeenCalled()
    expect(board.callbacks.onDelete).not.toHaveBeenCalled()
  })

  it('refuses copy too, not only the three that write', () => {
    // The buffer cannot outlive the board component, so a viewer's copy could
    // only ever be pasted somewhere the same guard already blocks. A control
    // that reports success and provably does nothing is worse than absent.
    //
    // Observable only by unlocking the board afterwards: if the copy HAD been
    // taken, the buffer would still hold it and the paste below would land.
    const board = setup([shape('a')], { readOnly: true })
    board.select('a')
    board.press('c')

    board.unlock()
    board.press('v')
    expect(board.scene.elements).toHaveLength(1)
    expect(board.callbacks.onClone).not.toHaveBeenCalled()
  })

  it('the unlock harness itself works, so the test above is not vacuous', () => {
    // Guards the negative test: an unlock that did nothing would make every
    // "refused" assertion pass for the wrong reason.
    const board = setup([shape('a')], { readOnly: true })
    board.unlock()
    board.select('a')
    board.press('c')
    board.press('v')
    expect(added(board.scene, ['a'])).toHaveLength(1)
  })
})

describe('the chord does not collide with the board shortcuts', () => {
  it('leaves an unmodified key to the tool shortcuts', () => {
    const board = setup([shape('a')])
    board.select('a')
    act(() => {
      board.api().boardHandlers.onKeyDown(chord('v', { ctrlKey: false }))
    })
    board.sync()
    // Plain "v" is the select tool, not a paste.
    expect(board.callbacks.onClone).not.toHaveBeenCalled()
  })

  it('accepts the Meta chord as well as Control, for macOS', () => {
    const board = setup([shape('a')])
    board.select('a')
    board.press('c', { ctrlKey: false, metaKey: true })
    board.press('v', { ctrlKey: false, metaKey: true })
    expect(added(board.scene, ['a'])).toHaveLength(1)
  })

  it('ignores the chord while text is being edited', () => {
    // Every key belongs to the text proxy then — Ctrl+D inside a label must
    // not duplicate the element being typed into.
    const board = setup([shape('a', { kind: 'text', text: 'hi' })])
    board.select('a')
    // Enter is the keyboard path into editing.
    board.press('Enter', { ctrlKey: false })
    expect(board.api().editing).not.toBeNull()

    board.press('d')
    board.press('v')
    expect(board.callbacks.onClone).not.toHaveBeenCalled()
  })
})
