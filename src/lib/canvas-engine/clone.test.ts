// src/lib/canvas-engine/clone.test.ts
// Copy planning: what is reproduced, what is regenerated, what is dropped,
// and the order the result must be persisted in.

import { describe, expect, it } from 'vitest'
import {
  CLONE_OFFSET,
  MAX_BOARD_COORD,
  Z_MAX,
  cloneTargets,
  planClone,
} from './clone'
import { DEFAULT_ELEMENT_STYLE, sceneFrom } from './scene'
import type { CanvasElement, ConnectorEndpoint } from './scene'
import {
  CANVAS_ZINDEX_MAX,
  MAX_BOARD_COORD as SCHEMA_MAX_BOARD_COORD,
} from '@/data/schema'

function el(
  id: string,
  patch: Partial<CanvasElement> = {},
): CanvasElement {
  return {
    id,
    kind: 'rectangle',
    x: 100,
    y: 200,
    width: 160,
    height: 100,
    rotation: 0,
    zIndex: 0,
    text: null,
    style: { ...DEFAULT_ELEMENT_STYLE },
    ...patch,
  }
}

function connector(
  id: string,
  source: ConnectorEndpoint,
  target: ConnectorEndpoint,
  patch: Partial<CanvasElement> = {},
): CanvasElement {
  return el(id, {
    kind: 'connector',
    width: 1,
    height: 1,
    connector: { source, target, routing: 'elbow' },
    ...patch,
  })
}

const attached = (elementId: string): ConnectorEndpoint => ({
  kind: 'element',
  elementId,
})
const free = (x: number, y: number): ConnectorEndpoint => ({
  kind: 'point',
  point: { x, y },
})

/** A deterministic id factory, so every expectation below can name the copies. */
function ids() {
  let n = 0
  return () => `copy-${++n}`
}

const plan = (
  targets: Array<CanvasElement>,
  placement: Partial<{ offsetIndex: number; topZIndex: number }> = {},
) =>
  planClone(targets, {
    offsetIndex: placement.offsetIndex ?? 0,
    topZIndex: placement.topZIndex ?? 0,
    nextId: ids(),
  })

describe('the restated bounds agree with the schema', () => {
  it('restates boardCoordSchema and canvasZIndexSchema exactly', () => {
    // The engine imports nothing, so this module declares the ranges
    // independently. A clamp that disagreed with the validator would produce
    // a value the write path rejects — a failed paste with no visible cause.
    expect(MAX_BOARD_COORD).toBe(SCHEMA_MAX_BOARD_COORD)
    expect(Z_MAX).toBe(CANVAS_ZINDEX_MAX)
  })
})

describe('cloneTargets', () => {
  it('returns the selected elements in ascending paint order', () => {
    const targets = cloneTargets(
      sceneFrom([el('a', { zIndex: 2 }), el('b', { zIndex: 0 }), el('c', { zIndex: 1 })]),
      new Set(['a', 'b']),
    )
    expect(targets.map((e) => e.id)).toEqual(['b', 'a'])
  })

  it('includes connectors, unlike zOrderTargets', () => {
    // A connector cannot be RE-ORDERED meaningfully, but it can certainly be
    // copied. Whether it survives is decided by its ends, not by its kind.
    const targets = cloneTargets(
      sceneFrom([el('a'), connector('con', attached('a'), attached('a'))]),
      new Set(['a', 'con']),
    )
    expect(targets.map((e) => e.id)).toEqual(['a', 'con'])
  })
})

describe('what a copy reproduces', () => {
  it('reproduces every stored property verbatim', () => {
    const source = el('a', {
      kind: 'ellipse',
      width: 321,
      height: 123,
      rotation: 45,
      text: 'hello',
      style: { ...DEFAULT_ELEMENT_STYLE, fill: '#ff0000', strokeWidth: 4 },
    })
    const [copy] = plan([source]).elements
    expect(copy.kind).toBe('ellipse')
    expect(copy.width).toBe(321)
    expect(copy.height).toBe(123)
    expect(copy.rotation).toBe(45)
    expect(copy.text).toBe('hello')
    expect(copy.style).toEqual(source.style)
  })

  it('keeps a text element STORED geometry rather than re-deriving it', () => {
    // Nothing on this path holds a text measurer, and a re-derived width
    // without one collapses the element to nothing.
    const [copy] = plan([
      el('t', { kind: 'text', text: 'a long label', width: 240, height: 28 }),
    ]).elements
    expect(copy.width).toBe(240)
    expect(copy.height).toBe(28)
  })

  it('gives the copy its own style object', () => {
    // Sharing one would make a later restyle of the copy silently repaint the
    // original too.
    const source = el('a')
    const [copy] = plan([source]).elements
    expect(copy.style).not.toBe(source.style)
  })

  it('mints a fresh id and maps the original to it', () => {
    const result = plan([el('a'), el('b')])
    expect(result.elements.map((e) => e.id)).toEqual(['copy-1', 'copy-2'])
    expect(result.idMap.get('a')).toBe('copy-1')
    expect(result.idMap.get('b')).toBe('copy-2')
  })
})

describe('where a copy lands', () => {
  it('offsets the copy so it is not hidden under its original', () => {
    const [copy] = plan([el('a', { x: 100, y: 200 })]).elements
    expect(copy.x).toBe(100 + CLONE_OFFSET)
    expect(copy.y).toBe(200 + CLONE_OFFSET)
  })

  it('steps further out on each repeated paste of the same buffer', () => {
    const [third] = plan([el('a', { x: 0, y: 0 })], { offsetIndex: 2 }).elements
    expect(third.x).toBe(CLONE_OFFSET * 3)
    expect(third.y).toBe(CLONE_OFFSET * 3)
  })

  it('lifts the copy above the board top', () => {
    const [copy] = plan([el('a', { zIndex: 0 })], { topZIndex: 7 }).elements
    expect(copy.zIndex).toBe(8)
  })

  it('keeps a multi-element copy stacked among itself', () => {
    // `a` is below `b` before; it must still be below `b` after, or copying a
    // group silently reshuffles it.
    const copies = plan([el('a', { zIndex: 0 }), el('b', { zIndex: 5 })], {
      topZIndex: 5,
    }).elements
    expect(copies.map((e) => e.zIndex)).toEqual([6, 7])
  })

  it('clamps the position at the board bound instead of writing past it', () => {
    const [copy] = plan([
      el('a', { x: MAX_BOARD_COORD - 10, y: -MAX_BOARD_COORD }),
    ]).elements
    expect(copy.x).toBe(MAX_BOARD_COORD)
    expect(copy.y).toBe(-MAX_BOARD_COORD + CLONE_OFFSET)
  })

  it('clamps the paint order at the ceiling the same way', () => {
    const [copy] = plan([el('a')], { topZIndex: Z_MAX }).elements
    expect(copy.zIndex).toBe(Z_MAX)
  })
})

describe('connectors', () => {
  it('copies a connector whose BOTH ends are in the selection, rewired to the copies', () => {
    const result = plan([
      el('a'),
      el('b'),
      connector('con', attached('a'), attached('b')),
    ])
    const copy = result.elements.find((e) => e.kind === 'connector')
    expect(copy?.connector?.source).toEqual({
      kind: 'element',
      elementId: result.idMap.get('a'),
    })
    expect(copy?.connector?.target).toEqual({
      kind: 'element',
      elementId: result.idMap.get('b'),
    })
  })

  it('preserves the connector routing and its endpoint attach points', () => {
    const source: ConnectorEndpoint = {
      kind: 'element',
      elementId: 'a',
      attach: { x: 0.25, y: 1 },
    }
    const result = plan([el('a'), el('b'), connector('con', source, attached('b'))])
    const copy = result.elements.find((e) => e.kind === 'connector')
    expect(copy?.connector?.routing).toBe('elbow')
    expect(copy?.connector?.source).toEqual({
      kind: 'element',
      elementId: result.idMap.get('a'),
      attach: { x: 0.25, y: 1 },
    })
  })

  it('DROPS a connector with one end outside the selection', () => {
    // Repointing that end at the original would wire the new copy back into
    // the diagram it was copied out of.
    const result = plan([el('a'), connector('con', attached('a'), attached('outside'))])
    expect(result.elements.map((e) => e.id)).toEqual(['copy-1'])
    expect(result.idMap.has('con')).toBe(false)
  })

  it('DROPS a connector with a free end, which has no copy to attach to', () => {
    const result = plan([el('a'), connector('con', attached('a'), free(10, 10))])
    expect(result.elements).toHaveLength(1)
  })

  it('drops a connector selected entirely on its own', () => {
    const result = plan([connector('con', attached('a'), attached('b'))])
    expect(result.elements).toEqual([])
    expect(result.idMap.size).toBe(0)
  })

  it('handles a connector whose two ends are the SAME copied element', () => {
    const result = plan([el('a'), connector('con', attached('a'), attached('a'))])
    const copy = result.elements.find((e) => e.kind === 'connector')
    expect(copy?.connector?.source).toEqual({
      kind: 'element',
      elementId: result.idMap.get('a'),
    })
    expect(copy?.connector?.target).toEqual({
      kind: 'element',
      elementId: result.idMap.get('a'),
    })
  })
})

describe('the order of the plan', () => {
  it('puts every non-connector before every connector', () => {
    // The persistence contract: a connector's endpoints name elements whose
    // server ids do not exist until their own creates are acknowledged.
    const result = plan([
      connector('con', attached('a'), attached('b')),
      el('a'),
      el('b'),
    ])
    expect(result.elements.map((e) => e.kind)).toEqual([
      'rectangle',
      'rectangle',
      'connector',
    ])
  })
})

describe('degenerate input', () => {
  it('plans nothing for an empty selection', () => {
    const result = plan([])
    expect(result.elements).toEqual([])
    expect(result.idMap.size).toBe(0)
  })

  it('leaves the originals untouched', () => {
    const source = el('a', { x: 100, y: 200, zIndex: 3 })
    const snapshot = JSON.stringify(source)
    plan([source], { topZIndex: 9 })
    expect(JSON.stringify(source)).toBe(snapshot)
  })
})
