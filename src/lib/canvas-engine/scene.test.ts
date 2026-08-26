// src/lib/canvas-engine/scene.test.ts
// Scene model and hit-testing. These two are tested together because the
// property that matters — "clicking a stack selects what you can see" —
// spans both: the scene decides paint order, the hit-test consumes it.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONNECTOR_ROUTING,
  DEFAULT_ELEMENT_STYLE,
  EMPTY_SCENE,
  addElement,
  boundsOfMany,
  bringToFront,
  effectiveCornerRadius,
  getElement,
  nextZIndex,
  remapConnectorEndpoints,
  removeElement,
  removeElements,
  sceneFrom,
  updateElement,
} from './scene'
import {
  elementContainsPoint,
  hitTest,
  hitTestRect,
  normaliseRect,
  rectFromPoints,
  rectsIntersect,
} from './hit-test'
import type { CanvasElement } from './scene'

function el(
  id: string,
  patch: Partial<CanvasElement> = {},
): CanvasElement {
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
    style: DEFAULT_ELEMENT_STYLE,
    ...patch,
  }
}

describe('sceneFrom', () => {
  it('orders elements by ascending z-index', () => {
    const scene = sceneFrom([
      el('c', { zIndex: 5 }),
      el('a', { zIndex: 1 }),
      el('b', { zIndex: 3 }),
    ])
    expect(scene.elements.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('breaks z-index ties by id so ordering is stable', () => {
    const one = sceneFrom([el('b', { zIndex: 0 }), el('a', { zIndex: 0 })])
    const two = sceneFrom([el('a', { zIndex: 0 }), el('b', { zIndex: 0 })])
    expect(one.elements.map((e) => e.id)).toEqual(two.elements.map((e) => e.id))
  })

  it('indexes by id', () => {
    const scene = sceneFrom([el('a'), el('b')])
    expect(getElement(scene, 'b')?.id).toBe('b')
    expect(getElement(scene, 'nope')).toBeNull()
  })

  it('does not mutate the array it was given', () => {
    const input = [el('c', { zIndex: 9 }), el('a', { zIndex: 1 })]
    sceneFrom(input)
    expect(input.map((e) => e.id)).toEqual(['c', 'a'])
  })
})

describe('scene mutations', () => {
  it('adds an element', () => {
    const scene = addElement(EMPTY_SCENE, el('a'))
    expect(scene.elements).toHaveLength(1)
    expect(EMPTY_SCENE.elements).toHaveLength(0)
  })

  it('patches an element without touching its siblings', () => {
    const scene = sceneFrom([el('a'), el('b', { zIndex: 1 })])
    const next = updateElement(scene, 'a', { x: 500 })
    expect(getElement(next, 'a')?.x).toBe(500)
    expect(getElement(next, 'b')).toEqual(getElement(scene, 'b'))
    // Original untouched.
    expect(getElement(scene, 'a')?.x).toBe(0)
  })

  it('returns the SAME scene for a no-op update, so callers can skip renders', () => {
    const scene = sceneFrom([el('a')])
    expect(updateElement(scene, 'missing', { x: 1 })).toBe(scene)
    expect(removeElement(scene, 'missing')).toBe(scene)
    expect(removeElements(scene, ['missing', 'also-missing'])).toBe(scene)
  })

  it('removes elements', () => {
    const scene = sceneFrom([el('a'), el('b', { zIndex: 1 }), el('c', { zIndex: 2 })])
    expect(removeElement(scene, 'b').elements.map((e) => e.id)).toEqual(['a', 'c'])
    expect(removeElements(scene, ['a', 'c']).elements.map((e) => e.id)).toEqual(['b'])
  })

  it('brings an element to the front of the paint order', () => {
    const scene = sceneFrom([
      el('a', { zIndex: 0 }),
      el('b', { zIndex: 1 }),
      el('c', { zIndex: 2 }),
    ])
    const next = bringToFront(scene, 'a')
    expect(next.elements[next.elements.length - 1].id).toBe('a')
  })

  it('nextZIndex puts a new element on top', () => {
    expect(nextZIndex(EMPTY_SCENE)).toBe(0)
    const scene = sceneFrom([el('a', { zIndex: 4 })])
    expect(nextZIndex(scene)).toBeGreaterThan(4)
  })
})

describe('boundsOfMany', () => {
  it('unions the bounds', () => {
    expect(
      boundsOfMany([
        el('a', { x: 0, y: 0, width: 100, height: 50 }),
        el('b', { x: 200, y: 100, width: 100, height: 50 }),
      ]),
    ).toEqual({ x: 0, y: 0, width: 300, height: 150 })
  })

  it('returns null for an empty selection rather than a rect at the origin', () => {
    // A degenerate 0x0 rect at (0,0) would render a selection box around
    // nothing, which reads as a bug to the user.
    expect(boundsOfMany([])).toBeNull()
  })
})

describe('hitTest', () => {
  it('returns null on an empty scene and on a miss', () => {
    expect(hitTest(EMPTY_SCENE, { x: 0, y: 0 })).toBeNull()
    const scene = sceneFrom([el('a', { x: 0, y: 0, width: 10, height: 10 })])
    expect(hitTest(scene, { x: 999, y: 999 })).toBeNull()
  })

  it('returns the TOPMOST element in a stack', () => {
    // The regression guard for the classic reversed-scan bug, where
    // clicking a stack always selects the bottom item.
    const scene = sceneFrom([
      el('bottom', { zIndex: 0 }),
      el('middle', { zIndex: 1 }),
      el('top', { zIndex: 2 }),
    ])
    expect(hitTest(scene, { x: 50, y: 50 })?.id).toBe('top')
  })

  it('falls through to a lower element outside the top one', () => {
    const scene = sceneFrom([
      el('big', { zIndex: 0, x: 0, y: 0, width: 200, height: 200 }),
      el('small', { zIndex: 1, x: 0, y: 0, width: 20, height: 20 }),
    ])
    expect(hitTest(scene, { x: 10, y: 10 })?.id).toBe('small')
    expect(hitTest(scene, { x: 100, y: 100 })?.id).toBe('big')
  })

  it('counts the boundary as inside', () => {
    const element = el('a', { x: 0, y: 0, width: 10, height: 10 })
    expect(elementContainsPoint(element, { x: 0, y: 0 })).toBe(true)
    expect(elementContainsPoint(element, { x: 10, y: 10 })).toBe(true)
    expect(elementContainsPoint(element, { x: 10.01, y: 5 })).toBe(false)
  })

  it('hits text elements the same way as rectangles', () => {
    const scene = sceneFrom([
      el('t', { kind: 'text', x: 0, y: 0, width: 200, height: 40 }),
    ])
    expect(hitTest(scene, { x: 100, y: 20 })?.id).toBe('t')
    expect(hitTest(scene, { x: 100, y: 60 })).toBeNull()
  })
})

describe('rounded rectangle containment', () => {
  // A radius that is drawn but not hit-tested would swallow clicks in the
  // four corners the shape no longer covers, and a shape tucked behind
  // another one's corner would be unselectable with nothing on screen to
  // explain it — the same reason the three non-rect kinds below have their
  // own containment.
  const rounded = el('r', {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    style: { ...DEFAULT_ELEMENT_STYLE, cornerRadius: 20 },
  })

  it('excludes the bounding box corners a radius cuts away', () => {
    expect(elementContainsPoint(rounded, { x: 0, y: 0 })).toBe(false)
    expect(elementContainsPoint(rounded, { x: 100, y: 0 })).toBe(false)
    expect(elementContainsPoint(rounded, { x: 100, y: 100 })).toBe(false)
    expect(elementContainsPoint(rounded, { x: 0, y: 100 })).toBe(false)
  })

  it('keeps the straight parts of every edge inside', () => {
    expect(elementContainsPoint(rounded, { x: 50, y: 0 })).toBe(true)
    expect(elementContainsPoint(rounded, { x: 100, y: 50 })).toBe(true)
    expect(elementContainsPoint(rounded, { x: 50, y: 100 })).toBe(true)
    expect(elementContainsPoint(rounded, { x: 0, y: 50 })).toBe(true)
    expect(elementContainsPoint(rounded, { x: 50, y: 50 })).toBe(true)
  })

  it('follows the arc, not the corner box', () => {
    // The arc's centre is one radius in from both edges. A point just inside
    // that centre is in the shape; the same offset outward is not.
    expect(elementContainsPoint(rounded, { x: 21, y: 21 })).toBe(true)
    expect(elementContainsPoint(rounded, { x: 3, y: 3 })).toBe(false)
  })

  it('leaves a square rectangle exactly as it was', () => {
    const square = el('s', { x: 0, y: 0, width: 100, height: 100 })
    expect(elementContainsPoint(square, { x: 0, y: 0 })).toBe(true)
    expect(elementContainsPoint(square, { x: 100, y: 100 })).toBe(true)
  })

  it('falls through a rounded corner to the element behind it', () => {
    const scene = sceneFrom([
      el('behind', { zIndex: 0, x: 0, y: 0, width: 100, height: 100 }),
      el('front', {
        zIndex: 1,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        style: { ...DEFAULT_ELEMENT_STYLE, cornerRadius: 20 },
      }),
    ])
    expect(hitTest(scene, { x: 50, y: 50 })?.id).toBe('front')
    expect(hitTest(scene, { x: 2, y: 2 })?.id).toBe('behind')
  })
})

describe('effectiveCornerRadius', () => {
  it('clamps to half the shorter side', () => {
    const wide = el('a', { width: 200, height: 60, style: { ...DEFAULT_ELEMENT_STYLE, cornerRadius: 500 } })
    expect(effectiveCornerRadius(wide)).toBe(30)
  })

  it('passes a radius that already fits through untouched', () => {
    const fits = el('a', { width: 200, height: 60, style: { ...DEFAULT_ELEMENT_STYLE, cornerRadius: 8 } })
    expect(effectiveCornerRadius(fits)).toBe(8)
  })

  it('is zero for every kind but rectangle', () => {
    // Clamping at DRAW time rather than on write is what lets a shape be
    // resized small and large again without losing the radius the user chose
    // — so a stored radius outlives geometry that cannot show it, and must
    // not leak into a kind that has no corners.
    for (const kind of ['ellipse', 'diamond', 'triangle', 'text'] as const) {
      const element = el('a', {
        kind,
        style: { ...DEFAULT_ELEMENT_STYLE, cornerRadius: 20 },
      })
      expect(effectiveCornerRadius(element)).toBe(0)
    }
  })

  it('is zero for a radius that is absent, zero or nonsense', () => {
    for (const cornerRadius of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const element = el('a', { style: { ...DEFAULT_ELEMENT_STYLE, cornerRadius } })
      expect(effectiveCornerRadius(element)).toBe(0)
    }
  })
})

describe('non-rectangular shape containment', () => {
  // The whole point of these three kinds: the CORNER of the bounding box is
  // outside the shape. If any of them fell back to a rect test, a click in
  // that corner would select the shape instead of falling through to whatever
  // is behind it, and overlapping shapes would be impossible to pick apart.
  const box = { x: 0, y: 0, width: 100, height: 100 }

  it('excludes the corners of an ellipse and includes its centre and axis ends', () => {
    const element = el('e', { kind: 'ellipse', ...box })
    expect(elementContainsPoint(element, { x: 50, y: 50 })).toBe(true)
    expect(elementContainsPoint(element, { x: 0, y: 50 })).toBe(true)
    expect(elementContainsPoint(element, { x: 50, y: 100 })).toBe(true)
    expect(elementContainsPoint(element, { x: 0, y: 0 })).toBe(false)
    expect(elementContainsPoint(element, { x: 100, y: 100 })).toBe(false)
  })

  it('scales an ellipse independently on each axis', () => {
    // A wide, flat ellipse. A circle-with-uniform-radius implementation gets
    // this wrong in both directions at once, so both are asserted.
    const element = el('e', { kind: 'ellipse', x: 0, y: 0, width: 200, height: 20 })
    expect(elementContainsPoint(element, { x: 190, y: 10 })).toBe(true)
    expect(elementContainsPoint(element, { x: 100, y: 19 })).toBe(true)
    expect(elementContainsPoint(element, { x: 190, y: 2 })).toBe(false)
  })

  it('excludes the corners of a diamond and includes its edge midpoints', () => {
    const element = el('d', { kind: 'diamond', ...box })
    expect(elementContainsPoint(element, { x: 50, y: 50 })).toBe(true)
    expect(elementContainsPoint(element, { x: 50, y: 0 })).toBe(true)
    expect(elementContainsPoint(element, { x: 100, y: 50 })).toBe(true)
    expect(elementContainsPoint(element, { x: 0, y: 0 })).toBe(false)
    expect(elementContainsPoint(element, { x: 99, y: 99 })).toBe(false)
    // Just inside and just outside the same edge, to pin the boundary rather
    // than only the obviously-far points.
    expect(elementContainsPoint(element, { x: 26, y: 26 })).toBe(true)
    expect(elementContainsPoint(element, { x: 24, y: 24 })).toBe(false)
  })

  it('gives a triangle its apex at the top and its base along the bottom', () => {
    const element = el('t', { kind: 'triangle', ...box })
    expect(elementContainsPoint(element, { x: 50, y: 0 })).toBe(true)
    expect(elementContainsPoint(element, { x: 0, y: 100 })).toBe(true)
    expect(elementContainsPoint(element, { x: 100, y: 100 })).toBe(true)
    expect(elementContainsPoint(element, { x: 50, y: 90 })).toBe(true)
    // The TOP corners are outside — this is what distinguishes an apex-up
    // triangle from an apex-down one, which a bounding-box test cannot see.
    expect(elementContainsPoint(element, { x: 0, y: 0 })).toBe(false)
    expect(elementContainsPoint(element, { x: 100, y: 10 })).toBe(false)
    expect(elementContainsPoint(element, { x: 50, y: 101 })).toBe(false)
  })

  it('reports nothing inside a degenerate shape rather than dividing by zero', () => {
    for (const kind of ['ellipse', 'diamond', 'triangle'] as const) {
      const element = el('z', { kind, x: 0, y: 0, width: 0, height: 0 })
      expect(elementContainsPoint(element, { x: 0, y: 0 })).toBe(false)
    }
  })

  it('lets a click in the corner of an ellipse reach the rectangle behind it', () => {
    // The behavioural statement of all of the above: the reverse-z scan keeps
    // walking when the topmost element's own outline does not contain the
    // point.
    const scene = sceneFrom([
      el('behind', { zIndex: 0, ...box }),
      el('front', { kind: 'ellipse', zIndex: 1, ...box }),
    ])
    expect(hitTest(scene, { x: 50, y: 50 })?.id).toBe('front')
    expect(hitTest(scene, { x: 2, y: 2 })?.id).toBe('behind')
  })
})

describe('hitTestRect (marquee)', () => {
  const scene = sceneFrom([
    el('a', { zIndex: 0, x: 0, y: 0, width: 100, height: 100 }),
    el('b', { zIndex: 1, x: 300, y: 0, width: 100, height: 100 }),
    el('c', { zIndex: 2, x: 600, y: 600, width: 100, height: 100 }),
  ])

  it('selects everything the marquee touches', () => {
    expect(
      hitTestRect(scene, { x: -10, y: -10, width: 420, height: 200 }).map(
        (e) => e.id,
      ),
    ).toEqual(['a', 'b'])
  })

  it('selects on partial overlap, not just full containment', () => {
    // Clipping a corner is enough — requiring containment makes large
    // elements nearly impossible to marquee-select.
    expect(
      hitTestRect(scene, { x: 90, y: 90, width: 20, height: 20 }).map((e) => e.id),
    ).toEqual(['a'])
  })

  it('handles a marquee dragged up-and-left (negative extents)', () => {
    // Negative width/height silently match nothing if not normalised.
    const dragged = { x: 110, y: 110, width: -120, height: -120 }
    expect(hitTestRect(scene, dragged).map((e) => e.id)).toEqual(['a'])
  })

  it('returns results in ascending z-order', () => {
    const all = hitTestRect(scene, { x: -1000, y: -1000, width: 5000, height: 5000 })
    expect(all.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('returns nothing for an empty marquee', () => {
    expect(hitTestRect(scene, { x: 200, y: 200, width: 0, height: 0 })).toEqual([])
  })
})

describe('rect helpers', () => {
  it('normalises negative extents', () => {
    expect(normaliseRect({ x: 10, y: 10, width: -10, height: -4 })).toEqual({
      x: 0,
      y: 6,
      width: 10,
      height: 4,
    })
  })

  it('builds a positive rect from two points in any order', () => {
    const a = rectFromPoints({ x: 100, y: 100 }, { x: 0, y: 0 })
    const b = rectFromPoints({ x: 0, y: 0 }, { x: 100, y: 100 })
    expect(a).toEqual(b)
  })

  it('treats touching edges as not intersecting', () => {
    expect(
      rectsIntersect(
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 10, y: 0, width: 10, height: 10 },
      ),
    ).toBe(false)
  })
})

describe('remapConnectorEndpoints', () => {
  const A = 'a'
  const B = 'b'
  const SERVER = 'server-id'

  function connector(sourceId: string, targetId: string): CanvasElement {
    return {
      id: 'c1',
      kind: 'connector',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      rotation: 0,
      zIndex: 0,
      text: null,
      style: { ...DEFAULT_ELEMENT_STYLE },
      connector: {
        source: { kind: 'element', elementId: sourceId },
        target: { kind: 'element', elementId: targetId },
        routing: DEFAULT_CONNECTOR_ROUTING,
      },
    }
  }

  it('repoints a target endpoint', () => {
    // An element created optimistically carries a client uuid the server
    // replaces. Without this the connector names a row that never existed:
    // it stops being drawable AND stops being found by the delete cascade.
    const next = remapConnectorEndpoints(sceneFrom([connector(A, B)]), B, SERVER)
    expect(next.byId.get('c1')?.connector).toEqual({
        source: { kind: 'element', elementId: A },
        target: { kind: 'element', elementId: SERVER },
        routing: DEFAULT_CONNECTOR_ROUTING,
      })
  })

  it('repoints a source endpoint', () => {
    const next = remapConnectorEndpoints(sceneFrom([connector(A, B)]), A, SERVER)
    expect(next.byId.get('c1')?.connector?.source).toEqual({
      kind: 'element',
      elementId: SERVER,
    })
  })

  it('repoints BOTH ends of a connector that somehow names the id twice', () => {
    const next = remapConnectorEndpoints(sceneFrom([connector(A, A)]), A, SERVER)
    expect(next.byId.get('c1')?.connector).toEqual({
        source: { kind: 'element', elementId: SERVER },
        target: { kind: 'element', elementId: SERVER },
        routing: DEFAULT_CONNECTOR_ROUTING,
      })
  })

  it('returns the SAME scene when nothing referenced the id', () => {
    // Identity is the contract `updateElement` already keeps, and it is what
    // lets React skip a render on every unrelated reconciliation.
    const scene = sceneFrom([connector(A, B)])
    expect(remapConnectorEndpoints(scene, 'unrelated', SERVER)).toBe(scene)
  })

  it('leaves non-connector elements untouched', () => {
    const rect: CanvasElement = {
      id: A,
      kind: 'rectangle',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rotation: 0,
      zIndex: 0,
      text: null,
      style: { ...DEFAULT_ELEMENT_STYLE },
    }
    const next = remapConnectorEndpoints(sceneFrom([rect, connector(A, B)]), A, SERVER)
    // The ELEMENT's own id is renamed by useCanvasElements, not here — this
    // function only ever rewrites references TO it.
    expect(next.byId.get(A)?.id).toBe(A)
  })
})
