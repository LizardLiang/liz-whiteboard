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
import { computeRelationshipDeleteVeto } from './ReactFlowCanvas'

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
