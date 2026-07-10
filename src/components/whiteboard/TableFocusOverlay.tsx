/**
 * TableFocusOverlay — read-only Dialog overlay showing a focused table
 * and its directly-connected (1-hop) neighbor tables in a sub-canvas.
 *
 * The main canvas is untouched; all mutation callbacks are stripped from
 * node data so the sub-canvas is fully read-only.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { ReactFlowCanvas } from './ReactFlowCanvas'
import type {
  RelationshipEdgeType,
  TableNodeType,
} from '@/lib/react-flow/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  filterValidEdges,
  getDirectlyRelatedTableIds,
} from '@/lib/react-flow/highlighting'
import { computeD3ForceLayout } from '@/lib/auto-layout/d3-force-layout'
import { calculateTableHeight } from '@/lib/react-flow/layout-adapter'

export interface TableFocusOverlayProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  focusedTableId: string | null
  nodes: Array<TableNodeType>
  edges: Array<RelationshipEdgeType>
}

export function TableFocusOverlay({
  open,
  onOpenChange,
  focusedTableId,
  nodes,
  edges,
}: TableFocusOverlayProps) {
  // Internal navigation state — seeded from the prop, reset on fresh open.
  const [activeFocusId, setActiveFocusId] = useState<string | null>(
    focusedTableId,
  )
  const [focusHistory, setFocusHistory] = useState<Array<string>>([])
  const [overlayPositions, setOverlayPositions] = useState<Map<
    string,
    { x: number; y: number }
  > | null>(null)

  // Sync to the incoming prop whenever the overlay is opened or the prop changes
  // (covers re-opening on a different table via `f` or context menu).
  useEffect(() => {
    if (open && focusedTableId) {
      setActiveFocusId(focusedTableId)
      setFocusHistory([])
    }
  }, [open, focusedTableId])

  // Re-focus to a neighbor node — pushes current focal id onto history stack.
  const handleRefocus = useCallback(
    (newId: string) => {
      if (newId === activeFocusId) return
      setFocusHistory((h) => [...h, activeFocusId!])
      setActiveFocusId(newId)
    },
    [activeFocusId],
  )

  // Compute the set of related table IDs: the focal table + all 1-hop neighbors
  const { focusNodes, focusEdges, focusedTableName, relatedCount } =
    useMemo(() => {
      if (!activeFocusId) {
        return {
          focusNodes: [],
          focusEdges: [],
          focusedTableName: '',
          relatedCount: 0,
        }
      }

      // Pre-filter stale edges: excludes edges referencing deleted columns
      // before building the neighbor set and before filtering edges below.
      // Without this, a stale edge can add an unrelated table to
      // relatedTableIds even though ReactFlowCanvas will later drop the
      // edge — producing a table with no visible connecting line in the
      // overlay. Shared with ReactFlowCanvas.tsx's initialEdges effect.
      const validEdges = filterValidEdges(nodes, edges)

      // Shared 1-hop-neighbor helper — used for the neighbor id set.
      // filteredEdges below still derives from validEdges directly (not the
      // helper's relatedEdges) because it needs ALL edges among the related
      // set (including edges between two neighbor tables), not just edges
      // touching activeFocusId.
      const { relatedTableIds } = getDirectlyRelatedTableIds(
        activeFocusId,
        validEdges,
      )

      // Filter nodes to the related set and strip mutation callbacks.
      // Neighbor nodes (not the focal node) receive onFocusTable so clicking
      // "Focus view" in their context menu re-targets the overlay without closing.
      const filteredNodes: Array<TableNodeType> = nodes
        .filter((n) => relatedTableIds.has(n.id))
        .map((n) => ({
          ...n,
          data: {
            ...n.data,
            onColumnCreate: undefined,
            onColumnUpdate: undefined,
            onColumnDelete: undefined,
            onColumnDuplicate: undefined,
            onRequestTableDelete: undefined,
            // Focal node is not re-targetable via context menu; neighbors are.
            onFocusTable: n.id !== activeFocusId ? handleRefocus : undefined,
            // Column reorder persists via these callbacks — strip so a drag
            // inside the read-only overlay cannot mutate or emit to the server.
            onColumnReorder: undefined,
            emitColumnReorder: undefined,
          },
        }))

      // Filter edges to those whose both endpoints are in the related set,
      // and strip relationship mutation callbacks so the overlay edge controls
      // (delete relationship, edit label) are read-only.
      const filteredEdges: Array<RelationshipEdgeType> = validEdges
        .filter(
          (e) => relatedTableIds.has(e.source) && relatedTableIds.has(e.target),
        )
        .map((e) => ({
          ...e,
          data: e.data
            ? { ...e.data, onDelete: undefined, onLabelUpdate: undefined }
            : e.data,
        }))

      const focalNode = nodes.find((n) => n.id === activeFocusId)
      const name = focalNode?.data.table.name ?? activeFocusId

      // Related count excludes the focal table itself
      const neighborCount = relatedTableIds.size - 1

      return {
        focusNodes: filteredNodes,
        focusEdges: filteredEdges,
        focusedTableName: name,
        relatedCount: neighborCount,
      }
    }, [activeFocusId, nodes, edges, handleRefocus])

  // Run compact D3 layout for the overlay subset whenever the focal table changes.
  // Positions are stored in overlayPositions and NEVER persisted to the DB or
  // main canvas. nodesDraggable={false} and no drag callbacks ensure that.
  useEffect(() => {
    setOverlayPositions(null)

    if (focusNodes.length === 0) return

    const layoutNodes = focusNodes.map((n) => ({
      id: n.id,
      width: n.measured?.width ?? (n.width) ?? 250,
      height:
        n.measured?.height ?? calculateTableHeight(n.data.table.columns.length),
    }))
    const layoutEdges = focusEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.data?.label ?? undefined,
      cardinality: e.data?.cardinality ? String(e.data.cardinality) : undefined,
    }))

    let cancelled = false
    computeD3ForceLayout(layoutNodes, layoutEdges)
      .then((positions) => {
        if (cancelled) return
        setOverlayPositions(
          new Map(positions.map((p) => [p.id, { x: p.x, y: p.y }])),
        )
      })
      .catch(() => {
        // single-node case throws "No nodes to layout" but is guarded above by
        // focusNodes.length === 0; other errors are silently ignored so the
        // overlay still renders with original positions as fallback.
      })

    return () => {
      cancelled = true
    }
    // focusNodes/focusEdges are deliberately excluded: they're derived from
    // the `nodes`/`edges` props (which change continuously during dragging
    // and live collaboration), but this layout must only recompute when the
    // user switches the focal table, per the comment above — including them
    // would re-run the compact D3 layout on every canvas update and cause
    // visible jank in the overlay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFocusId])

  // Merge compact overlay positions into focusNodes.
  // When overlayPositions is null (first frame or focus change), falls back to
  // focusNodes so fitView uses original positions until layout resolves.
  const overlayNodes = useMemo(() => {
    if (!overlayPositions) return focusNodes
    return focusNodes.map((n) => {
      const pos = overlayPositions.get(n.id)
      if (!pos) return n
      return { ...n, position: pos }
    })
  }, [focusNodes, overlayPositions])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[95vw] h-[90vh] flex flex-col overflow-hidden p-4">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {focusHistory.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  const prev = focusHistory[focusHistory.length - 1]
                  setFocusHistory((h) => h.slice(0, -1))
                  setActiveFocusId(prev)
                }}
                className="text-muted-foreground hover:text-foreground text-sm"
                aria-label="Go back"
              >
                ← Back
              </button>
            )}
            <DialogTitle>Focus: {focusedTableName}</DialogTitle>
          </div>
          <DialogDescription>
            {relatedCount === 0
              ? 'No directly related tables'
              : `${relatedCount} directly related table${relatedCount === 1 ? '' : 's'}`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-hidden relative min-h-0">
          <ReactFlowProvider>
            <ReactFlowCanvas
              initialNodes={overlayNodes}
              initialEdges={focusEdges}
              nodesDraggable={false}
              showControls={true}
              showMinimap={false}
              showBackground={true}
              fitViewOptions={{ padding: 0.25 }}
              onNodeClick={(nodeId) => {
                if (nodeId !== activeFocusId) handleRefocus(nodeId)
              }}
            />
          </ReactFlowProvider>
        </div>
      </DialogContent>
    </Dialog>
  )
}
