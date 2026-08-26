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
  CANVAS_SWATCHES,
  DEFAULT_STROKE_WIDTH,
  FILL_NONE,
  swatchForFill,
  swatchForStroke,
} from './canvas-style-palette'
import { DEFAULT_ELEMENT_STYLE } from './canvas-engine/scene'

describe('the palette and the engine default agree', () => {
  it('has a blue swatch whose fill and stroke ARE the default element style', () => {
    // If this fails, a never-styled shape shows no active swatch and the
    // toolbar looks broken on the most common board there is.
    const blue = CANVAS_SWATCHES.find((swatch) => swatch.id === 'blue')
    expect(blue).toBeDefined()
    expect(blue!.fill).toBe(DEFAULT_ELEMENT_STYLE.fill)
    expect(blue!.stroke).toBe(DEFAULT_ELEMENT_STYLE.stroke)
  })

  it('restores the default width when a cleared stroke is re-enabled', () => {
    expect(DEFAULT_STROKE_WIDTH).toBe(DEFAULT_ELEMENT_STYLE.strokeWidth)
  })

  it('spells the unfilled sentinel the way the renderer tests for it', () => {
    // `drawShape` compares `style.fill !== 'none'` by name; a different
    // spelling here would store a colour string the browser cannot parse and
    // paint nothing, which looks identical to "no fill" until it is exported.
    expect(FILL_NONE).toBe('none')
  })
})

describe('the palette itself', () => {
  it('offers eight distinct swatches with unique ids, fills and strokes', () => {
    expect(CANVAS_SWATCHES).toHaveLength(8)
    expect(new Set(CANVAS_SWATCHES.map((s) => s.id)).size).toBe(8)
    expect(new Set(CANVAS_SWATCHES.map((s) => s.fill)).size).toBe(8)
    expect(new Set(CANVAS_SWATCHES.map((s) => s.stroke)).size).toBe(8)
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

  it('does not match a fill value against a stroke value', () => {
    // The two halves store different strings for the same swatch (translucent
    // versus solid); crossing them would light up the wrong row.
    const blue = CANVAS_SWATCHES.find((s) => s.id === 'blue')!
    expect(swatchForStroke(blue.fill)).toBeNull()
    expect(swatchForFill(blue.stroke)).toBeNull()
  })
})
