/**
 * TableFocusOverlay — read-only Dialog overlay showing a focused table
 * and its directly-connected (1-hop) neighbor tables in a sub-canvas.
 *
 * The main canvas is untouched; all mutation callbacks are stripped from
 * node data so the sub-canvas is fully read-only.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ReactFlowCanvas } from './ReactFlowCanvas'
import { buildEdgeMap } from '@/lib/react-flow/highlighting'
import type { RelationshipEdgeType, TableNodeType } from '@/lib/react-flow/types'

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
  const [focusHistory, setFocusHistory] = useState<string[]>([])

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

      const edgeMap = buildEdgeMap(edges)
      const relatedTableIds = new Set<string>()
      relatedTableIds.add(activeFocusId)

      const connectedEdges = edgeMap.get(activeFocusId) ?? []
      for (const edge of connectedEdges) {
        relatedTableIds.add(edge.source)
        relatedTableIds.add(edge.target)
      }

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
      const filteredEdges: Array<RelationshipEdgeType> = edges
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
              initialNodes={focusNodes}
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
