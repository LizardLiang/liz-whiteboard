/**
 * ReactFlowWhiteboard - Container component for React Flow-based ERD
 *
 * This component handles:
 * - Data fetching via TanStack Query
 * - Conversion from Prisma entities to React Flow nodes/edges
 * - Integration with ReactFlowCanvas
 * - Auto-layout functionality via ELK
 * - Real-time collaboration via WebSocket
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ReactFlowProvider } from '@xyflow/react'
import { ReactFlowCanvas } from './ReactFlowCanvas'
import { ConnectionStatusIndicator } from './ConnectionStatusIndicator'
import type {
  RelationshipEdgeType,
  ShowMode,
  TableNodeType,
} from '@/lib/react-flow/types'
import { convertTablesToNodes } from '@/lib/react-flow/convert-to-nodes'
import { convertRelationshipsToEdges } from '@/lib/react-flow/convert-to-edges'
import { useAutoLayout } from '@/lib/react-flow/use-auto-layout'
import { extractPositionsForBatchUpdate } from '@/lib/react-flow/elk-layout'
import {
  getWhiteboardRelationships,
  getWhiteboardWithDiagram,
} from '@/lib/server-functions'
import { updateTablePositionFn } from '@/routes/api/tables'
import { useWhiteboardCollaboration } from '@/hooks/use-whiteboard-collaboration'
import { useColumnCollaboration } from '@/hooks/use-column-collaboration'
import { useColumnMutations } from '@/hooks/use-column-mutations'
import type { Column } from '@prisma/client'
import type { CreateColumnPayload } from './column/types'
import type { UpdateColumn } from '@/data/schema'

/**
 * ReactFlowWhiteboard Props
 */
export interface ReactFlowWhiteboardProps {
  /** Whiteboard ID to load */
  whiteboardId: string
  /** User ID for collaboration */
  userId?: string
  /** Whether to show minimap */
  showMinimap?: boolean
  /** Whether to show controls */
  showControls?: boolean
  /** Whether nodes are draggable */
  nodesDraggable?: boolean
  /** Callback to expose auto-layout function to parent */
  onAutoLayoutReady?: (
    computeLayout: () => Promise<void>,
    isComputing: boolean,
  ) => void
  /** Callback to expose display mode controls to parent */
  onDisplayModeReady?: (
    showMode: ShowMode,
    setShowMode: (mode: ShowMode) => void,
  ) => void
}

/**
 * Inner component that has access to React Flow context
 */
function ReactFlowWhiteboardInner({
  whiteboardId,
  userId,
  initialNodes,
  initialEdges,
  showMinimap,
  showControls,
  nodesDraggable,
  onAutoLayoutReady,
  onDisplayModeReady,
}: {
  whiteboardId: string
  userId: string
  initialNodes: Array<TableNodeType>
  initialEdges: Array<RelationshipEdgeType>
  showMinimap: boolean
  showControls: boolean
  nodesDraggable: boolean
  onAutoLayoutReady?: (
    computeLayout: () => Promise<void>,
    isComputing: boolean,
  ) => void
  onDisplayModeReady?: (
    showMode: ShowMode,
    setShowMode: (mode: ShowMode) => void,
  ) => void
}) {
  const queryClient = useQueryClient()

  // Local React Flow state (will be updated by collaboration)
  const [nodes, setNodes] = useState<Array<TableNodeType>>(initialNodes)
  const [edges, setEdges] = useState<Array<RelationshipEdgeType>>(initialEdges)

  // Keep a stable ref to edges for use inside callbacks without stale closure
  const edgesRef = useRef(edges)
  useEffect(() => { edgesRef.current = edges }, [edges])

  // Display mode state with localStorage persistence
  const [showMode, setShowMode] = useState<ShowMode>(() => {
    // Restore from localStorage on mount
    const saved = localStorage.getItem('whiteboard-display-mode')
    return (saved as ShowMode) || 'ALL_FIELDS'
  })

  // Persist showMode to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('whiteboard-display-mode', showMode)

    // Update all nodes with new showMode
    setNodes((prevNodes) =>
      prevNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          showMode,
        },
      })),
    )
  }, [showMode])

  // Update local state when initial data changes (and attach callbacks)
  // Callbacks refs are attached after they're defined below — see "Thread column mutation callbacks"
  useEffect(() => {
    setNodes(initialNodes)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNodes])

  useEffect(() => {
    setEdges(initialEdges)
  }, [initialEdges])

  // When edges change, update the edges prop in all node data (for delete confirmation)
  useEffect(() => {
    setNodes((prevNodes) =>
      prevNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          edges,
        },
      })),
    )
  }, [edges])

  // Real-time collaboration integration (table position events)
  const { connectionState, emitPositionUpdate } = useWhiteboardCollaboration(
    whiteboardId,
    userId,
    useCallback((tableId: string, positionX: number, positionY: number) => {
      // Update local React Flow nodes when other users move tables
      setNodes((prevNodes) =>
        prevNodes.map((node) =>
          node.id === tableId
            ? { ...node, position: { x: positionX, y: positionY } }
            : node,
        ),
      )
    }, []),
  )

  // Column collaboration callbacks (incoming events from other users)
  const onColumnCreated = useCallback(
    (column: Column & { createdBy: string }) => {
      setNodes((prev) =>
        prev.map((node) =>
          node.data.table.id === column.tableId
            ? {
                ...node,
                data: {
                  ...node.data,
                  table: {
                    ...node.data.table,
                    columns: [...node.data.table.columns, column],
                  },
                },
              }
            : node,
        ),
      )
    },
    [],
  )

  const onColumnUpdated = useCallback(
    (data: { columnId: string; tableId: string; updatedBy: string; [key: string]: any }) => {
      const { columnId, tableId, updatedBy: _updatedBy, ...rest } = data
      setNodes((prev) =>
        prev.map((node) =>
          node.data.table.id === tableId
            ? {
                ...node,
                data: {
                  ...node.data,
                  table: {
                    ...node.data.table,
                    columns: node.data.table.columns.map((c) =>
                      c.id === columnId ? { ...c, ...rest } : c,
                    ),
                  },
                },
              }
            : node,
        ),
      )
    },
    [],
  )

  const onColumnDeleted = useCallback(
    (data: { columnId: string; tableId: string; deletedBy: string }) => {
      const { columnId, tableId } = data
      // Remove column from node
      setNodes((prev) =>
        prev.map((node) =>
          node.data.table.id === tableId
            ? {
                ...node,
                data: {
                  ...node.data,
                  table: {
                    ...node.data.table,
                    columns: node.data.table.columns.filter((c) => c.id !== columnId),
                  },
                },
              }
            : node,
        ),
      )
      // Remove affected edges
      setEdges((prev) =>
        prev.filter(
          (e) =>
            e.data?.relationship.sourceColumnId !== columnId &&
            e.data?.relationship.targetColumnId !== columnId,
        ),
      )
    },
    [],
  )

  // Column mutations hook (optimistic updates + WebSocket emit)
  const columnMutationsCallbacks = useMemo(
    () => ({
      onColumnCreated,
      onColumnUpdated,
      onColumnDeleted,
      onColumnError: (_data: any) => {
        // Will be wired up after columnMutations is created below
      },
    }),
    [onColumnCreated, onColumnUpdated, onColumnDeleted],
  )

  const {
    emitColumnCreate,
    emitColumnUpdate,
    emitColumnDelete,
    isConnected,
    connectionState: _columnConnectionState,
  } = useColumnCollaboration(whiteboardId, userId, columnMutationsCallbacks)

  const columnMutations = useColumnMutations(
    setNodes,
    setEdges,
    emitColumnCreate,
    emitColumnUpdate,
    emitColumnDelete,
    isConnected,
  )

  // Column mutation callbacks (outgoing — triggered by user interactions in TableNode)
  const handleColumnCreate = useCallback(
    (tableId: string, data: CreateColumnPayload) => {
      columnMutations.createColumn(tableId, data)
    },
    [columnMutations],
  )

  const handleColumnUpdate = useCallback(
    (columnId: string, tableId: string, data: Partial<UpdateColumn>) => {
      columnMutations.updateColumn(columnId, tableId, data)
    },
    [columnMutations],
  )

  const handleColumnDelete = useCallback(
    (columnId: string, tableId: string) => {
      columnMutations.deleteColumn(columnId, tableId)
    },
    [columnMutations],
  )

  // Thread column mutation callbacks into node data via refs (stable identity)
  const handleColumnCreateRef = useRef(handleColumnCreate)
  const handleColumnUpdateRef = useRef(handleColumnUpdate)
  const handleColumnDeleteRef = useRef(handleColumnDelete)
  useEffect(() => { handleColumnCreateRef.current = handleColumnCreate }, [handleColumnCreate])
  useEffect(() => { handleColumnUpdateRef.current = handleColumnUpdate }, [handleColumnUpdate])
  useEffect(() => { handleColumnDeleteRef.current = handleColumnDelete }, [handleColumnDelete])

  // Inject column callbacks + isConnected into node data whenever isConnected changes
  useEffect(() => {
    setNodes((prevNodes) =>
      prevNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          onColumnCreate: handleColumnCreateRef.current,
          onColumnUpdate: handleColumnUpdateRef.current,
          onColumnDelete: handleColumnDeleteRef.current,
          isConnected,
        },
      })),
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected])

  // Also inject callbacks into nodes once on mount (initialNodes may not have them)
  useEffect(() => {
    setNodes((prevNodes) =>
      prevNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          onColumnCreate: handleColumnCreateRef.current,
          onColumnUpdate: handleColumnUpdateRef.current,
          onColumnDelete: handleColumnDeleteRef.current,
          edges: edgesRef.current,
          isConnected,
        },
      })),
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mutation for updating table position
  const updatePositionMutation = useMutation({
    mutationFn: async (params: {
      id: string
      positionX: number
      positionY: number
    }) => {
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
              : t,
          ),
        }
      })
    },
    onError: (err) => {
      console.error('Failed to update table position:', err)
    },
  })

  // Auto-layout hook
  const { computeLayout, isComputing } = useAutoLayout({
    onLayoutComplete: async (nodes) => {
      // Batch update all positions to database
      const positions = extractPositionsForBatchUpdate(nodes)

      try {
        // Update all positions (we can do this in parallel)
        await Promise.all(
          positions.map((pos) => updatePositionMutation.mutateAsync(pos)),
        )
        console.log('All positions updated after auto-layout')
      } catch (error) {
        console.error('Failed to update positions after auto-layout:', error)
      }
    },
    onLayoutError: (error) => {
      console.error('Auto-layout failed:', error)
    },
    fitViewAfterLayout: true,
    fitViewDelay: 100,
  })

  // Expose auto-layout function to parent component (only once on mount)
  useEffect(() => {
    if (onAutoLayoutReady) {
      onAutoLayoutReady(computeLayout, isComputing)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run once on mount

  // Expose display mode controls to parent component (only once on mount)
  useEffect(() => {
    if (onDisplayModeReady) {
      onDisplayModeReady(showMode, setShowMode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run once on mount

  // Handle node drag stop - update position in database and emit to other users
  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: TableNodeType) => {
      const { x, y } = node.position

      // Update database
      updatePositionMutation.mutate({
        id: node.id,
        positionX: x,
        positionY: y,
      })

      // Emit to other users via WebSocket
      emitPositionUpdate(node.id, x, y)
    },
    [updatePositionMutation, emitPositionUpdate],
  )

  // Render React Flow canvas with collaboration-aware state
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <ConnectionStatusIndicator connectionState={connectionState} />
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
    </div>
  )
}

/**
 * ReactFlowWhiteboard component
 * Fetches whiteboard data and renders React Flow canvas
 */
export function ReactFlowWhiteboard({
  whiteboardId,
  userId = 'temp-user-id', // TODO: Get from auth context
  showMinimap = false,
  showControls = true,
  nodesDraggable = true,
  onAutoLayoutReady,
  onDisplayModeReady,
}: ReactFlowWhiteboardProps) {
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

  // Convert tables to React Flow nodes with showMode
  const nodes = useMemo(() => {
    // The whiteboardData has structure: {whiteboard: {..., tables: [...]}, relationships: [...]}
    const tables = whiteboardData?.whiteboard?.tables

    if (!tables || tables.length === 0) {
      console.log('ReactFlowWhiteboard: No tables data or empty array')
      return []
    }
    console.log('ReactFlowWhiteboard: Converting tables to nodes', tables)
    const convertedNodes = convertTablesToNodes(tables, 'ALL_FIELDS')
    console.log('ReactFlowWhiteboard: Converted nodes', convertedNodes)
    return convertedNodes
  }, [whiteboardData?.whiteboard?.tables])

  // Convert relationships to React Flow edges
  const edges = useMemo(() => {
    if (!relationships) {
      console.log('ReactFlowWhiteboard: No relationships data')
      return []
    }
    console.log(
      'ReactFlowWhiteboard: Converting relationships to edges',
      relationships,
    )
    const convertedEdges = convertRelationshipsToEdges(relationships)
    console.log('ReactFlowWhiteboard: Converted edges', convertedEdges)
    return convertedEdges
  }, [relationships])

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

  // Wrap in ReactFlowProvider to enable hooks like useAutoLayout
  return (
    <ReactFlowProvider>
      <ReactFlowWhiteboardInner
        whiteboardId={whiteboardId}
        userId={userId}
        initialNodes={nodes}
        initialEdges={edges}
        showMinimap={showMinimap}
        showControls={showControls}
        nodesDraggable={nodesDraggable}
        onAutoLayoutReady={onAutoLayoutReady}
        onDisplayModeReady={onDisplayModeReady}
      />
    </ReactFlowProvider>
  )
}
