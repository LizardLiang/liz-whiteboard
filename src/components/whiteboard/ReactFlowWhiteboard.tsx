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
import { ReactFlowProvider, useReactFlow, useViewport } from '@xyflow/react'
import { ReactFlowCanvas } from './ReactFlowCanvas'
import type { ZoomControls } from './Toolbar'
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
import { useTableMutations } from '@/hooks/use-table-mutations'
import { useTableDeletion } from '@/hooks/use-table-deletion'
import type { Column } from '@prisma/client'
import type { CreateColumnPayload } from './column/types'
import type { UpdateColumn } from '@/data/schema'
import { getSessionUserId } from '@/lib/session-user-id'
import { DeleteTableDialog } from './DeleteTableDialog'
import type { TableRelationship } from './DeleteTableDialog'

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
  /** Callback to expose zoom controls and current zoom to parent */
  onZoomControlsReady?: (controls: ZoomControls) => void
  /** Callback to notify parent when viewport zoom changes */
  onZoomChange?: (zoom: number) => void
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
  onZoomControlsReady,
  onZoomChange,
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
  onZoomControlsReady?: (controls: ZoomControls) => void
  onZoomChange?: (zoom: number) => void
}) {
  const queryClient = useQueryClient()

  // Local React Flow state (will be updated by collaboration)
  const [nodes, setNodes] = useState<Array<TableNodeType>>(initialNodes)
  const [edges, setEdges] = useState<Array<RelationshipEdgeType>>(initialEdges)

  // Keep a stable ref to edges for use inside callbacks without stale closure
  const edgesRef = useRef(edges)
  useEffect(() => { edgesRef.current = edges }, [edges])

  // Table deletion state — which table has been requested for deletion (opens dialog)
  const [deletingTableId, setDeletingTableId] = useState<string | null>(null)

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
  // Preserve existing callbacks from prev nodes so that a TanStack Query refetch
  // (which updates initialNodes) does not wipe callbacks injected by later effects.
  useEffect(() => {
    setNodes((prevNodes) => {
      const prevNodeMap = new Map(prevNodes.map((n) => [n.id, n]))
      return initialNodes.map((node) => {
        const prev = prevNodeMap.get(node.id)
        if (!prev) return node
        // Preserve callbacks from previous node data, overwrite everything else
        return {
          ...node,
          data: {
            ...node.data,
            onColumnCreate: prev.data.onColumnCreate,
            onColumnUpdate: prev.data.onColumnUpdate,
            onColumnDelete: prev.data.onColumnDelete,
            onRequestTableDelete: prev.data.onRequestTableDelete,
          },
        }
      })
    })
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

  // Callback for when a remote user deletes a table
  const onTableDeleted = useCallback((tableId: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== tableId))
    setEdges((prev) =>
      prev.filter(
        (e) =>
          e.data?.relationship.sourceTableId !== tableId &&
          e.data?.relationship.targetTableId !== tableId,
      ),
    )
    // Close dialog if it was open for this table
    setDeletingTableId((prev) => (prev === tableId ? null : prev))
  }, [])

  // Ref for onTableError — breaks circular dependency between useWhiteboardCollaboration and useTableMutations
  const onTableErrorRef = useRef<(data: any) => void>(() => {})

  // Real-time collaboration integration (table position events + table deletion)
  const { connectionState, emitPositionUpdate, emitTableDelete } = useWhiteboardCollaboration(
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
    onTableDeleted,
    useCallback((data: any) => { onTableErrorRef.current(data) }, []),
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

  // Ref for onColumnError — breaks the circular dependency between
  // useColumnCollaboration (needs callbacks) and useColumnMutations (provides onColumnError)
  const onColumnErrorRef = useRef<(data: any) => void>(() => {})

  // Ref for replaceTempId — same pattern to avoid circular dependency
  const replaceTempIdRef = useRef<(tableId: string, tempId: string, realId: string) => void>(() => {})

  // On WebSocket reconnect, re-fetch whiteboard data to replace any stale
  // optimistic state that was never confirmed before the disconnect.
  const handleReconnect = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['whiteboard', whiteboardId] })
    queryClient.invalidateQueries({ queryKey: ['relationships', whiteboardId] })
  }, [queryClient, whiteboardId])

  // Ref for onReconnect — keeps the callback stable without re-registering socket listeners
  const onReconnectRef = useRef(handleReconnect)
  useEffect(() => {
    onReconnectRef.current = handleReconnect
  }, [handleReconnect])

  // Column mutations hook (optimistic updates + WebSocket emit)
  const columnMutationsCallbacks = useMemo(
    () => ({
      onColumnCreated,
      onColumnUpdated,
      onColumnDeleted,
      onColumnError: (data: any) => {
        onColumnErrorRef.current(data)
      },
      onOwnColumnCreated: (column: any) => {
        // Server confirmed our own column:create — replace the optimistic temp ID
        // with the real database ID. We find the matching pending column by
        // tableId + name + order (the temp column will have a different id).
        // Use a one-time setNodes read to locate the tempId before calling replaceTempId.
        let tempId: string | undefined
        setNodes((prevNodes) => {
          const tableNode = prevNodes.find((n) => n.data.table.id === column.tableId)
          if (tableNode) {
            const match = tableNode.data.table.columns.find(
              (c) =>
                c.name === column.name &&
                c.order === column.order &&
                c.id !== column.id,
            )
            if (match) {
              tempId = match.id
            }
          }
          return prevNodes // no state change yet — just reading
        })
        if (tempId) {
          replaceTempIdRef.current(column.tableId, tempId, column.id)
        }
      },
      onReconnect: () => {
        onReconnectRef.current()
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

  // Wire onColumnError ref now that columnMutations is available
  useEffect(() => {
    onColumnErrorRef.current = columnMutations.onColumnError
  }, [columnMutations.onColumnError])

  // Wire replaceTempId ref now that columnMutations is available
  useEffect(() => {
    replaceTempIdRef.current = columnMutations.replaceTempId
  }, [columnMutations.replaceTempId])

  // Table mutations hook (optimistic delete + rollback)
  const tableMutations = useTableMutations(
    setNodes,
    setEdges,
    emitTableDelete,
    isConnected,
  )

  // Wire onTableError ref now that tableMutations is available
  useEffect(() => {
    onTableErrorRef.current = tableMutations.onTableError
  }, [tableMutations.onTableError])

  // Keyboard shortcut for table deletion (Delete/Backspace on selected node)
  useTableDeletion((tableId: string) => setDeletingTableId(tableId))

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

  // Callback to request table deletion (opens dialog)
  const handleRequestTableDelete = useCallback((tableId: string) => {
    setDeletingTableId(tableId)
  }, [])

  // Thread column mutation callbacks into node data via refs (stable identity)
  const handleColumnCreateRef = useRef(handleColumnCreate)
  const handleColumnUpdateRef = useRef(handleColumnUpdate)
  const handleColumnDeleteRef = useRef(handleColumnDelete)
  const handleRequestTableDeleteRef = useRef(handleRequestTableDelete)
  useEffect(() => { handleColumnCreateRef.current = handleColumnCreate }, [handleColumnCreate])
  useEffect(() => { handleColumnUpdateRef.current = handleColumnUpdate }, [handleColumnUpdate])
  useEffect(() => { handleColumnDeleteRef.current = handleColumnDelete }, [handleColumnDelete])
  useEffect(() => { handleRequestTableDeleteRef.current = handleRequestTableDelete }, [handleRequestTableDelete])

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
          onRequestTableDelete: handleRequestTableDeleteRef.current,
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
          onRequestTableDelete: handleRequestTableDeleteRef.current,
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
      return await updateTablePositionFn({ data: params })
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

  // React Flow zoom API (requires ReactFlowProvider context)
  const reactFlowInstance = useReactFlow()
  const viewport = useViewport()

  // Build zoom controls and expose to parent once on mount
  useEffect(() => {
    if (onZoomControlsReady) {
      const controls: ZoomControls = {
        zoomIn: () => reactFlowInstance.zoomIn({ duration: 200 }),
        zoomOut: () => reactFlowInstance.zoomOut({ duration: 200 }),
        resetZoom: () => reactFlowInstance.setViewport(
          { x: 0, y: 0, zoom: 1 },
          { duration: 200 },
        ),
        fitToScreen: () => reactFlowInstance.fitView({ duration: 200, padding: 0.2 }),
      }
      onZoomControlsReady(controls)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run once on mount — reactFlowInstance is stable

  // Notify parent when viewport zoom changes
  useEffect(() => {
    if (onZoomChange) {
      onZoomChange(viewport.zoom)
    }
  }, [viewport.zoom, onZoomChange])

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

  // Compute dialog data for the deleting table
  const deletingNode = deletingTableId
    ? nodes.find((n) => n.id === deletingTableId) ?? null
    : null

  const tableDeleteAffectedRelationships = useMemo((): Array<TableRelationship> => {
    if (!deletingTableId || !deletingNode) return []
    const tableNameById = new Map(nodes.map((n) => [n.id, n.data.table.name]))
    return edges
      .filter(
        (e) =>
          e.data?.relationship.sourceTableId === deletingTableId ||
          e.data?.relationship.targetTableId === deletingTableId,
      )
      .map((e) => {
        const rel = e.data!.relationship
        return {
          id: e.id,
          sourceTableName: tableNameById.get(rel.sourceTableId) ?? rel.sourceTableId,
          sourceColumnName: rel.sourceColumn.name,
          targetTableName: tableNameById.get(rel.targetTableId) ?? rel.targetTableId,
          targetColumnName: rel.targetColumn.name,
          cardinality: String(e.data!.cardinality),
        }
      })
  }, [deletingTableId, deletingNode, nodes, edges])

  // Render React Flow canvas with collaboration-aware state
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <ConnectionStatusIndicator connectionState={connectionState} />
      {deletingTableId && deletingNode && (
        <DeleteTableDialog
          tableName={deletingNode.data.table.name}
          columnCount={deletingNode.data.table.columns.length}
          affectedRelationships={tableDeleteAffectedRelationships}
          onConfirm={() => {
            tableMutations.deleteTable(deletingTableId)
            setDeletingTableId(null)
          }}
          onCancel={() => setDeletingTableId(null)}
        />
      )}
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
  userId = getSessionUserId(), // Anonymous session-stable UUID; replace with auth when available
  showMinimap = false,
  showControls = true,
  nodesDraggable = true,
  onAutoLayoutReady,
  onDisplayModeReady,
  onZoomControlsReady,
  onZoomChange,
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
        onZoomControlsReady={onZoomControlsReady}
        onZoomChange={onZoomChange}
      />
    </ReactFlowProvider>
  )
}
