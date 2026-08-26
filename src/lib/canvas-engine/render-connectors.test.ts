// src/lib/canvas-engine/render-connectors.test.ts
// Renderer coverage for connectors and creation handles (canvas
// quick-create-handles tactical plan, Wave 3, step 8).
//
// Same recording-stub approach as render.test.ts, and the same limits: none
// of this says the board LOOKS right. What it does pin down are the three
// properties that are invisible until they are catastrophic and have no other
// detector:
//
//   - connectors paint BEFORE everything else, because `hit-test.ts` scans
//     them second and the two must agree or clicking a rectangle sometimes
//     selects the arrow behind it;
//   - creation handles clear the resize grips at every zoom, because two
//     overlapping hit rectangles look completely correct and silently steal
//     each other's presses;
//   - a connector never gets resize grips and never gets a rectangle
//     outline, because its stored bounds are a 1x1 placeholder that would
//     draw both at the origin.

import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_ENDS,
  CREATION_HANDLE_DIRECTIONS,
  CREATION_HANDLE_HIT,
  CREATION_HANDLE_OFFSET,
  RESIZE_HANDLES,
  connectorEndpointRects,
  creationHandleRects,
  creationHandleTarget,
  drawScene,
  handleRects,
} from './render'
import { connectorPathOf } from './hit-test'
import { DEFAULT_ELEMENT_STYLE, sceneFrom } from './scene'
import type { RenderSelection, ScreenRect, Viewport } from './render'
import type { Camera } from './camera'
import type { CanvasConnectorRouting, CanvasElement } from './scene'

interface Op {
  op: string
  args: Array<unknown>
}

function createRecorder() {
  const ops: Array<Op> = []
  let width = 0
  let height = 0
  let currentFont = '16px sans-serif'

  const canvas = {
    get width() {
      return width
    },
    set width(value: number) {
      width = value
    },
    get height() {
      return height
    },
    set height(value: number) {
      height = value
    },
  }

  const record =
    (op: string) =>
    (...args: Array<unknown>) => {
      ops.push({ op, args })
    }

  const ctx = {
    canvas,
    get font() {
      return currentFont
    },
    set font(value: string) {
      currentFont = value
    },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save: record('save'),
    restore: record('restore'),
    setTransform: record('setTransform'),
    clearRect: record('clearRect'),
    scale: record('scale'),
    translate: record('translate'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    setLineDash: record('setLineDash'),
    moveTo(...args: Array<unknown>) {
      ops.push({ op: 'moveTo', args: [...args, this.strokeStyle] })
    },
    lineTo(...args: Array<unknown>) {
      ops.push({ op: 'lineTo', args: [...args, this.strokeStyle] })
    },
    arc(...args: Array<unknown>) {
      ops.push({ op: 'arc', args: [...args, this.fillStyle] })
    },
    fill(...args: Array<unknown>) {
      ops.push({ op: 'fill', args: [...args, this.fillStyle] })
    },
    stroke(...args: Array<unknown>) {
      ops.push({ op: 'stroke', args: [...args, this.lineWidth] })
    },
    fillRect(...args: Array<unknown>) {
      ops.push({ op: 'fillRect', args: [...args, this.fillStyle] })
    },
    strokeRect(...args: Array<unknown>) {
      ops.push({ op: 'strokeRect', args: [...args, this.strokeStyle] })
    },
    fillText(...args: Array<unknown>) {
      ops.push({ op: 'fillText', args: [...args, this.fillStyle] })
    },
    measureText(text: string) {
      return { width: text.length * 8 }
    },
  }

  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    ops,
    opsOfType: (op: string) => ops.filter((entry) => entry.op === op),
    indexOf: (op: string) => ops.findIndex((entry) => entry.op === op),
  }
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
    style: { ...DEFAULT_ELEMENT_STYLE },
    ...patch,
  }
}

function conn(
  id: string,
  sourceId: string,
  targetId: string,
  routing: CanvasConnectorRouting = 'straight',
  patch: Partial<CanvasElement> = {},
): CanvasElement {
  return el(id, {
    kind: 'connector',
    // The degenerate placeholder a connector actually stores, deliberately
    // nowhere near the line it draws.
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    connector: {
      source: { kind: 'element', elementId: sourceId },
      target: { kind: 'element', elementId: targetId },
      routing,
    },
    ...patch,
  })
}

const VIEWPORT: Viewport = { width: 800, height: 600, devicePixelRatio: 1 }
const CAMERA: Camera = { x: 0, y: 0, zoom: 1 }
const NONE: RenderSelection = { ids: new Set<string>() }

/** 'a' at 0..100, 'b' at 300..400. The connector runs along y=50. */
const LINEAR = sceneFrom([
  el('a', { x: 0, y: 0, zIndex: 0 }),
  el('b', { x: 300, y: 0, zIndex: 1 }),
  conn('ab', 'a', 'b', 'straight', { zIndex: 2 }),
])

function rectsOverlap(a: ScreenRect, b: ScreenRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

// ───────────────────────────────────────────────────────────────────────────

describe('two-pass paint order', () => {
  it('draws every connector before any rectangle', () => {
    const rec = createRecorder()
    drawScene(rec.ctx, LINEAR, CAMERA, VIEWPORT, NONE)

    // The connector is the only thing that strokes a path in the world pass;
    // the rectangles fill. The connector's stroke must precede both fills.
    const firstStroke = rec.indexOf('stroke')
    const firstFillRect = rec.indexOf('fillRect')
    expect(firstStroke).toBeGreaterThan(-1)
    expect(firstFillRect).toBeGreaterThan(-1)
    expect(firstStroke).toBeLessThan(firstFillRect)
  })

  it('keeps connectors underneath even when their z-index is highest', () => {
    // This is the whole point: z-order governs WITHIN each pass, never across
    // them. A connector with the top z still paints first.
    const rec = createRecorder()
    const topZ = sceneFrom([
      el('a', { x: 0, y: 0, zIndex: 0 }),
      el('b', { x: 300, y: 0, zIndex: 1 }),
      conn('ab', 'a', 'b', 'straight', { zIndex: 999 }),
    ])
    drawScene(rec.ctx, topZ, CAMERA, VIEWPORT, NONE)
    expect(rec.indexOf('stroke')).toBeLessThan(rec.indexOf('fillRect'))
  })

  it('still paints rectangles among themselves in z-order', () => {
    const rec = createRecorder()
    const stacked = sceneFrom([
      el('under', { x: 0, y: 0, zIndex: 0, style: { ...DEFAULT_ELEMENT_STYLE, fill: '#111111' } }),
      el('over', { x: 0, y: 0, zIndex: 5, style: { ...DEFAULT_ELEMENT_STYLE, fill: '#222222' } }),
    ])
    drawScene(rec.ctx, stacked, CAMERA, VIEWPORT, NONE)
    const fills = rec.opsOfType('fillRect').map((entry) => entry.args[4])
    expect(fills).toEqual(['#111111', '#222222'])
  })
})

describe('drawing a connector', () => {
  it('strokes the derived path, not the placeholder bounds', () => {
    const rec = createRecorder()
    drawScene(rec.ctx, LINEAR, CAMERA, VIEWPORT, NONE)
    const moves = rec.opsOfType('moveTo')
    // World coordinates, under the camera transform: the line starts at the
    // source's right border (100, 50) — never at the placeholder's (0, 0).
    expect(moves[0].args.slice(0, 2)).toEqual([100, 50])
  })

  it('fills a target-end arrowhead', () => {
    const rec = createRecorder()
    drawScene(rec.ctx, LINEAR, CAMERA, VIEWPORT, NONE)
    // closePath + fill is the arrowhead triangle; nothing else in a plain
    // scene closes a path.
    expect(rec.opsOfType('closePath').length).toBe(1)
    expect(rec.opsOfType('fill').length).toBe(1)
  })

  it('draws the arrowhead in the stroke colour, not the fill colour', () => {
    // The engine's default fill is a near-transparent tint meant to sit
    // behind text; an arrowhead painted in it would be invisible.
    const rec = createRecorder()
    drawScene(rec.ctx, LINEAR, CAMERA, VIEWPORT, NONE)
    expect(rec.opsOfType('fill')[0].args[0]).toBe(DEFAULT_ELEMENT_STYLE.stroke)
  })

  it('draws nothing at all when an endpoint is missing', () => {
    const rec = createRecorder()
    const orphaned = sceneFrom([el('a', { x: 0, y: 0 }), conn('ab', 'a', 'ghost')])
    drawScene(rec.ctx, orphaned, CAMERA, VIEWPORT, NONE)
    expect(rec.opsOfType('moveTo')).toEqual([])
    expect(rec.opsOfType('fill')).toEqual([])
  })

  it('draws nothing when the two endpoints are concentric', () => {
    const rec = createRecorder()
    const stacked = sceneFrom([
      el('a', { x: 0, y: 0 }),
      el('b', { x: 0, y: 0 }),
      conn('ab', 'a', 'b'),
    ])
    drawScene(rec.ctx, stacked, CAMERA, VIEWPORT, NONE)
    expect(rec.opsOfType('moveTo')).toEqual([])
  })

  it('draws an elbow connector with its bend', () => {
    const rec = createRecorder()
    const bent = sceneFrom([
      el('a', { x: 0, y: 0 }),
      el('b', { x: 300, y: 200 }),
      conn('ab', 'a', 'b', 'elbow'),
    ])
    drawScene(rec.ctx, bent, CAMERA, VIEWPORT, NONE)
    // Four path points: one moveTo plus three lineTo, before the arrowhead's
    // own two lineTo calls.
    expect(rec.opsOfType('moveTo').length).toBeGreaterThanOrEqual(1)
    expect(rec.opsOfType('lineTo').length).toBeGreaterThanOrEqual(5)
  })
})

describe('selecting a connector', () => {
  const selected: RenderSelection = { ids: new Set(['ab']) }

  it('never draws resize grips for it', () => {
    const rec = createRecorder()
    drawScene(rec.ctx, LINEAR, CAMERA, VIEWPORT, selected)
    // Grips are the only thing that fillRects in the overlay; the two
    // rectangles' own fills are the only fillRects in a connector-selected
    // scene. Eight more would be the grips.
    expect(rec.opsOfType('fillRect').length).toBe(2)
  })

  it('never draws a rectangle outline for it', () => {
    // Its stored bounds are 1x1 at the origin — an outline would be a dot in
    // the corner of the board. Compared against the unselected baseline
    // rather than asserted as zero, because `strokeRect` is also how a
    // rectangle paints its OWN border.
    const baseline = createRecorder()
    drawScene(baseline.ctx, LINEAR, CAMERA, VIEWPORT, NONE)
    const rec = createRecorder()
    drawScene(rec.ctx, LINEAR, CAMERA, VIEWPORT, selected)
    expect(rec.opsOfType('strokeRect').length).toBe(
      baseline.opsOfType('strokeRect').length,
    )
  })

  it('re-strokes its path in screen space at a constant width', () => {
    const near = createRecorder()
    drawScene(near.ctx, LINEAR, { x: 0, y: 0, zoom: 0.5 }, VIEWPORT, selected)
    const far = createRecorder()
    drawScene(far.ctx, LINEAR, { x: 0, y: 0, zoom: 2 }, VIEWPORT, selected)

    // The LAST stroke of each frame is the selection highlight (the data
    // stroke comes first, under the transform). Its width must not change
    // with zoom — that is what "affordances live in screen space" means.
    const widthOf = (rec: ReturnType<typeof createRecorder>) => {
      const strokes = rec.opsOfType('stroke')
      return strokes[strokes.length - 1].args[0]
    }
    expect(widthOf(near)).toBe(widthOf(far))
  })

  it('still draws grips for a selected rectangle', () => {
    const rec = createRecorder()
    drawScene(rec.ctx, LINEAR, CAMERA, VIEWPORT, { ids: new Set(['a']) })
    // 2 element fills + 8 grips.
    expect(rec.opsOfType('fillRect').length).toBe(2 + RESIZE_HANDLES.length)
  })
})

describe('creationHandleRects', () => {
  const rect = { x: 0, y: 0, width: 100, height: 100 }

  it('returns one hit rect per direction, at the hit size', () => {
    const rects = creationHandleRects(CAMERA, rect)
    for (const direction of CREATION_HANDLE_DIRECTIONS) {
      expect(rects[direction].width).toBe(CREATION_HANDLE_HIT)
      expect(rects[direction].height).toBe(CREATION_HANDLE_HIT)
    }
  })

  it('places each handle outside its own edge', () => {
    const rects = creationHandleRects(CAMERA, rect)
    const centre = (r: ScreenRect) => ({
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
    })
    expect(centre(rects.top)).toEqual({ x: 50, y: -CREATION_HANDLE_OFFSET })
    expect(centre(rects.bottom)).toEqual({ x: 50, y: 100 + CREATION_HANDLE_OFFSET })
    expect(centre(rects.left)).toEqual({ x: -CREATION_HANDLE_OFFSET, y: 50 })
    expect(centre(rects.right)).toEqual({ x: 100 + CREATION_HANDLE_OFFSET, y: 50 })
  })

  it('never overlaps a resize grip, at any zoom', () => {
    // Two overlapping hit rectangles look completely correct and silently
    // steal each other's presses. This is the assertion that keeps
    // CREATION_HANDLE_OFFSET honest rather than the comment next to it.
    for (const zoom of [0.1, 0.5, 1, 1.5, 2]) {
      const camera: Camera = { x: 0, y: 0, zoom }
      const grips = handleRects(camera, rect)
      const creates = creationHandleRects(camera, rect)
      for (const direction of CREATION_HANDLE_DIRECTIONS) {
        for (const grip of RESIZE_HANDLES) {
          expect(
            rectsOverlap(creates[direction], grips[grip]),
            `${direction} handle overlaps ${grip} grip at zoom ${zoom}`,
          ).toBe(false)
        }
      }
    }
  })

  it('keeps a constant screen size while the element scales', () => {
    const small = creationHandleRects({ x: 0, y: 0, zoom: 0.25 }, rect)
    const large = creationHandleRects({ x: 0, y: 0, zoom: 2 }, rect)
    expect(small.right.width).toBe(large.right.width)
    expect(small.right.height).toBe(large.right.height)
  })

  it('follows the camera', () => {
    const panned = creationHandleRects({ x: 10, y: 20, zoom: 1 }, rect)
    const origin = creationHandleRects(CAMERA, rect)
    expect(panned.right.x).toBe(origin.right.x - 10)
    expect(panned.right.y).toBe(origin.right.y - 20)
  })
})

describe('creationHandleTarget', () => {
  it('is the single selected element', () => {
    expect(
      creationHandleTarget(LINEAR, { ids: new Set(['a']) })?.id,
    ).toBe('a')
  })

  it('is the hovered element when nothing is selected', () => {
    expect(
      creationHandleTarget(LINEAR, { ids: new Set<string>(), hoveredId: 'b' })
        ?.id,
    ).toBe('b')
  })

  it('prefers the selection over the hover', () => {
    expect(
      creationHandleTarget(LINEAR, { ids: new Set(['a']), hoveredId: 'b' })?.id,
    ).toBe('a')
  })

  it('is null for a multi-selection', () => {
    expect(
      creationHandleTarget(LINEAR, { ids: new Set(['a', 'b']) }),
    ).toBeNull()
  })

  it('is null for a connector', () => {
    expect(creationHandleTarget(LINEAR, { ids: new Set(['ab']) })).toBeNull()
    expect(
      creationHandleTarget(LINEAR, { ids: new Set<string>(), hoveredId: 'ab' }),
    ).toBeNull()
  })

  it('is null while a gesture already owns the pointer', () => {
    const base = { ids: new Set(['a']) }
    expect(
      creationHandleTarget(LINEAR, {
        ...base,
        editing: { elementId: 'a', caret: 0, caretVisible: true },
      }),
    ).toBeNull()
    expect(
      creationHandleTarget(LINEAR, {
        ...base,
        marquee: { x: 0, y: 0, width: 10, height: 10 },
      }),
    ).toBeNull()
    expect(
      creationHandleTarget(LINEAR, { ...base, draft: el('draft') }),
    ).toBeNull()
    expect(
      creationHandleTarget(LINEAR, {
        ...base,
        quickCreate: { fromId: 'a', toWorld: { x: 0, y: 0 } },
      }),
    ).toBeNull()
  })

  it('is null for an id that is no longer in the scene', () => {
    expect(
      creationHandleTarget(LINEAR, { ids: new Set<string>(), hoveredId: 'gone' }),
    ).toBeNull()
  })
})

describe('drawing creation handles', () => {
  it('draws four circles around the target', () => {
    const rec = createRecorder()
    drawScene(rec.ctx, LINEAR, CAMERA, VIEWPORT, { ids: new Set(['a']) })
    expect(rec.opsOfType('arc').length).toBe(4)
  })

  it('draws none when nothing is selected or hovered', () => {
    const rec = createRecorder()
    drawScene(rec.ctx, LINEAR, CAMERA, VIEWPORT, NONE)
    expect(rec.opsOfType('arc')).toEqual([])
  })

  it('draws none for a selected connector — but does draw its two endpoint grips', () => {
    // A connector gets no CREATION handles (four circles on an element's edge
    // midpoints): its own bounds are a 1x1 placeholder, so they would all pile
    // onto one point. It does now get the two ENDPOINT grips that move its
    // ends, which are also circles — so this counts them rather than asserting
    // no arcs at all, which would have silently started passing for the wrong
    // reason the moment either affordance changed.
    const rec = createRecorder()
    drawScene(rec.ctx, LINEAR, CAMERA, VIEWPORT, { ids: new Set(['ab']) })
    const arcs = rec.opsOfType('arc')
    expect(arcs.length).toBe(2)

    // And they sit exactly where `connectorEndpointRects` says — the same
    // rectangles input hit-tests.
    const path = connectorPathOf(LINEAR, LINEAR.byId.get('ab')!)!
    const grips = connectorEndpointRects(CAMERA, path)!
    const centres = arcs
      .map((op) => `${op.args[0]},${op.args[1]}`)
      .sort()
    expect(centres).toEqual(
      CONNECTOR_ENDS.map((end) => {
        const rect = grips[end]
        return `${rect.x + rect.width / 2},${rect.y + rect.height / 2}`
      }).sort(),
    )
  })

  it('draws on the hovered element when nothing is selected', () => {
    const rec = createRecorder()
    drawScene(rec.ctx, LINEAR, CAMERA, VIEWPORT, {
      ids: new Set<string>(),
      hoveredId: 'b',
    })
    expect(rec.opsOfType('arc').length).toBe(4)
  })

  it('puts the circles where creationHandleRects says', () => {
    const rec = createRecorder()
    drawScene(rec.ctx, LINEAR, CAMERA, VIEWPORT, { ids: new Set(['a']) })
    const rects = creationHandleRects(CAMERA, LINEAR.byId.get('a')!)
    const drawn = rec
      .opsOfType('arc')
      .map((entry) => [entry.args[0], entry.args[1]])
    for (const direction of CREATION_HANDLE_DIRECTIONS) {
      const r = rects[direction]
      expect(drawn).toContainEqual([r.x + r.width / 2, r.y + r.height / 2])
    }
  })

  it('draws the circle in the accent and the plus in the contrast colour', () => {
    // Inverted from the resize grips (light square, accent border) on
    // purpose: the two affordances sit close together and must be
    // distinguishable at a glance.
    const light = createRecorder()
    drawScene(light.ctx, LINEAR, CAMERA, VIEWPORT, { ids: new Set(['a']) }, { theme: 'light' })
    const dark = createRecorder()
    drawScene(dark.ctx, LINEAR, CAMERA, VIEWPORT, { ids: new Set(['a']) }, { theme: 'dark' })
    expect(light.opsOfType('arc')[0].args[5]).not.toBe(
      dark.opsOfType('arc')[0].args[5],
    )
  })
})

describe('the quick-create rubber band', () => {
  const dragging: RenderSelection = {
    ids: new Set(['a']),
    quickCreate: { fromId: 'a', toWorld: { x: 500, y: 500 } },
  }

  it('draws a dashed line from the source centre to the pointer', () => {
    const rec = createRecorder()
    drawScene(rec.ctx, LINEAR, CAMERA, VIEWPORT, dragging)
    const dashes = rec.opsOfType('setLineDash')
    expect(dashes.some((entry) => Array.isArray(entry.args[0]) && (entry.args[0] as Array<number>).length > 0)).toBe(true)
    // Source centre (50, 50) at camera origin, straight to (500, 500).
    const moves = rec.opsOfType('moveTo').map((entry) => entry.args.slice(0, 2))
    expect(moves).toContainEqual([50, 50])
  })

  it('suppresses the creation handles while dragging', () => {
    const rec = createRecorder()
    drawScene(rec.ctx, LINEAR, CAMERA, VIEWPORT, dragging)
    expect(rec.opsOfType('arc')).toEqual([])
  })

  it('draws nothing when the source vanished mid-drag', () => {
    const rec = createRecorder()
    drawScene(rec.ctx, LINEAR, CAMERA, VIEWPORT, {
      ids: new Set<string>(),
      quickCreate: { fromId: 'gone', toWorld: { x: 500, y: 500 } },
    })
    const moves = rec.opsOfType('moveTo').map((entry) => entry.args.slice(0, 2))
    expect(moves).not.toContainEqual([50, 50])
  })
})
