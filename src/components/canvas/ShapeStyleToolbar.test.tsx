// src/components/canvas/ShapeStyleToolbar.test.tsx
// The fill/stroke picker: which selections it appears for, what it shows for
// a mixed one, and what it emits.
//
// The anchor assertion computes its expected point with the SAME
// `boundsOfMany`/`worldToScreen` the component uses rather than pinning a
// literal. A literal would be a second, independent derivation of the
// transform — the W1/W3 shape this feature avoids everywhere else — and it
// would keep passing after the geometry changed and the bar drifted off the
// selection.

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  STYLE_TOOLBAR_OFFSET,
  ShapeStyleToolbar,
  applyStyleChange,
  shapeStyleTargets,
} from './ShapeStyleToolbar'
import type { CanvasElement, CanvasElementStyle } from '@/lib/canvas-engine/scene'
import { DEFAULT_CAMERA, worldToScreen } from '@/lib/canvas-engine/camera'
import {
  DEFAULT_ELEMENT_STYLE,
  boundsOfMany,
  sceneFrom,
} from '@/lib/canvas-engine/scene'
import {
  CANVAS_SWATCHES,
  DEFAULT_STROKE_WIDTH,
  FILL_NONE,
} from '@/lib/canvas-style-palette'

const RED = CANVAS_SWATCHES.find((s) => s.id === 'red')!
const TEAL = CANVAS_SWATCHES.find((s) => s.id === 'teal')!

function shape(
  id: string,
  overrides: Partial<CanvasElement> = {},
): CanvasElement {
  return {
    id,
    kind: 'rectangle',
    x: 100,
    y: 200,
    width: 120,
    height: 80,
    rotation: 0,
    zIndex: 0,
    text: null,
    style: { ...DEFAULT_ELEMENT_STYLE },
    ...overrides,
  }
}

function connectorElement(id: string): CanvasElement {
  return shape(id, {
    kind: 'connector',
    width: 1,
    height: 1,
    connector: {
      source: { kind: 'point', point: { x: 0, y: 0 } },
      target: { kind: 'point', point: { x: 50, y: 50 } },
      routing: 'straight',
    },
  })
}

function setup(
  elements: Array<CanvasElement>,
  selected: Array<string>,
  readOnly = false,
  editingElementId: string | null = null,
) {
  const onStyleChange = vi.fn()
  const scene = sceneFrom(elements)
  render(
    <ShapeStyleToolbar
      scene={scene}
      selectedIds={new Set(selected)}
      camera={DEFAULT_CAMERA}
      readOnly={readOnly}
      editingElementId={editingElementId}
      onStyleChange={onStyleChange}
    />,
  )
  return { onStyleChange, scene }
}

// ───────────────────────────────────────────────────────────────────────────

describe('shapeStyleTargets', () => {
  it('returns the selected shapes', () => {
    const scene = sceneFrom([shape('a'), shape('b'), shape('c')])
    const targets = shapeStyleTargets(scene, new Set(['a', 'c']), false)
    expect(targets.map((e) => e.id)).toEqual(['a', 'c'])
  })

  it('covers every shape kind, not just rectangles', () => {
    const scene = sceneFrom([
      shape('r', { kind: 'rectangle' }),
      shape('e', { kind: 'ellipse' }),
      shape('d', { kind: 'diamond' }),
      shape('t', { kind: 'triangle' }),
    ])
    const targets = shapeStyleTargets(scene, new Set(['r', 'e', 'd', 't']), false)
    expect(targets).toHaveLength(4)
  })

  it('excludes text and connectors, which paint no fill or outline', () => {
    const scene = sceneFrom([
      shape('s'),
      shape('txt', { kind: 'text' }),
      connectorElement('con'),
    ])
    const targets = shapeStyleTargets(scene, new Set(['s', 'txt', 'con']), false)
    expect(targets.map((e) => e.id)).toEqual(['s'])
  })

  it('keeps working on a MIXED selection rather than disabling itself', () => {
    // A marquee that happens to catch one connector must not silently switch
    // the whole toolbar off with no visible reason.
    const scene = sceneFrom([shape('s'), connectorElement('con')])
    expect(
      shapeStyleTargets(scene, new Set(['s', 'con']), false).map((e) => e.id),
    ).toEqual(['s'])
  })

  it('returns nothing when read-only or when nothing is selected', () => {
    const scene = sceneFrom([shape('a')])
    expect(shapeStyleTargets(scene, new Set(['a']), true)).toEqual([])
    expect(shapeStyleTargets(scene, new Set<string>(), false)).toEqual([])
  })

  it('returns nothing while ANY element is open for typing', () => {
    // Matches `drawSelectionOverlay`, which withholds the resize grips for
    // the duration of an edit — every piece of selection chrome appears and
    // disappears together. It also keeps this bar out of the id
    // reconciliation a quick-created element goes through while its editor is
    // already open, which cost that edit its text.
    const scene = sceneFrom([shape('a'), shape('b')])
    expect(shapeStyleTargets(scene, new Set(['a']), false, 'a')).toEqual([])
    // Even when the element being typed into is NOT the selected shape.
    expect(shapeStyleTargets(scene, new Set(['a']), false, 'b')).toEqual([])
    expect(shapeStyleTargets(scene, new Set(['a']), false, null)).toHaveLength(1)
  })
})

describe('applyStyleChange', () => {
  const style: CanvasElementStyle = { ...DEFAULT_ELEMENT_STYLE }

  it('sets a fill colour and touches nothing else', () => {
    const next = applyStyleChange(style, { target: 'fill', value: RED.fill })
    expect(next).toEqual({ ...style, fill: RED.fill })
  })

  it('clears a fill with the sentinel the renderer tests for', () => {
    expect(
      applyStyleChange(style, { target: 'fill', value: null }).fill,
    ).toBe(FILL_NONE)
  })

  it('clears a stroke by width, KEEPING its colour for when it comes back', () => {
    const next = applyStyleChange(style, { target: 'stroke', value: null })
    expect(next.strokeWidth).toBe(0)
    expect(next.stroke).toBe(style.stroke)
  })

  it('restores a width when colouring a stroke that was cleared', () => {
    // Without this the click would appear to do nothing at all: the colour
    // would change on a line that is still zero pixels wide.
    const cleared: CanvasElementStyle = { ...style, strokeWidth: 0 }
    const next = applyStyleChange(cleared, { target: 'stroke', value: TEAL.stroke })
    expect(next.stroke).toBe(TEAL.stroke)
    expect(next.strokeWidth).toBe(DEFAULT_STROKE_WIDTH)
  })

  it('preserves an existing non-default width when re-colouring', () => {
    // Re-colouring a 4px outline must not silently thin it to 2px.
    const bold: CanvasElementStyle = { ...style, strokeWidth: 4 }
    expect(
      applyStyleChange(bold, { target: 'stroke', value: RED.stroke }).strokeWidth,
    ).toBe(4)
  })
})

describe('rendering', () => {
  it('does not render for a selection with no shapes in it', () => {
    setup([connectorElement('con')], ['con'])
    expect(screen.queryByRole('toolbar', { name: 'Shape style' })).toBeNull()
  })

  it('does not render for a read-only board', () => {
    setup([shape('a')], ['a'], true)
    expect(screen.queryByRole('toolbar', { name: 'Shape style' })).toBeNull()
  })

  it('does not render while an element is open for typing', () => {
    setup([shape('a')], ['a'], false, 'a')
    expect(screen.queryByRole('toolbar', { name: 'Shape style' })).toBeNull()
  })

  it('anchors above the selection bounding box, centred', () => {
    const elements = [
      shape('a', { x: 100, y: 200 }),
      shape('b', { x: 400, y: 500 }),
    ]
    setup(elements, ['a', 'b'])
    const box = boundsOfMany(elements)!
    const expected = worldToScreen(DEFAULT_CAMERA, {
      x: box.x + box.width / 2,
      y: box.y,
    })

    const bar = screen.getByRole('toolbar', { name: 'Shape style' })
    expect(bar.style.left).toBe(`${expected.x}px`)
    expect(bar.style.top).toBe(`${expected.y - STYLE_TOOLBAR_OFFSET}px`)
  })

  it('marks the default shape as blue in both rows', () => {
    // The palette/engine-default agreement, seen from the UI: a shape nobody
    // has styled must not render with every swatch inactive.
    setup([shape('a')], ['a'])
    expect(
      screen.getByRole('button', { name: 'Fill Blue' }).getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      screen.getByRole('button', { name: 'Stroke Blue' }).getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('shows NO active swatch when the selected shapes disagree', () => {
    setup(
      [
        shape('a', { style: { ...DEFAULT_ELEMENT_STYLE, fill: RED.fill } }),
        shape('b', { style: { ...DEFAULT_ELEMENT_STYLE, fill: TEAL.fill } }),
      ],
      ['a', 'b'],
    )
    for (const swatch of CANVAS_SWATCHES) {
      expect(
        screen
          .getByRole('button', { name: `Fill ${swatch.label}` })
          .getAttribute('aria-pressed'),
      ).toBe('false')
    }
  })

  it('marks the none button active only when every target is cleared', () => {
    const unfilled = { ...DEFAULT_ELEMENT_STYLE, fill: FILL_NONE }
    setup([shape('a', { style: unfilled }), shape('b', { style: unfilled })], [
      'a',
      'b',
    ])
    expect(
      screen.getByRole('button', { name: 'Fill none' }).getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      screen.getByRole('button', { name: 'Stroke none' }).getAttribute('aria-pressed'),
    ).toBe('false')
  })
})

describe('emitting', () => {
  it('reports the chosen fill and the shapes it applies to', () => {
    const { onStyleChange } = setup([shape('a'), shape('b')], ['a', 'b'])
    fireEvent.click(screen.getByRole('button', { name: 'Fill Red' }))

    expect(onStyleChange).toHaveBeenCalledTimes(1)
    const [targets, change] = onStyleChange.mock.calls[0]
    expect(targets.map((e: CanvasElement) => e.id)).toEqual(['a', 'b'])
    expect(change).toEqual({ target: 'fill', value: RED.fill })
  })

  it('writes nothing when every target is already in that state', () => {
    // Otherwise a stray click pushes an undo entry that reverses to itself,
    // and Ctrl+Z appears to do nothing several times in a row.
    const { onStyleChange } = setup([shape('a')], ['a'])
    fireEvent.click(screen.getByRole('button', { name: 'Fill Blue' }))
    expect(onStyleChange).not.toHaveBeenCalled()
  })

  it('emits only the shapes the click would actually change', () => {
    // One already red, one not. The undo entry must cover the second alone,
    // or undoing would "restore" a colour the first shape never left.
    const { onStyleChange } = setup(
      [
        shape('already', { style: { ...DEFAULT_ELEMENT_STYLE, fill: RED.fill } }),
        shape('changing'),
      ],
      ['already', 'changing'],
    )
    fireEvent.click(screen.getByRole('button', { name: 'Fill Red' }))

    const [targets] = onStyleChange.mock.calls[0]
    expect(targets.map((e: CanvasElement) => e.id)).toEqual(['changing'])
  })

  it('emits a null value for the none buttons', () => {
    const { onStyleChange } = setup([shape('a')], ['a'])
    fireEvent.click(screen.getByRole('button', { name: 'Stroke none' }))
    expect(onStyleChange.mock.calls[0][1]).toEqual({
      target: 'stroke',
      value: null,
    })
  })

  it('offers every palette swatch in both rows', () => {
    // The palette is the source of truth; a ninth colour added to it should
    // appear here without anyone editing this component.
    setup([shape('a')], ['a'])
    for (const swatch of CANVAS_SWATCHES) {
      expect(screen.getByRole('button', { name: `Fill ${swatch.label}` })).toBeTruthy()
      expect(
        screen.getByRole('button', { name: `Stroke ${swatch.label}` }),
      ).toBeTruthy()
    }
  })
})
