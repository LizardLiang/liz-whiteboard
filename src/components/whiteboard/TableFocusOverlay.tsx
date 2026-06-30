/**
 * TableFocusOverlay — read-only Dialog overlay showing a focused table
 * and its directly-connected (1-hop) neighbor tables in a sub-canvas.
 *
 * The main canvas is untouched; all mutation callbacks are stripped from
 * node data so the sub-canvas is fully read-only.
 */

import { useMemo } from 'react'
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
  // Compute the set of related table IDs: the focal table + all 1-hop neighbors
  const { focusNodes, focusEdges, focusedTableName, relatedCount } =
    useMemo(() => {
      if (!focusedTableId) {
        return {
          focusNodes: [],
          focusEdges: [],
          focusedTableName: '',
          relatedCount: 0,
        }
      }

      const edgeMap = buildEdgeMap(edges)
      const relatedTableIds = new Set<string>()
      relatedTableIds.add(focusedTableId)

      const connectedEdges = edgeMap.get(focusedTableId) ?? []
      for (const edge of connectedEdges) {
        relatedTableIds.add(edge.source)
        relatedTableIds.add(edge.target)
      }

      // Filter nodes to the related set and strip mutation callbacks
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
            onFocusTable: undefined,
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

      const focalNode = nodes.find((n) => n.id === focusedTableId)
      const name = focalNode?.data.table.name ?? focusedTableId

      // Related count excludes the focal table itself
      const neighborCount = relatedTableIds.size - 1

      return {
        focusNodes: filteredNodes,
        focusEdges: filteredEdges,
        focusedTableName: name,
        relatedCount: neighborCount,
      }
    }, [focusedTableId, nodes, edges])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl h-[70vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Focus: {focusedTableName}</DialogTitle>
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
            />
          </ReactFlowProvider>
        </div>
      </DialogContent>
    </Dialog>
  )
}
