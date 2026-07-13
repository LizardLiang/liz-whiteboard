// src/lib/react-flow/canvas-node-metrics.ts
// Table width metrics — one shared offscreen CanvasRenderingContext2D used
// to `measureText` a table's natural width, so canvas mode's DOM strip
// (TableNode's chrome-light wrapper) and CanvasNodeLayer's draw always agree
// on where a column's handle sits (tactical plan Phase 1, "table width"
// locked decision #6). Before this, CanvasNodeLayer read
// `n.measured?.width` — the DOM-measured width of whatever TableNode last
// rendered — which becomes meaningless once TableNode stops rendering full
// column rows under canvas mode. This module is now the ONE width source
// both paths read.
//
// Uses the SAME font strings CanvasNodeLayer's draw loop uses ('600 13px
// Inter...' for the header, '12px Inter...' for rows) so measured widths
// match what actually gets painted. Cached per tableId, validated by
// REFERENCE equality against the `columns` array + headerName + savedWidth
// last used to compute it — not a rebuilt signature string. The app's
// mutation hooks (use-column-mutations.ts, use-table-mutations.ts) always
// replace `table.columns` (and `table` itself) with a fresh array/object on
// any real change and keep the SAME reference otherwise (this is also the
// invariant TableNode's memo comparator relies on via `prev.data.table !==
// next.data.table`) — so a plain `===` check is a correct, O(1) cache-valid
// check with no per-column string concatenation on the hot path. This
// function sits on CanvasNodeLayer's `useStore` selector (a per-store-tick
// hot path — pan/drag/selection), so a cache-hit must stay a cheap
// reference compare, never a full rebuild-and-compare of table content.
// Still respects the existing `Math.max(DEFAULT_W, table.width ?? 0)` floor
// (the user's manually-saved width always wins as a minimum).
import { BADGE_ZONE, DEFAULT_W, NOTE_RESERVE } from './canvas-node-geometry'
import type { Column } from '@/data/models'

const HEADER_FONT = '600 13px Inter, system-ui, sans-serif'
const ROW_FONT = '12px Inter, system-ui, sans-serif'

// Layout constants mirrored from CanvasNodeLayer's draw loop: PAD_X on both
// sides, the fixed constraint-badge zone (PK/FK/N/U) before the column name,
// a gap between the name and the right-aligned data type, and the field-note
// indicator reserve at the far right.
const PAD_X = 12
const NAME_TYPE_GAP = 16

let sharedCtx: CanvasRenderingContext2D | null = null

function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null
  if (!sharedCtx) {
    const canvas = document.createElement('canvas')
    sharedCtx = canvas.getContext('2d')
  }
  return sharedCtx
}

function measureNaturalWidth(
  ctx: CanvasRenderingContext2D,
  headerName: string,
  columns: Array<Column>,
): number {
  ctx.font = HEADER_FONT
  let maxWidth = ctx.measureText(headerName).width + PAD_X * 2

  ctx.font = ROW_FONT
  for (const col of columns) {
    const nameWidth = ctx.measureText(col.name).width
    const typeWidth = ctx.measureText(col.dataType).width
    const rowWidth =
      PAD_X +
      BADGE_ZONE +
      nameWidth +
      NAME_TYPE_GAP +
      typeWidth +
      NOTE_RESERVE +
      PAD_X
    if (rowWidth > maxWidth) maxWidth = rowWidth
  }

  return Math.ceil(maxWidth)
}

interface WidthCacheEntry {
  columns: Array<Column>
  headerName: string
  savedWidth: number | null | undefined
  width: number
}

const widthCache = new Map<string, WidthCacheEntry>()

function isCacheValid(
  entry: WidthCacheEntry,
  headerName: string,
  columns: Array<Column>,
  savedWidth: number | null | undefined,
): boolean {
  return (
    entry.columns === columns &&
    entry.headerName === headerName &&
    entry.savedWidth === savedWidth
  )
}

/**
 * Cached natural width for a table, shared by CanvasNodeLayer's draw and
 * TableNode's chrome-light wrapper. `columns` should be the table's FULL
 * column list (not showMode-filtered) — width must fit whichever showMode
 * is active at any time, since the cache is keyed per table, not per
 * showMode.
 */
export function getCachedTableWidth(
  tableId: string,
  headerName: string,
  columns: Array<Column>,
  savedWidth: number | null | undefined,
): number {
  const floor = Math.max(DEFAULT_W, savedWidth ?? 0)
  const cached = widthCache.get(tableId)
  if (cached && isCacheValid(cached, headerName, columns, savedWidth)) {
    return Math.max(floor, cached.width)
  }

  const ctx = getMeasureCtx()
  if (!ctx) {
    // SSR / no canvas support — return the floor WITHOUT caching. Caching a
    // floor-only value here would short-circuit a later client render (once
    // `document` exists) into never attempting the real `measureText` pass,
    // since a cached entry would then look valid until columns/name/width
    // actually change again.
    return floor
  }

  const natural = measureNaturalWidth(ctx, headerName, columns)
  const width = Math.max(floor, natural)
  widthCache.set(tableId, { columns, headerName, savedWidth, width })
  return width
}

/**
 * Evict a table's cached width. Call this whenever a table is deleted so
 * `widthCache` doesn't grow unbounded over a long session (it's a
 * module-level Map keyed by tableId with no other eviction path).
 */
export function evictTableWidth(tableId: string): void {
  widthCache.delete(tableId)
}
