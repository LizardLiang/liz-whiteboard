// src/components/whiteboard/ReactFlowCanvas.test.tsx
//
// Unit coverage for the connectivity-aware relationship-delete veto
// (2026-08-31 tactical plan, Part A / D-12). `onBeforeDelete` in
// ReactFlowCanvas.tsx delegates to `computeRelationshipDeleteVeto` — this
// suite tests that exact exported function, not a reimplementation.
//
// This exists as a FALLBACK for the disconnected-delete path: Playwright has
// no clean seam to sever the whiteboard's live Socket.IO connection
// mid-test (see the comment on relationship-deletion.spec.ts's e2e test),
// so the plan calls for unit coverage of the predicate instead.
import { describe, expect, it } from 'vitest'
import {
  computeConnectionValidity,
  computeRelationshipDeleteVeto,
} from './ReactFlowCanvas'

describe('computeRelationshipDeleteVeto', () => {
  it('vetoes nothing and does not notify when the delete can persist', () => {
    const deletedEdges = [{ type: 'relationship' }, { type: 'connector' }]
    const result = computeRelationshipDeleteVeto({
      deletedEdges,
      canPersistRelationshipDelete: true,
      hasRelationshipDeleteHandler: true,
    })
    expect(result.edges).toBe(deletedEdges)
    expect(result.shouldNotifyRefusal).toBe(false)
  })

  it('strips relationship edges and requests a refusal notice when a handler is wired but the delete cannot persist (disconnected whiteboard socket)', () => {
    const deletedEdges = [{ type: 'relationship' }, { type: 'connector' }]
    const result = computeRelationshipDeleteVeto({
      deletedEdges,
      canPersistRelationshipDelete: false,
      hasRelationshipDeleteHandler: true,
    })
    expect(result.edges).toEqual([{ type: 'connector' }])
    expect(result.shouldNotifyRefusal).toBe(true)
  })

  it('strips relationship edges but stays SILENT when no delete handler is wired at all (TableFocusOverlay veto)', () => {
    const deletedEdges = [{ type: 'relationship' }]
    const result = computeRelationshipDeleteVeto({
      deletedEdges,
      canPersistRelationshipDelete: false,
      hasRelationshipDeleteHandler: false,
    })
    expect(result.edges).toEqual([])
    expect(result.shouldNotifyRefusal).toBe(false)
  })

  it('does not notify when the vetoed batch contains only connector edges', () => {
    const deletedEdges = [{ type: 'connector' }]
    const result = computeRelationshipDeleteVeto({
      deletedEdges,
      canPersistRelationshipDelete: false,
      hasRelationshipDeleteHandler: true,
    })
    expect(result.edges).toEqual([{ type: 'connector' }])
    expect(result.shouldNotifyRefusal).toBe(false)
  })

  it('notifies exactly ONCE for a mixed batch (multi-select delete mixing connectors and relationships) — not once per edge', () => {
    const deletedEdges = [
      { type: 'connector' },
      { type: 'relationship' },
      { type: 'relationship' },
    ]
    const result = computeRelationshipDeleteVeto({
      deletedEdges,
      canPersistRelationshipDelete: false,
      hasRelationshipDeleteHandler: true,
    })
    // Connector deletions in the mixed batch still proceed.
    expect(result.edges).toEqual([{ type: 'connector' }])
    // shouldNotifyRefusal is a single boolean, not a per-edge count — the
    // caller fires the toast at most once regardless of how many
    // relationship edges were in the batch.
    expect(result.shouldNotifyRefusal).toBe(true)
  })
})

// Every case below was found by dogfooding, not by review: dragging from a
// reference node's column handle produced no relationship at all, because a
// reference/table pair fell through to the mixed-pair `return false`.
describe('computeConnectionValidity', () => {
  const columnHandle = (tableId: string, columnId: string, side: string) =>
    `${tableId}__${columnId}__${side}__${side === 'left' ? 'target' : 'source'}`

  it('accepts a table-to-table pair wired through column handles', () => {
    expect(
      computeConnectionValidity({
        sourceId: 't1',
        targetId: 't2',
        sourceType: 'table',
        targetType: 'table',
        sourceHandle: columnHandle('t1', 'c1', 'right'),
        targetHandle: columnHandle('t2', 'c2', 'left'),
      }),
    ).toBe(true)
  })

  it('accepts a reference node as either endpoint opposite a real table', () => {
    const fromReference = computeConnectionValidity({
      sourceId: 'ref1',
      targetId: 't2',
      sourceType: 'externalTable',
      targetType: 'table',
      sourceHandle: columnHandle('ref1', 'stub1', 'right'),
      targetHandle: columnHandle('t2', 'c2', 'left'),
    })
    const toReference = computeConnectionValidity({
      sourceId: 't1',
      targetId: 'ref1',
      sourceType: 'table',
      targetType: 'externalTable',
      sourceHandle: columnHandle('t1', 'c1', 'right'),
      targetHandle: columnHandle('ref1', 'stub1', 'left'),
    })
    expect([fromReference, toReference]).toEqual([true, true])
  })

  it('refuses a reference-to-reference pair: the relationship would belong to neither file', () => {
    expect(
      computeConnectionValidity({
        sourceId: 'ref1',
        targetId: 'ref2',
        sourceType: 'externalTable',
        targetType: 'externalTable',
        sourceHandle: columnHandle('ref1', 'stub1', 'right'),
        targetHandle: columnHandle('ref2', 'stub2', 'left'),
      }),
    ).toBe(false)
  })

  it('refuses a table-like pair that is not wired through column handles', () => {
    expect(
      computeConnectionValidity({
        sourceId: 't1',
        targetId: 'ref1',
        sourceType: 'table',
        targetType: 'externalTable',
        sourceHandle: 'not-a-column-handle',
        targetHandle: columnHandle('ref1', 'stub1', 'left'),
      }),
    ).toBe(false)
  })

  it('keeps the shape rules: non-line shapes connect, lines and self-pairs do not', () => {
    const base = { sourceType: 'shape', targetType: 'shape' }
    expect(
      computeConnectionValidity({
        ...base,
        sourceId: 's1',
        targetId: 's2',
        sourceShapeKind: 'rectangle',
        targetShapeKind: 'ellipse',
      }),
    ).toBe(true)
    expect(
      computeConnectionValidity({
        ...base,
        sourceId: 's1',
        targetId: 's2',
        sourceShapeKind: 'line',
        targetShapeKind: 'ellipse',
      }),
    ).toBe(false)
    expect(
      computeConnectionValidity({
        ...base,
        sourceId: 's1',
        targetId: 's1',
        sourceShapeKind: 'rectangle',
        targetShapeKind: 'rectangle',
      }),
    ).toBe(false)
  })

  it('refuses every mixed pair, in both directions', () => {
    expect(
      computeConnectionValidity({
        sourceId: 'ref1',
        targetId: 's1',
        sourceType: 'externalTable',
        targetType: 'shape',
      }),
    ).toBe(false)
    expect(
      computeConnectionValidity({
        sourceId: 's1',
        targetId: 'ref1',
        sourceType: 'shape',
        targetType: 'externalTable',
      }),
    ).toBe(false)
  })
})
