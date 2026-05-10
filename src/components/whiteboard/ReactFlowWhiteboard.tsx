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

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ReactFlowProvider,
  useReactFlow,
  useUpdateNodeInternals,
  useViewport,
} from '@xyflow/react'
import { ReactFlowCanvas } from './ReactFlowCanvas'
import { ConnectionStatusIndicator } from './ConnectionStatusIndicator'
import { DeleteTableDialog } from './DeleteTableDialog'
import { Toolbar } from './Toolbar'
import { AutoLayoutConfirmDialog } from './AutoLayoutConfirmDialog'
import type { Connection } from '@xyflow/react'
import type { ZoomControls } from './Toolbar'
import type {
  RelationshipEdgeType,
  ShowMode,
  TableNodeType,
} from '@/lib/react-flow/types'
import type { Cardinality, Column } from '@prisma/client'
import type { CreateColumnPayload } from './column/types'
import type {
  CreateRelationship,
  CreateTable,
  UpdateColumn,
} from '@/data/schema'
import type { TableRelationship } from './DeleteTableDialog'
import type { RelationshipErrorEvent } from '@/hooks/use-relationship-mutations'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { parseColumnHandleId } from '@/lib/react-flow/edge-routing'
import { convertTablesToNodes } from '@/lib/react-flow/convert-to-nodes'
import { convertRelationshipsToEdges } from '@/lib/react-flow/convert-to-edges'
import {
  createRelationshipFn,
  getWhiteboardRelationships,
  getWhiteboardWithDiagram,
} from '@/lib/server-functions'
import { useD3ForceLayout } from '@/hooks/use-d3-force-layout'
import { useAutoLayoutOrchestrator } from '@/hooks/use-auto-layout-orchestrator'
import { applyBulkPositions } from '@/lib/auto-layout'
import { updateTablePositionFn } from '@/routes/api/tables'
import { useWhiteboardCollaboration } from '@/hooks/use-whiteboard-collaboration'
import { useColumnCollaboration } from '@/hooks/use-column-collaboration'
import { useColumnMutations } from '@/hooks/use-column-mutations'
import { useTableMutations } from '@/hooks/use-table-mutations'
import { useRelationshipMutations } from '@/hooks/use-relationship-mutations'
import { useTableDeletion } from '@/hooks/use-table-deletion'
import { useColumnReorderMutations } from '@/hooks/use-column-reorder-mutations'
import { useColumnReorderCollaboration } from '@/hooks/use-column-reorder-collaboration'
import { getSessionUserId } from '@/lib/session-user-id'
import { isUnauthorizedError } from '@/lib/auth/errors'

/** Pending connection data waiting for cardinality selection */
interface PendingConnection {
  sourceTableId: string
  sourceColumnId: string
  targetTableId: string
  targetColumnId: string
}

/** Cardinality options for the picker dialog */
const CARDINALITY_OPTIONS: Array<{ value: Cardinality; label: string }> = [
  { value: 'ONE_TO_ONE', label: 'One to One (1:1)' },
  { value: 'ONE_TO_MANY', label: 'One to Many (1:N)' },
  { value: 'MANY_TO_ONE', label: 'Many to One (N:1)' },
  { value: 'MANY_TO_MANY', label: 'Many to Many (N:N)' },
  { value: 'ZERO_TO_ONE', label: 'Zero to One (0:1)' },
  { value: 'ZERO_TO_MANY', label: 'Zero to Many (0:N)' },
  { value: 'SELF_REFERENCING', label: 'Self Referencing' },
  { value: 'ZERO_OR_ONE_TO_ONE', label: 'Zero or One to One (0..1:1)' },
  { value: 'ZERO_OR_ONE_TO_MANY', label: 'Zero or One to Many (0..1:N)' },
  { value: 'ZERO_OR_MANY_TO_ONE', label: 'Zero or Many to One (0..N:1)' },
  { value: 'ZERO_OR_MANY_TO_MANY', label: 'Zero or Many to Many (0..N:N)' },
  { value: 'ZERO_OR_ONE_TO_ZERO_OR_ONE', label: 'Zero or One to Zero or One' },
  {
    value: 'ZERO_OR_ONE_TO_ZERO_OR_MANY',
    label: 'Zero or One to Zero or Many',
  },
  { value: 'MANY_TO_ZERO_OR_ONE', label: 'Many to Zero or One (N:0..1)' },
  { value: 'MANY_TO_ZERO_OR_MANY', label: 'Many to Zero or Many (N:0..N)' },
  {
    value: 'ZERO_OR_MANY_TO_ZERO_OR_ONE',
    label: 'Zero or Many to Zero or One',
  },
  {
    value: 'ZERO_OR_MANY_TO_ZERO_OR_MANY',
    label: 'Zero or Many to Zero or Many',
  },
]

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
  /** Callback when a new table is created via the toolbar */
  onCreateTable?: (data: CreateTable) => void | Promise<void>
  /** Callback when a new relationship is created via the toolbar */
  onCreateRelationship?: (data: CreateRelationship) => void | Promise<void>
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
  onCreateTable,
  onCreateRelationship,
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
  onCreateTable?: (data: CreateTable) => void | Promise<void>
  onCreateRelationship?: (data: CreateRelationship) => void | Promise<void>
  onDisplayModeReady?: (
    showMode: ShowMode,
    setShowMode: (mode: ShowMode) => void,
  ) => void
  onZoomControlsReady?: (controls: ZoomControls) => void
  onZoomChange?: (zoom: number) => void
}) {
  const queryClient = useQueryClient()

  // Column reorder mutations — must be initialized early since seedConfirmedOrderFromServer
  // is called from the initialNodes effect below
  const columnReorderMutations = useColumnReorderMutations()

  // Disable RF panOnDrag while a column is being dragged — prevents canvas
  // panning from stealing pointermove events and corrupting collision detection.
  const [isColumnDragging, setIsColumnDragging] = useState(false)

  // Local React Flow state (will be updated by collaboration)
  const [nodes, setNodes] = useState<Array<TableNodeType>>(initialNodes)
  const [edges, setEdges] = useState<Array<RelationshipEdgeType>>(initialEdges)

  // Stable map of tableId → tableName derived from the query data.
  // Recomputes only when tables are added, removed, or renamed — not on
  // every position/highlight change — so TableNode memo isn't broken.
  const tableNameById = useMemo(
    () =>
      new Map(initialNodes.map((n) => [n.data.table.id, n.data.table.name])),
    [initialNodes],
  )

  // Keep a stable ref to edges for use inside callbacks without stale closure
  const edgesRef = useRef(edges)
  useEffect(() => {
    edgesRef.current = edges
  }, [edges])

  // Table deletion state — which table has been requested for deletion (opens dialog)
  const [deletingTableId, setDeletingTableId] = useState<string | null>(null)

  // Cardinality picker dialog state for drag-to-connect
  const [pendingConnection, setPendingConnection] =
    useState<PendingConnection | null>(null)
  const [selectedCardinality, setSelectedCardinality] =
    useState<Cardinality>('ONE_TO_MANY')
  const [pendingLabel, setPendingLabel] = useState('')

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

  // Seed lastConfirmedOrder from initial whiteboard data (SA-H1).
  // Called when initialNodes changes (first load + reconnect refetch).
  // seedConfirmedOrderFromServer is idempotent — only sets baseline if not already present.
  //
  // MEDIUM-01: On reconnect refetch (justReconnectedRef.current === true), also call
  // onSyncReconcile so AC-08e/f toasts fire when the server order diverges from the
  // last optimistic order (e.g. reorder was lost during disconnect). Per Cassandra LOW-03,
  // refresh lastConfirmedOrderByTable unconditionally on reconnect so the stale pre-disconnect
  // baseline does not cause false-positive toasts on the NEXT reconnect.
  useEffect(() => {
    const isReconnect = justReconnectedRef.current
    if (isReconnect) {
      justReconnectedRef.current = false
    }

    initialNodes.forEach((node) => {
      const tableId = node.data.table.id
      const serverOrder = node.data.table.columns.map((c) => c.id)

      if (isReconnect) {
        // Refresh confirmed-order baseline so it reflects post-disconnect server state,
        // then check if our optimistic order diverged (AC-08e/f).
        // seedConfirmedOrderFromServer is idempotent (no-op if already seeded on first load),
        // so we call onSyncReconcile directly and let the ack handler manage lastConfirmed.
        columnReorderMutations.onSyncReconcile(tableId, serverOrder)
      } else {
        // Initial load: seed the baseline (idempotent)
        columnReorderMutations.seedConfirmedOrderFromServer(
          tableId,
          serverOrder,
        )
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNodes])

  // Update local state when initial data changes (and attach callbacks)
  // Preserve existing callbacks from prev nodes so that a TanStack Query refetch
  // (which updates initialNodes) does not wipe callbacks injected by later effects.
  useEffect(() => {
    setNodes((prevNodes) => {
      const prevNodeMap = new Map(prevNodes.map((n) => [n.id, n]))
      return initialNodes.map((node): TableNodeType => {
        const prev = prevNodeMap.get(node.id)
        if (!prev) {
          // New node (e.g., just-created table): inject current callbacks so
          // column mutations work immediately without waiting for the next
          // isConnected change or a full re-mount.
          return {
            ...node,
            data: {
              ...node.data,
              onColumnCreate: handleColumnCreateRef.current,
              onColumnUpdate: handleColumnUpdateRef.current,
              onColumnDelete: handleColumnDeleteRef.current,
              onColumnDuplicate: handleColumnDuplicateRef.current,
              onRequestTableDelete: handleRequestTableDeleteRef.current,
              edges: edgesRef.current,
              tableNameById,
              isConnected,
            },
          }
        }
        // Preserve callbacks from previous node data, overwrite everything else.
        // Also preserve any optimistic columns that are still pending server
        // confirmation — if a refetch lands before the server acks a column:create,
        // the DB snapshot won't include the column yet and would silently erase it
        // from local state, causing the user to re-type the same name and hit a
        // unique-constraint error on the second attempt.
        const incomingColumns = (
          node.data.table as { columns: Array<{ id: string }> }
        ).columns
        const prevColumns = prev.data.table.columns
        // If the incoming cache snapshot has no columns but local state does,
        // the cache is stale (e.g. position-only update landed before a full
        // refetch). Preserve the local columns to avoid wiping them.
        const baseColumns =
          incomingColumns.length > 0 ? incomingColumns : prevColumns
        const dbColumnIds = new Set(baseColumns.map((c) => c.id))
        const optimisticColumns = prevColumns.filter(
          (c) =>
            !dbColumnIds.has(c.id) &&
            columnMutations.pendingMutations.current.has(c.id),
        )
        return {
          ...node,
          data: {
            ...node.data,
            table: {
              ...node.data.table,
              columns: [...baseColumns, ...optimisticColumns],
            },
            onColumnCreate: prev.data.onColumnCreate,
            onColumnUpdate: prev.data.onColumnUpdate,
            onColumnDelete: prev.data.onColumnDelete,
            onColumnDuplicate: prev.data.onColumnDuplicate,
            onRequestTableDelete: prev.data.onRequestTableDelete,
            tableNameById,
          },
        }
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNodes, tableNameById])

  // Update local edge state when initial data changes — preserve onDelete and onLabelUpdate callbacks
  // so that a TanStack Query refetch does not wipe the injected callbacks.
  useEffect(() => {
    setEdges((prevEdges) => {
      const prevEdgeMap = new Map(prevEdges.map((e) => [e.id, e]))
      return initialEdges.map((edge) => {
        const prev = prevEdgeMap.get(edge.id)
        if (!prev) return edge
        return {
          ...edge,
          data: {
            ...edge.data!,
            onDelete: prev.data?.onDelete,
            onLabelUpdate: prev.data?.onLabelUpdate,
          },
        }
      })
    })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges])

  // Callback for when a remote user deletes a table
  const onTableDeleted = useCallback(
    (tableId: string) => {
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
      // W4 (M10): clean up all per-table reorder state to prevent unbounded ref growth
      columnReorderMutations.forgetTable(tableId)
    },
    [columnReorderMutations],
  )

  // Ref for onTableError — breaks circular dependency between useWhiteboardCollaboration and useTableMutations
  const onTableErrorRef = useRef<(data: any) => void>(() => {})

  // Callback for when a remote user deletes a relationship
  const onRelationshipDeleted = useCallback((relationshipId: string) => {
    setEdges((prev) => prev.filter((e) => e.id !== relationshipId))
  }, [])

  // Callback for when a remote user updates a relationship label
  const onRelationshipUpdated = useCallback(
    (relationshipId: string, label: string) => {
      setEdges((prev) =>
        prev.map((e) =>
          e.id === relationshipId
            ? { ...e, data: { ...e.data!, label: label || undefined } }
            : e,
        ),
      )
    },
    [],
  )

  // Ref for onRelationshipError — breaks circular dependency between useWhiteboardCollaboration and useRelationshipMutations
  const onRelationshipErrorRef = useRef<(data: RelationshipErrorEvent) => void>(
    () => {},
  )

  // Real-time collaboration integration (table position events + table deletion + relationship deletion/update)
  const {
    connectionState,
    emitPositionUpdate,
    emitBulkPositionUpdate,
    emitTableDelete,
    emitRelationshipDelete,
    emitRelationshipUpdate,
  } = useWhiteboardCollaboration(
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
    useCallback((data: any) => {
      onTableErrorRef.current(data)
    }, []),
    onRelationshipDeleted,
    useCallback((data: RelationshipErrorEvent) => {
      onRelationshipErrorRef.current(data)
    }, []),
    onRelationshipUpdated,
    // onBulkPositionUpdate — applies Auto Layout broadcast from collaborators.
    // One setNodes call satisfies the "one render tick" atomicity contract (FR-009).
    // Normalise wire-format {tableId, positionX, positionY} → {id, x, y} at the
    // boundary so applyBulkPositions can use its O(n) Map lookup (B3 fix).
    useCallback(
      (
        positions: Array<{
          tableId: string
          positionX: number
          positionY: number
        }>,
      ) => {
        const normalised = positions.map((p) => ({
          id: p.tableId,
          x: p.positionX,
          y: p.positionY,
        }))
        setNodes((nds) => applyBulkPositions(nds, normalised))
      },
      [],
    ),
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
    (data: {
      columnId: string
      tableId: string
      updatedBy: string
      [key: string]: any
    }) => {
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
                    columns: node.data.table.columns.filter(
                      (c) => c.id !== columnId,
                    ),
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
  const replaceTempIdRef = useRef<
    (tableId: string, tempId: string, realId: string) => void
  >(() => {})

  // Ref for onRemoteColumnDuplicated — avoids circular dep with columnMutations
  const onRemoteColumnDuplicatedRef = useRef<(data: any) => void>(() => {})

  // On WebSocket reconnect, re-fetch whiteboard data to replace any stale
  // optimistic state that was never confirmed before the disconnect.
  // MEDIUM-01: flag set to true on reconnect so the initialNodes effect knows
  // to call onSyncReconcile after the TanStack Query refetch settles.
  const justReconnectedRef = useRef(false)

  const handleReconnect = useCallback(() => {
    justReconnectedRef.current = true
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
          const tableNode = prevNodes.find(
            (n) => n.data.table.id === column.tableId,
          )
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
      onColumnDuplicated: (data: any) => {
        // Remote user duplicated a column — insert it into local state
        onRemoteColumnDuplicatedRef.current(data)
      },
      onOwnColumnDuplicated: (data: any) => {
        // Server confirmed our own column:duplicate — replace the optimistic temp ID
        // with the real database ID. The optimistic column has name `<original>_copy`
        // and order = sourceColumn.order + 1; match by tableId + order + prefix.
        const column = data.column
        let tempId: string | undefined
        setNodes((prevNodes) => {
          const tableNode = prevNodes.find(
            (n) => n.data.table.id === column.tableId,
          )
          if (tableNode) {
            const match = tableNode.data.table.columns.find(
              (c) =>
                c.order === column.order &&
                c.id !== column.id &&
                c.name.endsWith('_copy'),
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
    emitColumnDuplicate,
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
    emitColumnDuplicate,
  )

  // Wire onColumnError ref now that columnMutations is available
  useEffect(() => {
    onColumnErrorRef.current = columnMutations.onColumnError
  }, [columnMutations.onColumnError])

  // Wire replaceTempId ref now that columnMutations is available
  useEffect(() => {
    replaceTempIdRef.current = columnMutations.replaceTempId
  }, [columnMutations.replaceTempId])

  // Wire onRemoteColumnDuplicated ref now that columnMutations is available
  useEffect(() => {
    onRemoteColumnDuplicatedRef.current =
      columnMutations.onRemoteColumnDuplicated
  }, [columnMutations.onRemoteColumnDuplicated])

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

  // Relationship mutations hook (optimistic delete + label update with rollback)
  const relationshipMutations = useRelationshipMutations(
    setEdges,
    emitRelationshipDelete,
    isConnected,
    emitRelationshipUpdate,
  )

  // Wire onRelationshipError ref now that relationshipMutations is available
  useEffect(() => {
    onRelationshipErrorRef.current = relationshipMutations.onRelationshipError
  }, [relationshipMutations.onRelationshipError])

  // -------------------------------------------------------------------------
  // Column reorder state (optimistic state + FIFO queue already initialized above)
  // -------------------------------------------------------------------------

  // Tick counter per table — incremented on every local or remote reorder to
  // trigger updateNodeInternals and keep edges anchored (Spike S2, SA-M1)
  const [reorderTickByTable, setReorderTickByTable] = useState<
    Record<string, number>
  >({})

  const bumpReorderTick = useCallback((tableId: string) => {
    setReorderTickByTable((prev) => ({
      ...prev,
      [tableId]: (prev[tableId] ?? 0) + 1,
    }))
  }, [])

  // updateNodeInternals via useLayoutEffect — must be useLayoutEffect (not useEffect)
  // to run synchronously after DOM mutation before browser paint (SA-M1, Spike S2)
  const updateNodeInternals = useUpdateNodeInternals()
  useLayoutEffect(() => {
    Object.keys(reorderTickByTable).forEach((tableId) => {
      updateNodeInternals(tableId)
    })
  }, [reorderTickByTable, updateNodeInternals])

  // Column reorder collaboration (emits + listens for WS events)
  const { emitColumnReorder } = useColumnReorderCollaboration(
    whiteboardId,
    userId,
    {
      setNodes,
      bumpReorderTick,
      mutations: columnReorderMutations,
    },
  )

  // Stable ref for the deleteRelationship callback — prevents stale closures in edge data
  const handleRelationshipDeleteRef = useRef(
    relationshipMutations.deleteRelationship,
  )
  useEffect(() => {
    handleRelationshipDeleteRef.current =
      relationshipMutations.deleteRelationship
  }, [relationshipMutations.deleteRelationship])

  // Stable ref for the updateRelationshipLabel callback — prevents stale closures in edge data
  const handleRelationshipLabelUpdateRef = useRef(
    relationshipMutations.updateRelationshipLabel,
  )
  useEffect(() => {
    handleRelationshipLabelUpdateRef.current =
      relationshipMutations.updateRelationshipLabel
  }, [relationshipMutations.updateRelationshipLabel])

  // Inject onDelete and onLabelUpdate callbacks into edge data whenever isConnected changes
  useEffect(() => {
    setEdges((prevEdges) =>
      prevEdges.map((edge) => ({
        ...edge,
        data: {
          ...edge.data!,
          onDelete: handleRelationshipDeleteRef.current,
          onLabelUpdate: handleRelationshipLabelUpdateRef.current,
        },
      })),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected])

  // Also inject onDelete and onLabelUpdate callbacks into edges once on mount
  useEffect(() => {
    setEdges((prevEdges) =>
      prevEdges.map((edge) => ({
        ...edge,
        data: {
          ...edge.data!,
          onDelete: handleRelationshipDeleteRef.current,
          onLabelUpdate: handleRelationshipLabelUpdateRef.current,
        },
      })),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keyboard shortcut for table deletion (Delete/Backspace on selected node)
  useTableDeletion((tableId: string) => setDeletingTableId(tableId))

  // Column mutation callbacks (outgoing — triggered by user interactions in TableNode)
  const handleColumnCreate = useCallback(
    (tableId: string, data: CreateColumnPayload) => {
      try {
        columnMutations.createColumn(tableId, data)
      } catch (error) {
        console.error('Failed to create column:', error)
        throw error
      }
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

  const handleColumnDuplicate = useCallback(
    (column: Column) => {
      columnMutations.duplicateColumn(column)
    },
    [columnMutations],
  )

  // Callback to request table deletion (opens dialog)
  const handleRequestTableDelete = useCallback((tableId: string) => {
    setDeletingTableId(tableId)
  }, [])

  // Column reorder callback — wraps reconcileAfterDrop with real setNodes
  const handleColumnReorder = useCallback(
    (
      params: import('@/hooks/use-column-reorder-mutations').ReconcileAfterDropParams,
    ) => {
      columnReorderMutations.reconcileAfterDrop({
        ...params,
        setNodes,
        bumpReorderTick,
        emitColumnReorder,
      })
    },
    [columnReorderMutations, setNodes, bumpReorderTick, emitColumnReorder],
  )

  // Relationship creation mutation (for drag-to-connect)
  const createRelationshipMutation = useMutation({
    mutationFn: async (data: {
      whiteboardId: string
      sourceTableId: string
      targetTableId: string
      sourceColumnId: string
      targetColumnId: string
      cardinality: Cardinality
    }) => {
      return await createRelationshipFn({ data })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['relationships', whiteboardId],
      })
      queryClient.invalidateQueries({ queryKey: ['whiteboard', whiteboardId] })
    },
    onError: (err) => {
      console.error('Failed to create relationship:', err)
    },
  })

  // Handle connection drag completion — parse handle IDs and open cardinality picker.
  // In strict mode (default), source/target are guaranteed correct:
  // source = node with the source handle (drag start), target = node with the target handle (drop).
  const handleConnect = useCallback((connection: Connection) => {
    const { source, target, sourceHandle, targetHandle } = connection
    if (!source || !target || !sourceHandle || !targetHandle) return

    const parsedSource = parseColumnHandleId(sourceHandle)
    const parsedTarget = parseColumnHandleId(targetHandle)
    if (!parsedSource || !parsedTarget) return

    // Use connection.source/target (React Flow node IDs = table IDs) for table direction,
    // and parsed handle IDs only for column IDs.
    setPendingConnection({
      sourceTableId: source,
      sourceColumnId: parsedSource.columnId,
      targetTableId: target,
      targetColumnId: parsedTarget.columnId,
    })
    setSelectedCardinality('ONE_TO_MANY')
  }, [])

  // Confirm cardinality selection and create relationship
  const handleCardinalityConfirm = useCallback(() => {
    if (!pendingConnection) return

    createRelationshipMutation.mutate({
      whiteboardId,
      sourceTableId: pendingConnection.sourceTableId,
      targetTableId: pendingConnection.targetTableId,
      sourceColumnId: pendingConnection.sourceColumnId,
      targetColumnId: pendingConnection.targetColumnId,
      cardinality: selectedCardinality,
      label: pendingLabel.trim() || undefined,
    })

    setPendingConnection(null)
    setPendingLabel('')
  }, [
    pendingConnection,
    selectedCardinality,
    pendingLabel,
    whiteboardId,
    createRelationshipMutation,
  ])

  // Cancel pending connection
  const handleCardinalityCancel = useCallback(() => {
    setPendingConnection(null)
    setPendingLabel('')
  }, [])

  // Thread column mutation callbacks into node data via refs (stable identity)
  const handleColumnCreateRef = useRef(handleColumnCreate)
  const handleColumnUpdateRef = useRef(handleColumnUpdate)
  const handleColumnDeleteRef = useRef(handleColumnDelete)
  const handleColumnDuplicateRef = useRef(handleColumnDuplicate)
  const handleRequestTableDeleteRef = useRef(handleRequestTableDelete)
  const handleColumnReorderRef = useRef(handleColumnReorder)
  const emitColumnReorderRef = useRef(emitColumnReorder)
  const bumpReorderTickRef = useRef(bumpReorderTick)
  useEffect(() => {
    handleColumnCreateRef.current = handleColumnCreate
  }, [handleColumnCreate])
  useEffect(() => {
    handleColumnUpdateRef.current = handleColumnUpdate
  }, [handleColumnUpdate])
  useEffect(() => {
    handleColumnDeleteRef.current = handleColumnDelete
  }, [handleColumnDelete])
  useEffect(() => {
    handleColumnDuplicateRef.current = handleColumnDuplicate
  }, [handleColumnDuplicate])
  useEffect(() => {
    handleRequestTableDeleteRef.current = handleRequestTableDelete
  }, [handleRequestTableDelete])
  useEffect(() => {
    handleColumnReorderRef.current = handleColumnReorder
  }, [handleColumnReorder])
  useEffect(() => {
    emitColumnReorderRef.current = emitColumnReorder
  }, [emitColumnReorder])
  useEffect(() => {
    bumpReorderTickRef.current = bumpReorderTick
  }, [bumpReorderTick])

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
          onColumnDuplicate: handleColumnDuplicateRef.current,
          onRequestTableDelete: handleRequestTableDeleteRef.current,
          onColumnReorder: (
            params: import('@/hooks/use-column-reorder-mutations').ReconcileAfterDropParams,
          ) => handleColumnReorderRef.current(params),
          emitColumnReorder: (tableId: string, ids: Array<string>) =>
            emitColumnReorderRef.current(tableId, ids),
          isQueueFullForTable: (tableId: string) =>
            columnReorderMutations.isQueueFullForTable(tableId),
          setLocalDragging: (tableId: string, dragging: boolean) => {
            columnReorderMutations.setLocalDragging(tableId, dragging)
            setIsColumnDragging(columnReorderMutations.isAnyColumnDragging())
          },
          bumpReorderTick: (tableId: string) =>
            bumpReorderTickRef.current(tableId),
          tableNameById,
          isConnected,
        },
      })),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, tableNameById])

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
          onColumnDuplicate: handleColumnDuplicateRef.current,
          onRequestTableDelete: handleRequestTableDeleteRef.current,
          onColumnReorder: (
            params: import('@/hooks/use-column-reorder-mutations').ReconcileAfterDropParams,
          ) => handleColumnReorderRef.current(params),
          emitColumnReorder: (tableId: string, ids: Array<string>) =>
            emitColumnReorderRef.current(tableId, ids),
          isQueueFullForTable: (tableId: string) =>
            columnReorderMutations.isQueueFullForTable(tableId),
          setLocalDragging: (tableId: string, dragging: boolean) => {
            columnReorderMutations.setLocalDragging(tableId, dragging)
            setIsColumnDragging(columnReorderMutations.isAnyColumnDragging())
          },
          bumpReorderTick: (tableId: string) =>
            bumpReorderTickRef.current(tableId),
          edges: edgesRef.current,
          tableNameById,
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
      if (isUnauthorizedError(updatedTable)) return
      // Update cache without full refetch for better performance
      queryClient.setQueryData(['whiteboard', whiteboardId], (old: any) => {
        if (!old?.whiteboard?.tables) return old
        return {
          ...old,
          whiteboard: {
            ...old.whiteboard,
            tables: old.whiteboard.tables.map((t: any) =>
              t.id === updatedTable.id
                ? {
                    ...t,
                    positionX: updatedTable.positionX,
                    positionY: updatedTable.positionY,
                  }
                : t,
            ),
          },
        }
      })
    },
    onError: (err) => {
      console.error('Failed to update table position:', err)
    },
  })

  // d3-force layout hook (wraps the pure computeD3ForceLayout engine)
  const { runLayout: runD3ForceLayout } = useD3ForceLayout()

  // Auto Layout orchestrator — owns the full flow:
  // button click → optional dialog → layout → optimistic setNodes → persist → broadcast → fitView
  const {
    isRunning: isAutoLayoutRunning,
    showConfirmDialog: showAutoLayoutDialog,
    handleAutoLayoutClick,
    handleConfirm: handleAutoLayoutConfirm,
    handleCancel: handleAutoLayoutCancel,
  } = useAutoLayoutOrchestrator({
    whiteboardId,
    runD3ForceLayout,
    emitBulkPositionUpdate,
  })

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
        resetZoom: () =>
          reactFlowInstance.setViewport(
            { x: 0, y: 0, zoom: 1 },
            { duration: 200 },
          ),
        fitToScreen: () =>
          reactFlowInstance.fitView({ duration: 200, padding: 0.2 }),
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
    ? (nodes.find((n) => n.id === deletingTableId) ?? null)
    : null

  const tableDeleteAffectedRelationships =
    useMemo((): Array<TableRelationship> => {
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
            sourceTableName:
              tableNameById.get(rel.sourceTableId) ?? rel.sourceTableId,
            sourceColumnName: rel.sourceColumn.name,
            targetTableName:
              tableNameById.get(rel.targetTableId) ?? rel.targetTableId,
            targetColumnName: rel.targetColumn.name,
            cardinality: String(e.data!.cardinality),
          }
        })
    }, [deletingTableId, deletingNode, nodes, edges])

  // Render React Flow canvas with collaboration-aware state
  // Derive tables list from nodes for the Toolbar
  const toolbarTables = useMemo(() => nodes.map((n) => n.data.table), [nodes])

  // Zoom controls for the Toolbar (reuse the already-initialized reactFlowInstance/viewport above)
  const toolbarZoomControls: ZoomControls = useMemo(
    () => ({
      zoomIn: () => reactFlowInstance.zoomIn({ duration: 200 }),
      zoomOut: () => reactFlowInstance.zoomOut({ duration: 200 }),
      resetZoom: () =>
        reactFlowInstance.setViewport(
          { x: 0, y: 0, zoom: 1 },
          { duration: 200 },
        ),
      fitToScreen: () =>
        reactFlowInstance.fitView({ duration: 200, padding: 0.2 }),
    }),
    [reactFlowInstance],
  )

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
      }}
    >
      {/* Toolbar — owned by ReactFlowWhiteboardInner so auto-layout orchestrator can control it */}
      <Toolbar
        whiteboardId={whiteboardId}
        tables={toolbarTables as any}
        onCreateTable={onCreateTable}
        onCreateRelationship={onCreateRelationship}
        tableCount={nodes.length}
        onAutoLayoutClick={() => handleAutoLayoutClick(nodes.length)}
        isAutoLayoutRunning={isAutoLayoutRunning}
        zoomControls={toolbarZoomControls}
        currentZoom={viewport.zoom}
        showMode={showMode}
        onShowModeChange={setShowMode}
      />

      {/* Auto Layout confirmation dialog (shown when tableCount > 50) */}
      <AutoLayoutConfirmDialog
        open={showAutoLayoutDialog}
        tableCount={nodes.length}
        onConfirm={handleAutoLayoutConfirm}
        onCancel={handleAutoLayoutCancel}
      />

      <div style={{ position: 'relative', flex: 1 }}>
        <ConnectionStatusIndicator connectionState={connectionState} />
        {deletingTableId && deletingNode && (
          <DeleteTableDialog
            tableName={deletingNode.data.table.name}
            columnCount={deletingNode.data.table.columns.length}
            affectedRelationships={tableDeleteAffectedRelationships}
            onConfirm={() => {
              tableMutations.deleteTable(deletingTableId)
              // W4-A: clean up per-table reorder state on local delete path.
              // forgetTable is also called in onTableDeleted for the remote path —
              // this call covers the case where the current user deletes a table.
              columnReorderMutations.forgetTable(deletingTableId)
              setDeletingTableId(null)
            }}
            onCancel={() => setDeletingTableId(null)}
          />
        )}
        <ReactFlowCanvas
          initialNodes={nodes}
          initialEdges={edges}
          onConnect={handleConnect}
          onNodeDragStop={handleNodeDragStop}
          nodesDraggable={nodesDraggable}
          panOnDrag={!isColumnDragging}
          showMinimap={showMinimap}
          showControls={showControls}
          showBackground={true}
          fitViewOptions={{
            padding: 0.2,
            includeHiddenNodes: false,
          }}
        />

        {/* Cardinality Picker Dialog — shown after drag-to-connect */}
        <Dialog
          open={pendingConnection !== null}
          onOpenChange={(open) => {
            if (!open) handleCardinalityCancel()
          }}
        >
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Set Relationship Cardinality</DialogTitle>
            </DialogHeader>

            <div className="py-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cardinality-select">Cardinality</Label>
                <Select
                  value={selectedCardinality}
                  onValueChange={(value) =>
                    setSelectedCardinality(value as Cardinality)
                  }
                >
                  <SelectTrigger id="cardinality-select">
                    <SelectValue placeholder="Select cardinality" />
                  </SelectTrigger>
                  <SelectContent>
                    {CARDINALITY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="relationship-label">Label (optional)</Label>
                <Input
                  id="relationship-label"
                  value={pendingLabel}
                  onChange={(e) => setPendingLabel(e.target.value)}
                  placeholder="e.g. has many, belongs to"
                  maxLength={255}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleCardinalityCancel}>
                Cancel
              </Button>
              <Button onClick={handleCardinalityConfirm}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}

/**
 * ReactFlowWhiteboard component
 * Fetches whiteboard data and renders React Flow canvas
 */
export function ReactFlowWhiteboard({
  whiteboardId,
  userId = getSessionUserId(), // fallback only — callers should pass the authenticated user's DB ID
  showMinimap = false,
  showControls = true,
  nodesDraggable = true,
  onCreateTable,
  onCreateRelationship,
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
    // Guard against AuthErrorResponse
    if (!whiteboardData || isUnauthorizedError(whiteboardData)) return []
    // whiteboardData is WhiteboardWithDiagram which directly has .tables
    const tables = whiteboardData?.tables

    if (!tables || tables.length === 0) {
      console.log('ReactFlowWhiteboard: No tables data or empty array')
      return []
    }
    console.log('ReactFlowWhiteboard: Converting tables to nodes', tables)
    const convertedNodes = convertTablesToNodes(tables, 'ALL_FIELDS')
    console.log('ReactFlowWhiteboard: Converted nodes', convertedNodes)
    return convertedNodes
  }, [whiteboardData])

  // Convert relationships to React Flow edges
  const edges = useMemo(() => {
    if (!relationships || isUnauthorizedError(relationships)) {
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

  // Wrap in ReactFlowProvider to enable hooks like useAutoLayoutOrchestrator
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
        onCreateTable={onCreateTable}
        onCreateRelationship={onCreateRelationship}
        onDisplayModeReady={onDisplayModeReady}
        onZoomControlsReady={onZoomControlsReady}
        onZoomChange={onZoomChange}
      />
    </ReactFlowProvider>
  )
}
