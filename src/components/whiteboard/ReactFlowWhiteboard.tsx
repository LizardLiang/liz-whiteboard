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
  useNodesInitialized,
  useReactFlow,
  useUpdateNodeInternals,
  useViewport,
} from '@xyflow/react'
import { MessageCircle, Minimize2, SquareDashed } from 'lucide-react'
import { toast } from 'sonner'
import { ReactFlowCanvas } from './ReactFlowCanvas'
import { ConnectionStatusIndicator } from './ConnectionStatusIndicator'
import { DeleteTableDialog } from './DeleteTableDialog'
import { Toolbar } from './Toolbar'
import { WhiteboardSearch } from './WhiteboardSearch'
import { AutoLayoutConfirmDialog } from './AutoLayoutConfirmDialog'
import { TableFocusOverlay } from './TableFocusOverlay'
import { WhiteboardAccessDenied } from './WhiteboardAccessDenied'
import { WhiteboardPermissionsProvider } from './whiteboard-permissions-context'
import type { Connection } from '@xyflow/react'
import type { ZoomControls } from './Toolbar'
import type {
  AreaNodeType,
  CommentNodeType,
  CommentThreadVM,
  RelationshipEdgeType,
  ShowMode,
  TableNodeType,
} from '@/lib/react-flow/types'
import type { Column, CommentWithAuthor } from '@/data/models'
import type { EffectiveRole } from '@/data/permission'
import type {
  Cardinality,
  CreateRelationship,
  CreateTable,
  UpdateColumn,
} from '@/data/schema'
import type { WhiteboardWithDiagram } from '@/data/whiteboard'
import type { RelationshipWithDetails } from '@/data/relationship'
import type { DiagramAST } from '@/lib/parser/ast'
import type { CreateColumnPayload } from './column/types'
import type { TableRelationship } from './DeleteTableDialog'
import type { RelationshipErrorEvent } from '@/hooks/use-relationship-mutations'
import type { Dialect } from '@/lib/ddl-generator'
import type { ExportImageDialogOptions } from './ExportImageDialog'
import { exportDiagramImage } from '@/lib/export/export-image'
import { hasMinimumRole } from '@/lib/auth/permissions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
import { filterValidEdges } from '@/lib/react-flow/highlighting'
import { convertTablesToNodes } from '@/lib/react-flow/convert-to-nodes'
import { resolvePendingPositions } from '@/lib/react-flow/resolve-pending-positions'
import { convertRelationshipsToEdges } from '@/lib/react-flow/convert-to-edges'
import {
  createRelationshipFn,
  getMcpEndpointUrl,
  getWhiteboardRelationships,
  getWhiteboardWithDiagram,
  updateTablePositionsBulk,
} from '@/lib/server-functions'
import { useWhiteboardAreas } from '@/hooks/use-whiteboard-areas'
import { useWhiteboardComments } from '@/hooks/use-whiteboard-comments'
import { DEFAULT_AREA_COLOR } from '@/lib/area-colors'
import {
  computeAreaBounds,
  reconcileAreaMembership,
} from '@/lib/react-flow/area-bounds'
import { calculateTableHeight } from '@/lib/react-flow/layout-adapter'
import { LAYOUT_CONSTRAINTS } from '@/lib/react-flow/types'
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
import { useTableFocus } from '@/hooks/use-table-focus'
import { useMinimapFocusShortcut } from '@/hooks/use-minimap-focus-shortcut'
import { useTableRelationsPreview } from '@/hooks/use-table-relations-preview'
import {
  buildDiagramTablesFromFlow,
  exportTableDdl,
  useTableExportDdl,
} from '@/hooks/use-table-export-ddl'
import { useColumnReorderMutations } from '@/hooks/use-column-reorder-mutations'
import { useColumnReorderCollaboration } from '@/hooks/use-column-reorder-collaboration'
import { getSessionUserId } from '@/lib/session-user-id'
import { classifyQueryFailure, isUnauthorizedError } from '@/lib/auth/errors'
import { useAuthContext } from '@/components/auth/AuthContext'
import { useZenMode } from '@/hooks/use-zen-mode'

/** Pending connection data waiting for cardinality selection */
interface PendingConnection {
  sourceTableId: string
  sourceColumnId: string
  targetTableId: string
  targetColumnId: string
}

/**
 * Live comment mutation entry points (GH #110), exposed upward once via
 * `onCommentActionsReady` — mirrors the `onZoomControlsReady`/
 * `onDisplayModeReady` "ready callback" convention already used by this
 * component. Lets the route-level WhiteboardCommentsPanel (which cannot see
 * the socket hook directly — it's rendered outside this component to avoid
 * a circular import, same reason as WhiteboardHistoryPanel) drive
 * reply/edit/delete/resolve/create through the SAME socket-connected hook
 * instance, and pan the live canvas to a given comment's anchor.
 */
export interface CommentActions {
  createComment: ReturnType<typeof useWhiteboardComments>['createComment']
  addReply: ReturnType<typeof useWhiteboardComments>['addReply']
  editComment: ReturnType<typeof useWhiteboardComments>['editComment']
  deleteComment: ReturnType<typeof useWhiteboardComments>['deleteComment']
  resolveComment: ReturnType<typeof useWhiteboardComments>['resolveComment']
  /** Pan/fit the live canvas to a comment's anchor (table or point). */
  panToComment: (comment: CommentWithAuthor) => void
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
 * Stable empty default for a table node's `commentThreads` data field
 * (GH #110) — avoids a fresh `[]` identity on every injection-effect run
 * for tables with no comments, mirroring EMPTY_AREA_NODES's rationale in
 * ReactFlowCanvas.tsx.
 */
const EMPTY_COMMENT_THREADS: Array<CommentThreadVM> = []

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
  /** Requesting user's effective role on the whiteboard's project — gates
   * write affordances (Add Table/Relationship, dragging) in the toolbar. */
  viewerRole?: EffectiveRole | null
  /** Callback when a new table is created via the toolbar */
  onCreateTable?: (data: CreateTable) => void | Promise<unknown>
  /** Callback when a new relationship is created via the toolbar */
  onCreateRelationship?: (data: CreateRelationship) => void | Promise<unknown>
  /** Callback when the user confirms an Import SQL paste via the toolbar.
   * When omitted, no Import SQL button is rendered (mirrors onExport). */
  onImportSql?: (ast: DiagramAST) => void | Promise<void>
  /** Callback to expose display mode controls to parent */
  onDisplayModeReady?: (
    showMode: ShowMode,
    setShowMode: (mode: ShowMode) => void,
  ) => void
  /** Callback to expose zoom controls and current zoom to parent */
  onZoomControlsReady?: (controls: ZoomControls) => void
  /** Callback to notify parent when viewport zoom changes */
  onZoomChange?: (zoom: number) => void
  /**
   * Callback to open the version history panel (GH #107). Forwarded
   * straight through to the internal Toolbar. Deliberately owned by the
   * CALLER (not this component) — the panel itself
   * (WhiteboardHistoryPanel) reuses ReactFlowWhiteboard for its preview, so
   * rendering the panel here would create a circular import.
   */
  onOpenHistory?: () => void
  /**
   * Callback to open the canvas comments panel (GH #110). Forwarded to the
   * Toolbar, mirroring onOpenHistory — the panel itself is rendered by the
   * caller (route) to avoid a circular import.
   */
  onOpenComments?: () => void
  /**
   * Fires whenever the live comment list changes (initial load + every
   * socket event) so the caller can derive the header unread badge without
   * a second, disconnected query (GH #110).
   */
  onCommentsChange?: (comments: Array<CommentWithAuthor>) => void
  /**
   * Fires once with the live comment mutation entry points (GH #110) — see
   * the `CommentActions` doc comment above.
   */
  onCommentActionsReady?: (actions: CommentActions) => void
  /**
   * Renders a static, no-auth, read-only view (GH #109 public share links):
   * skips the two authed data queries in favor of `data` below, forces
   * nodesDraggable to false, hides the Toolbar and zen-mode chrome, opens NO
   * Socket.IO collaboration connection, and shows a "Read-only" badge.
   */
  isPublic?: boolean
  /**
   * Pre-fetched diagram data for the `isPublic` render path — supplied by
   * the public /share/$token route from its unauthenticated server fn
   * response, instead of the authed getWhiteboardWithDiagram/
   * getWhiteboardRelationships queries this component normally runs.
   */
  data?: {
    tables: WhiteboardWithDiagram['tables']
    relationships: Array<RelationshipWithDetails>
  }
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
  viewerRole = null,
  isPublic = false,
  collaborationEnabled = true,
  onCreateTable,
  onCreateRelationship,
  onImportSql,
  onDisplayModeReady,
  onZoomControlsReady,
  onZoomChange,
  onOpenHistory,
  onOpenComments,
  onCommentsChange,
  onCommentActionsReady,
}: {
  whiteboardId: string
  userId: string
  initialNodes: Array<TableNodeType>
  initialEdges: Array<RelationshipEdgeType>
  showMinimap: boolean
  showControls: boolean
  nodesDraggable: boolean
  viewerRole?: EffectiveRole | null
  isPublic?: boolean
  /** R1 (GH #109): when false, no Socket.IO connection is opened. */
  collaborationEnabled?: boolean
  onCreateTable?: (data: CreateTable) => void | Promise<unknown>
  onCreateRelationship?: (data: CreateRelationship) => void | Promise<unknown>
  onImportSql?: (ast: DiagramAST) => void | Promise<void>
  onDisplayModeReady?: (
    showMode: ShowMode,
    setShowMode: (mode: ShowMode) => void,
  ) => void
  onZoomControlsReady?: (controls: ZoomControls) => void
  onZoomChange?: (zoom: number) => void
  onOpenHistory?: () => void
  onOpenComments?: () => void
  onCommentsChange?: (comments: Array<CommentWithAuthor>) => void
  onCommentActionsReady?: (actions: CommentActions) => void
}) {
  const queryClient = useQueryClient()

  // Requesting user's effective write permission — gates the toolbar's Add
  // Table/Relationship buttons and (via WhiteboardPermissionsProvider below)
  // node-level write affordances like Add Column.
  const canEdit = hasMinimumRole(viewerRole, 'EDITOR')

  // Fetch MCP endpoint URL once — env var does not change at runtime.
  // Disabled on the public read-only share path (GH #109): getMcpEndpointUrl
  // is requireAuth-gated, so an anonymous /share/$token visitor would get a
  // 401 that the global QueryCache handler turns into a spurious
  // "session expired" modal over the diagram. The MCP endpoint UI is editor
  // chrome that isPublic already hides, so gating the fetch is safe.
  const { data: mcpEndpointUrl } = useQuery({
    queryKey: ['mcp-endpoint-url'],
    queryFn: () => getMcpEndpointUrl(),
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: !isPublic,
  })

  // Zen mode — hides the toolbar; a floating button restores the chrome
  const { isZenMode, toggleZenMode, exitZenMode } = useZenMode()

  // Column reorder mutations — must be initialized early since seedConfirmedOrderFromServer
  // is called from the initialNodes effect below
  const columnReorderMutations = useColumnReorderMutations()

  // Disable RF panOnDrag while a column is being dragged — prevents canvas
  // panning from stealing pointermove events and corrupting collision detection.
  const [isColumnDragging, setIsColumnDragging] = useState(false)

  // Wraps the single main <ReactFlowCanvas> render site — scopes the image
  // export's `.react-flow__viewport` DOM lookup so it can never match the
  // read-only sub-canvas TableFocusOverlay renders in its own nested
  // ReactFlowProvider (Issue #104).
  const canvasWrapperRef = useRef<HTMLDivElement>(null)

  // Local React Flow state (will be updated by collaboration)
  const [nodes, setNodes] = useState<Array<TableNodeType>>(initialNodes)
  const [edges, setEdges] = useState<Array<RelationshipEdgeType>>(initialEdges)

  // Node/edge accessors for DDL export (reads current React Flow state,
  // including relationships carried on edges — see use-table-export-ddl.ts)
  const { getNodes, getEdges } = useReactFlow<
    TableNodeType,
    RelationshipEdgeType
  >()

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

  // Keep a stable ref to nodes (parallel to edgesRef) so callbacks can read
  // pre-drag positions without a stale closure. Used by handleAreaDragStop's
  // rollback (GH #106 code-review BLOCKER) — this outer `nodes` state is only
  // ever touched by explicit setNodes calls (never by ReactFlowCanvas's own
  // live drag-preview state), so it still holds each member's pre-drag
  // position right up until the optimistic apply below.
  const nodesRef = useRef(nodes)
  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  // Session/auth context — triggerSessionExpired mirrors how
  // useAutoLayoutOrchestrator handles an isUnauthorizedError result from
  // updateTablePositionsBulk, and how handleAreaDragStop's moveArea ack
  // failure (SESSION_EXPIRED code) handles the atomic area move.
  const { triggerSessionExpired } = useAuthContext()

  // Pre-filtered edges (stale/deleted-column-safe, via filterValidEdges)
  // for the relations panel only — kept in a ref (parallel to edgesRef) so
  // the mount-only node-data injection effect can read a fresh value
  // without adding nodes/edges to its dependency array. `edges` itself stays
  // raw/unfiltered for delete-confirmation lookups (columnEdgeMap) — see
  // TableNodeData.relationsEdges doc comment.
  const validEdgesForPanelRef = useRef<Array<RelationshipEdgeType>>([])
  useEffect(() => {
    validEdgesForPanelRef.current = filterValidEdges(nodes, edges)
  }, [nodes, edges])

  // Table deletion state — which table has been requested for deletion (opens dialog)
  const [deletingTableId, setDeletingTableId] = useState<string | null>(null)

  // Focus overlay state — which table is currently being focused (opens overlay)
  const [focusedTableId, setFocusedTableId] = useState<string | null>(null)

  // Relations panel state — which table's attached relations panel is open
  const [relationsPreviewTableId, setRelationsPreviewTableId] = useState<
    string | null
  >(null)

  // Cmd/Ctrl+K search palette state, plus the focus request threaded down to
  // ReactFlowCanvas. The token increments on every navigation so the same
  // table can be re-selected (the canvas effect keys on the token).
  const [searchOpen, setSearchOpen] = useState(false)
  const [focusRequestTableId, setFocusRequestTableId] = useState<string | null>(
    null,
  )
  const [focusRequestToken, setFocusRequestToken] = useState(0)

  // Minimap focus state — the `m` shortcut enlarges the minimap for an easier
  // click/drag target. Ephemeral (no persistence, unlike zen mode).
  const [minimapExpanded, setMinimapExpanded] = useState(false)

  // Navigate the canvas to a table (from the search palette). Bump the token
  // first so re-selecting the currently-focused table still re-fires the jump.
  const handleNavigateToTable = useCallback((tableId: string) => {
    setFocusRequestTableId(tableId)
    setFocusRequestToken((token) => token + 1)
  }, [])

  // Cmd/Ctrl+K opens the search palette from anywhere on the whiteboard.
  // preventDefault suppresses the browser's own Ctrl+K (URL/search bar).
  // Skipped while typing in a form field so the key still works normally
  // inside inputs/editors (mirrors the `z` zen-mode guard).
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key.toLowerCase() !== 'k') return

      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) {
        return
      }

      event.preventDefault()
      setSearchOpen(true)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

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
              onTableNoteSave: handleTableNoteSaveRef.current,
              onFocusTable: (tableId: string) =>
                handleFocusTableRef.current(tableId),
              onExportDdl: (tableId: string, dialect: Dialect) =>
                handleExportDdlRef.current(tableId, dialect),
              onPreviewRelations: (tableId: string) =>
                handleTogglePreviewTableRef.current(tableId),
              edges: edgesRef.current,
              relationsEdges: validEdgesForPanelRef.current,
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
            onTableNoteSave: prev.data.onTableNoteSave,
            onFocusTable: prev.data.onFocusTable,
            onExportDdl: prev.data.onExportDdl,
            onPreviewRelations: prev.data.onPreviewRelations,
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

  // Ref for onTableUpdateError (table-comment W1 fix) — same circular-dependency
  // break as onTableErrorRef above, but for table:update rejections specifically.
  const onTableUpdateErrorRef = useRef<(data: any) => void>(() => {})

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

  // Callback for when a remote user updates a table's comment/note
  // (table-comment). The hook already filters out self-originated events
  // (updatedBy === userId); this applies the inbound description to the
  // matching table node's data so the popover reflects it when reopened.
  const onTableUpdated = useCallback(
    (data: { tableId: string; description?: string }) => {
      if (data.description === undefined) return
      setNodes((prev) =>
        prev.map((n) =>
          n.id === data.tableId
            ? {
                ...n,
                data: {
                  ...n.data,
                  table: { ...n.data.table, description: data.description! },
                },
              }
            : n,
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
    emitTableUpdate,
    emitRelationshipDelete,
    emitRelationshipUpdate,
    on: onCollabEvent,
    off: offCollabEvent,
    emit: emitCollabEvent,
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
    // R1 (GH #109): public read-only path opens no Socket.IO connection.
    collaborationEnabled,
    onTableUpdated,
    useCallback((data: any) => {
      onTableUpdateErrorRef.current(data)
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

  // Ref for refitAreasContainingTable (area-fit-member-content) — the same
  // forward-reference pattern as the refs above: handleColumnCreate/
  // handleColumnDelete are declared before refitAreasContainingTable (which
  // depends on refitArea/reactFlowInstance, declared later), so they call
  // through this ref instead of referencing the not-yet-declared function
  // directly (which would violate the temporal dead zone in useCallback's
  // deps array).
  const refitAreasContainingTableRef = useRef<
    (tableId: string, columnCountOverride?: number) => void
  >(() => {})

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
  } = useColumnCollaboration(
    whiteboardId,
    userId,
    columnMutationsCallbacks,
    // R1 (GH #109): public read-only path opens no Socket.IO connection.
    collaborationEnabled,
  )

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

  // Table mutations hook (optimistic delete + rollback; table-comment W1:
  // optimistic update + rollback for table:update saves)
  const tableMutations = useTableMutations(
    setNodes,
    setEdges,
    emitTableDelete,
    isConnected,
    emitTableUpdate,
  )

  // Wire onTableError ref now that tableMutations is available
  useEffect(() => {
    onTableErrorRef.current = tableMutations.onTableError
  }, [tableMutations.onTableError])

  // Wire onTableUpdateError ref now that tableMutations is available
  // (table-comment W1 fix)
  useEffect(() => {
    onTableUpdateErrorRef.current = tableMutations.onTableUpdateError
  }, [tableMutations.onTableUpdateError])

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
    // R1 (GH #109): public read-only path opens no Socket.IO connection.
    collaborationEnabled,
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

  // Keyboard shortcut for focus overlay (f key on selected node)
  useTableFocus(
    (tableId) => handleFocusTableRef.current(tableId),
    focusedTableId !== null,
  )

  // Keyboard shortcut for the relations panel (r key on selected node) —
  // suppressed while the Focus Overlay is open
  useTableRelationsPreview(
    (tableId) => handleTogglePreviewTableRef.current(tableId),
    focusedTableId !== null,
  )

  // Keyboard shortcut for DDL export (d key on selected node, default dialect: mssql)
  useTableExportDdl()

  // Keyboard shortcut for the minimap (m to expand/focus, Escape to collapse) —
  // suppressed while the Focus Overlay or search palette is open, and inert
  // when the minimap is hidden.
  useMinimapFocusShortcut({
    expanded: minimapExpanded,
    onToggle: () => setMinimapExpanded((v) => !v),
    onCollapse: () => setMinimapExpanded(false),
    suppressed: focusedTableId !== null || searchOpen,
    enabled: showMinimap,
  })

  // Collapse the enlarged minimap whenever it becomes hidden, so it can't
  // reappear already-expanded when shown again.
  useEffect(() => {
    if (!showMinimap && minimapExpanded) setMinimapExpanded(false)
  }, [showMinimap, minimapExpanded])

  // Column mutation callbacks (outgoing — triggered by user interactions in TableNode)
  const handleColumnCreate = useCallback(
    (tableId: string, data: CreateColumnPayload) => {
      try {
        columnMutations.createColumn(tableId, data)
        // area-fit-member-content: re-fit any area containing this table now
        // that its column count is about to grow by one. Compute the new
        // count from the pre-mutation node list (nodesRef.current) + 1 — the
        // optimistic setNodes inside createColumn hasn't committed/
        // re-rendered yet, so reading it back here would still see the OLD
        // count (see refitArea's columnCountOverrides comment).
        const table = nodesRef.current.find((n) => n.id === tableId)
        if (table) {
          refitAreasContainingTableRef.current(
            tableId,
            table.data.table.columns.length + 1,
          )
        }
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
      // area-fit-member-content: re-fit any area containing this table now
      // that its column count is about to shrink by one (see handleColumnCreate
      // above for why the count is computed from the pre-mutation node list
      // rather than read back after the optimistic setNodes).
      const table = nodesRef.current.find((n) => n.id === tableId)
      if (table) {
        refitAreasContainingTableRef.current(
          tableId,
          Math.max(0, table.data.table.columns.length - 1),
        )
      }
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

  // Callback to save a table's comment/note (table-comment). Routes through
  // tableMutations.updateTable (table-comment W1 fix) so a rejected save
  // (FORBIDDEN / NOT_FOUND / VALIDATION_ERROR) rolls back the optimistic
  // description and shows a toast — previously this bypassed rollback
  // entirely via a bespoke inline setNodes + raw emitTableUpdate call, and
  // the server error was silently dropped (onTableUpdateError wiring above).
  const handleTableNoteSave = useCallback(
    (tableId: string, description: string) => {
      tableMutations.updateTable(tableId, { description })
    },
    [tableMutations],
  )

  // Callback to open the Focus view overlay for a table
  const handleFocusTable = useCallback(
    (tableId: string) => setFocusedTableId(tableId),
    [],
  )

  // Callback to toggle a table's relations panel open/closed (pressing the
  // same table's shortcut/menu-item again closes it)
  const handleTogglePreviewTable = useCallback((tableId: string) => {
    setRelationsPreviewTableId((current) =>
      current === tableId ? null : tableId,
    )
  }, [])

  // Force-close an open relations panel when the Focus Overlay opens —
  // defensive cleanliness; the panel would otherwise just sit harmlessly
  // hidden behind the modal, but explicit closure avoids surprising
  // residual state when the dialog closes again.
  useEffect(() => {
    if (focusedTableId !== null) setRelationsPreviewTableId(null)
  }, [focusedTableId])

  // Callback to export a table's CREATE TABLE DDL (context-menu submenu)
  const handleExportDdl = useCallback(
    (tableId: string, dialect: Dialect) => {
      const tables = buildDiagramTablesFromFlow(getNodes(), getEdges())
      void exportTableDdl(tables, tableId, dialect)
    },
    [getNodes, getEdges],
  )

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
  const handleTableNoteSaveRef = useRef(handleTableNoteSave)
  const handleFocusTableRef = useRef(handleFocusTable)
  const handleTogglePreviewTableRef = useRef(handleTogglePreviewTable)
  const handleExportDdlRef = useRef(handleExportDdl)
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
    handleTableNoteSaveRef.current = handleTableNoteSave
  }, [handleTableNoteSave])
  useEffect(() => {
    handleFocusTableRef.current = handleFocusTable
  }, [handleFocusTable])
  useEffect(() => {
    handleTogglePreviewTableRef.current = handleTogglePreviewTable
  }, [handleTogglePreviewTable])
  useEffect(() => {
    handleExportDdlRef.current = handleExportDdl
  }, [handleExportDdl])
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
          onTableNoteSave: handleTableNoteSaveRef.current,
          onFocusTable: (tableId: string) =>
            handleFocusTableRef.current(tableId),
          onExportDdl: (tableId: string, dialect: Dialect) =>
            handleExportDdlRef.current(tableId, dialect),
          onPreviewRelations: (tableId: string) =>
            handleTogglePreviewTableRef.current(tableId),
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
          onTableNoteSave: handleTableNoteSaveRef.current,
          onFocusTable: (tableId: string) =>
            handleFocusTableRef.current(tableId),
          onExportDdl: (tableId: string, dialect: Dialect) =>
            handleExportDdlRef.current(tableId, dialect),
          onPreviewRelations: (tableId: string) =>
            handleTogglePreviewTableRef.current(tableId),
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
          relationsEdges: validEdgesForPanelRef.current,
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
      // Update cache without full refetch for better performance.
      // area-autolayout-persistence-fix: the query result is FLAT —
      // getWhiteboardWithDiagram returns `{ ...whiteboard, tables, viewerRole }`
      // (findWhiteboardByIdWithDiagram returns `{ ...whiteboard, tables }`) —
      // there is no nested `.whiteboard` wrapper. The previous `old?.whiteboard
      // ?.tables` guard here always failed (the property never existed), so
      // this patch was a silent no-op; fixed to match the real `old.tables`
      // shape (confirmed against src/data/whiteboard.ts and the `nodes` memo
      // below, which reads `whiteboardData?.tables` directly).
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

  // Shared cache patcher (area-autolayout-persistence-fix) — generalizes the
  // single-table `updatePositionMutation` cache updater above to N tables.
  // The ['whiteboard', whiteboardId] query result is the source of truth
  // that the `nodes` memo / `initialNodes` prop is built from; ReactFlowCanvas
  // re-syncs its internal node store from `initialNodes` whenever that prop's
  // reference changes (ReactFlowCanvas.tsx), so ANY path that moves table
  // nodes only via `setNodes`/React Flow's own drag state — without also
  // patching this cache — leaves a stale entry that a later, unrelated
  // `initialNodes` reference change (e.g. another mutation's cache patch)
  // will revert to. Used by Auto Layout (handleAfterAutoLayout) and the area
  // atomic-move path (handleAreaDragStop / the area:moved peer-receive
  // listener), both of which move member tables without going through
  // `updatePositionMutation`.
  //
  // Shape: the query result is FLAT (`{ ...whiteboard, tables, viewerRole }`
  // — see getWhiteboardWithDiagram/findWhiteboardByIdWithDiagram in
  // src/data/whiteboard.ts and the `nodes` memo below, which reads
  // `whiteboardData?.tables` directly). There is no nested `.whiteboard`
  // wrapper.
  const patchWhiteboardTablePositions = useCallback(
    (positions: Array<{ id: string; x: number; y: number }>) => {
      if (positions.length === 0) return
      const positionById = new Map(positions.map((p) => [p.id, p]))
      queryClient.setQueryData(['whiteboard', whiteboardId], (old: any) => {
        if (!old?.tables) return old
        return {
          ...old,
          tables: old.tables.map((t: any) => {
            const p = positionById.get(t.id)
            if (!p) return t
            return { ...t, positionX: p.x, positionY: p.y }
          }),
        }
      })
    },
    [queryClient, whiteboardId],
  )

  // d3-force layout hook (wraps the pure computeD3ForceLayout engine)
  const { runLayout: runD3ForceLayout } = useD3ForceLayout()

  // NOTE: the Auto Layout orchestrator is initialized further down (after
  // refitAllAreas is defined, GH #106 Bug 2 fix — Auto Layout excludes areas
  // and refits them afterward via onAfterLayout).

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
  const nodesInitialized = useNodesInitialized()

  // ── Subject areas (GH #106) ────────────────────────────────────────────────
  // Areas are background regions grouping tables. They live in a separate node
  // array from tables (ReactFlowCanvas merges them behind the tables).
  const {
    areas,
    createArea: createAreaMutation,
    updateArea: updateAreaMutation,
    deleteArea: deleteAreaMutation,
    moveArea,
    applyRemoteAreaMove,
  } = useWhiteboardAreas({
    whiteboardId,
    userId,
    enabled: collaborationEnabled,
    on: onCollabEvent,
    off: offCollabEvent,
    emit: emitCollabEvent,
  })

  // ── Canvas comments (GH #110) ──────────────────────────────────────────────
  // Threaded comments anchored to a table or a free canvas point. VIEWER+ may
  // participate — independent of `canEdit` (EDITOR+), which only gates the
  // diagram-mutating affordances above.
  const canComment = hasMinimumRole(viewerRole, 'VIEWER')
  const canModerateComments = hasMinimumRole(viewerRole, 'ADMIN')
  const {
    comments,
    createComment: createCommentMutation,
    addReply: addReplyMutation,
    editComment: editCommentMutation,
    deleteComment: deleteCommentMutation,
    resolveComment: resolveCommentMutation,
  } = useWhiteboardComments({
    whiteboardId,
    userId,
    enabled: collaborationEnabled,
    on: onCollabEvent,
    off: offCollabEvent,
    emit: emitCollabEvent,
  })

  // Expose the live comment list to the caller (route-level unread badge +
  // side panel) — see the CommentActions doc comment for why this is a
  // ready-callback rather than a second query.
  useEffect(() => {
    onCommentsChange?.(comments)
  }, [comments, onCommentsChange])

  const handleReplyComment = useCallback(
    (parentId: string, body: string) => addReplyMutation(parentId, body),
    [addReplyMutation],
  )
  const handleEditComment = useCallback(
    (commentId: string, body: string) => editCommentMutation(commentId, body),
    [editCommentMutation],
  )
  const handleDeleteComment = useCallback(
    (commentId: string) => deleteCommentMutation(commentId),
    [deleteCommentMutation],
  )
  const handleResolveComment = useCallback(
    (commentId: string, resolved: boolean) =>
      resolveCommentMutation(commentId, resolved),
    [resolveCommentMutation],
  )
  const handleCreateTableComment = useCallback(
    (tableId: string, body: string) =>
      createCommentMutation({
        targetType: 'table',
        targetTableId: tableId,
        body,
      }),
    [createCommentMutation],
  )

  // Group the flat comment list into per-anchor threads (root + replies).
  // Count of unresolved root threads — drives the Toolbar's Comments badge
  // (this component's own toolbar; the route-level header badge derives the
  // same count from onCommentsChange).
  const commentUnreadCount = useMemo(
    () => comments.filter((c) => c.parentId === null && !c.resolved).length,
    [comments],
  )

  const commentThreadsByTable = useMemo(() => {
    const roots = comments.filter(
      (c) => c.parentId === null && c.targetType === 'table',
    )
    const repliesByParent = new Map<string, Array<CommentWithAuthor>>()
    for (const c of comments) {
      if (c.parentId === null) continue
      if (!repliesByParent.has(c.parentId)) repliesByParent.set(c.parentId, [])
      repliesByParent.get(c.parentId)!.push(c)
    }
    const byTable = new Map<string, Array<CommentThreadVM>>()
    for (const root of roots) {
      if (!root.targetTableId) continue
      const thread: CommentThreadVM = {
        root,
        replies: repliesByParent.get(root.id) ?? [],
      }
      if (!byTable.has(root.targetTableId)) byTable.set(root.targetTableId, [])
      byTable.get(root.targetTableId)!.push(thread)
    }
    return byTable
  }, [comments])

  const pointThreads = useMemo<Array<CommentThreadVM>>(() => {
    const roots = comments.filter(
      (c) => c.parentId === null && c.targetType === 'point',
    )
    const repliesByParent = new Map<string, Array<CommentWithAuthor>>()
    for (const c of comments) {
      if (c.parentId === null) continue
      if (!repliesByParent.has(c.parentId)) repliesByParent.set(c.parentId, [])
      repliesByParent.get(c.parentId)!.push(c)
    }
    return roots.map((root) => ({
      root,
      replies: repliesByParent.get(root.id) ?? [],
    }))
  }, [comments])

  // Build the free-point comment pin nodes — merged into the canvas ON TOP
  // of tables via ReactFlowCanvas's `commentNodes` prop.
  const commentNodes = useMemo<Array<CommentNodeType>>(
    () =>
      pointThreads
        .filter((t) => t.root.positionX != null && t.root.positionY != null)
        .map((thread) => ({
          id: `comment:${thread.root.id}`,
          type: 'comment',
          position: { x: thread.root.positionX!, y: thread.root.positionY! },
          draggable: false,
          selectable: true,
          deletable: false,
          zIndex: 1500,
          data: {
            thread,
            canComment,
            currentUserId: userId,
            canModerateComments,
            onReply: handleReplyComment,
            onEdit: handleEditComment,
            onDelete: handleDeleteComment,
            onResolve: handleResolveComment,
          },
        })),
    [
      pointThreads,
      canComment,
      canModerateComments,
      userId,
      handleReplyComment,
      handleEditComment,
      handleDeleteComment,
      handleResolveComment,
    ],
  )

  // Pan/fit the live canvas to a comment's anchor — used by the side panel's
  // "jump to pin" action (exposed via onCommentActionsReady below).
  const handlePanToComment = useCallback(
    (comment: CommentWithAuthor) => {
      if (comment.targetType === 'table' && comment.targetTableId) {
        void reactFlowInstance.fitView({
          nodes: [{ id: comment.targetTableId }],
          duration: 300,
          maxZoom: 1.2,
        })
        return
      }
      if (
        comment.targetType === 'point' &&
        comment.positionX != null &&
        comment.positionY != null
      ) {
        reactFlowInstance.setCenter(comment.positionX, comment.positionY, {
          zoom: 1,
          duration: 300,
        })
      }
    },
    [reactFlowInstance],
  )

  // Expose the live comment mutation entry points once — mirrors
  // onZoomControlsReady/onDisplayModeReady (see CommentActions doc comment).
  useEffect(() => {
    onCommentActionsReady?.({
      createComment: createCommentMutation,
      addReply: addReplyMutation,
      editComment: editCommentMutation,
      deleteComment: deleteCommentMutation,
      resolveComment: resolveCommentMutation,
      panToComment: handlePanToComment,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ready-callback fires once per identity change, mirrors onZoomControlsReady
  }, [
    onCommentActionsReady,
    createCommentMutation,
    addReplyMutation,
    editCommentMutation,
    deleteCommentMutation,
    resolveCommentMutation,
    handlePanToComment,
  ])

  // Free-point comment placement tool (GH #110) — toggled from the floating
  // toolbar button; while active, the next pane click captures a flow
  // position and opens the "new comment" dialog (shadcn Dialog, not a native
  // prompt — keeps the UI shadcn-only while still supporting click-to-place,
  // since the comment body cannot be empty per createCommentSchema).
  const [commentToolActive, setCommentToolActive] = useState(false)
  const [pendingCommentPosition, setPendingCommentPosition] = useState<{
    x: number
    y: number
  } | null>(null)
  const [pendingCommentBody, setPendingCommentBody] = useState('')

  const handleAreaResize = useCallback(
    (
      areaId: string,
      bounds: {
        positionX: number
        positionY: number
        width: number
        height: number
      },
    ) => updateAreaMutation(areaId, bounds),
    [updateAreaMutation],
  )
  const handleAreaRename = useCallback(
    (areaId: string, name: string) => updateAreaMutation(areaId, { name }),
    [updateAreaMutation],
  )
  const handleAreaRecolor = useCallback(
    (areaId: string, color: string) =>
      updateAreaMutation(areaId, { color: color }),
    [updateAreaMutation],
  )
  // Build React Flow area nodes from the areas list.
  const areaNodes = useMemo<Array<AreaNodeType>>(
    () =>
      areas.map((area) => ({
        id: area.id,
        type: 'area',
        position: { x: area.positionX, y: area.positionY },
        width: area.width,
        height: area.height,
        draggable: canEdit,
        selectable: canEdit,
        // GH #106 Bug 1 fix: area deletion routes through Delete/Backspace ->
        // onNodesDelete in ReactFlowCanvas, which requires the node to be
        // marked deletable. Table nodes are the opposite (deletable: false)
        // so their removal always goes through the confirmation dialog.
        deletable: canEdit,
        // Render behind table nodes (which default to zIndex >= 1).
        zIndex: 0,
        data: {
          area,
          canEdit,
          onRename: handleAreaRename,
          onRecolor: handleAreaRecolor,
          onResize: handleAreaResize,
          onDelete: deleteAreaMutation,
        },
      })),
    [
      areas,
      canEdit,
      handleAreaRename,
      handleAreaRecolor,
      handleAreaResize,
      deleteAreaMutation,
    ],
  )

  // ── Area membership (GH #106) ──────────────────────────────────────────────
  // Lightweight projection of areas for the table "Add to area" submenu.
  const areaMenuList = useMemo(
    () =>
      areas.map((a) => ({
        id: a.id,
        name: a.name,
        memberTableIds: a.memberTableIds,
      })),
    [areas],
  )
  // Latest areas in a ref so the toggle handlers stay stable (they don't need
  // to re-create — and re-run the inject effect — on every membership change).
  const areasRef = useRef(areas)
  useEffect(() => {
    areasRef.current = areas
  }, [areas])

  // Auto-fit an area's bounds around its current members (GH #106 Bug 2 fix).
  // Reads live member geometry from the React Flow instance (measured
  // width/height), computes the new bounding box, and persists only when the
  // bounds actually changed — this is the feedback-loop guard: refitArea is
  // never wired as a reaction to `area:updated` (useWhiteboardAreas already
  // ignores echoes of the current user's own updates via `updatedBy`), it is
  // only invoked from explicit triggers (member drag-stop, membership
  // add/remove, post auto-layout).
  // `memberTableIdsOverride` lets membership-change callers (add/remove to
  // area) pass the just-computed member list directly, instead of reading
  // `areasRef` — which still holds the pre-update value until the next
  // render's effect runs (setAreas → areasRef sync is one tick behind).
  //
  // `positionOverrides` (area-autolayout-persistence-fix) lets Auto Layout
  // pass the just-applied positions directly, instead of reading
  // `reactFlowInstance.getNodes()` — which is stale for one tick right after
  // `onAfterLayout` fires (the RF store update from the layout hasn't been
  // committed/re-rendered yet), so refit was fitting the area to the
  // members' OLD positions. Size (measured width/height) still comes from
  // `getNodes()` — only the position is overridden.
  //
  // `columnCountOverrides` (area-fit-member-content) is the same fix for the
  // same class of bug, applied to column COUNT instead of position: a local
  // column create/delete applies its optimistic `setNodes` update, but that
  // update hasn't committed/re-rendered yet either, so `getNodes()` would
  // still report the member's OLD column count for one tick. Height is
  // ALWAYS computed from `columnCount` (via `computeAreaBounds` →
  // `calculateTableHeight`), never from measured/display-mode-dependent
  // height, so every refit path (membership, drag, auto-layout, and the new
  // column-count trigger) is full-content and client-independent.
  const refitArea = useCallback(
    (
      areaId: string,
      memberTableIdsOverride?: Array<string>,
      positionOverrides?: Map<string, { x: number; y: number }>,
      columnCountOverrides?: Map<string, number>,
    ) => {
      const area = areasRef.current.find((a) => a.id === areaId)
      if (!area) return
      const memberTableIds = memberTableIdsOverride ?? area.memberTableIds
      if (memberTableIds.length === 0) return

      const rfNodes = reactFlowInstance.getNodes()
      const memberNodes = memberTableIds
        .map((id) => {
          const node = rfNodes.find((n) => n.id === id) as
            | TableNodeType
            | undefined
          if (!node) return undefined
          const positionOverride = positionOverrides?.get(id)
          const position = positionOverride
            ? { x: positionOverride.x, y: positionOverride.y }
            : node.position
          const columnCount =
            columnCountOverrides?.get(id) ?? node.data.table.columns.length
          return { ...node, position, columnCount }
        })
        .filter((n): n is NonNullable<typeof n> => n !== undefined)
      if (memberNodes.length === 0) return

      const bounds = computeAreaBounds(memberNodes)
      if (!bounds) return

      const unchanged =
        Math.abs(bounds.positionX - area.positionX) < 0.5 &&
        Math.abs(bounds.positionY - area.positionY) < 0.5 &&
        Math.abs(bounds.width - area.width) < 0.5 &&
        Math.abs(bounds.height - area.height) < 0.5
      if (unchanged) return

      updateAreaMutation(areaId, bounds)
    },
    [reactFlowInstance, updateAreaMutation],
  )

  // Re-fit every area containing `tableId` — used after a LOCAL column
  // create/delete (area-fit-member-content). `columnCountOverride`, when
  // given, is the just-applied column count for `tableId` (computed by the
  // caller from the pre-mutation node list + 1/-1) so the refit doesn't read
  // the one-tick-stale `getNodes()` count (see `refitArea`'s
  // `columnCountOverrides` comment above). Deliberately NOT wired to remote
  // column events (`onColumnCreated`/`onColumnDeleted`) or the display-mode
  // toggle — peers grow their area via the existing `area:updated`
  // broadcast, and full-content bounds are deterministic from shared column
  // data, so a remote-triggered refit here would only produce a redundant
  // `area:update` emit.
  const refitAreasContainingTable = useCallback(
    (tableId: string, columnCountOverride?: number) => {
      const columnCountOverrides =
        columnCountOverride !== undefined
          ? new Map([[tableId, columnCountOverride]])
          : undefined
      areasRef.current
        .filter((area) => area.memberTableIds.includes(tableId))
        .forEach((area) =>
          refitArea(area.id, undefined, undefined, columnCountOverrides),
        )
    },
    [refitArea],
  )

  // Wire refitAreasContainingTable ref now that it's available (see the ref's
  // declaration comment above for why this indirection is needed).
  useEffect(() => {
    refitAreasContainingTableRef.current = refitAreasContainingTable
  }, [refitAreasContainingTable])

  // Re-fit every area with ≥1 member — called after Auto Layout re-lays-out
  // the tables (areas themselves are excluded from that layout, see
  // useAutoLayoutOrchestrator's onAfterLayout wiring below).
  //
  // `positions` (area-autolayout-persistence-fix), when provided, are the
  // just-applied Auto Layout positions — forwarded to `refitArea` as
  // position overrides so refit computes bounds from the fresh layout
  // instead of the one-tick-stale `reactFlowInstance.getNodes()`.
  const refitAllAreas = useCallback(
    (positions?: Array<{ id: string; x: number; y: number }>) => {
      const positionOverrides = positions
        ? new Map(positions.map((p) => [p.id, { x: p.x, y: p.y }]))
        : undefined
      areasRef.current.forEach((area) =>
        refitArea(area.id, undefined, positionOverrides),
      )
    },
    [refitArea],
  )

  // Area drag → moves members (movable-container grouping, GH #106 Bug 2 fix,
  // made atomic by area-atomic-move). ReactFlowCanvas already translated the
  // member table nodes live during the drag and computed their final
  // positions; here we persist both the area's own position and the
  // members' new positions in ONE server transaction via moveArea (area:move
  // socket event), which also rebroadcasts a single area:moved event to
  // peers — replacing the old 3-call path (area:update + HTTP
  // updateTablePositionsBulk + table:move:bulk) that let peers briefly see
  // the area jump ahead of its members. The area's own position is broadcast
  // ONLY via area:moved now — area:update must NOT also fire for this drag,
  // or peers get a duplicate jump.
  // The dragged area's own bounds are unchanged (every member moved by the
  // same delta), but a member table can belong to OTHER areas too (no
  // cross-area exclusivity — see memberTableIds in schema.ts), so every
  // OTHER area containing any moved member is still re-fit below via
  // area:update (bounds-only — not a detachment case, since that area itself
  // didn't move as a container).
  const handleAreaDragStop = useCallback(
    (
      areaId: string,
      positionX: number,
      positionY: number,
      movedMembers: Array<{ id: string; positionX: number; positionY: number }>,
    ) => {
      // Snapshot pre-drag positions (area + members) BEFORE any optimistic
      // apply, so an ack-failure rollback below can restore exactly what the
      // DB still has for BOTH the area and its members (GH #106 code-review
      // BLOCKER precedent: a persist failure must never leave local state
      // silently out of sync with the DB).
      const previousArea = areasRef.current.find((a) => a.id === areaId)
      const previousAreaPosition = previousArea
        ? {
            positionX: previousArea.positionX,
            positionY: previousArea.positionY,
          }
        : null
      const previousMemberPositions = movedMembers
        .map((m) => nodesRef.current.find((n) => n.id === m.id))
        .filter((n): n is NonNullable<typeof n> => n !== undefined)
        .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }))

      // Optimistic local apply — the area's own React Flow node already
      // reflects the drag visually (RF drags its own node state live); this
      // keeps the `areas` state (used to rebuild areaNodes) in sync too.
      // No emit here — moveArea below is the ONLY emit for this drag.
      applyRemoteAreaMove(areaId, { positionX, positionY })

      if (movedMembers.length > 0) {
        // Optimistic local apply — the members already moved visually inside
        // ReactFlowCanvas's own node state during the drag; this keeps the
        // outer node list (used by DDL export, search, etc.) in sync too.
        setNodes((prev) =>
          applyBulkPositions(
            prev,
            movedMembers.map((m) => ({
              id: m.id,
              x: m.positionX,
              y: m.positionY,
            })),
          ),
        )
        // area-autolayout-persistence-fix: also patch the query cache (the
        // source of truth `initialNodes` is rebuilt from) so the canvas's own
        // RF node store doesn't revert these members' positions the next
        // time `initialNodes` gets a new reference for an unrelated reason
        // (same latent bug Auto Layout had — this path moves members via
        // setNodes/native RF drag state only, never the cache, until now).
        patchWhiteboardTablePositions(
          movedMembers.map((m) => ({
            id: m.id,
            x: m.positionX,
            y: m.positionY,
          })),
        )
      }

      // GH #106 code-review WARNING: refit every OTHER area that contains ANY
      // moved member — fired immediately, matching handleNodeDragStop's
      // refit timing (not gated on persistence success below). The dragged
      // area itself is excluded: its position is owned by the atomic
      // moveArea call, not by a bounds refit.
      const movedMemberIds = new Set(movedMembers.map((m) => m.id))
      const areaIdsToRefit = new Set<string>()
      areasRef.current.forEach((area) => {
        if (
          area.id !== areaId &&
          area.memberTableIds.some((id) => movedMemberIds.has(id))
        ) {
          areaIdsToRefit.add(area.id)
        }
      })
      areaIdsToRefit.forEach((id) => refitArea(id))

      moveArea(
        areaId,
        { positionX, positionY },
        movedMembers.map((m) => ({
          tableId: m.id,
          positionX: m.positionX,
          positionY: m.positionY,
        })),
        (res) => {
          if (res.ok) return

          console.error('Failed to persist area move:', res.message)
          toast.error(
            res.code === 'SESSION_EXPIRED'
              ? 'Your session expired before the area move could be saved. Please sign in to retry.'
              : 'The area move could not be saved — your changes have been reverted.',
          )
          if (res.code === 'SESSION_EXPIRED') {
            triggerSessionExpired()
          }

          // Roll back BOTH the area and its members — the atomic move
          // failed as a whole (one transaction that never committed), so
          // local state must be restored to match the DB entirely.
          if (previousAreaPosition) {
            applyRemoteAreaMove(areaId, previousAreaPosition)
          }
          if (previousMemberPositions.length > 0) {
            setNodes((prev) =>
              applyBulkPositions(prev, previousMemberPositions),
            )
            // Roll the cache patch back too, or the members would appear
            // moved again the next time initialNodes re-syncs even though
            // the DB transaction never committed.
            patchWhiteboardTablePositions(previousMemberPositions)
          }
        },
      )
    },
    [
      applyRemoteAreaMove,
      moveArea,
      setNodes,
      refitArea,
      triggerSessionExpired,
      patchWhiteboardTablePositions,
    ],
  )

  // Peer receive for the atomic area move (area-atomic-move fix). Applies
  // the area's new position AND its members' new positions in ONE callback —
  // React 19 auto-batches both setState calls (applyRemoteAreaMove's setAreas
  // + setNodes) into a single render tick, so collaborators never see a
  // frame where the area has moved but its members lag (or vice versa).
  // Ignores the event when it originated from this same client (already
  // applied optimistically in handleAreaDragStop above).
  useEffect(() => {
    if (!collaborationEnabled) return

    const handleAreaMoved = (data: {
      areaId: string
      positionX: number
      positionY: number
      members: Array<{ tableId: string; positionX: number; positionY: number }>
      movedBy: string
    }) => {
      if (data.movedBy === userId) return

      applyRemoteAreaMove(data.areaId, {
        positionX: data.positionX,
        positionY: data.positionY,
      })
      if (data.members.length > 0) {
        const positions = data.members.map((m) => ({
          id: m.tableId,
          x: m.positionX,
          y: m.positionY,
        }))
        setNodes((prev) => applyBulkPositions(prev, positions))
        // area-autolayout-persistence-fix: keep the peer's cache consistent
        // too, mirroring the local-drag patch above.
        patchWhiteboardTablePositions(positions)
      }
    }

    onCollabEvent('area:moved', handleAreaMoved)
    return () => offCollabEvent('area:moved', handleAreaMoved)
  }, [
    collaborationEnabled,
    onCollabEvent,
    offCollabEvent,
    userId,
    applyRemoteAreaMove,
    setNodes,
    patchWhiteboardTablePositions,
  ])

  // Auto Layout onAfterLayout callback (area-autolayout-persistence-fix).
  // Auto Layout previously only wrote the applied positions to the React
  // Flow store (via setNodes inside the orchestrator) and never patched the
  // React Query cache — the source of truth `whiteboardData` → `nodes` memo
  // → `initialNodes` that ReactFlowCanvas re-syncs `setNodes` from on every
  // re-render (ReactFlowCanvas.tsx). That stale cache is why tables visibly
  // reverted to their pre-layout positions and areas detached from their
  // members after a re-render. This mirrors `updatePositionMutation`'s
  // onSuccess cache patch above, generalized to N tables, then refits areas
  // from the SAME fresh positions (not the one-tick-stale getNodes()).
  const handleAfterAutoLayout = useCallback(
    (positions: Array<{ id: string; x: number; y: number }>) => {
      patchWhiteboardTablePositions(positions)
      refitAllAreas(positions)
    },
    [patchWhiteboardTablePositions, refitAllAreas],
  )

  // Auto Layout orchestrator — owns the full flow:
  // button click → optional dialog → layout → optimistic setNodes → persist → broadcast → fitView
  // GH #106 Bug 2 fix: onAfterLayout re-fits every area once the (area-
  // excluded) table layout has applied + persisted.
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
    onAfterLayout: handleAfterAutoLayout,
  })

  const handleAddTableToArea = useCallback(
    (tableId: string, areaId: string) => {
      const area = areasRef.current.find((a) => a.id === areaId)
      if (!area || area.memberTableIds.includes(tableId)) return
      const nextMemberTableIds = [...area.memberTableIds, tableId]
      updateAreaMutation(areaId, { memberTableIds: nextMemberTableIds })
      refitArea(areaId, nextMemberTableIds)
    },
    [updateAreaMutation, refitArea],
  )
  const handleRemoveTableFromArea = useCallback(
    (tableId: string, areaId: string) => {
      const area = areasRef.current.find((a) => a.id === areaId)
      if (!area || !area.memberTableIds.includes(tableId)) return
      const nextMemberTableIds = area.memberTableIds.filter(
        (mid) => mid !== tableId,
      )
      updateAreaMutation(areaId, { memberTableIds: nextMemberTableIds })
      refitArea(areaId, nextMemberTableIds)
    },
    [updateAreaMutation, refitArea],
  )

  // Inject the current area list + membership handlers into every table node's
  // data so the "Add to area" submenu is always fresh. Runs after the main
  // node-data effect (declared earlier) both on area changes AND on initialNodes
  // changes (table create/refetch), so a rebuilt node set never loses this data.
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        data: {
          ...n.data,
          areas: areaMenuList,
          onAddToArea: handleAddTableToArea,
          onRemoveFromArea: handleRemoveTableFromArea,
        },
      })),
    )
  }, [
    areaMenuList,
    initialNodes,
    handleAddTableToArea,
    handleRemoveTableFromArea,
    setNodes,
  ])

  // Inject comment threads + handlers into every table node's data (GH #110)
  // — same "always fresh on data OR node-set change" rationale as the area
  // injection effect above.
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        data: {
          ...n.data,
          commentThreads:
            commentThreadsByTable.get(n.id) ?? EMPTY_COMMENT_THREADS,
          canComment,
          currentUserId: userId,
          canModerateComments,
          onCreateTableComment: handleCreateTableComment,
          onReplyComment: handleReplyComment,
          onEditComment: handleEditComment,
          onDeleteComment: handleDeleteComment,
          onResolveComment: handleResolveComment,
        },
      })),
    )
  }, [
    commentThreadsByTable,
    canComment,
    canModerateComments,
    userId,
    handleCreateTableComment,
    handleReplyComment,
    handleEditComment,
    handleDeleteComment,
    handleResolveComment,
    initialNodes,
    setNodes,
  ])

  // Create a new area at the current viewport center.
  const handleCreateArea = useCallback(() => {
    const width = 360
    const height = 240
    const center = reactFlowInstance.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    })
    createAreaMutation({
      name: 'New area',
      color: DEFAULT_AREA_COLOR,
      positionX: center.x - width / 2,
      positionY: center.y - height / 2,
      width,
      height,
    })
  }, [reactFlowInstance, createAreaMutation])

  // ── Client-side position resolution ────────────────────────────────────────
  // Tables created by the MCP server without an explicit position arrive with
  // positionPending=true and are placed at {-99999, -99999} (off-canvas) so
  // React Flow can still render and measure them via ResizeObserver.
  //
  // Once React Flow finishes measuring (nodesInitialized changes OR nodes
  // changes with pending nodes), this effect computes a non-overlapping layout
  // position for each pending node and emits table:move with isInit=true.
  //
  // The server applies a first-write-wins guard: if another client already
  // wrote a position, the server acks without writing again so both clients
  // converge on the same value.

  // Track which table IDs have already had their init position emitted so we
  // don't re-emit on every re-render. Cleared when the whiteboard ID changes.
  const resolvedPendingIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    // Clear the resolved set when the whiteboard changes.
    resolvedPendingIdsRef.current = new Set()
  }, [whiteboardId])

  useEffect(() => {
    // Find all locally pending nodes.
    const pendingNodes = nodes.filter((n) => n.data.positionPending)
    if (pendingNodes.length === 0) return

    // Get the live RF node list (which carries measured dimensions).
    const rfNodes = reactFlowInstance.getNodes()
    const rfNodeMap = new Map(rfNodes.map((n) => [n.id, n] as const))

    // Only proceed when every pending node has been measured.
    const measuredPending = pendingNodes
      .map((pn) => rfNodeMap.get(pn.id))
      .filter((n): n is NonNullable<typeof n> => n?.measured !== undefined)

    if (measuredPending.length !== pendingNodes.length) return

    // Exclude nodes whose position was already emitted this session.
    const unresolved = measuredPending.filter(
      (n) => !resolvedPendingIdsRef.current.has(n.id),
    )
    if (unresolved.length === 0) return

    const rfAllNodes = rfNodes
    const placements = resolvePendingPositions(
      unresolved as any,
      rfAllNodes as any,
    )
    if (placements.length === 0) return

    // Apply positions locally so the nodes appear on-canvas immediately.
    setNodes((prev) =>
      prev.map((n) => {
        const p = placements.find((pl) => pl.id === n.id)
        if (!p) return n
        return {
          ...n,
          position: { x: p.x, y: p.y },
          data: { ...n.data, positionPending: false },
        }
      }),
    )

    // Persist to server with first-write-wins guard.
    placements.forEach(({ id, x, y }) => {
      resolvedPendingIdsRef.current.add(id)
      emitPositionUpdate(id, x, y, true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, nodesInitialized, emitPositionUpdate])

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

  // Handle node drag stop - update position in database and emit to other
  // users. GH #111: React Flow forwards the full co-dragged selection as the
  // 3rd arg (draggedNodes) when multiple nodes were dragged together —
  // previously dropped here, so a multi-select drag only ever persisted the
  // leader node and left every other dragged table's new position
  // unsaved/unbroadcast. Dedupe [leader, ...draggedNodes] and branch on
  // count: single drag keeps the exact pre-#111 path (FR-4); multi drag
  // persists via the bulk server fn with optimistic apply + rollback on
  // failure (FR-1, FR-3, FR-5), matching handleAreaDragStop's precedent.
  const handleNodeDragStop = useCallback(
    (
      _event: React.MouseEvent,
      node: TableNodeType,
      draggedNodes?: Array<TableNodeType>,
    ) => {
      // Dedupe [leader, ...co-dragged]; keep ONLY table nodes (an area
      // co-selected with tables would arrive here as a non-'table' node —
      // its id is not a DiagramTable, so the bulk IDOR guard would reject
      // the whole batch).
      const byId = new Map<string, TableNodeType>()
      for (const n of [node, ...(draggedNodes ?? [])]) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- TS narrows n to TableNodeType from the declared OnNodeDrag<TableNodeType> prop type, but React Flow's actual multi-select drag can include a co-selected area node at runtime cast to that type; this check is a real runtime guard, not a tautology.
        if (n.type === 'table') byId.set(n.id, n)
      }
      const dragged = Array.from(byId.values())

      if (dragged.length <= 1) {
        const only = dragged[0] ?? node
        const { x, y } = only.position

        // Update database
        updatePositionMutation.mutate({
          id: only.id,
          positionX: x,
          positionY: y,
        })

        // Emit to other users via WebSocket
        emitPositionUpdate(only.id, x, y)
      } else {
        // Multi-drag: pre-drag snapshot for rollback — nodesRef.current
        // still holds the OLD positions during a native RF drag (only
        // explicit setNodes touches it), exactly the source
        // handleAreaDragStop uses for its own rollback snapshot.
        const previousPositions = dragged
          .map((d) => nodesRef.current.find((n) => n.id === d.id))
          .filter((n): n is NonNullable<typeof n> => n !== undefined)
          .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }))

        const newPositions = dragged.map((d) => ({
          id: d.id,
          x: d.position.x,
          y: d.position.y,
        }))

        // Optimistic: keep the OUTER node list + query cache in sync (RF's
        // own store already shows the move). Mirrors handleAreaDragStop
        // above.
        setNodes((prev) => applyBulkPositions(prev, newPositions))
        patchWhiteboardTablePositions(newPositions)

        // Broadcast to peers immediately (same optimistic semantics as
        // single drag).
        emitBulkPositionUpdate(
          dragged.map((d) => ({
            tableId: d.id,
            positionX: d.position.x,
            positionY: d.position.y,
          })),
        )

        // Persist; revert local + cache on failure (FR-5).
        void (async () => {
          try {
            const result = await updateTablePositionsBulk({
              data: {
                whiteboardId,
                positions: dragged.map((d) => ({
                  id: d.id,
                  positionX: d.position.x,
                  positionY: d.position.y,
                })),
              },
            })
            if (isUnauthorizedError(result)) {
              triggerSessionExpired()
              throw new Error('unauthorized')
            }
          } catch (err) {
            console.error('Failed to persist multi-drag positions:', err)
            toast.error(
              'The move could not be saved — your changes have been reverted.',
            )
            if (previousPositions.length > 0) {
              setNodes((prev) => applyBulkPositions(prev, previousPositions))
              patchWhiteboardTablePositions(previousPositions)
            }
          }
        })()
      }

      // GH #106 item 3 / GH #111: reconcile area membership from EVERY
      // dragged table's dropped center point (drag-in join / drag-out
      // leave), then re-fit any area whose membership changed or whose
      // bounds need to grow/shrink around it. Computed from one
      // `areasRef.current` snapshot via the pure `reconcileAreaMembership`
      // (area-bounds.ts, Hermes coverage-gap fix) — the returned sets are
      // mutually exclusive per table (join ⇒ not previously a member; leave
      // ⇒ center outside; refit ⇒ member & inside).
      //
      // Joins/leaves are aggregated PER AREA across the whole dragged batch
      // (rather than calling handleAddTableToArea/handleRemoveTableFromArea
      // once per table) and applied as a single membership write per area.
      // Multiple dragged tables can affect the SAME area in one batch — a
      // scenario that could never happen before GH #111, since previously
      // only the drag leader was ever reconciled — and
      // handleAddTableToArea/handleRemoveTableFromArea each independently
      // read+write `areasRef.current.memberTableIds`, which does not update
      // mid-batch (it's synced by a `useEffect` after commit); calling both
      // sequentially for the same area would have the second call compute
      // its `nextMemberTableIds` from the same stale pre-batch snapshot as
      // the first, silently discarding the first table's join/leave.
      // Aggregating first and writing once per area avoids that race.
      const joinsByArea = new Map<string, Set<string>>()
      const leavesByArea = new Map<string, Set<string>>()
      const boundsOnlyRefit = new Set<string>()
      for (const d of dragged) {
        const rfNode = reactFlowInstance.getNode(d.id)
        const w = rfNode?.measured?.width ?? LAYOUT_CONSTRAINTS.DEFAULT_NODE_WIDTH
        const h =
          rfNode?.measured?.height ??
          calculateTableHeight(d.data.table.columns.length)
        const center = { x: d.position.x + w / 2, y: d.position.y + h / 2 }

        const { join, leave, refit } = reconcileAreaMembership(
          areasRef.current,
          d.id,
          center,
        )

        if (join) {
          if (!joinsByArea.has(join)) joinsByArea.set(join, new Set())
          joinsByArea.get(join)?.add(d.id)
        }
        leave.forEach((areaId) => {
          if (!leavesByArea.has(areaId)) leavesByArea.set(areaId, new Set())
          leavesByArea.get(areaId)?.add(d.id)
        })
        refit.forEach((areaId) => boundsOnlyRefit.add(areaId))
      }

      const membershipChangedAreaIds = new Set([
        ...joinsByArea.keys(),
        ...leavesByArea.keys(),
      ])
      membershipChangedAreaIds.forEach((areaId) => {
        const area = areasRef.current.find((a) => a.id === areaId)
        if (!area) return
        const joining = joinsByArea.get(areaId)
        const leaving = leavesByArea.get(areaId)
        const nextMemberTableIds = [
          ...area.memberTableIds.filter((id) => !leaving?.has(id)),
          ...(joining
            ? Array.from(joining).filter(
                (id) => !area.memberTableIds.includes(id),
              )
            : []),
        ]
        updateAreaMutation(areaId, { memberTableIds: nextMemberTableIds })
        refitArea(areaId, nextMemberTableIds)
      })
      // `boundsOnlyRefit` dedupes so an area containing multiple dragged
      // tables (with unchanged membership) is only refit once (NFR-1); skip
      // any area already handled above via a membership-driven refit.
      boundsOnlyRefit.forEach((areaId) => {
        if (!membershipChangedAreaIds.has(areaId)) refitArea(areaId)
      })
    },
    [
      updatePositionMutation,
      emitPositionUpdate,
      refitArea,
      reactFlowInstance,
      updateAreaMutation,
      whiteboardId,
      emitBulkPositionUpdate,
      patchWhiteboardTablePositions,
      setNodes,
      triggerSessionExpired,
    ],
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

  // Export diagram as image (Issue #104) — captures the full diagram at its
  // natural bounds via html-to-image, independent of the current pan/zoom.
  // Scoped to canvasWrapperRef (not a bare document.querySelector) so the
  // read-only sub-canvas rendered by TableFocusOverlay (its own nested
  // ReactFlowProvider/.react-flow__viewport) can never be captured instead.
  const handleExport = useCallback(
    async ({ format, background }: ExportImageDialogOptions) => {
      const viewportEl = canvasWrapperRef.current?.querySelector<HTMLElement>(
        '.react-flow__viewport',
      )
      if (!viewportEl) {
        throw new Error('Export target not found — canvas is not rendered')
      }

      // Read the theme background color from the live `.react-flow` element
      // rather than hardcoding a hex value — always matches the current
      // light/dark theme exactly (see src/styles/react-flow-theme.css).
      const flowEl =
        canvasWrapperRef.current?.querySelector<HTMLElement>('.react-flow')
      const themeBg = flowEl
        ? getComputedStyle(flowEl).backgroundColor
        : '#ffffff'

      // Whiteboard name lives in the outer ReactFlowWhiteboard component's
      // query cache (['whiteboard', whiteboardId]) — read it directly from
      // the shared queryClient rather than threading it down as a prop.
      const cachedWhiteboard = queryClient.getQueryData([
        'whiteboard',
        whiteboardId,
      ])
      const whiteboardName =
        cachedWhiteboard && !isUnauthorizedError(cachedWhiteboard)
          ? (cachedWhiteboard as { name?: string }).name
          : undefined

      await exportDiagramImage({
        nodes: getNodes(),
        viewportEl,
        format,
        background,
        themeBg,
        filename: whiteboardName,
      })
    },
    [queryClient, whiteboardId, getNodes],
  )

  return (
    <WhiteboardPermissionsProvider value={{ canEdit }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
        }}
      >
        {/* Toolbar — owned by ReactFlowWhiteboardInner so auto-layout orchestrator can control it.
          Hidden in zen mode, and entirely on the public read-only path (GH #109). */}
        {!isZenMode && !isPublic && (
          <Toolbar
            whiteboardId={whiteboardId}
            tables={toolbarTables as any}
            onCreateTable={onCreateTable}
            onCreateRelationship={onCreateRelationship}
            onImportSql={onImportSql}
            tableCount={nodes.length}
            onAutoLayoutClick={() => handleAutoLayoutClick(nodes.length)}
            isAutoLayoutRunning={isAutoLayoutRunning}
            zoomControls={toolbarZoomControls}
            currentZoom={viewport.zoom}
            showMode={showMode}
            onShowModeChange={setShowMode}
            onZenModeToggle={toggleZenMode}
            onOpenSearch={() => setSearchOpen(true)}
            onOpenHistory={onOpenHistory}
            onOpenComments={onOpenComments}
            commentUnreadCount={commentUnreadCount}
            mcpEndpointUrl={mcpEndpointUrl ?? undefined}
            onExport={handleExport}
            canExport={nodes.length > 0}
            viewerRole={viewerRole}
          />
        )}

        {/* Cmd/Ctrl+K search palette — jump the canvas to a table or column */}
        <WhiteboardSearch
          open={searchOpen}
          onOpenChange={setSearchOpen}
          nodes={nodes}
          onNavigateToTable={handleNavigateToTable}
        />

        {/* Auto Layout confirmation dialog (shown when tableCount > 50) */}
        <AutoLayoutConfirmDialog
          open={showAutoLayoutDialog}
          tableCount={nodes.length}
          onConfirm={handleAutoLayoutConfirm}
          onCancel={handleAutoLayoutCancel}
        />

        <div ref={canvasWrapperRef} style={{ position: 'relative', flex: 1 }}>
          {isPublic ? (
            // Read-only shared-view indicator (GH #109) — replaces the
            // collaboration connection indicator, which is meaningless here
            // since no Socket.IO connection is ever opened on this path.
            <div className="absolute left-4 top-4 z-10 rounded-md border bg-background/90 px-3 py-1.5 text-sm font-medium text-muted-foreground shadow-sm backdrop-blur-sm">
              Read-only &middot; Shared view
            </div>
          ) : (
            <ConnectionStatusIndicator connectionState={connectionState} />
          )}

          {/* Floating exit button — the only chrome shown in zen mode */}
          {isZenMode && (
            <Button
              variant="outline"
              size="sm"
              onClick={exitZenMode}
              title="Exit Zen Mode (z)"
              className="absolute bottom-4 right-4 z-10"
            >
              <Minimize2 className="mr-2 h-4 w-4" />
              Exit Zen
            </Button>
          )}
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
          {canEdit && !isPublic && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCreateArea}
              title="Add subject area"
              className="absolute left-4 top-4 z-10"
            >
              <SquareDashed className="mr-2 h-4 w-4" />
              Add area
            </Button>
          )}
          {canComment && !isPublic && (
            <Button
              variant={commentToolActive ? 'default' : 'outline'}
              size="sm"
              onClick={() => setCommentToolActive((prev) => !prev)}
              title={
                commentToolActive
                  ? 'Click the canvas to place a comment'
                  : 'Add a comment pin'
              }
              aria-pressed={commentToolActive}
              className="absolute left-4 top-14 z-10"
            >
              <MessageCircle className="mr-2 h-4 w-4" />
              {commentToolActive ? 'Click canvas...' : 'Add comment'}
            </Button>
          )}
          <ReactFlowCanvas
            initialNodes={nodes}
            initialEdges={edges}
            areaNodes={areaNodes}
            commentNodes={commentNodes}
            onAreaDragStop={handleAreaDragStop}
            onAreaDelete={deleteAreaMutation}
            onConnect={handleConnect}
            onNodeDragStop={handleNodeDragStop}
            nodesDraggable={nodesDraggable}
            panOnDrag={!isColumnDragging}
            showMinimap={showMinimap}
            minimapExpanded={minimapExpanded}
            onMinimapCollapse={() => setMinimapExpanded(false)}
            showControls={showControls}
            showBackground={true}
            fitViewOptions={{
              padding: 0.2,
              includeHiddenNodes: false,
            }}
            relationsPreviewTableId={relationsPreviewTableId}
            onPaneClick={(event) => {
              setRelationsPreviewTableId(null)
              if (!commentToolActive) return
              const pos = reactFlowInstance.screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
              })
              setPendingCommentPosition(pos)
              setCommentToolActive(false)
            }}
            focusRequestTableId={focusRequestTableId}
            focusRequestToken={focusRequestToken}
          />

          {/* New free-point comment dialog (GH #110) — opened after a
              placement click; body cannot be empty per createCommentSchema,
              so the pin is only created once the user confirms text here. */}
          <Dialog
            open={pendingCommentPosition !== null}
            onOpenChange={(open) => {
              if (!open) {
                setPendingCommentPosition(null)
                setPendingCommentBody('')
              }
            }}
          >
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>New comment</DialogTitle>
              </DialogHeader>
              <Textarea
                autoFocus
                value={pendingCommentBody}
                onChange={(e) =>
                  setPendingCommentBody(e.target.value.slice(0, 2000))
                }
                placeholder="Add a comment..."
                className="min-h-24"
              />
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setPendingCommentPosition(null)
                    setPendingCommentBody('')
                  }}
                >
                  Cancel
                </Button>
                <Button
                  disabled={pendingCommentBody.trim().length === 0}
                  onClick={() => {
                    if (!pendingCommentPosition) return
                    createCommentMutation({
                      targetType: 'point',
                      positionX: pendingCommentPosition.x,
                      positionY: pendingCommentPosition.y,
                      body: pendingCommentBody.trim(),
                    })
                    setPendingCommentPosition(null)
                    setPendingCommentBody('')
                  }}
                >
                  Comment
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Focus View Overlay — read-only sub-canvas for the selected table + 1-hop neighbors */}
          <TableFocusOverlay
            open={focusedTableId !== null}
            onOpenChange={(open) => {
              if (!open) setFocusedTableId(null)
            }}
            focusedTableId={focusedTableId}
            nodes={nodes}
            edges={edges}
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
    </WhiteboardPermissionsProvider>
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
  viewerRole = null,
  isPublic = false,
  data,
  onCreateTable,
  onCreateRelationship,
  onImportSql,
  onDisplayModeReady,
  onZoomControlsReady,
  onZoomChange,
  onOpenHistory,
  onOpenComments,
  onCommentsChange,
  onCommentActionsReady,
}: ReactFlowWhiteboardProps) {
  // Fetch whiteboard data with tables — disabled on the public read-only
  // path (GH #109): that path never has an authenticated session, and
  // getWhiteboardWithDiagram/getWhiteboardRelationships are both
  // requireAuth-gated, so calling them here would always fail. `data` is
  // supplied instead by the public /share/$token route from its own
  // unauthenticated server fn response.
  const {
    data: whiteboardData,
    isLoading: isLoadingWhiteboard,
    isError: isErrorWhiteboard,
    error: whiteboardError,
  } = useQuery({
    queryKey: ['whiteboard', whiteboardId],
    queryFn: async () => {
      return await getWhiteboardWithDiagram({ data: whiteboardId })
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    enabled: !isPublic,
  })

  // Fetch relationships — also disabled on the public path (see above).
  const { data: relationships, isLoading: isLoadingRelationships } = useQuery({
    queryKey: ['relationships', whiteboardId],
    queryFn: async () => {
      return await getWhiteboardRelationships({ data: whiteboardId })
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    enabled: !isPublic,
  })

  // Convert tables to React Flow nodes with showMode
  const nodes = useMemo(() => {
    if (isPublic) {
      const tables = data?.tables ?? []
      if (tables.length === 0) return []
      return convertTablesToNodes(tables, 'ALL_FIELDS')
    }
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
  }, [isPublic, data, whiteboardData])

  // Convert relationships to React Flow edges
  const edges = useMemo(() => {
    if (isPublic) {
      const rels = data?.relationships ?? []
      if (rels.length === 0) return []
      return convertRelationshipsToEdges(rels)
    }
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
  }, [isPublic, data, relationships])

  // Loading state (never true on the public path — both queries are
  // `enabled: false` there, so isLoading resolves to false immediately)
  if (isLoadingWhiteboard || isLoadingRelationships) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading diagram...</div>
      </div>
    )
  }

  // Error/missing state — getWhiteboardWithDiagram throws ForbiddenError on
  // RBAC denial (react-query never populates `data` for a rejected query),
  // but a rejected query can just as easily be a network error, a 500, or a
  // genuine not-found. Only render the access-denied state when the error is
  // actually a ForbiddenError — everything else falls back to a generic
  // failure message so it isn't mislabeled "you don't have access". Skipped
  // entirely on the public path, where `whiteboardData` is never populated
  // by design (the query is disabled) — `data` is checked there instead.
  if (!isPublic && !whiteboardData) {
    if (
      isErrorWhiteboard &&
      classifyQueryFailure({ error: whiteboardError }) === 'forbidden'
    ) {
      return <WhiteboardAccessDenied />
    }
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
        // R1/A4 (GH #109): the public read-only path is never draggable and
        // never opens a collaboration socket, regardless of the caller-
        // supplied nodesDraggable prop.
        nodesDraggable={isPublic ? false : nodesDraggable}
        viewerRole={viewerRole}
        isPublic={isPublic}
        collaborationEnabled={!isPublic}
        onCreateTable={onCreateTable}
        onCreateRelationship={onCreateRelationship}
        onImportSql={onImportSql}
        onDisplayModeReady={onDisplayModeReady}
        onZoomControlsReady={onZoomControlsReady}
        onZoomChange={onZoomChange}
        onOpenHistory={onOpenHistory}
        onOpenComments={onOpenComments}
        onCommentsChange={onCommentsChange}
        onCommentActionsReady={onCommentActionsReady}
      />
    </ReactFlowProvider>
  )
}
