// src/lib/canvas-style-palette.test.ts
// The swatch palette, and the one thing about it that cannot be enforced by
// the type system: that its blue entry IS the engine's default style.
//
// `canvas-engine/scene.ts` imports nothing — that is what lets the engine be
// unit-tested with no browser and no database — so it cannot import this
// module and this module must not import a Zod-adjacent one into the engine.
// The two declare the same two strings independently, which is exactly the
// drift risk `canvas-element-adapter.ts`'s `_kindsAgree` guard exists for on
// the kind vocabulary. There is no compile-time trick available here, so this
// test is the guard.

import { describe, expect, it } from 'vitest'
import {
  CANVAS_CORNER_RADII,
  CANVAS_FONT_SIZES,
  CANVAS_STROKE_WIDTHS,
  CANVAS_SWATCHES,
  CANVAS_TEXT_COLORS,
  DEFAULT_STROKE_WIDTH,
  DEFAULT_TEXT_COLOR,
  FILL_NONE,
  swatchForFill,
  swatchForStroke,
} from './canvas-style-palette'
import { PRESET_IDS, PRESET_RAMPS } from './canvas-engine/colour-ramps'
import { DEFAULT_ELEMENT_STYLE } from './canvas-engine/scene'
import { SHAPE_STROKE_WIDTHS } from '@/data/schema'

describe('the palette and the engine default agree', () => {
  it('reads the engine default fill and stroke as the Slate swatch', () => {
    // A never-styled shape is painted with the slate ramp, so the toolbar must
    // show Slate active instead of no selection at all.
    expect(swatchForFill(DEFAULT_ELEMENT_STYLE.fill)?.id).toBe('slate')
    expect(swatchForStroke(DEFAULT_ELEMENT_STYLE.stroke)?.id).toBe('slate')
  })

  it('stores the same preset values as the colour ramps module', () => {
    // This module imports nothing, so the ramp module cannot be derived from it.
    expect(CANVAS_SWATCHES.map((s) => [s.id, s.fill, s.stroke])).toEqual(
      PRESET_IDS.map((id) => [
        id,
        PRESET_RAMPS[id].value,
        PRESET_RAMPS[id].value,
      ]),
    )
  })

  it('lists the presets in picker order and offers no amber or yellow', () => {
    expect(CANVAS_SWATCHES.map((s) => s.label)).toEqual([
      'Blue',
      'Indigo',
      'Violet',
      'Plum',
      'Pink',
      'Tomato',
      'Orange',
      'Green',
      'Teal',
      'Cyan',
      'Slate',
    ])
  })

  it('restores the default width when a cleared stroke is re-enabled', () => {
    expect(DEFAULT_STROKE_WIDTH).toBe(DEFAULT_ELEMENT_STYLE.strokeWidth)
  })

  it('includes the default corner radius among the offered ones', () => {
    // Same rule as the blue swatch and the default weight: a never-styled
    // rectangle must show an ACTIVE button in the Corner row, or the row looks
    // broken on the most common shape on the board.
    expect([...CANVAS_CORNER_RADII]).toContain(
      DEFAULT_ELEMENT_STYLE.cornerRadius,
    )
  })

  it('includes the default font size among the offered ones', () => {
    expect(CANVAS_FONT_SIZES.map((option) => option.size)).toContain(
      DEFAULT_ELEMENT_STYLE.fontSize,
    )
  })

  it('leads the text colours with the engine default, then the eleven presets', () => {
    expect(DEFAULT_TEXT_COLOR).toBe(DEFAULT_ELEMENT_STYLE.color)
    expect(CANVAS_TEXT_COLORS[0]).toEqual({
      label: 'Default',
      value: DEFAULT_ELEMENT_STYLE.color,
    })
    expect(CANVAS_TEXT_COLORS).toHaveLength(12)
    expect(CANVAS_TEXT_COLORS.slice(1).map((option) => option.value)).toEqual(
      CANVAS_SWATCHES.map((swatch) => swatch.stroke),
    )
  })

  it('defaults rectangles to ROUNDED corners, not square', () => {
    // The product decision, pinned: a rectangle is drawn rounded before anyone
    // styles it. This is also the schema default, so a stored row with no
    // corner preference adopts it.
    expect(DEFAULT_ELEMENT_STYLE.cornerRadius).toBeGreaterThan(0)
  })

  it('offers the SAME stroke weights as the ER whiteboard', () => {
    // Restated rather than imported so this module keeps its no-imports
    // property (the schema would pull Zod in). This is the guard that keeps
    // the two boards from drifting into different weight vocabularies.
    expect([...CANVAS_STROKE_WIDTHS]).toEqual([...SHAPE_STROKE_WIDTHS])
  })

  it('includes the default weight among the offered ones', () => {
    // Otherwise a never-styled shape shows no active width button — the same
    // papercut the blue-swatch assertion above exists to prevent.
    expect(CANVAS_STROKE_WIDTHS).toContain(DEFAULT_STROKE_WIDTH)
  })

  it('never offers zero as a weight — that is the stroke none button', () => {
    // Two controls expressing one state sitting side by side is a UI bug, not
    // a redundancy.
    expect(CANVAS_STROKE_WIDTHS).not.toContain(0)
    for (const width of CANVAS_STROKE_WIDTHS) {
      expect(width).toBeGreaterThan(0)
    }
  })

  it('spells the unfilled sentinel the way the renderer tests for it', () => {
    // `drawShape` compares `style.fill !== 'none'` by name; a different
    // spelling here would store a colour string the browser cannot parse and
    // paint nothing, which looks identical to "no fill" until it is exported.
    expect(FILL_NONE).toBe('none')
  })
})

describe('the palette itself', () => {
  it('offers eleven distinct swatches with unique ids, fills and strokes', () => {
    expect(CANVAS_SWATCHES).toHaveLength(11)
    expect(new Set(CANVAS_SWATCHES.map((s) => s.id)).size).toBe(11)
    expect(new Set(CANVAS_SWATCHES.map((s) => s.fill)).size).toBe(11)
    expect(new Set(CANVAS_SWATCHES.map((s) => s.stroke)).size).toBe(11)
  })

  it('gives every swatch a label for the picker', () => {
    for (const swatch of CANVAS_SWATCHES) {
      expect(swatch.label.length).toBeGreaterThan(0)
    }
  })
})

describe('lookups', () => {
  it('finds the swatch a stored value came from', () => {
    const teal = CANVAS_SWATCHES.find((s) => s.id === 'teal')!
    expect(swatchForFill(teal.fill)?.id).toBe('teal')
    expect(swatchForStroke(teal.stroke)?.id).toBe('teal')
  })

  it('reports no swatch for a value this palette never wrote', () => {
    // An older row, or a hand-edited one. "No swatch is active" is the honest
    // answer — snapping to the nearest colour would claim the shape is a
    // palette colour it is not.
    expect(swatchForFill('#123456')).toBeNull()
    expect(swatchForStroke('rgba(1, 2, 3, 0.5)')).toBeNull()
    expect(swatchForFill(FILL_NONE)).toBeNull()
  })

  it('matches a preset against both rows, since fill and stroke store one value', () => {
    const cyan = CANVAS_SWATCHES.find((s) => s.id === 'cyan')!
    expect(swatchForFill(cyan.fill)?.id).toBe('cyan')
    expect(swatchForStroke(cyan.stroke)?.id).toBe('cyan')
  })

  it('treats the legacy translucent swatch strings as custom', () => {
    expect(swatchForFill('rgba(245, 158, 11, 0.10)')).toBeNull()
  })
})
