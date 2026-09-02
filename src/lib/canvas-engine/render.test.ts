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
  ATTACH_CANDIDATE_INSET,
  ATTACH_CANDIDATE_WASH,
  ATTACH_SPOT_SIZE,
  HANDLE_SIZE,
  HIGHLIGHT_COLOR,
  HIGHLIGHT_INSET,
  RESIZE_HANDLES,
  TEXT_PADDING,
  drawScene,
  handleRects,
  layoutElementText,
  resolveTextColor,
  syncBackingStore,
  textFrame,
  textOriginY,
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
    closePath: record('closePath'),
    arcTo: record('arcTo'),
    arc(...args: Array<unknown>) {
      ops.push({ op: 'arc', args: [...args, this.fillStyle] })
    },
    ellipse: record('ellipse'),
    fill(...args: Array<unknown>) {
      ops.push({ op: 'fill', args: [...args, this.fillStyle] })
    },
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
    // Pinned SQUARE, deliberately. `DEFAULT_ELEMENT_STYLE.cornerRadius` is 8,
    // and a rounded rectangle is traced as a path instead of calling
    // `fillRect`/`strokeRect` — which most tests here use as "a rectangle was
    // painted". Pinning it keeps each of those testing its own subject
    // (z-order, paint order, grips) rather than incidentally depending on the
    // product's corner style. Tests that are ABOUT rounding set it explicitly.
    style: { ...DEFAULT_ELEMENT_STYLE, cornerRadius: 0 },
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
    drawScene(rec.ctx, scene, { x: 0, y: 0, zoom: 1 }, viewport(), NO_SELECTION)
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

  it('grips every element of a multi-selection, exactly as a click does', () => {
    // The regression this guards: grips used to be drawn for a selection of
    // exactly one, so a marquee over several shapes drew nothing but a 1px
    // outline on each element's own bounds in `chrome.accent` — which is
    // `DEFAULT_ELEMENT_STYLE.stroke`. A default-styled rectangle had its
    // border repainted the colour it already was, and the selection was
    // invisible.
    const a = makeElement({ id: 'a', zIndex: 0 })
    const b = makeElement({ id: 'b', zIndex: 1, x: 400 })
    const rec = createRecorder()
    drawScene(rec.ctx, sceneFrom([a, b]), { x: 0, y: 0, zoom: 1 }, viewport(), {
      ids: new Set(['a', 'b']),
    })
    const grips = rec
      .opsOfType('fillRect')
      .filter((entry) => entry.args[2] === HANDLE_SIZE)
    expect(grips).toHaveLength(RESIZE_HANDLES.length * 2)

    const expected = new Set(
      [a, b].flatMap((element) => {
        const r = handleRects({ x: 0, y: 0, zoom: 1 }, element)
        return RESIZE_HANDLES.map((handle) => `${r[handle].x},${r[handle].y}`)
      }),
    )
    for (const grip of grips) {
      expect(expected.has(`${grip.args[0]},${grip.args[1]}`)).toBe(true)
    }

    // Two outlines: element bounds minus the 1px stroke inset.
    const outlines = rec
      .opsOfType('strokeRect')
      .filter((entry) => entry.args[2] === 199)
    expect(outlines).toHaveLength(2)
  })

  it('never grips a connector, whose bounds are a 1x1 placeholder', () => {
    // All eight would pile onto the same point, and the mark would read as a
    // stray dot at the connector's origin.
    const shape = makeElement({ id: 'a' })
    const line = makeElement({
      id: 'c',
      kind: 'connector',
      zIndex: 1,
      width: 1,
      height: 1,
      connector: {
        source: { kind: 'point', point: { x: 0, y: 0 } },
        target: { kind: 'point', point: { x: 50, y: 50 } },
        routing: 'straight',
      },
    })
    const rec = createRecorder()
    drawScene(
      rec.ctx,
      sceneFrom([shape, line]),
      { x: 0, y: 0, zoom: 1 },
      viewport(),
      { ids: new Set(['a', 'c']) },
    )
    const grips = rec
      .opsOfType('fillRect')
      .filter((entry) => entry.args[2] === HANDLE_SIZE)
    expect(grips).toHaveLength(RESIZE_HANDLES.length)
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
    drawScene(
      rec.ctx,
      sceneFrom([element]),
      { x: 0, y: 0, zoom: 1 },
      viewport(),
      {
        ids: new Set(['a']),
        editing: { elementId: 'a', caret: 2, caretVisible: true },
      },
    )
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

describe('drawScene — the connector attach candidate', () => {
  // The answer to "will this connect, and where?" DURING the drag. A ring
  // alone was easy to miss mid-gesture, when the eye is following the line
  // rather than the shape, so the whole target is tinted as well.
  const ACCENT = '#3b82f6' // CHROME.light.accent — the default theme.
  const CAMERA: Camera = { x: 0, y: 0, zoom: 2 }

  /**
   * A candidate whose OWN stroke is not the accent — `DEFAULT_ELEMENT_STYLE`
   * strokes shapes in the same blue, and the tests below identify the overlay
   * by its colour.
   */
  function candidate(overrides: Partial<CanvasElement> = {}): CanvasElement {
    return makeElement({
      id: 'a',
      ...overrides,
      style: { ...DEFAULT_ELEMENT_STYLE, cornerRadius: 0, stroke: '#ff0000' },
    })
  }

  function drawCandidate(element: CanvasElement) {
    const rec = createRecorder()
    drawScene(rec.ctx, sceneFrom([element]), CAMERA, viewport(), {
      ids: new Set<string>(),
      connectorAttach: { elementId: element.id, attach: { x: 1, y: 0.5 } },
    })
    return rec
  }

  /** The halo rect: the candidate's screen box, grown by the inset. */
  function halo(element: CanvasElement) {
    const r = worldRectToScreen(CAMERA, element)
    return [
      r.x - ATTACH_CANDIDATE_INSET,
      r.y - ATTACH_CANDIDATE_INSET,
      r.width + ATTACH_CANDIDATE_INSET * 2,
      r.height + ATTACH_CANDIDATE_INSET * 2,
    ]
  }

  it('tints AND rings a rectangle candidate, in screen space', () => {
    const element = candidate()
    const rec = drawCandidate(element)

    const tint = rec
      .opsOfType('fillRect')
      .filter((entry) => entry.args[4] === ACCENT)
    const ring = rec
      .opsOfType('strokeRect')
      .filter((entry) => entry.args[4] === ACCENT)
    expect(tint).toHaveLength(1)
    expect(ring).toHaveLength(1)
    expect(tint[0].args.slice(0, 4)).toEqual(halo(element))
    expect(ring[0].args.slice(0, 4)).toEqual(halo(element))

    // Screen space, like every other affordance — an outline drawn in world
    // units would be hairline at 0.1x zoom and heavy at 2x.
    expect(rec.ops.indexOf(ring[0])).toBeGreaterThan(rec.indexOf('restore'))
  })

  it('rings an ELLIPSE on its drawn outline, not on its box', () => {
    // A box around an ellipse would promise the four corners a release there
    // does not accept — the same export-what-you-draw lie the hit-test avoids.
    const element = candidate({ kind: 'ellipse' })
    const rec = drawCandidate(element)

    expect(
      rec.opsOfType('strokeRect').filter((entry) => entry.args[4] === ACCENT),
    ).toHaveLength(0)
    // Two ellipses: the shape itself, then the halo traced around it.
    const ellipses = rec.opsOfType('ellipse')
    expect(ellipses).toHaveLength(2)
    const r = worldRectToScreen(CAMERA, element)
    expect(ellipses[1].args.slice(0, 5)).toEqual([
      r.x + r.width / 2,
      r.y + r.height / 2,
      r.width / 2 + ATTACH_CANDIDATE_INSET,
      r.height / 2 + ATTACH_CANDIDATE_INSET,
      0,
    ])
  })

  it('marks the exact border point the connector would land on', () => {
    const element = candidate()
    const rec = drawCandidate(element)
    const spot = worldToScreen(CAMERA, {
      x: element.x + element.width,
      y: element.y + element.height / 2,
    })
    const dots = rec
      .opsOfType('arc')
      .filter((entry) => entry.args[5] === ACCENT)
    expect(dots).toHaveLength(1)
    expect(dots[0].args.slice(0, 3)).toEqual([
      spot.x,
      spot.y,
      ATTACH_SPOT_SIZE / 2,
    ])
  })

  it('keeps the tint translucent so the shape stays readable under it', () => {
    // The candidate is still a shape with a fill and text of its own. A wash
    // that hid either would trade one legibility problem for another.
    expect(ATTACH_CANDIDATE_WASH).toBeGreaterThan(0)
    expect(ATTACH_CANDIDATE_WASH).toBeLessThan(0.35)
  })

  it('draws nothing when no connector is being dragged', () => {
    const element = candidate()
    const rec = createRecorder()
    drawScene(rec.ctx, sceneFrom([element]), CAMERA, viewport(), NO_SELECTION)
    expect(
      rec.opsOfType('strokeRect').filter((entry) => entry.args[4] === ACCENT),
    ).toHaveLength(0)
  })
})

describe('drawScene — undo/redo highlight (board-undo tactical plan, Wave 4)', () => {
  function highlightOps(rec: Recorder) {
    return rec
      .opsOfType('strokeRect')
      .filter((entry) => entry.args[4] === HIGHLIGHT_COLOR)
  }

  it('draws a ring around the highlighted element, in screen space, after the camera transform is popped', () => {
    const element = makeElement({ id: 'a' })
    const rec = createRecorder()
    drawScene(
      rec.ctx,
      sceneFrom([element]),
      { x: 0, y: 0, zoom: 2 },
      viewport(),
      { ids: new Set<string>(), highlight: { elementId: 'a', intensity: 1 } },
    )
    const rings = highlightOps(rec)
    expect(rings).toHaveLength(1)

    const r = worldRectToScreen({ x: 0, y: 0, zoom: 2 }, element)
    expect(rings[0].args.slice(0, 4)).toEqual([
      r.x - HIGHLIGHT_INSET,
      r.y - HIGHLIGHT_INSET,
      r.width + HIGHLIGHT_INSET * 2,
      r.height + HIGHLIGHT_INSET * 2,
    ])

    const restoreAt = rec.indexOf('restore')
    const ringAt = rec.ops.findIndex(
      (entry) => entry.op === 'strokeRect' && entry.args[4] === HIGHLIGHT_COLOR,
    )
    expect(ringAt).toBeGreaterThan(restoreAt)
  })

  it('draws nothing when there is no highlight', () => {
    const element = makeElement({ id: 'a' })
    const rec = createRecorder()
    drawScene(
      rec.ctx,
      sceneFrom([element]),
      { x: 0, y: 0, zoom: 1 },
      viewport(),
      NO_SELECTION,
    )
    expect(highlightOps(rec)).toHaveLength(0)
  })

  it('draws nothing when the highlighted element no longer exists (a refused undo whose target was deleted)', () => {
    const rec = createRecorder()
    drawScene(rec.ctx, sceneFrom([]), { x: 0, y: 0, zoom: 1 }, viewport(), {
      ids: new Set<string>(),
      highlight: { elementId: 'gone', intensity: 1 },
    })
    expect(highlightOps(rec)).toHaveLength(0)
  })

  it('draws nothing once intensity has fully decayed', () => {
    const element = makeElement({ id: 'a' })
    const rec = createRecorder()
    drawScene(
      rec.ctx,
      sceneFrom([element]),
      { x: 0, y: 0, zoom: 1 },
      viewport(),
      { ids: new Set<string>(), highlight: { elementId: 'a', intensity: 0 } },
    )
    expect(highlightOps(rec)).toHaveLength(0)
  })
})

describe('drawScene: shape kinds', () => {
  // These assert the PATH, not the pixels — a stub context cannot say whether
  // a diamond looks like a diamond. What it can prove is that each kind traces
  // the geometry `hit-test.ts` tests against, because a renderer and a
  // hit-test that disagree produce a shape you can see and cannot click.
  function draw(element: CanvasElement) {
    const rec = createRecorder()
    drawScene(
      rec.ctx,
      sceneFrom([element]),
      { x: 0, y: 0, zoom: 1 },
      viewport(),
      NO_SELECTION,
    )
    return rec
  }

  it('draws a ROUNDED rectangle as a path, with an arc at each corner', () => {
    const element = makeElement({
      style: { ...DEFAULT_ELEMENT_STYLE, cornerRadius: 20 },
    })
    const rec = createRecorder()
    drawScene(
      rec.ctx,
      sceneFrom([element]),
      { x: 0, y: 0, zoom: 1 },
      viewport(),
      NO_SELECTION,
    )

    // No rect calls for the shape itself: a rounded rectangle has no
    // `fillRoundRect` equivalent, so it has to become a path.
    const shapeRects = rec
      .opsOfType('fillRect')
      .filter((entry) => entry.args[2] === element.width)
    expect(shapeRects).toHaveLength(0)

    const arcs = rec.opsOfType('arcTo')
    expect(arcs).toHaveLength(4)
    for (const arc of arcs) expect(arc.args[4]).toBe(20)
    expect(rec.opsOfType('fill').length).toBeGreaterThan(0)
    expect(rec.opsOfType('stroke').length).toBeGreaterThan(0)
  })

  it('clamps the drawn radius to half the shorter side', () => {
    // Past that the two arcs on an edge overlap, and the renderer and
    // `elementContainsPoint` would each resolve the overlap their own way.
    const element = makeElement({
      width: 200,
      height: 60,
      style: { ...DEFAULT_ELEMENT_STYLE, cornerRadius: 500 },
    })
    const rec = createRecorder()
    drawScene(
      rec.ctx,
      sceneFrom([element]),
      { x: 0, y: 0, zoom: 1 },
      viewport(),
      NO_SELECTION,
    )
    const arcs = rec.opsOfType('arcTo')
    expect(arcs).toHaveLength(4)
    for (const arc of arcs) expect(arc.args[4]).toBe(30)
  })

  it('rounds nothing on a kind that traces its own path', () => {
    // An ellipse has no corners; a stored radius on one must not reach the
    // path it traces for itself.
    const element = makeElement({
      kind: 'ellipse',
      style: { ...DEFAULT_ELEMENT_STYLE, cornerRadius: 20 },
    })
    const rec = createRecorder()
    drawScene(
      rec.ctx,
      sceneFrom([element]),
      { x: 0, y: 0, zoom: 1 },
      viewport(),
      NO_SELECTION,
    )
    expect(rec.opsOfType('arcTo')).toHaveLength(0)
    expect(rec.opsOfType('ellipse')).toHaveLength(1)
  })

  it('draws a rectangle with fillRect and strokeRect, not a path', () => {
    // Unchanged behaviour, asserted so the path-based kinds below cannot
    // quietly take the rectangle with them.
    const rec = draw(makeElement({ kind: 'rectangle' }))
    expect(rec.opsOfType('fillRect')[0].args.slice(0, 4)).toEqual([
      100, 50, 200, 120,
    ])
    expect(rec.opsOfType('strokeRect')).toHaveLength(1)
    expect(rec.opsOfType('ellipse')).toHaveLength(0)
  })

  it('draws an ellipse at the centre of its box with HALF-extent radii', () => {
    // The classic defect this pins: passing width/height instead of the radii
    // draws a shape twice the size of its own resize box.
    const rec = draw(makeElement({ kind: 'ellipse' }))
    expect(rec.opsOfType('ellipse')[0].args.slice(0, 5)).toEqual([
      200, 110, 100, 60, 0,
    ])
    expect(rec.opsOfType('fillRect')).toHaveLength(0)
    expect(rec.opsOfType('strokeRect')).toHaveLength(0)
    expect(rec.opsOfType('fill')).toHaveLength(1)
    expect(rec.opsOfType('stroke')).toHaveLength(1)
  })

  it('draws a diamond through the four edge midpoints', () => {
    const rec = draw(makeElement({ kind: 'diamond' }))
    expect(rec.opsOfType('moveTo')[0].args).toEqual([200, 50])
    expect(rec.opsOfType('lineTo').map((entry) => entry.args)).toEqual([
      [300, 110],
      [200, 170],
      [100, 110],
    ])
    expect(rec.opsOfType('closePath')).toHaveLength(1)
  })

  it('draws a triangle apex-up, matching what the hit-test accepts', () => {
    const rec = draw(makeElement({ kind: 'triangle' }))
    expect(rec.opsOfType('moveTo')[0].args).toEqual([200, 50])
    expect(rec.opsOfType('lineTo').map((entry) => entry.args)).toEqual([
      [300, 170],
      [100, 170],
    ])
    expect(rec.opsOfType('closePath')).toHaveLength(1)
  })

  it('honours fill:none and strokeWidth:0 independently', () => {
    const outlined = draw(
      makeElement({
        kind: 'ellipse',
        style: { ...DEFAULT_ELEMENT_STYLE, fill: 'none' },
      }),
    )
    expect(outlined.opsOfType('fill')).toHaveLength(0)
    expect(outlined.opsOfType('stroke')).toHaveLength(1)

    const filled = draw(
      makeElement({
        kind: 'diamond',
        style: { ...DEFAULT_ELEMENT_STYLE, strokeWidth: 0 },
      }),
    )
    expect(filled.opsOfType('fill')).toHaveLength(1)
    expect(filled.opsOfType('stroke')).toHaveLength(0)
  })

  it('draws nothing at all for a shape that is neither filled nor stroked', () => {
    const rec = draw(
      makeElement({
        kind: 'triangle',
        style: { ...DEFAULT_ELEMENT_STYLE, fill: 'none', strokeWidth: 0 },
      }),
    )
    expect(rec.opsOfType('moveTo')).toHaveLength(0)
    expect(rec.opsOfType('fill')).toHaveLength(0)
    expect(rec.opsOfType('stroke')).toHaveLength(0)
  })

  it('lays a label out in the same frame for every shape kind', () => {
    // The text frame is the element RECT for all four kinds — a shape's label
    // must not shift when its outline changes.
    const texts = (
      ['rectangle', 'ellipse', 'diamond', 'triangle'] as const
    ).map(
      (kind) =>
        draw(makeElement({ kind, text: 'hi' })).opsOfType('fillText')[0],
    )
    for (const entry of texts) {
      expect(entry.args.slice(0, 3)).toEqual([
        'hi',
        100 + TEXT_PADDING,
        50 + TEXT_PADDING,
      ])
    }
  })
})

describe('drawScene: group frame (canvas-element-grouping tactical plan, Wave 6)', () => {
  // CHROME.light.accent and CHROME.light.marqueeFill, read directly rather
  // than exported — the same local-constant convention the connector-attach
  // describe block below already uses for ACCENT.
  const ACCENT = '#3b82f6'
  const MARQUEE_FILL = 'rgba(59, 130, 246, 0.10)'

  function groupElement(
    overrides: Partial<CanvasElement> = {},
  ): CanvasElement {
    return makeElement({
      kind: 'group',
      group: { childIds: [] },
      text: null,
      ...overrides,
    })
  }

  it('draws a persistent low-emphasis frame at rest, even with zero members (FR-032)', () => {
    const element = groupElement()
    const rec = createRecorder()
    drawScene(
      rec.ctx,
      sceneFrom([element]),
      { x: 0, y: 0, zoom: 1 },
      viewport(),
      NO_SELECTION,
    )
    const rects = rec.opsOfType('strokeRect')
    expect(rects).toHaveLength(1)
    expect(rects[0].args).toEqual([100, 50, 200, 120, MARQUEE_FILL])
  })

  it('never fills a group — no fill style of its own (FR-031)', () => {
    const rec = createRecorder()
    drawScene(
      rec.ctx,
      sceneFrom([groupElement()]),
      { x: 0, y: 0, zoom: 1 },
      viewport(),
      NO_SELECTION,
    )
    expect(rec.opsOfType('fillRect')).toHaveLength(0)
    expect(rec.opsOfType('fill')).toHaveLength(0)
  })

  it('draws full emphasis (chrome.accent) when hovered but not selected', () => {
    const element = groupElement()
    const rec = createRecorder()
    drawScene(
      rec.ctx,
      sceneFrom([element]),
      { x: 0, y: 0, zoom: 1 },
      viewport(),
      { ids: new Set<string>(), hoveredId: element.id },
    )
    const rects = rec.opsOfType('strokeRect')
    expect(rects).toHaveLength(1)
    expect(rects[0].args).toEqual([100, 50, 200, 120, ACCENT])
  })

  it('draws full emphasis (chrome.accent) when selected', () => {
    const element = groupElement()
    const rec = createRecorder()
    drawScene(
      rec.ctx,
      sceneFrom([element]),
      { x: 0, y: 0, zoom: 1 },
      viewport(),
      { ids: new Set([element.id]) },
    )
    // Two strokeRect calls exist for a SELECTED group: this function's own
    // world-space frame (raw x/y/width/height, asserted here) plus
    // `drawSelectionOverlay`'s pre-existing screen-space selection outline
    // (inset by 0.5, width/height -1 — a different call, not this feature's
    // concern, already covered by that describe block's own tests).
    const worldFrame = rec
      .opsOfType('strokeRect')
      .find((entry) => entry.args[0] === 100 && entry.args[1] === 50)
    expect(worldFrame?.args).toEqual([100, 50, 200, 120, ACCENT])
  })

  it('resolves the low-emphasis token per theme', () => {
    const element = groupElement()
    const rec = createRecorder()
    drawScene(
      rec.ctx,
      sceneFrom([element]),
      { x: 0, y: 0, zoom: 1 },
      viewport(),
      NO_SELECTION,
      { theme: 'dark' },
    )
    expect(rec.opsOfType('strokeRect')[0].args).toEqual([
      100,
      50,
      200,
      120,
      'rgba(96, 165, 250, 0.16)',
    ])
  })
})

describe('text alignment', () => {
  // makeElement is 200x120 at (100, 50), TEXT_PADDING is 8, and the stub
  // measurer is fontSize * 0.5 per character. So for the default 16px font:
  //   frame.x = 108, frame.y = 58, maxWidth = 184, available height = 104
  //   'abc' = 24 units wide  -> horizontal slack 160
  //   one line = 16 * 1.4 = 22.4 tall -> vertical slack 81.6
  const measureStub = (text: string) =>
    text.length * DEFAULT_ELEMENT_STYLE.fontSize * CHAR_WIDTH_RATIO

  function drawn(element: CanvasElement) {
    const rec = createRecorder()
    drawScene(
      rec.ctx,
      sceneFrom([element]),
      { x: 0, y: 0, zoom: 1 },
      viewport(),
      NO_SELECTION,
    )
    return rec.opsOfType('fillText')
  }

  it('draws left-aligned text at the frame origin, as it always has', () => {
    const element = makeElement({ kind: 'text', text: 'abc' })
    const frame = textFrame(element)
    expect(drawn(element)[0].args.slice(0, 3)).toEqual([
      'abc',
      frame.x,
      frame.y,
    ])
  })

  it('offsets a centred line by half the horizontal slack', () => {
    const element = makeElement({
      kind: 'text',
      text: 'abc',
      style: { ...DEFAULT_ELEMENT_STYLE, textAlign: 'center' },
    })
    const frame = textFrame(element)
    expect(drawn(element)[0].args[1]).toBe(frame.x + 80)
  })

  it('offsets a right-aligned line by the whole horizontal slack', () => {
    const element = makeElement({
      kind: 'text',
      text: 'abc',
      style: { ...DEFAULT_ELEMENT_STYLE, textAlign: 'right' },
    })
    const frame = textFrame(element)
    expect(drawn(element)[0].args[1]).toBe(frame.x + 160)
  })

  it('keeps the horizontal offset out of ctx.textAlign', () => {
    // The offset lives in the layout so the caret and the glyphs cannot
    // disagree; handing it to the context instead would move one and not the
    // other. `textAlign` therefore stays 'left' under every alignment.
    const rec = createRecorder()
    drawScene(
      rec.ctx,
      sceneFrom([
        makeElement({
          kind: 'text',
          text: 'abc',
          style: { ...DEFAULT_ELEMENT_STYLE, textAlign: 'right' },
        }),
      ]),
      { x: 0, y: 0, zoom: 1 },
      viewport(),
      NO_SELECTION,
    )
    expect(rec.ctx.textAlign).toBe('left')
  })

  it('centres the block vertically for verticalAlign middle', () => {
    const element = makeElement({
      kind: 'text',
      text: 'abc',
      style: { ...DEFAULT_ELEMENT_STYLE, verticalAlign: 'middle' },
    })
    const frame = textFrame(element)
    // 81.6 slack, halved.
    expect(textOriginY(element, layoutElementText(element, measureStub))).toBe(
      frame.y + 40.8,
    )
    expect(drawn(element)[0].args[2]).toBe(frame.y + 40.8)
  })

  it('drops the block to the bottom for verticalAlign bottom', () => {
    const element = makeElement({
      kind: 'text',
      text: 'abc',
      style: { ...DEFAULT_ELEMENT_STYLE, verticalAlign: 'bottom' },
    })
    const frame = textFrame(element)
    expect(drawn(element)[0].args[2]).toBeCloseTo(frame.y + 81.6, 6)
  })

  it('starts overflowing text at the top under EVERY vertical alignment', () => {
    // Taller than its box: there is no slack to distribute, and text creeping
    // up out of the shape would be worse than the overflow already is. Same
    // unclipped top the element has always shown.
    for (const verticalAlign of ['top', 'middle', 'bottom'] as const) {
      const element = makeElement({
        kind: 'text',
        // Wraps to many lines in a 24-unit-tall box.
        text: 'aaaaaaaa bbbbbbbb cccccccc dddddddd eeeeeeee',
        height: 24,
        style: { ...DEFAULT_ELEMENT_STYLE, verticalAlign },
      })
      const frame = textFrame(element)
      expect(
        textOriginY(element, layoutElementText(element, measureStub)),
      ).toBe(frame.y)
    }
  })

  it('leaves the two axes independent', () => {
    const element = makeElement({
      kind: 'text',
      text: 'abc',
      style: {
        ...DEFAULT_ELEMENT_STYLE,
        textAlign: 'right',
        verticalAlign: 'bottom',
      },
    })
    const frame = textFrame(element)
    const [op] = drawn(element)
    expect(op.args[1]).toBe(frame.x + 160)
    expect(op.args[2]).toBeCloseTo(frame.y + 81.6, 6)
  })

  it('draws the caret against the same origin as the glyphs', () => {
    // The whole point of routing both through `textOriginY` and the layout's
    // own caret offsets: a caret on a different line from the text it is
    // measured against is the click-lands-early bug in visible form.
    const element = makeElement({
      id: 'edited',
      kind: 'text',
      text: 'abc',
      style: {
        ...DEFAULT_ELEMENT_STYLE,
        textAlign: 'center',
        verticalAlign: 'middle',
      },
    })
    const rec = createRecorder()
    drawScene(
      rec.ctx,
      sceneFrom([element]),
      { x: 0, y: 0, zoom: 1 },
      viewport(),
      {
        ids: new Set(['edited']),
        editing: { elementId: 'edited', caret: 0, caretVisible: true },
      },
    )
    const [text] = rec.opsOfType('fillText')
    const caretMoves = rec.opsOfType('moveTo')
    // The caret at index 0 sits exactly where the line's first glyph starts.
    expect(caretMoves.at(-1)?.args[0]).toBe(text.args[1])
    expect(caretMoves.at(-1)?.args[1]).toBe(text.args[2])
  })
})
