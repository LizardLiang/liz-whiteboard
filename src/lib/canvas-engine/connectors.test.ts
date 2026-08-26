// src/lib/canvas-engine/connectors.test.ts
// How the rest of the engine behaves once an element has no meaningful bounds
// of its own (canvas quick-create-handles tactical plan, Wave 2).
//
// A connector's geometry is DERIVED from its two endpoints, and its stored
// x/y/width/height are a 1x1 placeholder that nothing may read. Every helper
// below builds that placeholder somewhere deliberately wrong — at the origin,
// far from the line it draws — so any code path that reads it instead of
// deriving the path fails here rather than in a browser.
//
// Scene relationships and hit-testing are tested together for the same reason
// scene.test.ts already pairs them: the property that matters spans both.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ELEMENT_STYLE,
  connectorsTouching,
  sceneFrom,
  withAttachedConnectors,
} from './scene'
import {
  elementContainsPoint,
  hitTest,
  hitTestRect,
  pointNearPolyline,
  resolvedBounds,
} from './hit-test'
import type { CanvasConnectorRouting, CanvasElement } from './scene'

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
    style: DEFAULT_ELEMENT_STYLE,
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
    // The degenerate placeholder a real connector row carries. It sits at the
    // origin — inside element 'a' in most scenes below — precisely so that
    // reading it by mistake produces a visible wrong answer.
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

/** 'a' at 0..100, 'b' at 300..400, both y 0..100. The line runs along y=50. */
const LINEAR = sceneFrom([
  el('a', { x: 0, y: 0, zIndex: 0 }),
  el('b', { x: 300, y: 0, zIndex: 1 }),
  conn('ab', 'a', 'b', 'straight', { zIndex: 2 }),
])

describe('connectorsTouching', () => {
  const scene = sceneFrom([
    el('a', { x: 0, y: 0 }),
    el('b', { x: 300, y: 0 }),
    el('c', { x: 600, y: 0 }),
    conn('ab', 'a', 'b'),
    conn('bc', 'b', 'c'),
  ])

  it('finds a connector by its source', () => {
    expect(connectorsTouching(scene, 'a').map((e) => e.id)).toEqual(['ab'])
  })

  it('finds a connector by its target', () => {
    expect(connectorsTouching(scene, 'c').map((e) => e.id)).toEqual(['bc'])
  })

  it('finds every connector at a shared endpoint', () => {
    expect(
      connectorsTouching(scene, 'b')
        .map((e) => e.id)
        .sort(),
    ).toEqual(['ab', 'bc'])
  })

  it('is empty for an unconnected element', () => {
    expect(connectorsTouching(sceneFrom([el('lonely')]), 'lonely')).toEqual([])
  })

  it('never returns a non-connector', () => {
    for (const found of connectorsTouching(scene, 'b')) {
      expect(found.connector).toBeDefined()
    }
  })
})

describe('withAttachedConnectors', () => {
  const scene = sceneFrom([
    el('a', { x: 0, y: 0 }),
    el('b', { x: 300, y: 0 }),
    el('c', { x: 600, y: 0 }),
    conn('ab', 'a', 'b'),
    conn('bc', 'b', 'c'),
  ])

  it('expands one element into itself plus its connectors', () => {
    expect(withAttachedConnectors(scene, ['a']).sort()).toEqual(['a', 'ab'])
  })

  it('deduplicates a connector reached from both of its endpoints', () => {
    // Deleting a AND b reaches 'ab' twice. Two delete operations for one row
    // would make the second inverse restore a row the first already restored.
    expect(withAttachedConnectors(scene, ['a', 'b']).sort()).toEqual([
      'a',
      'ab',
      'b',
      'bc',
    ])
  })

  it('leaves an unconnected selection untouched', () => {
    expect(withAttachedConnectors(sceneFrom([el('x')]), ['x'])).toEqual(['x'])
  })

  it('is a no-op for an empty selection', () => {
    expect(withAttachedConnectors(scene, [])).toEqual([])
  })
})

describe('pointNearPolyline', () => {
  const line = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ]

  it('hits on the line and within the tolerance', () => {
    expect(pointNearPolyline(line, { x: 50, y: 0 }, 5)).toBe(true)
    expect(pointNearPolyline(line, { x: 50, y: 4 }, 5)).toBe(true)
  })

  it('misses beyond the tolerance', () => {
    expect(pointNearPolyline(line, { x: 50, y: 6 }, 5)).toBe(false)
  })

  it('clamps to the segment rather than extending the infinite line', () => {
    // Without clamping, a point far past the end reads as being right on the
    // line, and empty space beyond a short connector would select it.
    expect(pointNearPolyline(line, { x: 400, y: 0 }, 5)).toBe(false)
    expect(pointNearPolyline(line, { x: 103, y: 0 }, 5)).toBe(true)
  })

  it('follows every segment of a multi-segment path', () => {
    const elbow = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]
    expect(pointNearPolyline(elbow, { x: 100, y: 50 }, 5)).toBe(true)
    expect(pointNearPolyline(elbow, { x: 50, y: 50 }, 5)).toBe(false)
  })

  it('handles degenerate inputs without dividing by zero', () => {
    expect(pointNearPolyline([], { x: 0, y: 0 }, 5)).toBe(false)
    expect(pointNearPolyline([{ x: 0, y: 0 }], { x: 3, y: 0 }, 5)).toBe(true)
    expect(pointNearPolyline([{ x: 0, y: 0 }], { x: 9, y: 0 }, 5)).toBe(false)
    expect(
      pointNearPolyline(
        [
          { x: 5, y: 5 },
          { x: 5, y: 5 },
        ],
        { x: 5, y: 7 },
        5,
      ),
    ).toBe(true)
  })
})

describe('hitTest with connectors', () => {
  it('grabs a connector by its derived line, not its stored bounds', () => {
    expect(hitTest(LINEAR, { x: 200, y: 50 })?.id).toBe('ab')
  })

  it('misses the line beyond the tolerance', () => {
    expect(hitTest(LINEAR, { x: 200, y: 120 })).toBeNull()
  })

  it('honours a caller-supplied tolerance', () => {
    expect(hitTest(LINEAR, { x: 200, y: 70 }, 8)).toBeNull()
    expect(hitTest(LINEAR, { x: 200, y: 70 }, 40)?.id).toBe('ab')
  })

  it('is never hit through its 1x1 placeholder bounds', () => {
    // The placeholder sits at the origin, inside 'a'. A hit there must
    // resolve to 'a' — never to the connector.
    expect(hitTest(LINEAR, { x: 0, y: 0 })?.id).toBe('a')
  })

  it('does not grab a connector through an element painted over it', () => {
    // The connector has the HIGHEST z here, but connectors paint beneath
    // everything (render.ts's two-pass draw). Hit-testing has to agree with
    // what the user can see, or clicking a box sometimes selects the arrow.
    const covered = sceneFrom([
      el('a', { x: 0, y: 0 }),
      el('b', { x: 300, y: 0 }),
      el('over', { x: 150, y: 0, width: 100, height: 100, zIndex: 0 }),
      conn('ab', 'a', 'b', 'straight', { zIndex: 99 }),
    ])
    expect(hitTest(covered, { x: 200, y: 50 })?.id).toBe('over')
  })

  it('ignores a connector whose endpoint is gone', () => {
    const orphaned = sceneFrom([
      el('a', { x: 0, y: 0 }),
      conn('ab', 'a', 'ghost'),
    ])
    expect(hitTest(orphaned, { x: 200, y: 50 })).toBeNull()
  })

  it('ignores a connector between concentric elements', () => {
    const stacked = sceneFrom([
      el('a', { x: 0, y: 0 }),
      el('b', { x: 0, y: 0 }),
      conn('ab', 'a', 'b'),
    ])
    // Some element is there, but never the undrawable connector.
    expect(stacked.elements.length).toBe(3)
    expect(hitTest(stacked, { x: 200, y: 50 })).toBeNull()
  })

  it('finds an elbow connector along its bend', () => {
    const bent = sceneFrom([
      el('a', { x: 0, y: 0 }),
      el('b', { x: 300, y: 200 }),
      conn('ab', 'a', 'b', 'elbow'),
    ])
    // Exits right at (100,50), turns at x=200, enters left at (300,250).
    expect(hitTest(bent, { x: 200, y: 150 })?.id).toBe('ab')
    expect(hitTest(bent, { x: 260, y: 150 })).toBeNull()
  })
})

describe('elementContainsPoint for a connector', () => {
  it('is always false — the scene-aware path owns that case', () => {
    // This predicate has no scene, so it cannot resolve endpoints. Returning
    // false rather than testing the placeholder bounds is what stops a click
    // at the origin selecting every connector on the board.
    const connector = conn('ab', 'a', 'b')
    expect(elementContainsPoint(connector, { x: 0, y: 0 })).toBe(false)
    expect(elementContainsPoint(connector, { x: 200, y: 50 })).toBe(false)
  })
})

describe('resolvedBounds', () => {
  it('is the plain bounds for a non-connector', () => {
    expect(resolvedBounds(LINEAR, el('a', { x: 10, y: 20 }))).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 100,
    })
  })

  it('is the derived path box for a connector, not the placeholder', () => {
    const connector = LINEAR.byId.get('ab')!
    expect(resolvedBounds(LINEAR, connector)).toEqual({
      x: 100,
      y: 50,
      width: 200,
      height: 0,
    })
  })

  it('is null for a connector with a missing endpoint', () => {
    const orphaned = sceneFrom([
      el('a', { x: 0, y: 0 }),
      conn('ab', 'a', 'ghost'),
    ])
    expect(resolvedBounds(orphaned, orphaned.byId.get('ab')!)).toBeNull()
  })
})

describe('hitTestRect with connectors', () => {
  const scene = sceneFrom([
    el('a', { x: 0, y: 0, zIndex: 0 }),
    el('b', { x: 300, y: 0, zIndex: 1 }),
    el('c', { x: 900, y: 0, zIndex: 2 }),
    conn('ab', 'a', 'b', 'straight', { zIndex: 3 }),
    conn('ac', 'a', 'c', 'straight', { zIndex: 4 }),
  ])
  const AROUND_A_AND_B = { x: -10, y: -10, width: 430, height: 130 }

  it('selects a connector when BOTH endpoints are inside', () => {
    expect(
      hitTestRect(scene, AROUND_A_AND_B)
        .map((e) => e.id)
        .sort(),
    ).toEqual(['a', 'ab', 'b'])
  })

  it('leaves a connector out when only one endpoint is inside', () => {
    // 'ac' crosses this marquee, but 'c' is far outside it. Intersection
    // would sweep up every long arrow that happens to pass through.
    expect(hitTestRect(scene, AROUND_A_AND_B).map((e) => e.id)).not.toContain(
      'ac',
    )
  })

  it('does not select a connector merely crossed by the marquee', () => {
    // A small marquee in the empty space between the elements: it crosses
    // both connector lines and contains neither endpoint.
    expect(hitTestRect(scene, { x: 150, y: 40, width: 20, height: 20 })).toEqual(
      [],
    )
  })

  it('returns results in ascending z-order', () => {
    const zs = hitTestRect(scene, AROUND_A_AND_B).map((e) => e.zIndex)
    expect([...zs].sort((p, q) => p - q)).toEqual(zs)
  })

  it('still selects plain elements exactly as before', () => {
    const plain = sceneFrom([el('a', { x: 0, y: 0 }), el('b', { x: 300, y: 0 })])
    expect(
      hitTestRect(plain, { x: -10, y: -10, width: 430, height: 130 }).map(
        (e) => e.id,
      ),
    ).toEqual(['a', 'b'])
  })
})
