// src/components/canvas/SelectionToolbar.test.tsx
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
  SelectionToolbar,
  applyStyleChange,
  canGroupSelection,
  canUngroupSelection,
  shapeStyleTargets,
} from './SelectionToolbar'
import type {
  CanvasElement,
  CanvasElementStyle,
} from '@/lib/canvas-engine/scene'
import { DEFAULT_CAMERA, worldToScreen } from '@/lib/canvas-engine/camera'
import {
  DEFAULT_ELEMENT_STYLE,
  boundsOfMany,
  sceneFrom,
} from '@/lib/canvas-engine/scene'
import {
  CANVAS_CORNER_RADII,
  CANVAS_STROKE_WIDTHS,
  CANVAS_SWATCHES,
  DEFAULT_STROKE_WIDTH,
  FILL_NONE,
} from '@/lib/canvas-style-palette'

// Radix positions its popover with floating-ui, which observes the trigger
// through ResizeObserver — a browser API jsdom does not implement. The same
// stub the DataTypeSelector suite installs for cmdk.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- lib.dom types ResizeObserver as always-present, but jsdom does not implement it at runtime.
window.ResizeObserver = window.ResizeObserver ?? ResizeObserverStub

/**
 * Open one setting's popover.
 *
 * Every option now lives behind a trigger, so a test that asserts on a swatch
 * has to say which setting it is looking at first. The trigger's accessible
 * name is the setting's name ALONE ("Fill"), which is what keeps it distinct
 * from the options inside it ("Fill Red") under an exact-name query.
 */
function openSetting(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }))
}

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

function groupElement(
  id: string,
  childIds: Array<string>,
  overrides: Partial<CanvasElement> = {},
): CanvasElement {
  return shape(id, { kind: 'group', group: { childIds }, ...overrides })
}

function setup(
  elements: Array<CanvasElement>,
  selected: Array<string>,
  readOnly = false,
  editingElementId: string | null = null,
) {
  const onStyleChange = vi.fn()
  const onArrange = vi.fn()
  const onDuplicate = vi.fn()
  const onGroup = vi.fn()
  const onUngroup = vi.fn()
  const scene = sceneFrom(elements)
  render(
    <SelectionToolbar
      scene={scene}
      selectedIds={new Set(selected)}
      camera={DEFAULT_CAMERA}
      readOnly={readOnly}
      editingElementId={editingElementId}
      onStyleChange={onStyleChange}
      onArrange={onArrange}
      onDuplicate={onDuplicate}
      onGroup={onGroup}
      onUngroup={onUngroup}
    />,
  )
  return { onStyleChange, onArrange, onDuplicate, onGroup, onUngroup, scene }
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
    const targets = shapeStyleTargets(
      scene,
      new Set(['r', 'e', 'd', 't']),
      false,
    )
    expect(targets).toHaveLength(4)
  })

  it('excludes text and connectors, which paint no fill or outline', () => {
    const scene = sceneFrom([
      shape('s'),
      shape('txt', { kind: 'text' }),
      connectorElement('con'),
    ])
    const targets = shapeStyleTargets(
      scene,
      new Set(['s', 'txt', 'con']),
      false,
    )
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
    expect(shapeStyleTargets(scene, new Set(['a']), false, null)).toHaveLength(
      1,
    )
  })
})

describe('applyStyleChange', () => {
  const style: CanvasElementStyle = { ...DEFAULT_ELEMENT_STYLE }

  it('sets a fill colour and touches nothing else', () => {
    const next = applyStyleChange(style, { target: 'fill', value: RED.fill })
    expect(next).toEqual({ ...style, fill: RED.fill })
  })

  it('clears a fill with the sentinel the renderer tests for', () => {
    expect(applyStyleChange(style, { target: 'fill', value: null }).fill).toBe(
      FILL_NONE,
    )
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
    const next = applyStyleChange(cleared, {
      target: 'stroke',
      value: TEAL.stroke,
    })
    expect(next.stroke).toBe(TEAL.stroke)
    expect(next.strokeWidth).toBe(DEFAULT_STROKE_WIDTH)
  })

  it('sets a stroke weight and touches nothing else', () => {
    const next = applyStyleChange(style, { target: 'strokeWidth', value: 4 })
    expect(next).toEqual({ ...style, strokeWidth: 4 })
  })

  it('turns a cleared stroke back ON when a weight is chosen', () => {
    // The second natural way back from "no stroke", the first being to pick a
    // colour. The preserved colour is what comes back with it.
    const cleared: CanvasElementStyle = {
      ...style,
      strokeWidth: 0,
      stroke: TEAL.stroke,
    }
    const next = applyStyleChange(cleared, { target: 'strokeWidth', value: 1 })
    expect(next.strokeWidth).toBe(1)
    expect(next.stroke).toBe(TEAL.stroke)
  })

  it('preserves an existing non-default width when re-colouring', () => {
    // Re-colouring a 4px outline must not silently thin it to 2px.
    const bold: CanvasElementStyle = { ...style, strokeWidth: 4 }
    expect(
      applyStyleChange(bold, { target: 'stroke', value: RED.stroke })
        .strokeWidth,
    ).toBe(4)
  })
})

describe('rendering', () => {
  it('does not render for a connector-only selection', () => {
    setup([connectorElement('con')], ['con'])
    expect(screen.queryByRole('toolbar', { name: 'Selection' })).toBeNull()
  })

  it('renders for a TEXT-only selection, with order but no paint rows', () => {
    // Text is painted in z-order and must be able to come forward, but it has
    // no fill or outline to change — showing colour rows that visibly do
    // nothing would be worse than showing none.
    setup([shape('t', { kind: 'text' })], ['t'])
    expect(screen.getByRole('toolbar', { name: 'Selection' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Bring to front' })).toBeTruthy()
    // The TRIGGERS are absent, not merely their popovers left unopened.
    expect(screen.queryByRole('button', { name: 'Fill' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stroke' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Width' })).toBeNull()
  })

  it('shows the paint settings when a shape is in the selection', () => {
    setup([shape('s'), shape('t', { kind: 'text' })], ['s', 't'])
    expect(screen.getByRole('button', { name: 'Fill' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Arrange' })).toBeTruthy()
  })

  it('renders for a GROUP selection, with order but no paint rows (FR-031)', () => {
    // A group has no fill/stroke of its own — bulk-restyling its members from
    // here is explicitly out of scope (SelectionToolbar.tsx's own header
    // comment on `paint` vs `arrange`).
    const g = groupElement('g', ['a', 'b'])
    setup([shape('a'), shape('b'), g], ['g'])
    expect(screen.getByRole('toolbar', { name: 'Selection' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Bring to front' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Fill' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stroke' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Width' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Corner' })).toBeNull()
  })

  it('does not render for a read-only board', () => {
    setup([shape('a')], ['a'], true)
    expect(screen.queryByRole('toolbar', { name: 'Selection' })).toBeNull()
  })

  it('does not render while an element is open for typing', () => {
    setup([shape('a')], ['a'], false, 'a')
    expect(screen.queryByRole('toolbar', { name: 'Selection' })).toBeNull()
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

    const bar = screen.getByRole('toolbar', { name: 'Selection' })
    expect(bar.style.left).toBe(`${expected.x}px`)
    expect(bar.style.top).toBe(`${expected.y - STYLE_TOOLBAR_OFFSET}px`)
  })

  it('marks the default shape as blue in both rows', () => {
    // The palette/engine-default agreement, seen from the UI: a shape nobody
    // has styled must not render with every swatch inactive.
    setup([shape('a')], ['a'])
    openSetting('Fill')
    expect(
      screen
        .getByRole('button', { name: 'Fill Blue' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    openSetting('Stroke')
    expect(
      screen
        .getByRole('button', { name: 'Stroke Blue' })
        .getAttribute('aria-pressed'),
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
    openSetting('Fill')
    for (const swatch of CANVAS_SWATCHES) {
      expect(
        screen
          .getByRole('button', { name: `Fill ${swatch.label}` })
          .getAttribute('aria-pressed'),
      ).toBe('false')
    }
  })

  it('marks the current weight active', () => {
    setup(
      [shape('a', { style: { ...DEFAULT_ELEMENT_STYLE, strokeWidth: 4 } })],
      ['a'],
    )
    openSetting('Width')
    expect(
      screen
        .getByRole('button', { name: 'Stroke width 4' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      screen
        .getByRole('button', { name: 'Stroke width 2' })
        .getAttribute('aria-pressed'),
    ).toBe('false')
  })

  it('shows no active weight for a cleared stroke', () => {
    // The stroke row's none button is what is active then — the weight row
    // must not also claim a value.
    setup(
      [shape('a', { style: { ...DEFAULT_ELEMENT_STYLE, strokeWidth: 0 } })],
      ['a'],
    )
    openSetting('Width')
    for (const width of CANVAS_STROKE_WIDTHS) {
      expect(
        screen
          .getByRole('button', { name: `Stroke width ${width}` })
          .getAttribute('aria-pressed'),
      ).toBe('false')
    }
  })

  it('shows no active weight for a stored width outside the offered set', () => {
    setup(
      [shape('a', { style: { ...DEFAULT_ELEMENT_STYLE, strokeWidth: 3 } })],
      ['a'],
    )
    openSetting('Width')
    for (const width of CANVAS_STROKE_WIDTHS) {
      expect(
        screen
          .getByRole('button', { name: `Stroke width ${width}` })
          .getAttribute('aria-pressed'),
      ).toBe('false')
    }
  })

  it('marks the none button active only when every target is cleared', () => {
    const unfilled = { ...DEFAULT_ELEMENT_STYLE, fill: FILL_NONE }
    setup(
      [shape('a', { style: unfilled }), shape('b', { style: unfilled })],
      ['a', 'b'],
    )
    openSetting('Fill')
    expect(
      screen
        .getByRole('button', { name: 'Fill none' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    openSetting('Stroke')
    expect(
      screen
        .getByRole('button', { name: 'Stroke none' })
        .getAttribute('aria-pressed'),
    ).toBe('false')
  })
})

describe('arranging', () => {
  it('reports the elements to re-order and which end', () => {
    const { onArrange } = setup(
      [shape('a', { zIndex: 0 }), shape('b', { zIndex: 1 })],
      ['a'],
    )
    fireEvent.click(screen.getByRole('button', { name: 'Bring to front' }))
    expect(onArrange).toHaveBeenCalledTimes(1)
    const [targets, command] = onArrange.mock.calls[0]
    expect(targets.map((e: CanvasElement) => e.id)).toEqual(['a'])
    expect(command).toBe('front')

    fireEvent.click(screen.getByRole('button', { name: 'Send to back' }))
    expect(onArrange.mock.calls[1][1]).toBe('back')
  })

  it('includes text in the elements to re-order but excludes connectors', () => {
    const { onArrange } = setup(
      [shape('s'), shape('t', { kind: 'text' }), connectorElement('con')],
      ['s', 't', 'con'],
    )
    fireEvent.click(screen.getByRole('button', { name: 'Bring to front' }))
    expect(onArrange.mock.calls[0][0].map((e: CanvasElement) => e.id)).toEqual([
      's',
      't',
    ])
  })

  it('emits even for a selection already at that end', () => {
    // The button is never disabled: `planZOrder` is what decides a command
    // changes nothing, and a button that looks dead because of this frame's
    // stack position reads as broken.
    const { onArrange } = setup(
      [shape('a', { zIndex: 0 }), shape('b', { zIndex: 1 })],
      ['b'],
    )
    fireEvent.click(screen.getByRole('button', { name: 'Bring to front' }))
    expect(onArrange).toHaveBeenCalledTimes(1)
  })
})

describe('emitting', () => {
  it('reports the chosen fill and the shapes it applies to', () => {
    const { onStyleChange } = setup([shape('a'), shape('b')], ['a', 'b'])
    openSetting('Fill')
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
    openSetting('Fill')
    fireEvent.click(screen.getByRole('button', { name: 'Fill Blue' }))
    expect(onStyleChange).not.toHaveBeenCalled()
  })

  it('emits only the shapes the click would actually change', () => {
    // One already red, one not. The undo entry must cover the second alone,
    // or undoing would "restore" a colour the first shape never left.
    const { onStyleChange } = setup(
      [
        shape('already', {
          style: { ...DEFAULT_ELEMENT_STYLE, fill: RED.fill },
        }),
        shape('changing'),
      ],
      ['already', 'changing'],
    )
    openSetting('Fill')
    fireEvent.click(screen.getByRole('button', { name: 'Fill Red' }))

    const [targets] = onStyleChange.mock.calls[0]
    expect(targets.map((e: CanvasElement) => e.id)).toEqual(['changing'])
  })

  it('emits a null value for the none buttons', () => {
    const { onStyleChange } = setup([shape('a')], ['a'])
    openSetting('Stroke')
    fireEvent.click(screen.getByRole('button', { name: 'Stroke none' }))
    expect(onStyleChange.mock.calls[0][1]).toEqual({
      target: 'stroke',
      value: null,
    })
  })

  it('emits the chosen weight, and writes nothing for the current one', () => {
    const { onStyleChange } = setup([shape('a')], ['a'])
    openSetting('Width')
    // The default is 2 — re-picking it must not push a self-reversing undo entry.
    fireEvent.click(screen.getByRole('button', { name: 'Stroke width 2' }))
    expect(onStyleChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Stroke width 4' }))
    expect(onStyleChange.mock.calls[0][1]).toEqual({
      target: 'strokeWidth',
      value: 4,
    })
  })

  it('offers every weight the palette declares', () => {
    setup([shape('a')], ['a'])
    openSetting('Width')
    for (const width of CANVAS_STROKE_WIDTHS) {
      expect(
        screen.getByRole('button', { name: `Stroke width ${width}` }),
      ).toBeTruthy()
    }
  })

  it('offers every palette swatch in both rows', () => {
    // The palette is the source of truth; a ninth colour added to it should
    // appear here without anyone editing this component.
    // One setting at a time: opening the stroke popover dismisses the fill
    // one, which is the behaviour a user gets too.
    setup([shape('a')], ['a'])
    openSetting('Fill')
    for (const swatch of CANVAS_SWATCHES) {
      expect(
        screen.getByRole('button', { name: `Fill ${swatch.label}` }),
      ).toBeTruthy()
    }
    openSetting('Stroke')
    for (const swatch of CANVAS_SWATCHES) {
      expect(
        screen.getByRole('button', { name: `Stroke ${swatch.label}` }),
      ).toBeTruthy()
    }
  })
})

describe('the duplicate control', () => {
  it('is offered for a shape selection', () => {
    setup([shape('a')], ['a'])
    expect(screen.getByRole('group', { name: 'Actions' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeTruthy()
  })

  it('is offered for TEXT too, which has no paint rows', () => {
    // Text can be copied like anything else; it simply cannot be restyled
    // from here.
    setup([shape('t', { kind: 'text' })], ['t'])
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Fill' })).toBeNull()
  })

  it('calls back when clicked, with no target list of its own', () => {
    // Duplicate reads the LIVE selection from the input hook. A target list
    // computed here would be a second answer to "what is selected".
    const { onDuplicate } = setup([shape('a')], ['a'])
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
    expect(onDuplicate).toHaveBeenCalledTimes(1)
    expect(onDuplicate).toHaveBeenCalledWith()
  })

  it('is absent on a read-only board', () => {
    setup([shape('a')], ['a'], true)
    expect(screen.queryByRole('button', { name: 'Duplicate' })).toBeNull()
  })

  it('is absent while an element is being typed into', () => {
    setup([shape('a')], ['a'], false, 'a')
    expect(screen.queryByRole('button', { name: 'Duplicate' })).toBeNull()
  })

  it('names its shortcut, so the keyboard path is discoverable', () => {
    setup([shape('a')], ['a'])
    expect(
      screen.getByRole('button', { name: 'Duplicate' }).getAttribute('title'),
    ).toContain('Ctrl+D')
  })
})

describe('canGroupSelection / canUngroupSelection', () => {
  it('requires at least 2 selected elements to group (FR-030/A1)', () => {
    expect(canGroupSelection(new Set())).toBe(false)
    expect(canGroupSelection(new Set(['a']))).toBe(false)
    expect(canGroupSelection(new Set(['a', 'b']))).toBe(true)
    expect(canGroupSelection(new Set(['a', 'b', 'c']))).toBe(true)
  })

  it('allows ungroup only when the selection is exactly one group element (FR-008)', () => {
    const scene = sceneFrom([
      shape('a'),
      shape('b'),
      groupElement('g', ['a', 'b']),
    ])
    expect(canUngroupSelection(scene, new Set())).toBe(false)
    expect(canUngroupSelection(scene, new Set(['a']))).toBe(false)
    expect(canUngroupSelection(scene, new Set(['a', 'g']))).toBe(false)
    expect(canUngroupSelection(scene, new Set(['g']))).toBe(true)
  })
})

describe('the group and ungroup controls', () => {
  it('Group is disabled below 2 selected', () => {
    setup([shape('a')], ['a'])
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Group' })
        .disabled,
    ).toBe(true)
  })

  it('Group is enabled at 2 or more selected', () => {
    setup([shape('a'), shape('b')], ['a', 'b'])
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Group' })
        .disabled,
    ).toBe(false)
  })

  it('Ungroup is enabled when the selection is exactly one group', () => {
    const g = groupElement('g', ['a', 'b'])
    setup([shape('a'), shape('b'), g], ['g'])
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Ungroup' })
        .disabled,
    ).toBe(false)
  })

  it('Ungroup stays disabled for a non-group single selection', () => {
    setup([shape('a')], ['a'])
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Ungroup' })
        .disabled,
    ).toBe(true)
  })

  it('Ungroup stays disabled once a group is part of a larger selection', () => {
    const g = groupElement('g', ['a', 'b'])
    setup([shape('a'), shape('b'), g], ['a', 'g'])
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Ungroup' })
        .disabled,
    ).toBe(true)
  })

  it('Group calls back when clicked, with no target list of its own', () => {
    // Mirrors onDuplicate's own reasoning: reads the LIVE selection from the
    // input hook, not a target list computed here.
    const { onGroup } = setup([shape('a'), shape('b')], ['a', 'b'])
    fireEvent.click(screen.getByRole('button', { name: 'Group' }))
    expect(onGroup).toHaveBeenCalledTimes(1)
    expect(onGroup).toHaveBeenCalledWith()
  })

  it('Ungroup calls back when clicked', () => {
    const g = groupElement('g', ['a', 'b'])
    const { onUngroup } = setup([shape('a'), shape('b'), g], ['g'])
    fireEvent.click(screen.getByRole('button', { name: 'Ungroup' }))
    expect(onUngroup).toHaveBeenCalledTimes(1)
    expect(onUngroup).toHaveBeenCalledWith()
  })

  it('a disabled Ungroup does not call back when clicked', () => {
    const { onUngroup } = setup([shape('a')], ['a'])
    fireEvent.click(screen.getByRole('button', { name: 'Ungroup' }))
    expect(onUngroup).not.toHaveBeenCalled()
  })

  it('name their shortcuts, so the keyboard path is discoverable', () => {
    setup([shape('a'), shape('b')], ['a', 'b'])
    expect(
      screen.getByRole('button', { name: 'Group' }).getAttribute('title'),
    ).toContain('Ctrl+G')
    expect(
      screen.getByRole('button', { name: 'Ungroup' }).getAttribute('title'),
    ).toContain('Ctrl+Shift+G')
  })
})

describe('the corner radius row', () => {
  it('rounds a rectangle', () => {
    const { onStyleChange } = setup([shape('a')], ['a'])
    openSetting('Corner')
    fireEvent.click(screen.getByRole('button', { name: 'Corner radius 20' }))
    expect(onStyleChange).toHaveBeenCalledTimes(1)
    const [changed, change] = onStyleChange.mock.calls[0]
    expect(changed.map((e: CanvasElement) => e.id)).toEqual(['a'])
    expect(change).toEqual({ target: 'cornerRadius', value: 20 })
  })

  it('offers every radius in the palette, zero included', () => {
    // Zero belongs IN the row rather than in a none button beside it: unlike
    // "no stroke", no rounding is the same field at one end of its range.
    setup(
      [shape('a', { style: { ...DEFAULT_ELEMENT_STYLE, cornerRadius: 8 } })],
      ['a'],
    )
    openSetting('Corner')
    for (const radius of CANVAS_CORNER_RADII) {
      expect(
        screen.getByRole('button', { name: `Corner radius ${radius}` }),
      ).toBeTruthy()
    }
    expect(CANVAS_CORNER_RADII).toContain(0)
  })

  it('marks the stored radius active', () => {
    setup(
      [shape('a', { style: { ...DEFAULT_ELEMENT_STYLE, cornerRadius: 8 } })],
      ['a'],
    )
    openSetting('Corner')
    expect(
      screen
        .getByRole('button', { name: 'Corner radius 8' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('marks nothing active when the rectangles disagree', () => {
    setup(
      [
        shape('a', { style: { ...DEFAULT_ELEMENT_STYLE, cornerRadius: 8 } }),
        shape('b', { style: { ...DEFAULT_ELEMENT_STYLE, cornerRadius: 20 } }),
      ],
      ['a', 'b'],
    )
    openSetting('Corner')
    for (const radius of CANVAS_CORNER_RADII) {
      expect(
        screen
          .getByRole('button', { name: `Corner radius ${radius}` })
          .getAttribute('aria-pressed'),
      ).toBe('false')
    }
  })

  it('is absent when nothing selected has corners', () => {
    setup([shape('e', { kind: 'ellipse' })], ['e'])
    expect(screen.queryByRole('button', { name: 'Corner' })).toBeNull()
    // ...but the settings that DO apply to an ellipse are still there, so
    // this is one trigger hiding rather than the toolbar failing to render.
    expect(screen.getByRole('button', { name: 'Width' })).toBeTruthy()
  })

  it('rounds only the rectangles in a mixed selection', () => {
    // An ellipse has no corners to round. Writing a radius to it would store
    // a value that changes nothing and push it into the undo entry, so
    // Ctrl+Z would report restyling more shapes than visibly changed.
    const { onStyleChange } = setup(
      [shape('r'), shape('e', { kind: 'ellipse' })],
      ['r', 'e'],
    )
    openSetting('Corner')
    fireEvent.click(screen.getByRole('button', { name: 'Corner radius 20' }))
    const [changed] = onStyleChange.mock.calls[0]
    expect(changed.map((e: CanvasElement) => e.id)).toEqual(['r'])
  })

  it('writes nothing when the rectangle already has that radius', () => {
    const { onStyleChange } = setup(
      [shape('a', { style: { ...DEFAULT_ELEMENT_STYLE, cornerRadius: 20 } })],
      ['a'],
    )
    openSetting('Corner')
    fireEvent.click(screen.getByRole('button', { name: 'Corner radius 20' }))
    expect(onStyleChange).not.toHaveBeenCalled()
  })

  it('is absent on a read-only board', () => {
    setup([shape('a')], ['a'], true)
    expect(
      screen.queryByRole('button', { name: 'Corner radius 20' }),
    ).toBeNull()
  })
})

describe('the setting popovers', () => {
  it('keeps the options behind their trigger until it is clicked', () => {
    // The whole point of collapsing the settings: the bar stays one row high,
    // so no swatch is in the document until its setting is opened.
    setup([shape('a')], ['a'])
    expect(screen.queryByRole('group', { name: 'Fill' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Fill Red' })).toBeNull()

    openSetting('Fill')
    expect(screen.getByRole('group', { name: 'Fill' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Fill Red' })).toBeTruthy()
  })

  it('offers one trigger per setting, and no more', () => {
    setup([shape('a')], ['a'])
    for (const label of ['Fill', 'Stroke', 'Width', 'Corner']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
  })

  it('names the current value on the closed trigger', () => {
    // A trigger showing only a swatch would leave the bar unreadable to
    // anyone who cannot tell two hues apart at 14px. The tooltip is where the
    // current value is spelled out.
    setup([shape('a')], ['a'])
    expect(
      screen.getByRole('button', { name: 'Fill' }).getAttribute('title'),
    ).toBe('Fill: Blue')
    expect(
      screen.getByRole('button', { name: 'Width' }).getAttribute('title'),
    ).toBe('Width: 2px')
    // The engine default is 8, so a never-styled rectangle is already rounded.
    expect(
      screen.getByRole('button', { name: 'Corner' }).getAttribute('title'),
    ).toBe('Corner: 8px')
  })

  it('says Mixed when the selected shapes disagree', () => {
    setup(
      [
        shape('a', { style: { ...DEFAULT_ELEMENT_STYLE, fill: RED.fill } }),
        shape('b', { style: { ...DEFAULT_ELEMENT_STYLE, fill: TEAL.fill } }),
      ],
      ['a', 'b'],
    )
    expect(
      screen.getByRole('button', { name: 'Fill' }).getAttribute('title'),
    ).toBe('Fill: Mixed')
  })

  it('says None for a cleared half of the paint', () => {
    setup(
      [
        shape('a', {
          style: { ...DEFAULT_ELEMENT_STYLE, fill: FILL_NONE, strokeWidth: 0 },
        }),
      ],
      ['a'],
    )
    expect(
      screen.getByRole('button', { name: 'Fill' }).getAttribute('title'),
    ).toBe('Fill: None')
    // A cleared stroke has no weight to report either.
    expect(
      screen.getByRole('button', { name: 'Width' }).getAttribute('title'),
    ).toBe('Width: None')
  })

  it('stays open across picks, so weights can be compared', () => {
    // Choosing paint is a comparison — three weights tried in a row. A
    // popover that dismissed itself on the first click would make every pick
    // after it cost two.
    const { onStyleChange } = setup([shape('a')], ['a'])
    openSetting('Width')
    fireEvent.click(screen.getByRole('button', { name: 'Stroke width 4' }))
    expect(screen.getByRole('button', { name: 'Stroke width 1' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Stroke width 1' }))
    expect(onStyleChange).toHaveBeenCalledTimes(2)
  })
})

describe('the popover and the board keyboard', () => {
  it('keeps its keystrokes away from the board container', () => {
    // A React portal bubbles through the React TREE, so the popover's content
    // still reaches `CanvasBoard`'s container `onKeyDown` even though it
    // renders outside that container in the DOM. Before this was stopped,
    // Escape closed the popover AND cleared the selection under it, which
    // took the toolbar down with it.
    const onKeyDown = vi.fn()
    const scene = sceneFrom([shape('a')])
    render(
      <div onKeyDown={onKeyDown}>
        <SelectionToolbar
          scene={scene}
          selectedIds={new Set(['a'])}
          camera={DEFAULT_CAMERA}
          readOnly={false}
          editingElementId={null}
          onStyleChange={vi.fn()}
          onArrange={vi.fn()}
          onDuplicate={vi.fn()}
          onGroup={vi.fn()}
          onUngroup={vi.fn()}
        />
      </div>,
    )

    openSetting('Fill')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Fill Red' }), {
      key: 'Escape',
    })
    expect(onKeyDown).not.toHaveBeenCalled()
  })
})

describe('text alignment', () => {
  it('offers Align for a text element, which takes no paint at all', () => {
    // The case that forced a second target set. A `text` element paints no
    // fill, stroke or corner, so it shows none of those settings — but it is
    // made of text, so alignment is the one setting that MUST reach it.
    setup([shape('t', { kind: 'text' })], ['t'])
    expect(screen.getByRole('button', { name: 'Align' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Fill' })).toBeNull()
  })

  it('offers Align for a shape alongside the paint settings', () => {
    setup([shape('a')], ['a'])
    expect(screen.getByRole('button', { name: 'Align' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Fill' })).toBeTruthy()
  })

  it('withholds Align from a connector-only selection', () => {
    // A connector carries no text, so the setting would visibly do nothing.
    setup([connectorElement('c')], ['c'])
    expect(screen.queryByRole('button', { name: 'Align' })).toBeNull()
  })

  it('withholds Align while an element is being edited', () => {
    // Every piece of selection chrome appears and disappears together — the
    // rule the file header states for the bar as a whole.
    setup([shape('a')], ['a'], false, 'a')
    expect(screen.queryByRole('button', { name: 'Align' })).toBeNull()
  })

  it('withholds Align on a read-only board', () => {
    setup([shape('a')], ['a'], true)
    expect(screen.queryByRole('button', { name: 'Align' })).toBeNull()
  })

  it('emits a textAlign change for every alignable target', () => {
    const { onStyleChange } = setup(
      [shape('a'), shape('b', { kind: 'text' })],
      ['a', 'b'],
    )
    openSetting('Align')
    fireEvent.click(screen.getByRole('button', { name: 'Align center' }))
    expect(onStyleChange).toHaveBeenCalledTimes(1)
    const [targets, change] = onStyleChange.mock.calls[0]
    expect(targets.map((e: CanvasElement) => e.id)).toEqual(['a', 'b'])
    expect(change).toEqual({ target: 'textAlign', value: 'center' })
  })

  it('emits a verticalAlign change from the second row', () => {
    const { onStyleChange } = setup([shape('a')], ['a'])
    openSetting('Align')
    fireEvent.click(screen.getByRole('button', { name: 'Align bottom' }))
    expect(onStyleChange).toHaveBeenCalledWith(expect.anything(), {
      target: 'verticalAlign',
      value: 'bottom',
    })
  })

  it('marks the current alignment pressed on both axes', () => {
    setup(
      [
        shape('a', {
          style: {
            ...DEFAULT_ELEMENT_STYLE,
            textAlign: 'right',
            verticalAlign: 'middle',
          },
        }),
      ],
      ['a'],
    )
    openSetting('Align')
    expect(
      screen
        .getByRole('button', { name: 'Align right' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      screen
        .getByRole('button', { name: 'Align middle' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      screen
        .getByRole('button', { name: 'Align left' })
        .getAttribute('aria-pressed'),
    ).toBe('false')
  })

  it('marks nothing pressed when the selection disagrees', () => {
    // The honest rendering of a mixed selection — the same convention the
    // swatches follow rather than claiming one element's value for all.
    setup(
      [
        shape('a', { style: { ...DEFAULT_ELEMENT_STYLE, textAlign: 'left' } }),
        shape('b', { style: { ...DEFAULT_ELEMENT_STYLE, textAlign: 'right' } }),
      ],
      ['a', 'b'],
    )
    openSetting('Align')
    for (const name of ['Align left', 'Align center', 'Align right']) {
      expect(
        screen.getByRole('button', { name }).getAttribute('aria-pressed'),
      ).toBe('false')
    }
  })

  it('writes nothing when every target is already aligned that way', () => {
    // The same no-op guard every other setting states: a stray click on the
    // active option must not push an undo entry that reverses to itself.
    const { onStyleChange } = setup([shape('a')], ['a'])
    openSetting('Align')
    fireEvent.click(screen.getByRole('button', { name: 'Align left' }))
    expect(onStyleChange).not.toHaveBeenCalled()
  })
})

describe('applyStyleChange for alignment', () => {
  const base: CanvasElementStyle = { ...DEFAULT_ELEMENT_STYLE }

  it('writes textAlign and leaves the other axis alone', () => {
    const next = applyStyleChange(base, { target: 'textAlign', value: 'right' })
    expect(next.textAlign).toBe('right')
    expect(next.verticalAlign).toBe(base.verticalAlign)
  })

  it('writes verticalAlign and leaves the other axis alone', () => {
    const next = applyStyleChange(base, {
      target: 'verticalAlign',
      value: 'bottom',
    })
    expect(next.verticalAlign).toBe('bottom')
    expect(next.textAlign).toBe(base.textAlign)
  })

  it('touches no paint field', () => {
    const next = applyStyleChange(base, {
      target: 'textAlign',
      value: 'center',
    })
    expect(next.fill).toBe(base.fill)
    expect(next.stroke).toBe(base.stroke)
    expect(next.strokeWidth).toBe(base.strokeWidth)
    expect(next.cornerRadius).toBe(base.cornerRadius)
  })
})
