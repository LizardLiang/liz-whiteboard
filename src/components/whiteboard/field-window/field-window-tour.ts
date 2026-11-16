// src/components/whiteboard/field-window/field-window-tour.ts
// The steps of the field window tour: an intro step (board-entry tour only,
// spotlights a canvas table) and the seven window steps. Targets are read lazily by
// data-testid, scoped to the window the tour explains. Step 4 pans the canvas
// (zoom unchanged) so the table is visible outside the window.

import type { Rect } from '@/components/tutorial/placement'
import type { TourStep } from '@/components/tutorial/use-spotlight-tour'
import type { TFunction } from '@/lib/i18n/translate'

export const TOUR_STEP_COUNT = 7
/** The board-entry tour adds the intro step in front of the window steps. */
export const ENTRY_TOUR_STEP_COUNT = TOUR_STEP_COUNT + 1

/** Space the app header takes at the top of the viewport (px). */
const HEADER_RESERVE_PX = 64
/** Free space kept around the table inside a free area (px). */
const TABLE_MARGIN_PX = 12
const PAN_DURATION_MS = 200

export type TablePanPlan =
  { kind: 'keep' } | { kind: 'pan'; dx: number; dy: number } | { kind: 'none' }

function intersects(a: Rect, b: Rect): boolean {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  )
}

function inside(inner: Rect, outer: Rect): boolean {
  return (
    inner.left >= outer.left &&
    inner.top >= outer.top &&
    inner.left + inner.width <= outer.left + outer.width &&
    inner.top + inner.height <= outer.top + outer.height
  )
}

/**
 * Decide how to pan so `table` (screen rect) is fully visible, outside
 * `win`, below the header and above the toolbar. `keep` = already fine,
 * `pan` = shift the canvas by (dx, dy) so the table centres in the largest
 * free area, `none` = no free area can show the table.
 */
export function planTablePan(input: {
  viewport: { width: number; height: number }
  win: Rect | null
  table: Rect
  bottomReserve: number
}): TablePanPlan {
  const { viewport, win, table, bottomReserve } = input
  const top = HEADER_RESERVE_PX
  const bottom = viewport.height - bottomReserve
  const work: Rect = {
    left: 0,
    top,
    width: viewport.width,
    height: Math.max(0, bottom - top),
  }
  if (inside(table, work) && !(win && intersects(table, win))) {
    return { kind: 'keep' }
  }
  const candidates: Array<Rect> = win
    ? [
        { left: 0, top, width: win.left, height: work.height },
        {
          left: win.left + win.width,
          top,
          width: viewport.width - (win.left + win.width),
          height: work.height,
        },
        { left: 0, top, width: viewport.width, height: win.top - top },
        {
          left: 0,
          top: win.top + win.height,
          width: viewport.width,
          height: bottom - (win.top + win.height),
        },
      ]
    : [work]
  const needW = table.width + TABLE_MARGIN_PX * 2
  const needH = table.height + TABLE_MARGIN_PX * 2
  let best: Rect | null = null
  for (const c of candidates) {
    if (c.width < needW || c.height < needH) continue
    if (!best || c.width * c.height > best.width * best.height) best = c
  }
  if (!best) return { kind: 'none' }
  return {
    kind: 'pan',
    dx: best.left + best.width / 2 - (table.left + table.width / 2),
    dy: best.top + best.height / 2 - (table.top + table.height / 2),
  }
}

export interface IntroCandidate {
  id: string
  rect: Rect
}

export interface IntroPick {
  id: string
  /** Pan to apply so the table is fully visible; null when it already is. */
  pan: { dx: number; dy: number } | null
}

/**
 * Choose the table the board-entry intro step spotlights: the fully visible
 * table nearest the viewport centre; if none is fully visible, the nearest
 * table that fits the free area, panned (same zoom) into the area's centre.
 */
export function pickIntroTable(input: {
  viewport: { width: number; height: number }
  bottomReserve: number
  tables: Array<IntroCandidate>
}): IntroPick | null {
  const { viewport, bottomReserve, tables } = input
  const cx = viewport.width / 2
  const cy = viewport.height / 2
  const dist = (r: Rect) =>
    Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy)
  const sorted = [...tables].sort((a, b) => dist(a.rect) - dist(b.rect))
  for (const c of sorted) {
    const plan = planTablePan({
      viewport,
      win: null,
      table: c.rect,
      bottomReserve,
    })
    if (plan.kind === 'keep') return { id: c.id, pan: null }
  }
  for (const c of sorted) {
    const plan = planTablePan({
      viewport,
      win: null,
      table: c.rect,
      bottomReserve,
    })
    if (plan.kind === 'pan')
      return { id: c.id, pan: { dx: plan.dx, dy: plan.dy } }
  }
  return null
}

/** The slice of the React Flow instance the tour needs. */
export interface TourFlow {
  getViewport: () => { x: number; y: number; zoom: number }
  setViewport: (
    viewport: { x: number; y: number; zoom: number },
    options?: { duration?: number },
  ) => unknown
  getInternalNode: (id: string) =>
    | {
        internals: { positionAbsolute: { x: number; y: number } }
        measured: { width?: number; height?: number }
      }
    | undefined
}

export interface FieldWindowTourDeps {
  t: TFunction
  /** The window the tour explains; null when it is gone. */
  getWindowEl: () => HTMLElement | null
  /** Node id and name of the table shown in that window. */
  getTable: () => { id: string; name: string } | null
  getFlow: () => TourFlow | null
  /** Viewport space kept free for the bottom toolbar (px). */
  getBottomReserve: () => number
}

function inWindow(deps: FieldWindowTourDeps, testId: string) {
  return () =>
    deps.getWindowEl()?.querySelector(`[data-testid="${testId}"]`) ?? null
}

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

/** Screen rect of a table node, from React Flow's own geometry (works when the node is culled from the DOM). */
export function tableScreenRect(flow: TourFlow, id: string): Rect | null {
  const node = flow.getInternalNode(id)
  const pane = document.querySelector('.react-flow')
  if (!node || !pane) return null
  const { x, y, zoom } = flow.getViewport()
  const origin = pane.getBoundingClientRect()
  const { positionAbsolute } = node.internals
  return {
    left: origin.left + x + positionAbsolute.x * zoom,
    top: origin.top + y + positionAbsolute.y * zoom,
    width: (node.measured.width ?? 0) * zoom,
    height: (node.measured.height ?? 0) * zoom,
  }
}

export function buildFieldWindowTour(
  deps: FieldWindowTourDeps,
): Array<TourStep> {
  const { t } = deps
  // Set by step 4's `before`: no free area can show the table.
  let noSpot = false

  const canvasTarget = () => {
    if (noSpot) return null
    const table = deps.getTable()
    if (!table) return null
    const el = document.querySelector(
      `[data-table-name="${CSS.escape(table.name)}"]`,
    )
    return el?.closest('.react-flow__node') ?? el
  }

  const panToTable = () => {
    noSpot = false
    const table = deps.getTable()
    const flow = deps.getFlow()
    const winEl = deps.getWindowEl()
    if (!table || !flow) return
    const rect = tableScreenRect(flow, table.id)
    if (!rect) return
    const plan = planTablePan({
      viewport: { width: window.innerWidth, height: window.innerHeight },
      win: winEl ? rectOf(winEl) : null,
      table: rect,
      bottomReserve: deps.getBottomReserve(),
    })
    if (plan.kind === 'none') {
      noSpot = true
    } else if (plan.kind === 'pan') {
      const vp = flow.getViewport()
      void flow.setViewport(
        { x: vp.x + plan.dx, y: vp.y + plan.dy, zoom: vp.zoom },
        { duration: PAN_DURATION_MS },
      )
    }
  }

  return [
    {
      id: 'window',
      target: () => deps.getWindowEl(),
      title: t('whiteboard.fieldsTour.windowTitle'),
      body: t('whiteboard.fieldsTour.windowBody'),
    },
    {
      id: 'header',
      target: inWindow(deps, 'table-fields-header'),
      title: t('whiteboard.fieldsTour.headerTitle'),
      body: t('whiteboard.fieldsTour.headerBody'),
    },
    {
      id: 'pin',
      target: inWindow(deps, 'fields-window-pin'),
      title: t('whiteboard.fieldsTour.pinTitle'),
      body: t('whiteboard.fieldsTour.pinBody'),
    },
    {
      id: 'canvas',
      target: canvasTarget,
      title: t('whiteboard.fieldsTour.canvasTitle'),
      body: t('whiteboard.fieldsTour.canvasBody'),
      before: panToTable,
    },
    {
      id: 'mode',
      target: inWindow(deps, 'fields-window-mode'),
      title: t('whiteboard.fieldsTour.modeTitle'),
      body: t('whiteboard.fieldsTour.modeBody'),
    },
    {
      id: 'minimize',
      target: inWindow(deps, 'fields-window-minimize'),
      title: t('whiteboard.fieldsTour.minimizeTitle'),
      body: t('whiteboard.fieldsTour.minimizeBody'),
    },
    {
      id: 'help',
      target: inWindow(deps, 'fields-window-help'),
      title: t('whiteboard.fieldsTour.helpTitle'),
      body: t('whiteboard.fieldsTour.helpBody'),
    },
  ]
}

export interface IntroTourDeps {
  t: TFunction
  /** Canvas tables (node id and name), in board order. */
  getTables: () => Array<{ id: string; name: string }>
  /** The intro table once chosen; null before the intro step runs. */
  getIntroId: () => string | null
  setIntroId: (id: string | null) => void
  /** The field window, when one is open (the intro table may sit under it). */
  getWindowEl: () => HTMLElement | null
  getFlow: () => TourFlow | null
  getBottomReserve: () => number
}

/** Step 1 of the board-entry tour: spotlight one canvas table, announce the feature. */
export function buildIntroStep(deps: IntroTourDeps): TourStep {
  const { t } = deps
  // Set by `before`: the table cannot be shown, so the card is centred.
  let noSpot = false

  const target = () => {
    const id = deps.getIntroId()
    const name = deps.getTables().find((x) => x.id === id)?.name
    if (noSpot || !name) return null
    const el = document.querySelector(`[data-table-name="${CSS.escape(name)}"]`)
    return el?.closest('.react-flow__node') ?? el
  }

  const panIntoView = () => {
    noSpot = false
    const flow = deps.getFlow()
    if (!flow) return
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const bottomReserve = deps.getBottomReserve()
    let pan: { dx: number; dy: number } | null = null
    const known = deps.getIntroId()
    if (known) {
      const rect = tableScreenRect(flow, known)
      if (!rect) return
      const winEl = deps.getWindowEl()
      const plan = planTablePan({
        viewport,
        win: winEl ? rectOf(winEl) : null,
        table: rect,
        bottomReserve,
      })
      if (plan.kind === 'none') noSpot = true
      else if (plan.kind === 'pan') pan = { dx: plan.dx, dy: plan.dy }
    } else {
      const tables = deps.getTables().flatMap((x) => {
        const rect = tableScreenRect(flow, x.id)
        return rect ? [{ id: x.id, rect }] : []
      })
      const pick = pickIntroTable({ viewport, bottomReserve, tables })
      if (!pick) {
        noSpot = true
        return
      }
      deps.setIntroId(pick.id)
      pan = pick.pan
    }
    if (pan) {
      const vp = flow.getViewport()
      void flow.setViewport(
        { x: vp.x + pan.dx, y: vp.y + pan.dy, zoom: vp.zoom },
        { duration: PAN_DURATION_MS },
      )
    }
  }

  return {
    id: 'intro',
    target,
    title: t('whiteboard.fieldsTour.introTitle'),
    body: t('whiteboard.fieldsTour.introBody'),
    before: panIntoView,
  }
}
