// src/lib/render/framing.test.ts
// Pure framing maths: fit, focus, tile grid, and the error paths the render
// page reports through `data-render-error`.

import { describe, expect, it } from 'vitest'
import {
  FOCUS_MAX_ZOOM,
  TILE_MARGIN,
  buildTileGrid,
  fitRect,
  parseFocusIds,
  parseTile,
  planFrame,
  tileRect,
  unionRects,
  visibleRect,
} from './framing'
import type { Rect } from './framing'

const VIEW = { width: 1568, height: 1568 }

function rects(entries: Record<string, Rect>): Map<string, Rect> {
  return new Map(Object.entries(entries))
}

const BOARD = rects({
  a: { x: 0, y: 0, width: 240, height: 160 },
  b: { x: 420, y: 80, width: 240, height: 160 },
  far: { x: 3600, y: 2400, width: 240, height: 160 },
})

describe('unionRects', () => {
  it('returns null for no rectangles', () => {
    expect(unionRects([])).toBeNull()
  })

  it('spans every rectangle', () => {
    expect(unionRects(BOARD.values())).toEqual({
      x: 0,
      y: 0,
      width: 3840,
      height: 2560,
    })
  })
})

describe('fitRect', () => {
  it('shows the whole rectangle, centred', () => {
    const rect = { x: 0, y: 0, width: 3840, height: 2560 }
    const camera = fitRect(rect, VIEW, 1)
    const seen = visibleRect(camera, VIEW)
    expect(seen.x).toBeLessThanOrEqual(rect.x)
    expect(seen.y).toBeLessThanOrEqual(rect.y)
    expect(seen.x + seen.width).toBeGreaterThanOrEqual(rect.x + rect.width)
    expect(seen.y + seen.height).toBeGreaterThanOrEqual(rect.y + rect.height)
    expect(seen.x + seen.width / 2).toBeCloseTo(rect.x + rect.width / 2)
  })

  it('never magnifies past the max zoom', () => {
    const camera = fitRect({ x: 0, y: 0, width: 10, height: 10 }, VIEW, 1)
    expect(camera.zoom).toBe(1)
  })

  it('stops at the minimum zoom for a huge board', () => {
    const camera = fitRect({ x: 0, y: 0, width: 1e6, height: 1e6 }, VIEW, 1)
    expect(camera.zoom).toBe(0.1)
  })
})

describe('planFrame', () => {
  const base = { focusIds: [], tile: null, rects: BOARD, viewport: VIEW }

  it('fit: reports the whole board and a tile grid', () => {
    const plan = planFrame({ ...base, mode: 'fit' })
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.boardBounds).toEqual({
      x: 0,
      y: 0,
      width: 3840,
      height: 2560,
    })
    expect(plan.tileGrid?.cols).toBe(3)
    expect(plan.tileGrid?.rows).toBe(2)
    expect(plan.worldRect.width).toBeGreaterThanOrEqual(3840)
  })

  it('fit: an empty board frames the origin at zoom 1 with no grid', () => {
    const plan = planFrame({ ...base, mode: 'fit', rects: new Map() })
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.boardBounds).toBeNull()
    expect(plan.tileGrid).toBeNull()
    expect(plan.camera).toEqual({ x: 0, y: 0, zoom: 1 })
  })

  it('focus: frames only the named elements', () => {
    const plan = planFrame({ ...base, mode: 'focus', focusIds: ['a', 'b'] })
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.camera.zoom).toBeLessThanOrEqual(FOCUS_MAX_ZOOM)
    expect(plan.worldRect.x + plan.worldRect.width).toBeLessThan(3000)
  })

  it('focus: names the first unknown id', () => {
    const plan = planFrame({
      ...base,
      mode: 'focus',
      focusIds: ['a', 'missing'],
    })
    expect(plan).toEqual({ error: 'unknown-focus:missing' })
  })

  it('focus: no ids is an error', () => {
    expect(planFrame({ ...base, mode: 'focus' })).toEqual({
      error: 'focus-empty',
    })
  })

  it('tile: shows one viewport-sized window at zoom 1', () => {
    const plan = planFrame({
      ...base,
      mode: 'tile',
      tile: { row: 1, col: 2 },
    })
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.camera.zoom).toBe(1)
    expect(plan.worldRect).toEqual({
      x: -TILE_MARGIN + 2 * 1568,
      y: -TILE_MARGIN + 1568,
      width: 1568,
      height: 1568,
    })
  })

  it('tile: rejects a tile outside the grid', () => {
    const plan = planFrame({
      ...base,
      mode: 'tile',
      tile: { row: 5, col: 0 },
    })
    expect(plan).toEqual({ error: 'invalid-tile:5,0' })
  })

  it('tile: requires a tile', () => {
    expect(planFrame({ ...base, mode: 'tile' })).toEqual({
      error: 'invalid-tile',
    })
  })

  it('tile: an empty board has no tiles', () => {
    expect(
      planFrame({
        ...base,
        mode: 'tile',
        tile: { row: 0, col: 0 },
        rects: new Map(),
      }),
    ).toEqual({ error: 'empty-board' })
  })
})

describe('buildTileGrid', () => {
  it('marks only tiles that overlap an element', () => {
    const grid = buildTileGrid(
      unionRects(BOARD.values())!,
      VIEW,
      BOARD.values(),
    )
    expect(grid.occupied).toEqual([
      [0, 0],
      [1, 2],
    ])
  })

  it('numbers tiles row-major from the board origin', () => {
    const grid = buildTileGrid(
      { x: 100, y: 200, width: 100, height: 100 },
      VIEW,
      [],
    )
    expect(tileRect(grid, 0, 0)).toMatchObject({
      x: 100 - TILE_MARGIN,
      y: 200 - TILE_MARGIN,
    })
    expect(grid.cols).toBe(1)
    expect(grid.rows).toBe(1)
  })
})

describe('parseTile / parseFocusIds', () => {
  it('parses row,col', () => {
    expect(parseTile('1,2')).toEqual({ row: 1, col: 2 })
  })

  it.each([undefined, '', '1', '1,2,3', 'a,b', '-1,0', '1.5,0'])(
    'rejects %s',
    (raw) => {
      expect(parseTile(raw)).toBeNull()
    },
  )

  it('splits, trims and drops empty ids', () => {
    expect(parseFocusIds(' a, b ,,c')).toEqual(['a', 'b', 'c'])
    expect(parseFocusIds(undefined)).toEqual([])
  })
})
