// Viewport culling: what is skipped, what must never be, and that the export
// path (no cull rect) still draws everything.
import { describe, expect, it } from 'vitest'
import {
  CULL_MARGIN_PX,
  cullRectFor,
  drawScene,
  rectsOverlap,
  renderPersistentScene,
} from './render'
import { DEFAULT_ELEMENT_STYLE, sceneFrom } from './scene'
import { cellKey, createTable, tableSize } from './table'
import type { PersistentRenderTarget } from './render-target'
import type { CanvasConnectorRouting, CanvasElement } from './scene'
import type { Camera } from './camera'
import type { RenderSelection, Viewport } from './render'

/** A target that records the x of every rect / ellipse and line it is given. */
function recorder() {
  const xs: Array<number> = []
  const texts: Array<string> = []
  const noop = () => {}
  const target: PersistentRenderTarget = {
    measureText: (text) => text.length * 8,
    rect: (x) => void xs.push(x),
    ellipse: (cx) => void xs.push(cx),
    beginPath: noop,
    moveTo: (x) => void xs.push(x),
    lineTo: noop,
    cubicTo: noop,
    closePath: noop,
    paintPath: noop,
    beginText: noop,
    textLine: (text) => void texts.push(text),
    textPiece: (text) => void texts.push(text),
    textDecoration: noop,
    endText: noop,
    beginFade: noop,
    endFade: noop,
  }
  return { target, xs, texts }
}

function el(id: string, patch: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id,
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    zIndex: 0,
    text: null,
    style: { ...DEFAULT_ELEMENT_STYLE, cornerRadius: 0 },
    ...patch,
  }
}

function conn(
  id: string,
  from: string,
  to: string,
  routing: CanvasConnectorRouting = 'straight',
): CanvasElement {
  return el(id, {
    kind: 'connector',
    width: 1,
    height: 1,
    connector: {
      source: { kind: 'element', elementId: from },
      target: { kind: 'element', elementId: to },
      routing,
    },
  })
}

const VIEWPORT: Viewport = { width: 800, height: 600, devicePixelRatio: 1 }
const CAMERA: Camera = { x: 0, y: 0, zoom: 1 }
const CULL = cullRectFor(CAMERA, VIEWPORT)

function draw(
  scene: ReturnType<typeof sceneFrom>,
  cull?: typeof CULL,
  extra: { emphasized?: Array<string>; layoutId?: string } = {},
) {
  const rec = recorder()
  renderPersistentScene(
    rec.target,
    scene,
    'light',
    new Set(extra.emphasized ?? []),
    extra.layoutId,
    undefined,
    undefined,
    null,
    'classic',
    null,
    undefined,
    1,
    cull,
  )
  return rec
}

describe('cullRectFor', () => {
  it('is the visible rect grown by the margin', () => {
    expect(CULL).toEqual({
      x: -CULL_MARGIN_PX,
      y: -CULL_MARGIN_PX,
      width: 800 + CULL_MARGIN_PX * 2,
      height: 600 + CULL_MARGIN_PX * 2,
    })
  })

  it('keeps a screen-pixel margin at other zooms', () => {
    const rect = cullRectFor({ x: 100, y: 50, zoom: 0.5 }, VIEWPORT)
    expect(rect.x).toBe(100 - CULL_MARGIN_PX / 0.5)
    expect(rect.width).toBe(1600 + (CULL_MARGIN_PX / 0.5) * 2)
  })
})

describe('rectsOverlap', () => {
  it('is true for inside, straddling and touching, false for apart', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 }
    expect(rectsOverlap(a, { x: 2, y: 2, width: 3, height: 3 })).toBe(true)
    expect(rectsOverlap(a, { x: 8, y: 8, width: 10, height: 10 })).toBe(true)
    expect(rectsOverlap(a, { x: 10, y: 0, width: 5, height: 5 })).toBe(true)
    expect(rectsOverlap(a, { x: 11, y: 0, width: 5, height: 5 })).toBe(false)
  })
})

describe('element culling', () => {
  const scene = sceneFrom([
    el('in', { x: 100, y: 100 }),
    el('partial', { x: 750, y: 550 }),
    el('margin', { x: 820, y: 100 }),
    el('far', { x: 5000, y: 5000 }),
    el('left', { x: -3000, y: 100 }),
  ])

  it('draws everything without a cull rect', () => {
    expect(draw(scene).xs.sort((a, b) => a - b)).toEqual([
      -3000, 100, 750, 820, 5000,
    ])
  })

  it('keeps in-view, partly-in and in-margin elements, drops the rest', () => {
    expect(draw(scene, CULL).xs.sort((a, b) => a - b)).toEqual([100, 750, 820])
  })

  it('keeps the paint order of the survivors', () => {
    const ordered = sceneFrom([
      el('c', { x: 300, y: 0, zIndex: 3 }),
      el('gone', { x: 9000, y: 0, zIndex: 4 }),
      el('a', { x: 100, y: 0, zIndex: 5 }),
    ])
    expect(draw(ordered, CULL).xs).toEqual([300, 100])
  })

  it('never culls a selected or hovered element', () => {
    expect(
      draw(scene, CULL, { emphasized: ['far'] }).xs.sort((a, b) => a - b),
    ).toContain(5000)
  })

  it('never culls the element whose layout was requested', () => {
    const text = sceneFrom([el('far', { x: 5000, y: 5000, text: 'abc' })])
    expect(draw(text, CULL, { layoutId: 'far' }).texts).toEqual(['abc'])
  })

  it('keeps a rotated element whose corner swings into view', () => {
    const rotated = sceneFrom([
      // Unrotated, the box ends at x = -80, left of the cull edge at -64.
      // Its half-diagonal (about 400) reaches across when it turns.
      el('r', { x: -100, y: 0, width: 20, height: 800, rotation: 45 }),
    ])
    expect(draw(rotated, CULL).xs).toEqual([-100])
    expect(
      draw(sceneFrom([{ ...rotated.elements[0], rotation: 0 }]), CULL).xs,
    ).toEqual([])
  })

  it('keeps an element whose thick stroke reaches the margin', () => {
    const thick = sceneFrom([
      el('s', {
        x: 800 + CULL_MARGIN_PX + 40,
        y: 0,
        style: { ...DEFAULT_ELEMENT_STYLE, cornerRadius: 0, strokeWidth: 60 },
      }),
    ])
    expect(draw(thick, CULL).xs).toHaveLength(1)
  })

  it('keeps a shape above the view whose text runs down into it', () => {
    const tall = sceneFrom([
      el('above', {
        x: 100,
        y: -2000,
        width: 120,
        height: 40,
        kind: 'text',
        // Narrow frame, so this wraps to far more than the 40px box.
        text: Array.from({ length: 400 }, () => 'word').join(' '),
      }),
      el('short', {
        x: 100,
        y: -2000,
        width: 120,
        height: 40,
        kind: 'text',
        text: 'hi',
      }),
    ])
    const out = draw(tall, CULL)
    expect(out.texts.length).toBeGreaterThan(1)
    expect(out.texts.join(' ')).toContain('word')
    expect(out.texts).not.toContain('hi')
  })

  it('does not lay out or draw text of a far element', () => {
    const far = sceneFrom([el('far', { x: 5000, y: 5000, text: 'abc' })])
    expect(draw(far, CULL).texts).toEqual([])
  })
})

describe('connector culling', () => {
  it('keeps a connector whose ends are both off-screen but crosses the view', () => {
    const scene = sceneFrom([
      el('a', { x: -2000, y: 250, width: 50, height: 50 }),
      el('b', { x: 3000, y: 250, width: 50, height: 50 }),
      conn('ab', 'a', 'b'),
    ])
    const rec = draw(scene, CULL)
    // The connector's moveTo starts at the clipped edge of 'a'.
    expect(rec.xs).toContain(-1950)
  })

  it('drops a connector wholly outside the view', () => {
    const scene = sceneFrom([
      el('a', { x: 3000, y: 3000 }),
      el('b', { x: 4000, y: 3000 }),
      conn('ab', 'a', 'b'),
    ])
    expect(draw(scene, CULL).xs).toEqual([])
    expect(draw(scene).xs.length).toBeGreaterThan(0)
  })

  it('keeps a curved connector that bows into the view', () => {
    const scene = sceneFrom([
      el('a', { x: -1500, y: -1200, width: 50, height: 50 }),
      el('b', { x: 2300, y: -1200, width: 50, height: 50 }),
      conn('ab', 'a', 'b', 'curved'),
    ])
    // Both ends are far above and either side of the default view. A view
    // framed around the curve keeps the connector.
    const tall: Viewport = { ...VIEWPORT, height: 3000 }
    const wide = cullRectFor({ x: 0, y: -1500, zoom: 1 }, tall)
    expect(draw(scene, wide).xs.length).toBeGreaterThan(0)
  })

  it('keeps an elbow connector that turns inside the view', () => {
    const scene = sceneFrom([
      el('a', { x: -2000, y: 100, width: 50, height: 50 }),
      el('b', { x: 2000, y: 400, width: 50, height: 50 }),
      conn('ab', 'a', 'b', 'elbow'),
    ])
    // Both end shapes are off-screen and skipped; the line and its arrowhead
    // (a moveTo each) are drawn because the path runs through the view.
    expect(draw(scene, CULL).xs).toHaveLength(2)
  })
})

describe('table culling', () => {
  let n = 0
  const grid = createTable(40, 2, () => `id${(n += 1)}`)
  const cells = Object.fromEntries(
    grid.rows.flatMap((row) =>
      grid.cols.map((col) => [cellKey(row.id, col.id), { text: 'cell' }]),
    ),
  )
  const size = tableSize(grid)
  const table = {
    ...el('t', { kind: 'table', x: 0, y: 0, ...size }),
    table: { ...grid, cells },
  }

  it('draws fewer cells when only part of a tall table is in view', () => {
    const scene = sceneFrom([table])
    const full = draw(scene)
    const culled = draw(scene, CULL)
    expect(culled.xs.length).toBeGreaterThan(0)
    expect(culled.xs.length).toBeLessThan(full.xs.length)
    expect(culled.texts.length).toBeGreaterThan(0)
    expect(culled.texts.length).toBeLessThan(full.texts.length)
  })

  it('drops a table that is wholly off-screen', () => {
    const scene = sceneFrom([{ ...table, x: 9000 }])
    expect(draw(scene, CULL).xs).toEqual([])
  })
})

describe('drawScene', () => {
  const selection: RenderSelection = { ids: new Set<string>() }
  const scene = sceneFrom([
    el('in', { x: 100, y: 100 }),
    el('far', { x: 5000, y: 5000 }),
  ])

  function rectsDrawn(cull?: boolean) {
    const fills: Array<number> = []
    const ctx = {
      canvas: { width: 0, height: 0, style: {} },
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      save() {},
      restore() {},
      setTransform() {},
      clearRect() {},
      scale() {},
      translate() {},
      beginPath() {},
      closePath() {},
      arcTo() {},
      setLineDash() {},
      moveTo() {},
      lineTo() {},
      arc() {},
      fill() {},
      stroke() {},
      fillText() {},
      strokeRect() {},
      fillRect(x: number) {
        fills.push(x)
      },
      measureText: (t: string) => ({ width: t.length * 8 }),
    } as unknown as CanvasRenderingContext2D
    drawScene(ctx, scene, CAMERA, VIEWPORT, selection, { cull })
    return fills
  }

  it('culls by default', () => {
    expect(rectsDrawn()).toEqual([100])
  })

  it('draws the whole scene when cull is off (server render)', () => {
    expect(rectsDrawn(false).sort((a, b) => a - b)).toEqual([100, 5000])
  })
})
