// src/lib/render/framing.ts
// Pure framing maths for the headless render pages. No React, no DOM.
//
// The MCP renderer asks for one of three framings:
//   fit   - the whole board in one viewport
//   focus - only the named elements (tables, shapes, canvas elements)
//   tile  - one viewport-sized window at zoom 1.0, addressed as row,col of a
//           grid laid over the board
// Both board surfaces (React Flow ER boards, the Canvas 2D engine) reduce to
// "a set of world rectangles keyed by id", so one planner serves both.

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** World coordinate at the viewport's top-left, plus world-to-screen scale. */
export interface FrameCamera {
  x: number
  y: number
  zoom: number
}

export type FramingMode = 'fit' | 'focus' | 'tile'

export interface TileGrid {
  cols: number
  rows: number
  tileWidth: number
  tileHeight: number
  originX: number
  originY: number
  /** `[row, col]` of every tile that overlaps at least one element. */
  occupied: Array<[number, number]>
}

export interface FrameReport {
  camera: FrameCamera
  /** The world rectangle the viewport shows. */
  worldRect: Rect
  /** Union of every element, or null for an empty board. */
  boardBounds: Rect | null
  tileGrid: TileGrid | null
}

export type FramePlan = FrameReport | { error: string }

export interface FrameRequest {
  mode: FramingMode
  focusIds: Array<string>
  tile: { row: number; col: number } | null
  rects: Map<string, Rect>
  viewport: { width: number; height: number }
}

/** Share of the viewport left empty on each side of a fitted rectangle. */
export const FIT_PADDING = 0.06
export const MIN_ZOOM = 0.1
/** Fit never magnifies past 1x; focus may, so one small table stays legible. */
export const FIT_MAX_ZOOM = 1
export const FOCUS_MAX_ZOOM = 1.5
/** Empty margin around the board when laying the tile grid, in world units. */
export const TILE_MARGIN = 32

export function unionRects(rects: Iterable<Rect>): Rect | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.width)
    maxY = Math.max(maxY, r.y + r.height)
  }
  if (!Number.isFinite(minX)) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function visibleRect(
  camera: FrameCamera,
  viewport: { width: number; height: number },
): Rect {
  return {
    x: camera.x,
    y: camera.y,
    width: viewport.width / camera.zoom,
    height: viewport.height / camera.zoom,
  }
}

/** Camera that centres `rect` in the viewport at the largest zoom that fits. */
export function fitRect(
  rect: Rect,
  viewport: { width: number; height: number },
  maxZoom: number,
): FrameCamera {
  const usableW = viewport.width * (1 - 2 * FIT_PADDING)
  const usableH = viewport.height * (1 - 2 * FIT_PADDING)
  const raw = Math.min(
    usableW / Math.max(rect.width, 1),
    usableH / Math.max(rect.height, 1),
  )
  const zoom = Math.min(maxZoom, Math.max(MIN_ZOOM, raw))
  return {
    x: rect.x + rect.width / 2 - viewport.width / zoom / 2,
    y: rect.y + rect.height / 2 - viewport.height / zoom / 2,
    zoom,
  }
}

function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

export function tileRect(
  grid: Pick<TileGrid, 'tileWidth' | 'tileHeight' | 'originX' | 'originY'>,
  row: number,
  col: number,
): Rect {
  return {
    x: grid.originX + col * grid.tileWidth,
    y: grid.originY + row * grid.tileHeight,
    width: grid.tileWidth,
    height: grid.tileHeight,
  }
}

/** Lay a zoom-1.0 tile grid over `bounds`, one tile per viewport. */
export function buildTileGrid(
  bounds: Rect,
  viewport: { width: number; height: number },
  rects: Iterable<Rect>,
): TileGrid {
  const originX = bounds.x - TILE_MARGIN
  const originY = bounds.y - TILE_MARGIN
  const cols = Math.max(
    1,
    Math.ceil((bounds.width + 2 * TILE_MARGIN) / viewport.width),
  )
  const rows = Math.max(
    1,
    Math.ceil((bounds.height + 2 * TILE_MARGIN) / viewport.height),
  )
  const grid: TileGrid = {
    cols,
    rows,
    tileWidth: viewport.width,
    tileHeight: viewport.height,
    originX,
    originY,
    occupied: [],
  }
  const list = [...rects]
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tile = tileRect(grid, row, col)
      if (list.some((r) => intersects(tile, r))) grid.occupied.push([row, col])
    }
  }
  return grid
}

/** Parse the `tile=row,col` search param. Null when absent or malformed. */
export function parseTile(
  raw: string | undefined,
): { row: number; col: number } | null {
  if (!raw) return null
  const match = /^(\d{1,3}),(\d{1,3})$/.exec(raw)
  if (!match) return null
  return { row: Number(match[1]), col: Number(match[2]) }
}

/** Parse the `focus=id,id` search param into trimmed, non-empty ids. */
export function parseFocusIds(raw: string | undefined): Array<string> {
  if (!raw) return []
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
}

/**
 * Decide the camera for a framing request, and report what it shows.
 * Returns `{ error }` for an unknown focus id or an out-of-range tile.
 */
export function planFrame(req: FrameRequest): FramePlan {
  const { mode, focusIds, tile, rects, viewport } = req
  const boardBounds = unionRects(rects.values())
  const tileGrid = boardBounds
    ? buildTileGrid(boardBounds, viewport, rects.values())
    : null

  let camera: FrameCamera
  if (mode === 'focus') {
    if (focusIds.length === 0) return { error: 'focus-empty' }
    const picked: Array<Rect> = []
    for (const id of focusIds) {
      const rect = rects.get(id)
      if (!rect) return { error: `unknown-focus:${id}` }
      picked.push(rect)
    }
    camera = fitRect(unionRects(picked)!, viewport, FOCUS_MAX_ZOOM)
  } else if (mode === 'tile') {
    if (!tile) return { error: 'invalid-tile' }
    if (!tileGrid) return { error: 'empty-board' }
    if (tile.row >= tileGrid.rows || tile.col >= tileGrid.cols) {
      return { error: `invalid-tile:${tile.row},${tile.col}` }
    }
    const rect = tileRect(tileGrid, tile.row, tile.col)
    camera = { x: rect.x, y: rect.y, zoom: 1 }
  } else {
    camera = boardBounds
      ? fitRect(boardBounds, viewport, FIT_MAX_ZOOM)
      : { x: 0, y: 0, zoom: 1 }
  }

  return {
    camera,
    worldRect: visibleRect(camera, viewport),
    boardBounds,
    tileGrid,
  }
}

/** Rounded JSON for the `data-world-rect` attribute. */
export function formatWorldRect(rect: Rect): string {
  const r = (n: number) => Math.round(n * 100) / 100
  return JSON.stringify({
    x: r(rect.x),
    y: r(rect.y),
    width: r(rect.width),
    height: r(rect.height),
  })
}

/**
 * Framing request handed to a board component by a render page. The component
 * applies the plan once its viewport is measured, then calls `onFramed`.
 */
export interface RenderFraming {
  mode: FramingMode
  focusIds: Array<string>
  tile: { row: number; col: number } | null
  onFramed: (plan: FramePlan) => void
}
