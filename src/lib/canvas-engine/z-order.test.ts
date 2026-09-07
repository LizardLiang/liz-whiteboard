// src/lib/canvas-engine/z-order.test.ts
// Paint-order planning: what moves, what does not, and what the plan leaves
// alone.

import { describe, expect, it } from 'vitest'
import { Z_MAX, Z_MIN, planZOrder, zOrderTargets } from './z-order'
import { DEFAULT_ELEMENT_STYLE, sceneFrom } from './scene'
import type { CanvasElement } from './scene'
import { CANVAS_ZINDEX_MAX, CANVAS_ZINDEX_MIN } from '@/data/schema'

function el(id: string, zIndex: number, patch: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id,
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    zIndex,
    text: null,
    style: { ...DEFAULT_ELEMENT_STYLE },
    ...patch,
  }
}

function group(
  id: string,
  zIndex: number,
  childIds: Array<string>,
): CanvasElement {
  return el(id, zIndex, { kind: 'group', group: { childIds } })
}

function connector(id: string, zIndex: number): CanvasElement {
  return el(id, zIndex, {
    kind: 'connector',
    width: 1,
    height: 1,
    connector: {
      source: { kind: 'point', point: { x: 0, y: 0 } },
      target: { kind: 'point', point: { x: 10, y: 10 } },
      routing: 'straight',
    },
  })
}

const plan = (
  elements: Array<CanvasElement>,
  ids: Array<string>,
  command: 'front' | 'back',
) => planZOrder(sceneFrom(elements), new Set(ids), command)

describe('the bounds agree with the schema', () => {
  it('restates canvasZIndexSchema exactly', () => {
    // The engine imports nothing, so the two declare the range independently.
    // A clamp that disagreed with the validator would produce a value the
    // write path rejects — a failed save with no user-visible cause.
    expect(Z_MIN).toBe(CANVAS_ZINDEX_MIN)
    expect(Z_MAX).toBe(CANVAS_ZINDEX_MAX)
  })
})

describe('zOrderTargets', () => {
  it('returns the selected elements in ascending paint order', () => {
    const targets = zOrderTargets(
      sceneFrom([el('a', 2), el('b', 0), el('c', 1)]),
      new Set(['a', 'b']),
    )
    expect(targets.map((e) => e.id)).toEqual(['b', 'a'])
  })

  it('excludes connectors, which the renderer paints beneath everything anyway', () => {
    const targets = zOrderTargets(
      sceneFrom([el('a', 0), connector('con', 1)]),
      new Set(['a', 'con']),
    )
    expect(targets.map((e) => e.id)).toEqual(['a'])
  })

  it('covers text as well as shapes — both are painted in z-order', () => {
    const targets = zOrderTargets(
      sceneFrom([el('t', 0, { kind: 'text' }), el('s', 1)]),
      new Set(['t', 's']),
    )
    expect(targets.map((e) => e.id)).toEqual(['t', 's'])
  })

  it('expands a selected group to its whole subtree (FR-015)', () => {
    // outer > mid > {a, b}: selecting only the OUTER group's id must still
    // sweep mid and both leaves into the target set, or a z-order command
    // would move the group's own frame without its members, tearing the
    // group apart visually — the exact failure FR-015 exists to prevent.
    const targets = zOrderTargets(
      sceneFrom([
        el('a', 1),
        el('x', 2), // not a member — must stay excluded
        el('b', 3),
        group('mid', 4, ['a', 'b']),
        group('outer', 0, ['mid']),
      ]),
      new Set(['outer']),
    )
    expect(new Set(targets.map((e) => e.id))).toEqual(
      new Set(['outer', 'mid', 'a', 'b']),
    )
    expect(targets.map((e) => e.id)).not.toContain('x')
  })
})

describe('bring to front', () => {
  it('lifts one element above the current top', () => {
    expect(plan([el('a', 0), el('b', 5), el('c', 3)], ['a'], 'front')).toEqual([
      { id: 'a', zIndex: 6 },
    ])
  })

  it('moves ONLY the selection — no unselected row is rewritten', () => {
    const changes = plan([el('a', 0), el('b', 1), el('c', 2)], ['a'], 'front')
    expect(changes.map((c) => c.id)).toEqual(['a'])
  })

  it('keeps a multi-selection stacked among itself', () => {
    // `a` is below `c` before; it must still be below `c` after, or moving a
    // group to the front silently reshuffles it.
    const changes = plan(
      [el('a', 0), el('c', 2), el('x', 5)],
      ['a', 'c'],
      'front',
    )
    expect(changes).toEqual([
      { id: 'a', zIndex: 6 },
      { id: 'c', zIndex: 7 },
    ])
  })

  it('plans nothing for an element already at the top', () => {
    // A repeated click must not push an undo entry that reverses to itself.
    expect(plan([el('a', 0), el('b', 1)], ['b'], 'front')).toEqual([])
  })

  it('counts a connector z when choosing the new value', () => {
    // A connector's stored z is real and occupies a value; handing a shape the
    // same one would make the two collide on the id tie-break. Two shapes
    // here, so `a` genuinely has somewhere to go.
    expect(
      plan([el('a', 0), el('b', 1), connector('con', 9)], ['a'], 'front'),
    ).toEqual([{ id: 'a', zIndex: 10 }])
  })

  it('plans nothing when the only paintable element is already the top one', () => {
    // A connector sitting at a higher z does not put a shape "behind"
    // anything — the renderer paints every connector first regardless.
    expect(plan([el('a', 0), connector('con', 9)], ['a'], 'front')).toEqual([])
  })

  it('moves a group\'s whole subtree together, leaving no non-member interleaved', () => {
    // 3-level nesting: outer > mid > {a, b}. `x` is NOT a member and sits
    // BETWEEN a and b in the current z-order — exactly the arrangement that
    // would fragment the group if only `outer`'s own id were moved. Only
    // `outer` is selected; `zOrderTargets`'s own group expansion (tested
    // above) is what pulls mid/a/b in too.
    const elements = [
      group('outer', 0, ['mid']),
      el('a', 1),
      el('x', 2),
      el('b', 3),
      group('mid', 4, ['a', 'b']),
    ]
    const changes = plan(elements, ['outer'], 'front')

    // Every member of the subtree is planned — not just the group's own row.
    expect(new Set(changes.map((c) => c.id))).toEqual(
      new Set(['outer', 'mid', 'a', 'b']),
    )
    // `x` never appears in the plan — a z-order command touches only the
    // selection (and, now, its expansion), never an unselected row.
    expect(changes.map((c) => c.id)).not.toContain('x')

    // Applying the plan must leave `x` OUTSIDE the group's block — not
    // sandwiched between two of its members, the visible symptom FR-015
    // guards against.
    const patched = sceneFrom(
      elements.map((element) => {
        const change = changes.find((c) => c.id === element.id)
        return change ? { ...element, zIndex: change.zIndex } : element
      }),
    )
    const order = patched.elements.map((element) => element.id)
    const groupIndices = ['outer', 'mid', 'a', 'b'].map((id) =>
      order.indexOf(id),
    )
    const xIndex = order.indexOf('x')
    const isOutsideBlock =
      xIndex < Math.min(...groupIndices) || xIndex > Math.max(...groupIndices)
    expect(isOutsideBlock).toBe(true)
  })
})

describe('send to back', () => {
  it('drops one element below the current bottom', () => {
    expect(plan([el('a', 0), el('b', 5)], ['b'], 'back')).toEqual([
      { id: 'b', zIndex: -1 },
    ])
  })

  it('keeps a multi-selection stacked among itself, all below the rest', () => {
    const changes = plan(
      [el('x', 0), el('a', 1), el('c', 3)],
      ['a', 'c'],
      'back',
    )
    // Two targets, bottom of the scene is 0, so they take -2 and -1 in their
    // existing relative order — `a` still beneath `c`, both beneath `x`.
    expect(changes).toEqual([
      { id: 'a', zIndex: -2 },
      { id: 'c', zIndex: -1 },
    ])
  })

  it('plans nothing for an element already at the bottom', () => {
    expect(plan([el('a', 0), el('b', 1)], ['a'], 'back')).toEqual([])
  })
})

describe('degenerate input', () => {
  it('plans nothing for an empty selection', () => {
    expect(plan([el('a', 0)], [], 'front')).toEqual([])
    expect(plan([el('a', 0)], [], 'back')).toEqual([])
  })

  it('plans nothing when only connectors are selected', () => {
    expect(plan([el('a', 0), connector('con', 1)], ['con'], 'front')).toEqual([])
  })

  it('still moves an element off a TIE, which shared z-values make common', () => {
    // Several rows at z 0 is a real state — the column defaults to 0 and raw
    // seed scripts write it — so ordering falls back to the id tie-break.
    // Bring-to-front must escape that rather than plan the same value again.
    expect(plan([el('a', 0), el('b', 0), el('c', 0)], ['a'], 'front')).toEqual([
      { id: 'a', zIndex: 1 },
    ])
  })

  it('clamps at the ceiling instead of planning a value the schema rejects', () => {
    // Degrades to a no-op at the bound rather than producing a write that
    // fails validation with no user-visible cause.
    expect(plan([el('a', Z_MAX - 1), el('b', Z_MAX)], ['a'], 'front')).toEqual([
      { id: 'a', zIndex: Z_MAX },
    ])
    expect(plan([el('a', Z_MAX), el('b', Z_MAX)], ['a'], 'front')).toEqual([])
  })

  it('clamps at the floor the same way', () => {
    expect(plan([el('a', Z_MIN), el('b', Z_MIN + 1)], ['b'], 'back')).toEqual([
      { id: 'b', zIndex: Z_MIN },
    ])
    expect(plan([el('a', Z_MIN), el('b', Z_MIN)], ['b'], 'back')).toEqual([])
  })
})
