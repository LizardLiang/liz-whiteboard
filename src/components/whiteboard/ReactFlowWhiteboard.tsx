/**
 * ReactFlowWhiteboard - Container component for React Flow-based ERD
 *
 * This component handles:
 * - Data fetching via TanStack Query
 * - Conversion from Prisma entities to React Flow nodes/edges
 * - Integration with ReactFlowCanvas
 */

import { useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { NodeDragHandler } from '@xyflow/react'
import { ReactFlowCanvas } from './ReactFlowCanvas'
import { convertTablesToNodes } from '@/lib/react-flow/convert-to-nodes'
import { convertRelationshipsToEdges } from '@/lib/react-flow/convert-to-edges'
import type { TableNodeType } from '@/lib/react-flow/types'
import {
  getWhiteboardWithDiagram,
  getWhiteboardRelationships,
} from '@/lib/server-functions'
import { updateTablePositionFn } from '@/routes/api/tables'

/**
 * ReactFlowWhiteboard Props
 */
export interface ReactFlowWhiteboardProps {
  /** Whiteboard ID to load */
  whiteboardId: string
  /** Whether to show minimap */
  showMinimap?: boolean
  /** Whether to show controls */
  showControls?: boolean
  /** Whether nodes are draggable */
  nodesDraggable?: boolean
}

/**
 * ReactFlowWhiteboard component
 * Fetches whiteboard data and renders React Flow canvas
 */
export function ReactFlowWhiteboard({
  whiteboardId,
  showMinimap = false,
  showControls = true,
  nodesDraggable = true,
}: ReactFlowWhiteboardProps) {
  const queryClient = useQueryClient()

  // Fetch whiteboard data with tables
  const { data: whiteboardData, isLoading: isLoadingWhiteboard } = useQuery({
    queryKey: ['whiteboard', whiteboardId],
    queryFn: async () => {
      return await getWhiteboardWithDiagram({ data: whiteboardId })
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  })

  // Fetch relationships
  const { data: relationships, isLoading: isLoadingRelationships } = useQuery({
    queryKey: ['relationships', whiteboardId],
    queryFn: async () => {
      return await getWhiteboardRelationships({ data: whiteboardId })
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  })

  // Mutation for updating table position
  const updatePositionMutation = useMutation({
    mutationFn: async (params: { id: string; positionX: number; positionY: number }) => {
      return await updateTablePositionFn(params)
    },
    onSuccess: (updatedTable) => {
      // Update cache without full refetch for better performance
      queryClient.setQueryData(['whiteboard', whiteboardId], (old: any) => {
        if (!old?.tables) return old
        return {
          ...old,
          tables: old.tables.map((t: any) =>
            t.id === updatedTable.id
              ? {
                  ...t,
                  positionX: updatedTable.positionX,
                  positionY: updatedTable.positionY,
                }
              : t
          ),
        }
      })
    },
    onError: (err) => {
      console.error('Failed to update table position:', err)
    },
  })

  // Convert tables to React Flow nodes
  const nodes = useMemo(() => {
    if (!whiteboardData?.tables) return []
    return convertTablesToNodes(whiteboardData.tables)
  }, [whiteboardData?.tables])

  // Convert relationships to React Flow edges
  const edges = useMemo(() => {
    if (!relationships) return []
    return convertRelationshipsToEdges(relationships)
  }, [relationships])

  // Handle node drag stop - update position in database
  const handleNodeDragStop = useCallback<NodeDragHandler<TableNodeType>>(
    (event, node) => {
      updatePositionMutation.mutate({
        id: node.id,
        positionX: node.position.x,
        positionY: node.position.y,
      })
    },
    [updatePositionMutation]
  )

  // Loading state
  if (isLoadingWhiteboard || isLoadingRelationships) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading diagram...</div>
      </div>
    )
  }

  // Error state
  if (!whiteboardData) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-destructive">Failed to load whiteboard</div>
      </div>
    )
  }

  // Render React Flow canvas
  return (
    <ReactFlowCanvas
      initialNodes={nodes}
      initialEdges={edges}
      onNodeDragStop={handleNodeDragStop}
      nodesDraggable={nodesDraggable}
      showMinimap={showMinimap}
      showControls={showControls}
      showBackground={true}
      fitViewOptions={{
        padding: 0.2,
        includeHiddenNodes: false,
      }}
    />
  )
}
