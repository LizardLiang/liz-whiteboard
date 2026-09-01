// src/lib/canvas-element-adapter.test.ts
// The storage/engine boundary. These tests exist because the two sides use
// different names for the same numbers — positionX/positionY in SQL, x/y in
// the engine — and a silent swap between them is exactly the defect class
// (W1, W3) this repo has already paid for twice.

import { describe, expect, it } from 'vitest'
import {
  fromElementSnapshot,
  toCreateInput,
  toElementSnapshot,
  toEngineElement,
  toEngineScene,
  toUpdatePatch,
} from './canvas-element-adapter'
import { DEFAULT_ELEMENT_STYLE } from './canvas-engine/scene'
import type { CanvasElementRecord } from '@/data/models'

function record(
  id: string,
  over: Partial<CanvasElementRecord> = {},
): CanvasElementRecord {
  return {
    id,
    boardId: 'board-1',
    kind: 'rectangle',
    positionX: 10,
    positionY: 20,
    width: 160,
    height: 100,
    rotation: 0,
    zIndex: 0,
    text: null,
    style: DEFAULT_ELEMENT_STYLE,
    props: { kind: 'rectangle' },
    revision: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  }
}

describe('toEngineElement', () => {
  it('maps positionX/positionY onto x/y, not onto each other', () => {
    // Asymmetric values on purpose: with x === y a transposed mapping passes.
    const element = toEngineElement(
      record('a', { positionX: 7, positionY: 99 }),
    )
    expect(element.x).toBe(7)
    expect(element.y).toBe(99)
  })

  it('carries geometry, text and style through unchanged', () => {
    const element = toEngineElement(
      record('a', {
        width: 300,
        height: 42,
        rotation: 15,
        zIndex: 3,
        text: 'hello',
        style: { ...DEFAULT_ELEMENT_STYLE, fontSize: 24 },
      }),
    )
    expect(element).toEqual({
      id: 'a',
      kind: 'rectangle',
      x: 10,
      y: 20,
      width: 300,
      height: 42,
      rotation: 15,
      zIndex: 3,
      text: 'hello',
      style: { ...DEFAULT_ELEMENT_STYLE, fontSize: 24 },
    })
  })

  it('drops the storage-only fields', () => {
    const element = toEngineElement(record('a'))
    expect(element).not.toHaveProperty('boardId')
    expect(element).not.toHaveProperty('props')
    expect(element).not.toHaveProperty('createdAt')
  })
})

describe('toEngineScene', () => {
  it('builds a z-ordered scene regardless of the order rows arrive in', () => {
    const scene = toEngineScene([
      record('c', { zIndex: 5 }),
      record('a', { zIndex: 1 }),
      record('b', { zIndex: 3 }),
    ])
    expect(scene.elements.map((e) => e.id)).toEqual(['a', 'b', 'c'])
    expect(scene.byId.get('b')?.zIndex).toBe(3)
  })

  it('handles an empty board', () => {
    expect(toEngineScene([]).elements).toEqual([])
  })
})

describe('round trip', () => {
  it('survives record -> engine -> create input with geometry intact', () => {
    const source = record('a', {
      positionX: -1234.5,
      positionY: 6789,
      width: 77,
      height: 88,
      zIndex: 4,
      text: 'round trip',
    })
    const input = toCreateInput('board-2', toEngineElement(source))

    expect(input.boardId).toBe('board-2')
    expect(input.positionX).toBe(-1234.5)
    expect(input.positionY).toBe(6789)
    expect(input.width).toBe(77)
    expect(input.height).toBe(88)
    expect(input.zIndex).toBe(4)
    expect(input.text).toBe('round trip')
  })

  it('derives props.kind from the element kind, so the two can never disagree', () => {
    // The create schema rejects a mismatch; building props here rather than
    // asking the caller for it means the mismatch is unrepresentable.
    const input = toCreateInput(
      'board-2',
      toEngineElement(record('t', { kind: 'text' })),
    )
    expect(input.kind).toBe('text')
    expect(input.props).toEqual({ kind: 'text' })
  })

  it('omits kind from an update patch, because a kind never changes', () => {
    const patch = toUpdatePatch(toEngineElement(record('a', { positionX: 5 })))
    expect(patch.positionX).toBe(5)
    expect(patch).not.toHaveProperty('kind')
  })

  it('INCLUDES props in an update patch', () => {
    // Changed with the connector kind. `props` used to be omitted here on the
    // grounds that it was fully derivable from `kind` and therefore never
    // editable — true while every arm was an empty object. A connector's
    // `routing` is real, editable content, and without it in the patch a
    // routing change would have no way to reach storage at all.
    const patch = toUpdatePatch(toEngineElement(record('a')))
    expect(patch.props).toEqual({ kind: 'rectangle' })
  })
})

// ─── connectors ────────────────────────────────────────────────────────────
//
// A connector is the first kind whose `props` carry content that cannot be
// rebuilt from `kind`. Every conversion in this file therefore has to move
// them, in BOTH directions — and the undo snapshot pair matters as much as
// the load pair, because a restored connector that lost its endpoints comes
// back as a row nothing can draw, hit-test or select.

const CONNECTOR_PROPS = {
  kind: 'connector',
  sourceElementId: '11111111-1111-4111-8111-111111111111',
  targetElementId: '22222222-2222-4222-8222-222222222222',
  routing: 'elbow',
} as const

function connectorRecord(): CanvasElementRecord {
  return record('c1', {
    kind: 'connector',
    props: CONNECTOR_PROPS,
    // The degenerate placeholder a connector actually stores.
    positionX: 0,
    positionY: 0,
    width: 1,
    height: 1,
  })
}

describe('connector conversions', () => {
  it('reads endpoints and routing off the stored props', () => {
    const element = toEngineElement(connectorRecord())
    expect(element.kind).toBe('connector')
    expect(element.connector).toEqual({
      source: { kind: 'element', elementId: CONNECTOR_PROPS.sourceElementId },
      target: { kind: 'element', elementId: CONNECTOR_PROPS.targetElementId },
      routing: 'elbow',
    })
  })

  it('gives a non-connector no connector KEY at all', () => {
    // Not `connector: undefined` — toStrictEqual distinguishes the two, and a
    // key holding undefined would make `element.connector` checks noisier.
    expect(toEngineElement(record('a'))).not.toHaveProperty('connector')
  })

  it('writes endpoints and routing back into create props', () => {
    const input = toCreateInput('board-2', toEngineElement(connectorRecord()))
    expect(input.kind).toBe('connector')
    expect(input.props).toEqual(CONNECTOR_PROPS)
  })

  it('carries routing through an update patch, so it can be changed', () => {
    const element = toEngineElement(connectorRecord())
    const changed = {
      ...element,
      connector: { ...element.connector!, routing: 'curved' as const },
    }
    expect(toUpdatePatch(changed).props).toEqual({
      ...CONNECTOR_PROPS,
      routing: 'curved',
    })
  })

  it('survives the undo snapshot round trip intact', () => {
    const element = toEngineElement(connectorRecord())
    const restored = fromElementSnapshot(toElementSnapshot('board-1', element))
    expect(restored).toStrictEqual(element)
    expect(restored.connector).toEqual(element.connector)
  })

  it('keeps a non-connector free of a connector field across the round trip', () => {
    const element = toEngineElement(record('a'))
    expect(
      fromElementSnapshot(toElementSnapshot('board-1', element)),
    ).toStrictEqual(element)
  })

  it('tolerates a row whose props column is null or absent', () => {
    // `CanvasElementRecord` types props as always present, but the column is
    // nullable in SQL and this project's raw-SQL e2e seeds can omit it. A
    // missing props means "no connector here" — the correct answer for every
    // rectangle and text row, and the only recoverable one for a connector.
    const noProps = {
      ...record('a'),
      props: undefined,
    } as unknown as CanvasElementRecord
    expect(() => toEngineElement(noProps)).not.toThrow()
    expect(toEngineElement(noProps)).not.toHaveProperty('connector')

    const nullProps = {
      ...record('a'),
      props: null,
    } as unknown as CanvasElementRecord
    expect(toEngineElement(nullProps)).not.toHaveProperty('connector')
  })

  it('refuses to build props for a connector with no endpoints', () => {
    // A programming error, not user input. Writing a rectangle's empty props
    // under a connector's kind would persist a row that fails the schema's own
    // kind/props cross-validation on the way back in — better to fail here.
    const broken = {
      ...toEngineElement(connectorRecord()),
      connector: undefined,
    }
    expect(() => toCreateInput('board-2', broken)).toThrow(
      /no connector endpoints/,
    )
    expect(() => toElementSnapshot('board-1', broken)).toThrow(
      /no connector endpoints/,
    )
  })
})

describe('free connector ends round-trip through storage', () => {
  const FREE_PROPS = {
    kind: 'connector' as const,
    sourceElementId: '11111111-1111-4111-8111-111111111111',
    sourceAnchor: 'right' as const,
    targetElementId: null,
    targetPoint: { x: 420, y: 260 },
    routing: 'straight' as const,
  }

  function freeRecord() {
    return {
      ...connectorRecord(),
      props: FREE_PROPS,
    } as unknown as Parameters<typeof toEngineElement>[0]
  }

  it('reads a detached end as a point endpoint', () => {
    expect(toEngineElement(freeRecord()).connector).toEqual({
      source: {
        kind: 'element',
        elementId: FREE_PROPS.sourceElementId,
        // The legacy `sourceAnchor: 'right'` reads as that side's MIDPOINT —
        // exactly where it has always been drawn, so an old row keeps its
        // appearance and simply becomes draggable like any other.
        attach: { x: 1, y: 0.5 },
      },
      target: { kind: 'point', point: { x: 420, y: 260 } },
      routing: 'straight',
    })
  })

  it('writes it back as a null id plus a point, never both', () => {
    const input = toCreateInput('board-2', toEngineElement(freeRecord()))
    expect(input.props).toEqual({
      kind: 'connector',
      sourceElementId: FREE_PROPS.sourceElementId,
      // Written in the CURRENT form, not the legacy one it was read from:
      // a row touched by this app is migrated forward on its next write.
      sourceAttach: { x: 1, y: 0.5 },
      targetElementId: null,
      targetPoint: { x: 420, y: 260 },
      routing: 'straight',
    })
    // The schema's exactly-one-of invariant, satisfied by construction: an
    // attached end carries no point key, a free end no attachment.
    expect(input.props).not.toHaveProperty('sourcePoint')
    expect(input.props).not.toHaveProperty('targetAttach')
    expect(input.props).not.toHaveProperty('sourceAnchor')
  })

  it('survives the undo snapshot round trip with the free end intact', () => {
    const element = toEngineElement(freeRecord())
    const restored = fromElementSnapshot(toElementSnapshot('board-2', element))
    expect(restored.connector).toEqual(element.connector)
  })

  it('reads a malformed end (neither attached nor free) as no connector', () => {
    // The schema refuses to WRITE one. Reading it back as "nothing here"
    // rather than throwing keeps one bad row from taking the whole board load
    // down, and lands it in the same draws-nothing state an unresolvable
    // endpoint already has.
    const malformed = {
      ...connectorRecord(),
      props: { ...FREE_PROPS, targetPoint: undefined },
    } as unknown as Parameters<typeof toEngineElement>[0]
    expect(toEngineElement(malformed).connector).toBeUndefined()
  })
})

describe('connector curvature round-trips, and its absence is preserved', () => {
  const CURVED_PROPS = {
    ...CONNECTOR_PROPS,
    routing: 'curved' as const,
    curvature: -0.375,
  }

  function curvedRecord(): CanvasElementRecord {
    return record('c2', {
      kind: 'connector',
      props: CURVED_PROPS,
      positionX: 0,
      positionY: 0,
      width: 1,
      height: 1,
    })
  }

  it('reads a stored curvature onto the engine connector', () => {
    expect(toEngineElement(curvedRecord()).connector).toEqual({
      source: { kind: 'element', elementId: CONNECTOR_PROPS.sourceElementId },
      target: { kind: 'element', elementId: CONNECTOR_PROPS.targetElementId },
      routing: 'curved',
      curvature: -0.375,
    })
  })

  it('leaves the KEY absent for a legacy row that carries none', () => {
    // Not `curvature: undefined`. `toStrictEqual` distinguishes the two, and
    // so does the engine's "absent means no hand-applied bow" reading — the
    // same contract `attach` already has for connectors written before
    // attachment existed.
    const element = toEngineElement(connectorRecord())
    expect(element.connector).not.toHaveProperty('curvature')
  })

  it('writes it back into create props and an update patch', () => {
    // The update patch is the whole persistence story for this feature: the
    // adapter serialises a connector's props WHOLESALE, so curvature reaches
    // storage on the existing write path with no new server work.
    const element = toEngineElement(curvedRecord())
    expect(toCreateInput('board-2', element).props).toEqual(CURVED_PROPS)
    expect(toUpdatePatch(element).props).toEqual(CURVED_PROPS)
  })

  it('adds no curvature key to a connector that never had one', () => {
    // A row written before bending existed must not gain the field merely by
    // being saved again — that is what keeps the "absent and 0 are the same"
    // promise honest across an ordinary move or reroute.
    const patch = toUpdatePatch(toEngineElement(connectorRecord()))
    expect(patch.props).not.toHaveProperty('curvature')
    expect(patch.props).toEqual(CONNECTOR_PROPS)
  })

  it('carries a deliberate ZERO rather than dropping it', () => {
    // 0 is a value — a connector the user bowed and then straightened again —
    // and a truthiness-guarded spread would silently discard it, resurrecting
    // whatever bow the row held before.
    const element = toEngineElement(curvedRecord())
    const straightened = {
      ...element,
      connector: { ...element.connector!, curvature: 0 },
    }
    expect(toUpdatePatch(straightened).props).toHaveProperty('curvature', 0)
  })

  it('survives the undo snapshot round trip intact', () => {
    // The half that is easy to forget: without it, undoing a delete would
    // restore the connector flat and silently discard the bow.
    const element = toEngineElement(curvedRecord())
    const restored = fromElementSnapshot(toElementSnapshot('board-1', element))
    expect(restored).toStrictEqual(element)
  })
})
