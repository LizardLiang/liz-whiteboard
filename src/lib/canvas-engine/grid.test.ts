// src/lib/canvas-engine/grid.test.ts
// Unit tests for the dot grid and the snapping that keeps new elements on it.
//
// What is worth pinning here is the AGREEMENT between the two halves. Dots at
// one spacing and snapping at another would produce a board that looks almost
// aligned, and no assertion about either half on its own would catch it — so
// the tests below check the drawn spacing against `GRID_SIZE` directly.

import { describe, expect, it } from 'vitest'
import {
  GRID_SIZE,
  MIN_GRID_SCREEN_STEP,
  dotGridBackground,
  gridSpacingFor,
  snapCoord,
  snapPoint,
  snapRect,
  snapSize,
} from './grid'
import { MAX_ZOOM, MIN_ZOOM } from './camera'

describe('snapCoord', () => {
  it('moves a coordinate to the nearest grid line', () => {
    expect(snapCoord(0)).toBe(0)
    expect(snapCoord(9)).toBe(0)
    expect(snapCoord(11)).toBe(20)
    expect(snapCoord(30)).toBe(40) // .5 rounds up, consistently
    expect(snapCoord(137)).toBe(140)
  })

  it('snaps negative coordinates the same way, and never to negative zero', () => {
    expect(snapCoord(-9)).toBe(0)
    expect(Object.is(snapCoord(-9), -0)).toBe(false)
    expect(snapCoord(-11)).toBe(-20)
    expect(snapCoord(-137)).toBe(-140)
  })

  it('leaves a coordinate already on a line untouched', () => {
    for (const value of [-100, -20, 0, 20, 160, 1000]) {
      expect(snapCoord(value)).toBe(value)
    }
  })
})

describe('snapPoint', () => {
  it('snaps both axes', () => {
    expect(snapPoint({ x: 103, y: -47 })).toEqual({ x: 100, y: -40 })
  })
})

describe('snapRect', () => {
  it('puts all four borders on grid lines', () => {
    const snapped = snapRect({ x: 103, y: 47, width: 74, height: 33 })
    expect(snapped.x % GRID_SIZE).toBe(0)
    expect(snapped.y % GRID_SIZE).toBe(0)
    expect((snapped.x + snapped.width) % GRID_SIZE).toBe(0)
    expect((snapped.y + snapped.height) % GRID_SIZE).toBe(0)
  })

  it('snaps each edge independently rather than moving the whole rect', () => {
    // Left 103 -> 100 and right 177 -> 180: the width GROWS from 74 to 80.
    // Snapping the origin and keeping the size would have left the right
    // border at 174, between two dots, which is the defect this guards.
    expect(snapRect({ x: 103, y: 47, width: 74, height: 33 })).toEqual({
      x: 100,
      y: 40,
      width: 80,
      height: 40,
    })
  })

  it('keeps a sub-cell drag at least one cell wide and tall', () => {
    const snapped = snapRect({ x: 100, y: 100, width: 3, height: 3 })
    expect(snapped).toEqual({
      x: 100,
      y: 100,
      width: GRID_SIZE,
      height: GRID_SIZE,
    })
  })

  it('is idempotent — snapping an already-snapped rect changes nothing', () => {
    const once = snapRect({ x: 13, y: 91, width: 211, height: 57 })
    expect(snapRect(once)).toEqual(once)
  })
})

describe('snapSize', () => {
  it('rounds each dimension to whole cells', () => {
    expect(snapSize({ width: 74, height: 33 })).toEqual({
      width: 80,
      height: 40,
    })
  })

  it('never returns less than one cell', () => {
    expect(snapSize({ width: 1, height: 0 })).toEqual({
      width: GRID_SIZE,
      height: GRID_SIZE,
    })
  })
})

describe('gridSpacingFor', () => {
  it('draws the full-resolution grid at 1x', () => {
    expect(gridSpacingFor(1)).toBe(GRID_SIZE)
  })

  it('never lets the drawn dots fall below the legible screen step', () => {
    for (let zoom = MIN_ZOOM; zoom <= MAX_ZOOM; zoom += 0.05) {
      expect(gridSpacingFor(zoom) * zoom).toBeGreaterThanOrEqual(
        MIN_GRID_SCREEN_STEP,
      )
    }
  })

  it('thins by powers of two, so every drawn dot is still a real grid point', () => {
    // This is what lets `snapCoord` always use the full-resolution GRID_SIZE:
    // a snapped edge can land on a dot the zoom chose not to draw, but never
    // BETWEEN two dots that are drawn.
    for (let zoom = MIN_ZOOM; zoom <= MAX_ZOOM; zoom += 0.05) {
      const ratio = gridSpacingFor(zoom) / GRID_SIZE
      expect(Number.isInteger(Math.log2(ratio))).toBe(true)
    }
  })

  it('falls back to the base spacing for a degenerate zoom', () => {
    expect(gridSpacingFor(0)).toBe(GRID_SIZE)
    expect(gridSpacingFor(Number.NaN)).toBe(GRID_SIZE)
  })
})

describe('dotGridBackground', () => {
  it('tiles at the drawn spacing scaled by zoom', () => {
    const style = dotGridBackground({ x: 0, y: 0, zoom: 1 })
    expect(style.backgroundSize).toBe(`${GRID_SIZE}px ${GRID_SIZE}px`)
  })

  it('puts a dot exactly on the world origin', () => {
    // The tile carries its dot at the centre, so the background origin sits
    // half a cell back from where the dot has to land.
    const style = dotGridBackground({ x: 0, y: 0, zoom: 1 })
    expect(style.backgroundPosition).toBe(
      `${-GRID_SIZE / 2}px ${-GRID_SIZE / 2}px`,
    )
  })

  it('moves the dots with the camera, in screen pixels', () => {
    const style = dotGridBackground({ x: 100, y: 50, zoom: 2 })
    const step = GRID_SIZE * 2
    expect(style.backgroundSize).toBe(`${step}px ${step}px`)
    expect(style.backgroundPosition).toBe(
      `${-100 * 2 - step / 2}px ${-50 * 2 - step / 2}px`,
    )
  })

  it('uses a different dot colour per theme', () => {
    const light = dotGridBackground({ x: 0, y: 0, zoom: 1 }, 'light')
    const dark = dotGridBackground({ x: 0, y: 0, zoom: 1 }, 'dark')
    expect(light.backgroundImage).not.toBe(dark.backgroundImage)
  })
})
