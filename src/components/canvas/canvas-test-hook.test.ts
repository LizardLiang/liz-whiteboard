// src/components/canvas/canvas-test-hook.test.ts
// Unit coverage for the e2e test hook itself.
//
// What CANNOT be tested here is the production gate: `import.meta.env.DEV` is
// a compile-time replacement, so a unit test always runs on the DEV branch and
// asserting the disabled path would only assert the test environment. That
// half is verified by building — `bun run build` output contains the string
// `__canvasEngine` in zero files, while a control string from the same
// component chunk is present. Recorded in the Wave 5 notes.
//
// What IS worth testing is the part a spec depends on and that would fail
// silently: the published elements are a COPY, so an assertion that pokes at
// them cannot corrupt the board it is measuring.

import { afterEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCanvasTestHook } from './canvas-test-hook'
import type { CanvasElement } from '@/lib/canvas-engine/scene'
import type { RenderSelection } from '@/lib/canvas-engine/render'
import {
  DEFAULT_ELEMENT_STYLE,
  bounds,
  sceneFrom,
} from '@/lib/canvas-engine/scene'
import { creationHandleRects } from '@/lib/canvas-engine/render'

const ELEMENT_ID = '11111111-1111-4111-8111-111111111111'

function makeElement(overrides: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id: ELEMENT_ID,
    kind: 'rectangle',
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    rotation: 0,
    zIndex: 0,
    text: null,
    style: { ...DEFAULT_ELEMENT_STYLE },
    ...overrides,
  }
}

/** A `RenderSelection` with only the fields a given test cares about. */
function selectionOf(
  overrides: Partial<RenderSelection> = {},
): RenderSelection {
  return { ids: new Set([ELEMENT_ID]), ...overrides }
}

function render(overrides: Partial<Parameters<typeof useCanvasTestHook>[0]> = {}) {
  return renderHook(() =>
    useCanvasTestHook({
      boardId: 'board-1',
      scene: sceneFrom([makeElement()]),
      camera: { x: 1, y: 2, zoom: 3 },
      selection: selectionOf(),
      tool: 'select',
      readOnly: false,
      ...overrides,
    }),
  )
}

afterEach(() => {
  delete window.__canvasEngine
})

describe('useCanvasTestHook', () => {
  it('publishes the scene, camera and selection', () => {
    render()
    const published = window.__canvasEngine!
    expect(published.boardId).toBe('board-1')
    expect(published.camera).toEqual({ x: 1, y: 2, zoom: 3 })
    expect(published.selectedIds).toEqual([ELEMENT_ID])
    expect(published.elements).toHaveLength(1)
    expect(published.elements[0]).toMatchObject({
      id: ELEMENT_ID,
      kind: 'rectangle',
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    })
  })

  it('publishes copies, so a spec cannot corrupt the board it is measuring', () => {
    const scene = sceneFrom([makeElement()])
    renderHook(() =>
      useCanvasTestHook({
        boardId: 'board-1',
        scene,
        camera: { x: 0, y: 0, zoom: 1 },
        selection: { ids: new Set<string>() },
        tool: 'select',
        readOnly: false,
      }),
    )

    window.__canvasEngine!.elements[0].x = 9999
    window.__canvasEngine!.camera.zoom = 99

    expect(scene.elements[0].x).toBe(10)
  })

  it('reports the element being edited and the read-only flag', () => {
    render({
      selection: selectionOf({
        editing: { elementId: ELEMENT_ID, caret: 0, caretVisible: true },
      }),
      readOnly: true,
      tool: 'text',
    })
    expect(window.__canvasEngine!.editingElementId).toBe(ELEMENT_ID)
    expect(window.__canvasEngine!.readOnly).toBe(true)
    expect(window.__canvasEngine!.tool).toBe('text')
  })

  it('removes its publication on unmount', () => {
    // A hook outliving its board would make a spec assert against a board that
    // is no longer on screen, which reads as a data bug rather than a stale
    // global.
    const { unmount } = render()
    expect(window.__canvasEngine).toBeDefined()
    unmount()
    expect(window.__canvasEngine).toBeUndefined()
  })
})

describe('creation-handle publication (Wave 6, step 18)', () => {
  it('publishes the hovered id and the handles it produces', () => {
    // Handles on hover with NOTHING selected — the case a spec cannot infer
    // from `selectedIds`, and the one that makes the whole affordance
    // discoverable.
    render({
      selection: { ids: new Set<string>(), hoveredId: ELEMENT_ID },
    })
    const published = window.__canvasEngine!
    expect(published.hoveredId).toBe(ELEMENT_ID)
    expect(published.creationHandleTargetId).toBe(ELEMENT_ID)
    expect(Object.keys(published.creationHandles ?? {}).sort()).toEqual([
      'bottom',
      'left',
      'right',
      'top',
    ])
  })

  it('publishes the rectangles the renderer would draw, not a second derivation', () => {
    // Anchored to `creationHandleRects` itself so a spec clicks exactly what
    // was painted. Computing the expected value any other way here would be
    // the same drift this contract exists to prevent.
    const camera = { x: 1, y: 2, zoom: 3 }
    render({ camera })
    expect(window.__canvasEngine!.creationHandles).toEqual(
      creationHandleRects(camera, bounds(makeElement())),
    )
  })

  it('publishes handles for a single selection', () => {
    render()
    expect(window.__canvasEngine!.creationHandleTargetId).toBe(ELEMENT_ID)
  })

  it('publishes no handles while text is being edited', () => {
    // One of `creationHandleTarget`'s suppression rules — resolved by that
    // function, not re-derived here, which is the point of handing the hook
    // the renderer's own selection object.
    render({
      selection: selectionOf({
        editing: { elementId: ELEMENT_ID, caret: 0, caretVisible: true },
      }),
    })
    expect(window.__canvasEngine!.creationHandleTargetId).toBeNull()
    expect(window.__canvasEngine!.creationHandles).toBeNull()
  })

  it('publishes no handles mid-quick-create-drag', () => {
    render({
      selection: selectionOf({
        quickCreate: { fromId: ELEMENT_ID, toWorld: { x: 400, y: 400 } },
      }),
    })
    expect(window.__canvasEngine!.creationHandles).toBeNull()
  })

  it('publishes nulls when nothing is hovered or selected', () => {
    render({ selection: { ids: new Set<string>() } })
    const published = window.__canvasEngine!
    expect(published.hoveredId).toBeNull()
    expect(published.creationHandleTargetId).toBeNull()
    expect(published.creationHandles).toBeNull()
  })

  it('publishes a connector\'s endpoints and routing on the element itself', () => {
    // A spec reads these straight off `elements` — no second collection to
    // keep in sync.
    const connector: CanvasElement = {
      ...makeElement({ id: 'c1', kind: 'connector', width: 1, height: 1 }),
      connector: {
        source: { kind: 'element', elementId: 'a' },
        target: { kind: 'element', elementId: 'b' },
        routing: 'elbow' ,
      },
    }
    render({ scene: sceneFrom([makeElement(), connector]) })
    const published = window.__canvasEngine!
    expect(published.elements.find((e) => e.id === 'c1')?.connector).toEqual({
        source: { kind: 'element', elementId: 'a' },
        target: { kind: 'element', elementId: 'b' },
        routing: 'elbow',
      })
  })
})
