// src/lib/canvas-engine/render.test.ts
// Unit tests for the canvas renderer against a RECORDING stub context.
//
// A stub context cannot tell us whether the board LOOKS right — nothing here
// asserts pixels, and nothing here should pretend to. What it can prove is
// the set of things that are invisible-until-they-are-catastrophic and that
// have no other detector:
//
//   - the device-pixel-ratio backing store is sized and the transform scaled
//     (the blurry-canvas bug the plan names explicitly);
//   - the backing store is NOT reassigned on an unchanged frame (assigning
//     `canvas.width` resets the entire context state);
//   - the camera transform is the one from `camera.ts` and elements are
//     drawn in world coordinates under it;
//   - selection grips are the SAME screen size at 0.5x and 2x zoom, which is
//     the whole reason the overlay is drawn after the transform is popped;
//   - the default text colour resolves per theme while a chosen colour does
//     not.
//
// Where a stub gives no signal — glyph shapes, antialiasing, whether the
// board is legible — the Wave 5 e2e is what covers it, and these tests say
// nothing about it.

import { describe, expect, it } from 'vitest'
import {
  HANDLE_SIZE,
  RESIZE_HANDLES,
  TEXT_PADDING,
  drawScene,
  handleRects,
  layoutElementText,
  resolveTextColor,
  syncBackingStore,
  textFrame,
  worldRectToScreen,
} from './render'
import { DEFAULT_ELEMENT_STYLE, sceneFrom } from './scene'
import { worldToScreen } from './camera'
import type { RenderSelection, Viewport } from './render'
import type { Camera } from './camera'
import type { CanvasElement } from './scene'

// ───────────────────────────────────────────────────────────────────────────
// Recording stub context
// ───────────────────────────────────────────────────────────────────────────

interface Op {
  op: string
  args: Array<unknown>
}

interface Recorder {
  ctx: CanvasRenderingContext2D
  ops: Array<Op>
  canvas: { width: number; height: number }
  /** How many times `width`/`height` were ASSIGNED (not merely read). */
  backingStoreWrites: number
  opsOfType: (op: string) => Array<Op>
  indexOf: (op: string) => number
}

/**
 * Every character measures `fontSize * 0.5` wide. Deterministic and
 * proportional to the font size, so a layout assertion is arithmetic rather
 * than a guess about a real font's metrics.
 */
const CHAR_WIDTH_RATIO = 0.5

function createRecorder(): Recorder {
  const ops: Array<Op> = []
  let width = 0
  let height = 0
  let writes = 0
  let currentFont = '16px sans-serif'

  const canvas = {
    get width() {
      return width
    },
    set width(value: number) {
      width = value
      writes += 1
    },
    get height() {
      return height
    },
    set height(value: number) {
      height = value
      writes += 1
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
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    stroke(...args: Array<unknown>) {
      // lineWidth is captured here, not on moveTo, because it is what is in
      // effect at the moment the path is painted.
      ops.push({ op: 'stroke', args: [...args, this.lineWidth] })
    },
    setLineDash: record('setLineDash'),
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
      const size = Number.parseFloat(currentFont)
      return { width: text.length * size * CHAR_WIDTH_RATIO }
    },
  }

  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    ops,
    canvas,
    get backingStoreWrites() {
      return writes
    },
    opsOfType: (op) => ops.filter((entry) => entry.op === op),
    indexOf: (op) => ops.findIndex((entry) => entry.op === op),
  }
}

function makeElement(overrides: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id: 'e1',
    kind: 'rectangle',
    x: 100,
    y: 50,
    width: 200,
    height: 120,
    rotation: 0,
    zIndex: 0,
    text: null,
    style: { ...DEFAULT_ELEMENT_STYLE },
    ...overrides,
  }
}

const NO_SELECTION: RenderSelection = { ids: new Set<string>() }

function viewport(devicePixelRatio = 1): Viewport {
  return { width: 800, height: 600, devicePixelRatio }
}

// ───────────────────────────────────────────────────────────────────────────

describe('syncBackingStore', () => {
  it('sizes the backing store to cssSize * devicePixelRatio', () => {
    const rec = createRecorder()
    const changed = syncBackingStore(rec.ctx, viewport(2))
    expect(changed).toBe(true)
    expect(rec.canvas.width).toBe(1600)
    expect(rec.canvas.height).toBe(1200)
  })

  it('does not reassign an unchanged backing store', () => {
    // Assigning canvas.width resets the ENTIRE context state — transform,
    // styles, clip. Doing it every frame would silently undo whatever the
    // previous frame configured, so "no write when nothing changed" is a
    // correctness property, not an optimisation.
    const rec = createRecorder()
    syncBackingStore(rec.ctx, viewport(2))
    const writesAfterFirst = rec.backingStoreWrites
    const changed = syncBackingStore(rec.ctx, viewport(2))
    expect(changed).toBe(false)
    expect(rec.backingStoreWrites).toBe(writesAfterFirst)
  })

  it('falls back to ratio 1 for a non-positive devicePixelRatio', () => {
    const rec = createRecorder()
    syncBackingStore(rec.ctx, { width: 400, height: 300, devicePixelRatio: 0 })
    expect(rec.canvas.width).toBe(400)
    expect(rec.canvas.height).toBe(300)
  })

  it('never sizes below one device pixel', () => {
    const rec = createRecorder()
    syncBackingStore(rec.ctx, { width: 0, height: 0, devicePixelRatio: 1 })
    expect(rec.canvas.width).toBe(1)
    expect(rec.canvas.height).toBe(1)
  })
})

describe('drawScene — device pixel ratio', () => {
  it('scales the base transform by the device pixel ratio', () => {
    const rec = createRecorder()
    drawScene(
      rec.ctx,
      sceneFrom([]),
      { x: 0, y: 0, zoom: 1 },
      viewport(3),
      NO_SELECTION,
    )
    expect(rec.opsOfType('setTransform')[0].args).toEqual([3, 0, 0, 3, 0, 0])
  })

  it('clears the full viewport in CSS pixels, not device pixels', () => {
    // The clear happens under the DPR base transform, so its extent is the
    // CSS size. Passing device pixels here would clear four times the area
    // at 2x and cost real frame time.
    const rec = createRecorder()
    drawScene(
      rec.ctx,
      sceneFrom([]),
      { x: 0, y: 0, zoom: 1 },
      viewport(2),
      NO_SELECTION,
    )
    expect(rec.opsOfType('clearRect')[0].args).toEqual([0, 0, 800, 600])
  })
})

describe('drawScene — camera transform', () => {
  it('applies scale(zoom) then translate(-camera) inside a save/restore', () => {
    const rec = createRecorder()
    const camera: Camera = { x: 40, y: 25, zoom: 1.5 }
    drawScene(rec.ctx, sceneFrom([]), camera, viewport(), NO_SELECTION)

    expect(rec.opsOfType('scale')[0].args).toEqual([1.5, 1.5])
    expect(rec.opsOfType('translate')[0].args).toEqual([-40, -25])
    expect(rec.indexOf('save')).toBeLessThan(rec.indexOf('scale'))
    expect(rec.indexOf('restore')).toBeGreaterThan(rec.indexOf('translate'))
  })

  it('draws elements in world coordinates under that transform', () => {
    const rec = createRecorder()
    const element = makeElement()
    drawScene(
      rec.ctx,
      sceneFrom([element]),
      { x: 40, y: 25, zoom: 1.5 },
      viewport(),
      NO_SELECTION,
    )
    const fill = rec.opsOfType('fillRect')[0]
    expect(fill.args.slice(0, 4)).toEqual([100, 50, 200, 120])
  })

  it('paints elements in ascending z-order', () => {
    const rec = createRecorder()
    const scene = sceneFrom([
      makeElement({ id: 'top', zIndex: 5, x: 1 }),
      makeElement({ id: 'bottom', zIndex: 1, x: 2 }),
    ])
    drawScene(
      rec.ctx,
      scene,
      { x: 0, y: 0, zoom: 1 },
      viewport(),
      NO_SELECTION,
    )
    const xs = rec.opsOfType('fillRect').map((entry) => entry.args[0])
    expect(xs).toEqual([2, 1])
  })
})

describe('drawScene — selection affordances are screen space', () => {
  it('draws grips at a constant screen size regardless of zoom', () => {
    // The plan's B7: a grip drawn in world space would be 0.8 screen px at
    // 0.1x zoom. This is the assertion that keeps the overlay outside the
    // camera transform.
    const element = makeElement()
    const scene = sceneFrom([element])
    const selection: RenderSelection = { ids: new Set([element.id]) }

    const sizes = [0.5, 2].map((zoom) => {
      const rec = createRecorder()
      drawScene(rec.ctx, scene, { x: 0, y: 0, zoom }, viewport(), selection)
      const grips = rec
        .opsOfType('fillRect')
        .filter((entry) => entry.args[2] === HANDLE_SIZE)
      return grips.map((entry) => [entry.args[2], entry.args[3]])
    })

    expect(sizes[0]).toHaveLength(RESIZE_HANDLES.length)
    expect(sizes[0]).toEqual(sizes[1])
    expect(sizes[0][0]).toEqual([HANDLE_SIZE, HANDLE_SIZE])
  })

  it('draws grips after the camera transform is popped', () => {
    const element = makeElement()
    const rec = createRecorder()
    drawScene(
      rec.ctx,
      sceneFrom([element]),
      { x: 0, y: 0, zoom: 2 },
      viewport(),
      { ids: new Set([element.id]) },
    )
    const restoreAt = rec.indexOf('restore')
    const firstGripAt = rec.ops.findIndex(
      (entry) => entry.op === 'fillRect' && entry.args[2] === HANDLE_SIZE,
    )
    expect(firstGripAt).toBeGreaterThan(restoreAt)
  })

  it('omits grips for a multi-selection but still outlines every element', () => {
    const a = makeElement({ id: 'a', zIndex: 0 })
    const b = makeElement({ id: 'b', zIndex: 1, x: 400 })
    const rec = createRecorder()
    drawScene(
      rec.ctx,
      sceneFrom([a, b]),
      { x: 0, y: 0, zoom: 1 },
      viewport(),
      { ids: new Set(['a', 'b']) },
    )
    const grips = rec
      .opsOfType('fillRect')
      .filter((entry) => entry.args[2] === HANDLE_SIZE)
    expect(grips).toHaveLength(0)
    // Two outlines: element bounds minus the 1px stroke inset.
    const outlines = rec
      .opsOfType('strokeRect')
      .filter((entry) => entry.args[2] === 199)
    expect(outlines).toHaveLength(2)
  })

  it('omits grips while text is being edited', () => {
    const element = makeElement({ id: 'a', kind: 'text', text: 'hi' })
    const rec = createRecorder()
    drawScene(
      rec.ctx,
      sceneFrom([element]),
      { x: 0, y: 0, zoom: 1 },
      viewport(),
      {
        ids: new Set(['a']),
        editing: { elementId: 'a', caret: 1, caretVisible: true },
      },
    )
    const grips = rec
      .opsOfType('fillRect')
      .filter((entry) => entry.args[2] === HANDLE_SIZE)
    expect(grips).toHaveLength(0)
  })

  it('draws the marquee in screen space', () => {
    const rec = createRecorder()
    const camera: Camera = { x: 10, y: 20, zoom: 2 }
    drawScene(rec.ctx, sceneFrom([]), camera, viewport(), {
      ids: new Set<string>(),
      marquee: { x: 30, y: 40, width: 50, height: 60 },
    })
    const expected = worldToScreen(camera, { x: 30, y: 40 })
    const marqueeFill = rec.opsOfType('fillRect')[0]
    expect(marqueeFill.args.slice(0, 4)).toEqual([
      expected.x,
      expected.y,
      100,
      120,
    ])
  })
})

describe('drawScene — draft and caret', () => {
  it('draws the in-flight draft element that is not in the scene', () => {
    const rec = createRecorder()
    drawScene(rec.ctx, sceneFrom([]), { x: 0, y: 0, zoom: 1 }, viewport(), {
      ids: new Set<string>(),
      draft: makeElement({ id: 'draft', x: 7, y: 8, width: 9, height: 10 }),
    })
    expect(rec.opsOfType('fillRect')[0].args.slice(0, 4)).toEqual([7, 8, 9, 10])
  })

  it('draws the caret only when it is in its visible blink phase', () => {
    const element = makeElement({ id: 'a', kind: 'text', text: 'ab' })
    const scene = sceneFrom([element])

    const visible = createRecorder()
    drawScene(visible.ctx, scene, { x: 0, y: 0, zoom: 1 }, viewport(), {
      ids: new Set(['a']),
      editing: { elementId: 'a', caret: 1, caretVisible: true },
    })
    expect(visible.opsOfType('moveTo')).toHaveLength(1)

    const hidden = createRecorder()
    drawScene(hidden.ctx, scene, { x: 0, y: 0, zoom: 1 }, viewport(), {
      ids: new Set(['a']),
      editing: { elementId: 'a', caret: 1, caretVisible: false },
    })
    expect(hidden.opsOfType('moveTo')).toHaveLength(0)
  })

  it('places the caret at the measured offset of the character before it', () => {
    const element = makeElement({
      id: 'a',
      kind: 'text',
      text: 'abcd',
      style: { ...DEFAULT_ELEMENT_STYLE, fontSize: 20 },
    })
    const rec = createRecorder()
    drawScene(rec.ctx, sceneFrom([element]), { x: 0, y: 0, zoom: 1 }, viewport(), {
      ids: new Set(['a']),
      editing: { elementId: 'a', caret: 2, caretVisible: true },
    })
    // Two characters at 20px * 0.5 = 10 world units each, from the padded
    // text origin.
    const frame = textFrame(element)
    expect(rec.opsOfType('moveTo')[0].args).toEqual([frame.x + 20, frame.y])
  })

  it('draws a one-screen-pixel caret at any zoom', () => {
    // The caret is drawn INSIDE the camera transform, so its lineWidth is in
    // world units. 1 / zoom world units is exactly one screen pixel — a
    // constant 1 there would give a 4px caret at 0.25x and a half-pixel one
    // at 2x.
    const element = makeElement({ id: 'a', kind: 'text', text: 'ab' })
    for (const zoom of [0.25, 1, 2]) {
      const rec = createRecorder()
      drawScene(
        rec.ctx,
        sceneFrom([element]),
        { x: 0, y: 0, zoom },
        viewport(),
        {
          ids: new Set(['a']),
          editing: { elementId: 'a', caret: 1, caretVisible: true },
        },
      )
      const strokes = rec.opsOfType('stroke')
      expect(strokes).toHaveLength(1)
      expect(strokes[0].args.at(-1)).toBeCloseTo(1 / zoom)
    }
  })
})

describe('drawScene — text', () => {
  it('draws each wrapped line one lineHeight below the last', () => {
    const element = makeElement({
      kind: 'text',
      // 8 chars at 16px * 0.5 = 64 world units; the frame is
      // 200 - 2*8 = 184 wide, so "aaaaaaaa bbbbbbbb cccccccc" (26 chars,
      // 208 units) must break.
      text: 'aaaaaaaa bbbbbbbb cccccccc',
      width: 120,
    })
    const rec = createRecorder()
    drawScene(
      rec.ctx,
      sceneFrom([element]),
      { x: 0, y: 0, zoom: 1 },
      viewport(),
      NO_SELECTION,
    )
    const lines = rec.opsOfType('fillText')
    expect(lines.length).toBeGreaterThan(1)
    const frame = textFrame(element)
    const layout = layoutElementText(
      element,
      (text) => text.length * element.style.fontSize * CHAR_WIDTH_RATIO,
    )
    expect(lines[0].args.slice(0, 3)).toEqual([
      layout.lines[0].text,
      frame.x,
      frame.y,
    ])
    expect(lines[1].args.slice(0, 3)).toEqual([
      layout.lines[1].text,
      frame.x,
      frame.y + layout.lineHeight,
    ])
  })

  it('draws no text for an element whose text is null or empty', () => {
    for (const text of [null, '']) {
      const rec = createRecorder()
      drawScene(
        rec.ctx,
        sceneFrom([makeElement({ text })]),
        { x: 0, y: 0, zoom: 1 },
        viewport(),
        NO_SELECTION,
      )
      expect(rec.opsOfType('fillText')).toHaveLength(0)
    }
  })

  it('resolves the default text colour per theme and honours a chosen one', () => {
    const withDefault = makeElement({ text: 'hi' })
    const chosen = makeElement({
      text: 'hi',
      style: { ...DEFAULT_ELEMENT_STYLE, color: '#ff0000' },
    })

    expect(resolveTextColor(withDefault.style, 'light')).toBe('#0f172a')
    expect(resolveTextColor(withDefault.style, 'dark')).toBe('#f8fafc')
    expect(resolveTextColor(chosen.style, 'dark')).toBe('#ff0000')

    const rec = createRecorder()
    drawScene(
      rec.ctx,
      sceneFrom([withDefault]),
      { x: 0, y: 0, zoom: 1 },
      viewport(),
      NO_SELECTION,
      { theme: 'dark' },
    )
    // Last recorded arg on fillText is the fillStyle in effect.
    expect(rec.opsOfType('fillText')[0].args.at(-1)).toBe('#f8fafc')
  })
})

describe('worldRectToScreen and handleRects', () => {
  it('agrees with the canonical worldToScreen transform', () => {
    const camera: Camera = { x: 15, y: -25, zoom: 0.75 }
    const rect = { x: 100, y: 200, width: 40, height: 60 }
    const screen = worldRectToScreen(camera, rect)
    expect(screen).toEqual({
      ...worldToScreen(camera, { x: 100, y: 200 }),
      width: 30,
      height: 45,
    })
  })

  it('centres each grip on its corner or edge midpoint', () => {
    const camera: Camera = { x: 0, y: 0, zoom: 1 }
    const rect = { x: 0, y: 0, width: 100, height: 50 }
    const grips = handleRects(camera, rect)
    const half = HANDLE_SIZE / 2
    expect(grips.nw).toEqual({
      x: -half,
      y: -half,
      width: HANDLE_SIZE,
      height: HANDLE_SIZE,
    })
    expect(grips.se.x).toBe(100 - half)
    expect(grips.se.y).toBe(50 - half)
    expect(grips.n.x).toBe(50 - half)
    expect(grips.e.y).toBe(25 - half)
  })

  it('keeps grips the same size while their positions follow the camera', () => {
    const rect = { x: 0, y: 0, width: 100, height: 50 }
    const near = handleRects({ x: 0, y: 0, zoom: 1 }, rect)
    const far = handleRects({ x: 0, y: 0, zoom: 0.25 }, rect)
    expect(far.se.width).toBe(near.se.width)
    expect(far.se.x).toBe(25 - HANDLE_SIZE / 2)
  })
})

describe('textFrame', () => {
  it('insets the text block by TEXT_PADDING on every side', () => {
    const frame = textFrame(makeElement())
    expect(frame).toEqual({
      x: 100 + TEXT_PADDING,
      y: 50 + TEXT_PADDING,
      maxWidth: 200 - TEXT_PADDING * 2,
    })
  })

  it('never reports a negative maxWidth for an element narrower than its padding', () => {
    // layoutText treats maxWidth <= 0 as "do not wrap"; a negative width
    // would be a different, undefined case.
    const frame = textFrame(makeElement({ width: 4 }))
    expect(frame.maxWidth).toBe(0)
  })
})
