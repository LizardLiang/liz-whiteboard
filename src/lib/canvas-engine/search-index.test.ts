// src/lib/canvas-engine/search-index.test.ts
// Unit tests for the Cmd/Ctrl+K canvas search index builder.

import { describe, expect, it } from 'vitest'
import { buildCanvasSearchIndex } from './search-index'
import { DEFAULT_ELEMENT_STYLE, sceneFrom } from './scene'
import type { CanvasElement } from './scene'

/** Minimal element factory — mirrors scene.test.ts's own `el` helper. */
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

describe('buildCanvasSearchIndex', () => {
  it('returns an empty index for an empty scene', () => {
    expect(buildCanvasSearchIndex(sceneFrom([]))).toEqual([])
  })

  it('emits one entry per labelled element, carrying id/kind/text', () => {
    const scene = sceneFrom([
      el('a', { kind: 'rectangle', text: 'alpha crate', zIndex: 0 }),
    ])

    expect(buildCanvasSearchIndex(scene)).toEqual([
      { elementId: 'a', kind: 'rectangle', text: 'alpha crate' },
    ])
  })

  it('skips an element whose text is null', () => {
    const scene = sceneFrom([el('a', { text: null })])

    expect(buildCanvasSearchIndex(scene)).toEqual([])
  })

  it('skips an element whose text is empty or whitespace-only after trimming', () => {
    const scene = sceneFrom([
      el('a', { text: '' }),
      el('b', { text: '   ' }),
    ])

    expect(buildCanvasSearchIndex(scene)).toEqual([])
  })

  it('trims surrounding whitespace from the indexed text', () => {
    const scene = sceneFrom([el('a', { text: '  padded  ' })])

    expect(buildCanvasSearchIndex(scene)).toEqual([
      { elementId: 'a', kind: 'rectangle', text: 'padded' },
    ])
  })

  it('skips group elements even when hand-given text', () => {
    const scene = sceneFrom([
      el('g', { kind: 'group', text: 'should not appear', zIndex: 0 }),
      el('a', { kind: 'rectangle', text: 'alpha crate', zIndex: 1 }),
    ])

    expect(buildCanvasSearchIndex(scene)).toEqual([
      { elementId: 'a', kind: 'rectangle', text: 'alpha crate' },
    ])
  })

  it('indexes connectors', () => {
    const scene = sceneFrom([
      el('c', { kind: 'connector', text: 'alpha link', zIndex: 0 }),
    ])

    expect(buildCanvasSearchIndex(scene)).toEqual([
      { elementId: 'c', kind: 'connector', text: 'alpha link' },
    ])
  })

  it('indexes every non-group kind: rectangle, ellipse, diamond, triangle, text, connector', () => {
    const scene = sceneFrom([
      el('rect', { kind: 'rectangle', text: 'r', zIndex: 0 }),
      el('ell', { kind: 'ellipse', text: 'e', zIndex: 1 }),
      el('dia', { kind: 'diamond', text: 'd', zIndex: 2 }),
      el('tri', { kind: 'triangle', text: 't', zIndex: 3 }),
      el('txt', { kind: 'text', text: 'x', zIndex: 4 }),
      el('con', { kind: 'connector', text: 'c', zIndex: 5 }),
    ])

    const kinds = buildCanvasSearchIndex(scene).map((entry) => entry.kind)
    expect(kinds).toEqual([
      'rectangle',
      'ellipse',
      'diamond',
      'triangle',
      'text',
      'connector',
    ])
  })

  it('preserves scene (z-order) order rather than sorting by kind', () => {
    // Deliberately interleaved kinds at ascending zIndex — a kind-based sort
    // would group all rectangles before the connector; scene order does not.
    const scene = sceneFrom([
      el('conn', { kind: 'connector', text: 'first', zIndex: 0 }),
      el('rect', { kind: 'rectangle', text: 'second', zIndex: 1 }),
      el('text', { kind: 'text', text: 'third', zIndex: 2 }),
    ])

    expect(buildCanvasSearchIndex(scene).map((entry) => entry.elementId)).toEqual([
      'conn',
      'rect',
      'text',
    ])
  })
})
