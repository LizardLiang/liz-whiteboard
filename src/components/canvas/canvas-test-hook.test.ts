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
import { DEFAULT_ELEMENT_STYLE, sceneFrom } from '@/lib/canvas-engine/scene'

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

function render(overrides: Partial<Parameters<typeof useCanvasTestHook>[0]> = {}) {
  return renderHook(() =>
    useCanvasTestHook({
      boardId: 'board-1',
      scene: sceneFrom([makeElement()]),
      camera: { x: 1, y: 2, zoom: 3 },
      selectedIds: new Set([ELEMENT_ID]),
      editingElementId: null,
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
        selectedIds: new Set<string>(),
        editingElementId: null,
        tool: 'select',
        readOnly: false,
      }),
    )

    window.__canvasEngine!.elements[0].x = 9999
    window.__canvasEngine!.camera.zoom = 99

    expect(scene.elements[0].x).toBe(10)
  })

  it('reports the element being edited and the read-only flag', () => {
    render({ editingElementId: ELEMENT_ID, readOnly: true, tool: 'text' })
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
