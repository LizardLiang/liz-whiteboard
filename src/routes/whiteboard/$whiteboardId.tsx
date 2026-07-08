// src/routes/whiteboard/$whiteboardId.tsx
// Whiteboard editor route - loads and renders full ER diagram

import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type Konva from 'konva'
import type { CanvasViewport } from '@/components/whiteboard/Canvas'
import type { CreateRelationship, CreateTable } from '@/data/schema'
import type { DiagramAST } from '@/lib/parser/ast'
import type { ZoomControls } from '@/components/whiteboard/Toolbar'
import type { CommentActions } from '@/components/whiteboard/ReactFlowWhiteboard'
import type { CommentWithAuthor } from '@/data/models'
import type { ShowMode } from '@/lib/react-flow/types'
import { Canvas, useCanvasControls } from '@/components/whiteboard/Canvas'
import { TableNode } from '@/components/whiteboard/TableNode'
import { RelationshipEdge } from '@/components/whiteboard/RelationshipEdge'
import { ReactFlowWhiteboard } from '@/components/whiteboard/ReactFlowWhiteboard'
import { WhiteboardAccessDenied } from '@/components/whiteboard/WhiteboardAccessDenied'
import { Toolbar } from '@/components/whiteboard/Toolbar'
import { WhiteboardHistoryPanel } from '@/components/whiteboard/WhiteboardHistoryPanel'
import { WhiteboardCommentsPanel } from '@/components/whiteboard/WhiteboardCommentsPanel'
import { Minimap } from '@/components/whiteboard/Minimap'
import { useCollaboration } from '@/hooks/use-collaboration'
import { useSqlImport } from '@/hooks/use-sql-import'
import { useZenMode } from '@/hooks/use-zen-mode'
import { useAuthContext } from '@/components/auth/AuthContext'
import { getSessionUserId } from '@/lib/session-user-id'
import {
  createRelationshipFn,
  createTable as createTableFn,
  getWhiteboardRelationships,
  getWhiteboardWithDiagram,
  saveCanvasState,
  updateTablePosition as updateTablePositionFn,
} from '@/lib/server-functions'
import { entitiesToText } from '@/lib/parser/diagram-parser'
import {
  classifyQueryFailure,
  isThrownForbiddenError,
  isUnauthorizedError,
} from '@/lib/auth/errors'
import { hasMinimumRole } from '@/lib/auth/permissions'

/**
 * Whiteboard editor page component
 * Loads whiteboard with full diagram and enables real-time collaboration
 */
export const Route = createFileRoute('/whiteboard/$whiteboardId')({
  component: WhiteboardEditor,
})

/**
 * Feature flag: Toggle between Konva (legacy) and React Flow (new)
 */
const USE_REACT_FLOW = import.meta.env.VITE_USE_REACT_FLOW === 'true'

/**
 * Whiteboard Editor component
 */
function WhiteboardEditor() {
  const { whiteboardId } = Route.useParams()
  const queryClient = useQueryClient()

  // Use the authenticated user's DB ID so the server's `createdBy` field matches.
  // getSessionUserId() was a placeholder — it generated a random sessionStorage UUID
  // that never matched the server's auth user ID, causing column:created confirmations
  // to be treated as remote-user events and duplicating optimistic columns.
  const { user } = Route.useRouteContext()
  const userId = user?.id ?? getSessionUserId()
  const { triggerSessionExpired } = useAuthContext()

  // State
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<
    string | null
  >(null)
  const [canvasViewport, setCanvasViewport] = useState<CanvasViewport>({
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  })
  const [activeTab] = useState<'visual' | 'text'>('visual')
  // Version history panel (GH #107) — owned here (not inside Toolbar/
  // ReactFlowWhiteboard) because WhiteboardHistoryPanel's preview reuses
  // ReactFlowWhiteboard, and rendering the panel from within
  // ReactFlowWhiteboard/Toolbar would create a circular import.
  const [historyOpen, setHistoryOpen] = useState(false)
  // Canvas comments (GH #110) — panel + header badge state owned here for
  // the same circular-import reason as historyOpen above. `comments`/
  // `commentActions` are fed from ReactFlowWhiteboard's onCommentsChange/
  // onCommentActionsReady ready-callbacks (the live socket-connected hook
  // lives inside the canvas component, not here).
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [comments, setComments] = useState<Array<CommentWithAuthor>>([])
  const [commentActions, setCommentActions] = useState<CommentActions | null>(
    null,
  )
  const commentUnreadCount = comments.filter(
    (c) => c.parentId === null && !c.resolved,
  ).length
  const [textSource, setTextSource] = useState<string>('')
  const [isTextSyncEnabled] = useState(true)
  // React Flow display mode controls (set via callback)
  const [, setReactFlowShowMode] = useState<ShowMode>('ALL_FIELDS')
  const reactFlowShowModeRef = useRef<((mode: ShowMode) => void) | null>(null)

  // React Flow zoom controls (set via callback from ReactFlowWhiteboard)
  const [, setReactFlowZoomControls] = useState<ZoomControls | null>(null)
  const [, setReactFlowCurrentZoom] = useState<number>(1)

  // Canvas stage ref for programmatic zoom controls
  const stageRef = useRef<Konva.Stage>(null)

  // Zen mode — hides all UI chrome so only the canvas is visible
  const { isZenMode, toggleZenMode } = useZenMode()

  // Debounce timer for canvas state persistence
  const saveCanvasStateTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Fetch whiteboard data with TanStack Query
  // NOTE: Uses 'whiteboard-page' key to avoid collision with ReactFlowWhiteboard's
  // ['whiteboard', whiteboardId] query which returns a different shape (raw WhiteboardWithDiagram).
  const {
    data: whiteboardData,
    isLoading,
    isError,
    error: whiteboardPageError,
  } = useQuery({
    queryKey: ['whiteboard-page', whiteboardId],
    queryFn: async () => {
      // Fetch whiteboard with tables and relationships
      const whiteboard = await getWhiteboardWithDiagram({ data: whiteboardId })
      // Session expired between page load and this fetch — return the auth
      // error itself as the query's resolved data (rather than nesting it
      // inside { whiteboard, relationships }) so the QueryClient's global
      // onSuccess handler (root-provider.tsx) can detect it via
      // isUnauthorizedError() and surface the session-expired modal, exactly
      // like every other requireAuth-wrapped call in this app.
      if (isUnauthorizedError(whiteboard)) return whiteboard

      const relationships = await getWhiteboardRelationships({
        data: whiteboardId,
      })
      if (isUnauthorizedError(relationships)) return relationships

      return {
        whiteboard,
        relationships,
      }
    },
  })

  // SQL DDL import orchestration (Issue #105) — shared by both the Konva
  // Toolbar rendered directly below and, threaded through as a prop, the
  // Toolbar ReactFlowWhiteboard renders internally for the React Flow path.
  // Toolbar's onImportSql contract discards the resolved summary (void |
  // Promise<void>) — ImportSqlDialog only needs to know success/failure.
  const { importDiagram } = useSqlImport(whiteboardId)
  const handleImportSql = useCallback(
    async (ast: DiagramAST) => {
      await importDiagram(ast)
    },
    [importDiagram],
  )

  /**
   * Toggle zen mode with the `z` shortcut. Ignored when a modifier is held
   * (so Ctrl/Cmd+Z undo is never hijacked) and while typing in a form field
   * so the key still types normally inside dialogs and editors.
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'z') return
      if (event.ctrlKey || event.metaKey || event.altKey) return

      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) {
        return
      }

      event.preventDefault()
      toggleZenMode()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleZenMode])

  // Auth-error-narrowed view of the loaded whiteboard's canvasState, used
  // only as this effect's dependency/read so isUnauthorizedError narrowing
  // doesn't have to happen inside a dependency-array expression.
  const loadedCanvasState =
    whiteboardData && !isUnauthorizedError(whiteboardData)
      ? whiteboardData.whiteboard?.canvasState
      : undefined

  /**
   * Restore canvas state when whiteboard loads
   */
  useEffect(() => {
    if (loadedCanvasState) {
      const savedState = loadedCanvasState as {
        zoom: number
        offsetX: number
        offsetY: number
      }

      // Validate saved state
      if (
        typeof savedState.zoom === 'number' &&
        typeof savedState.offsetX === 'number' &&
        typeof savedState.offsetY === 'number'
      ) {
        setCanvasViewport({
          zoom: savedState.zoom,
          offsetX: savedState.offsetX,
          offsetY: savedState.offsetY,
        })
        console.log('Canvas state restored:', savedState)
      }
    }
  }, [loadedCanvasState])

  // WebSocket collaboration - MUST be called before any early returns
  const { emit, on, off, connectionState, isUnauthorized } = useCollaboration(
    whiteboardId,
    userId,
    triggerSessionExpired,
  )

  /**
   * Handle canvas viewport changes with debounced persistence
   * Saves to database after 1 second of inactivity
   */
  const handleCanvasViewportChange = useCallback(
    (viewport: CanvasViewport) => {
      setCanvasViewport(viewport)

      // Clear existing timer
      if (saveCanvasStateTimerRef.current) {
        clearTimeout(saveCanvasStateTimerRef.current)
      }

      // Debounce save for 1 second
      saveCanvasStateTimerRef.current = setTimeout(async () => {
        try {
          await saveCanvasState({
            data: {
              whiteboardId,
              canvasState: {
                zoom: viewport.zoom,
                offsetX: viewport.offsetX,
                offsetY: viewport.offsetY,
              },
            },
          })
          console.log('Canvas state saved:', viewport)
        } catch (error) {
          console.error('Failed to save canvas state:', error)
        }
      }, 1000)
    },
    [whiteboardId],
  )

  // Canvas zoom controls
  const canvasControls = useCanvasControls(stageRef, handleCanvasViewportChange)

  // Mutations
  const createTableMutation = useMutation({
    mutationFn: async (data: CreateTable) => {
      return await createTableFn({ data })
    },
    onMutate: async (newTable: CreateTable) => {
      // Optimistic update
      await queryClient.cancelQueries({
        queryKey: ['whiteboard', whiteboardId],
      })

      const previousData = queryClient.getQueryData([
        'whiteboard',
        whiteboardId,
      ])

      // Optimistically add table to cache
      queryClient.setQueryData(['whiteboard', whiteboardId], (old: any) => {
        if (!old) return old
        return {
          ...old,
          tables: [
            ...(old.tables ?? []),
            {
              id: 'temp-' + Date.now(),
              ...newTable,
              columns: [],
              outgoingRelationships: [],
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
        }
      })

      return { previousData }
    },
    onSuccess: (createdTable) => {
      // Emit WebSocket event for other users
      emit('table:create', createdTable)

      // Invalidate and refetch
      queryClient.invalidateQueries({
        queryKey: ['whiteboard-page', whiteboardId],
      })
      queryClient.invalidateQueries({ queryKey: ['whiteboard', whiteboardId] })
    },
    onError: (err, _newTable, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(
          ['whiteboard', whiteboardId],
          context.previousData,
        )
      }
      console.error('Failed to create table:', err)
      toast.error(
        isThrownForbiddenError(err)
          ? 'You do not have permission to add tables to this whiteboard.'
          : 'Failed to create table. Please try again.',
      )
    },
  })

  const updateTablePositionMutation = useMutation({
    mutationFn: async (data: {
      id: string
      positionX: number
      positionY: number
    }) => {
      return await updateTablePositionFn({ data })
    },
    onSuccess: (updatedTable, variables) => {
      // Session expired mid-drag — root-provider's global onSuccess handler
      // already surfaces the session-expired modal for this resolved-value
      // 401; skip the optimistic cache patch below (nothing to reconcile).
      if (isUnauthorizedError(updatedTable)) return

      // Emit WebSocket event for other users
      emit('table:move', {
        tableId: variables.id,
        positionX: variables.positionX,
        positionY: variables.positionY,
      })

      // Update cache without full refetch
      queryClient.setQueryData(['whiteboard', whiteboardId], (old: any) => {
        if (!old) return old
        return {
          ...old,
          tables: (old.tables ?? []).map((t: any) =>
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

  const createRelationshipMutation = useMutation({
    mutationFn: async (data: CreateRelationship) => {
      return await createRelationshipFn({ data })
    },
    onSuccess: (createdRelationship) => {
      // Emit WebSocket event for other users
      emit('relationship:create', createdRelationship)

      // Invalidate and refetch
      queryClient.invalidateQueries({
        queryKey: ['whiteboard-page', whiteboardId],
      })
      queryClient.invalidateQueries({ queryKey: ['whiteboard', whiteboardId] })
    },
    onError: (err) => {
      console.error('Failed to create relationship:', err)
      toast.error(
        isThrownForbiddenError(err)
          ? 'You do not have permission to add relationships to this whiteboard.'
          : 'Failed to create relationship. Please try again.',
      )
    },
  })

  // Event handlers
  // Use mutateAsync (not mutate) so the promise returned to Toolbar.tsx
  // actually reflects success/failure — Toolbar keeps its dialog open on
  // rejection instead of closing optimistically before the mutation settles.
  const handleCreateTable = useCallback(
    (data: CreateTable) => {
      return createTableMutation.mutateAsync(data)
    },
    [createTableMutation],
  )

  const handleCreateRelationship = useCallback(
    (data: CreateRelationship) => {
      return createRelationshipMutation.mutateAsync(data)
    },
    [createRelationshipMutation],
  )

  const handleTableDragEnd = useCallback(
    (tableId: string, x: number, y: number) => {
      updateTablePositionMutation.mutate({
        id: tableId,
        positionX: x,
        positionY: y,
      })
    },
    [updateTablePositionMutation],
  )

  /**
   * Handle minimap navigation
   * Updates canvas position when user clicks on minimap
   */
  const handleMinimapNavigate = useCallback(
    (offsetX: number, offsetY: number) => {
      const newViewport = {
        zoom: canvasViewport.zoom,
        offsetX,
        offsetY,
      }
      setCanvasViewport(newViewport)
      handleCanvasViewportChange(newViewport)
    },
    [canvasViewport.zoom, handleCanvasViewportChange],
  )

  /**
   * Cleanup debounce timer on unmount
   */
  useEffect(() => {
    return () => {
      if (saveCanvasStateTimerRef.current) {
        clearTimeout(saveCanvasStateTimerRef.current)
      }
    }
  }, [])

  /**
   * Callback for React Flow to register its display mode controls
   */
  const handleDisplayModeReady = useCallback(
    (showMode: ShowMode, setShowMode: (mode: ShowMode) => void) => {
      setReactFlowShowMode(showMode)
      reactFlowShowModeRef.current = setShowMode
    },
    [],
  )

  /**
   * Callback for React Flow to register its zoom controls
   */
  const handleZoomControlsReady = useCallback((controls: ZoomControls) => {
    setReactFlowZoomControls(controls)
  }, [])

  /**
   * Callback for React Flow to notify parent of viewport zoom changes
   */
  const handleZoomChange = useCallback((zoom: number) => {
    setReactFlowCurrentZoom(zoom)
  }, [])

  // Initialize textSource from database or sync from canvas when switching to text mode
  useEffect(() => {
    if (!whiteboardData || isUnauthorizedError(whiteboardData)) return
    if (activeTab === 'text' && whiteboardData.whiteboard) {
      // If whiteboard has stored textSource, use it; otherwise generate from canvas
      if (whiteboardData.whiteboard.textSource && textSource === '') {
        setTextSource(whiteboardData.whiteboard.textSource)
      } else if (isTextSyncEnabled) {
        const currentText = entitiesToText(
          whiteboardData.whiteboard.tables,
          whiteboardData.relationships,
        )
        setTextSource(currentText)
      }
    }
  }, [activeTab, whiteboardData, isTextSyncEnabled, textSource])

  // WebSocket event listeners for real-time updates
  useEffect(() => {
    const handleTableCreated = (table: any) => {
      console.log('Table created by another user:', table)
      queryClient.invalidateQueries({
        queryKey: ['whiteboard-page', whiteboardId],
      })
      queryClient.invalidateQueries({ queryKey: ['whiteboard', whiteboardId] })
    }

    const handleTableMoved = (data: {
      tableId: string
      positionX: number
      positionY: number
      updatedBy?: string
    }) => {
      // Ignore own moves — already applied via mutation's setQueryData
      if (data.updatedBy === userId) return
      console.log('Table moved by another user:', data)
      queryClient.setQueryData(
        ['whiteboard-page', whiteboardId],
        (old: any) => {
          if (!old) return old
          return {
            ...old,
            whiteboard: {
              ...old.whiteboard,
              tables: old.whiteboard.tables.map((t: any) =>
                t.id === data.tableId
                  ? {
                      ...t,
                      positionX: data.positionX,
                      positionY: data.positionY,
                    }
                  : t,
              ),
            },
          }
        },
      )
      // Also invalidate ReactFlowWhiteboard's query
      queryClient.invalidateQueries({ queryKey: ['whiteboard', whiteboardId] })
    }

    const handleRelationshipCreated = (relationship: any) => {
      console.log('Relationship created by another user:', relationship)
      queryClient.invalidateQueries({
        queryKey: ['whiteboard-page', whiteboardId],
      })
      queryClient.invalidateQueries({ queryKey: ['whiteboard', whiteboardId] })
      queryClient.invalidateQueries({
        queryKey: ['relationships', whiteboardId],
      })
    }

    const handleTextUpdated = (data: {
      textSource: string
      updatedBy: string
    }) => {
      console.log('Text updated by another user:', data.updatedBy)
      setTextSource(data.textSource)
      queryClient.invalidateQueries({
        queryKey: ['whiteboard-page', whiteboardId],
      })
      queryClient.invalidateQueries({ queryKey: ['whiteboard', whiteboardId] })
    }

    // GH #107: another editor restored a previous version — refresh every
    // query that feeds this canvas so the acting client and every other
    // connected collaborator converge on the restored state (AC5). Reuses
    // the exact invalidation set the other handlers in this effect use.
    const handleWhiteboardRestored = (data: { whiteboardId: string }) => {
      if (data.whiteboardId !== whiteboardId) return
      queryClient.invalidateQueries({
        queryKey: ['whiteboard-page', whiteboardId],
      })
      queryClient.invalidateQueries({ queryKey: ['whiteboard', whiteboardId] })
      queryClient.invalidateQueries({
        queryKey: ['relationships', whiteboardId],
      })
    }

    on('table:created', handleTableCreated)
    on('table:moved', handleTableMoved)
    on('relationship:created', handleRelationshipCreated)
    on('text:updated', handleTextUpdated)
    on('whiteboard:restored', handleWhiteboardRestored)

    return () => {
      off('table:created', handleTableCreated)
      off('table:moved', handleTableMoved)
      off('relationship:created', handleRelationshipCreated)
      off('text:updated', handleTextUpdated)
      off('whiteboard:restored', handleWhiteboardRestored)
    }
  }, [on, off, queryClient, whiteboardId, userId])

  // Early returns AFTER all hooks have been called
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-lg text-muted-foreground">Loading whiteboard...</p>
      </div>
    )
  }

  // isUnauthorized covers the case where the collaboration socket's namespace
  // connection was denied (RBAC) — the server only emits this on an actual
  // FORBIDDEN denial, so it's always an access-denied case.
  if (isUnauthorized) {
    return (
      <div className="flex items-center justify-center h-screen">
        <WhiteboardAccessDenied />
      </div>
    )
  }

  // A rejected whiteboard-page query can be a permissions denial, but it can
  // just as easily be a network error, a 500, or a genuine not-found — only
  // render the access-denied state when the error is actually a
  // ForbiddenError so other failures aren't mislabeled "you don't have
  // access".
  if (isError) {
    if (classifyQueryFailure({ error: whiteboardPageError }) === 'forbidden') {
      return (
        <div className="flex items-center justify-center h-screen">
          <WhiteboardAccessDenied />
        </div>
      )
    }
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-lg font-semibold">Failed to load whiteboard</p>
        <p className="text-sm text-muted-foreground">
          Something went wrong loading this whiteboard. Please try again.
        </p>
        <Link
          to="/"
          className="text-sm text-primary underline underline-offset-4"
        >
          Back to dashboard
        </Link>
      </div>
    )
  }

  if (!whiteboardData) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-lg text-muted-foreground">Loading whiteboard...</p>
      </div>
    )
  }

  // Session expired mid-visit (queryFn returns the auth error itself in this
  // case — see above). The QueryClient's global onSuccess handler already
  // dispatched HTTP_UNAUTHORIZED, which opens the session-expired modal via
  // AuthContext; this is just the render-side guard so we don't try to read
  // .tables/.relationships off an { error, status } payload.
  if (isUnauthorizedError(whiteboardData)) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-lg text-muted-foreground">
          Your session expired. Please sign in again.
        </p>
      </div>
    )
  }

  const { whiteboard, relationships } = whiteboardData
  const viewerRole = whiteboard?.viewerRole ?? null
  const canEdit = hasMinimumRole(viewerRole, 'EDITOR')

  if (!whiteboard) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-lg font-semibold">Whiteboard not found</p>
        <p className="text-sm text-muted-foreground">
          This whiteboard does not exist or you don't have access to it.
        </p>
        <Link
          to="/"
          className="text-sm text-primary underline underline-offset-4"
        >
          Back to dashboard
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header — hidden in zen mode */}
      {!isZenMode && (
        <div className="flex items-center justify-between px-4 py-2 border-b">
          <h1 className="text-xl font-semibold">{whiteboard.name}</h1>
          <div className="flex items-center gap-2">
            {USE_REACT_FLOW && commentUnreadCount > 0 && (
              <span
                className="rounded-full bg-destructive px-2 py-0.5 text-xs font-medium text-destructive-foreground"
                title={`${commentUnreadCount} unresolved comment thread${commentUnreadCount === 1 ? '' : 's'}`}
              >
                {commentUnreadCount} unresolved
              </span>
            )}
            <span
              className={`text-sm ${
                connectionState === 'connected'
                  ? 'text-green-600'
                  : connectionState === 'connecting'
                    ? 'text-yellow-600'
                    : 'text-red-600'
              }`}
            >
              {connectionState === 'connected'
                ? 'Connected'
                : connectionState === 'connecting'
                  ? 'Connecting...'
                  : 'Disconnected'}
            </span>
          </div>
        </div>
      )}

      {/* Whiteboard canvas */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar — rendered by ReactFlowWhiteboardInner when USE_REACT_FLOW is true.
               For the Konva (legacy) path, we render a separate toolbar here. */}
        {!USE_REACT_FLOW && !isZenMode && (
          <Toolbar
            whiteboardId={whiteboardId}
            tables={whiteboard.tables}
            tableCount={whiteboard.tables.length}
            onCreateTable={handleCreateTable}
            onCreateRelationship={handleCreateRelationship}
            onImportSql={handleImportSql}
            zoomControls={canvasControls}
            currentZoom={canvasViewport.zoom}
            viewerRole={viewerRole}
            onOpenHistory={() => setHistoryOpen(true)}
          />
        )}

        {/* Canvas - Toggle between Konva and React Flow */}
        <div className="flex-1 overflow-hidden relative">
          {USE_REACT_FLOW ? (
            /* React Flow Canvas (new) — includes its own Toolbar */
            <ReactFlowWhiteboard
              whiteboardId={whiteboardId}
              userId={userId}
              showMinimap={whiteboard.tables.length > 0}
              showControls={true}
              nodesDraggable={canEdit}
              viewerRole={viewerRole}
              onCreateTable={handleCreateTable}
              onCreateRelationship={handleCreateRelationship}
              onImportSql={handleImportSql}
              onDisplayModeReady={handleDisplayModeReady}
              onZoomControlsReady={handleZoomControlsReady}
              onZoomChange={handleZoomChange}
              onOpenHistory={() => setHistoryOpen(true)}
              onOpenComments={() => setCommentsOpen(true)}
              onCommentsChange={setComments}
              onCommentActionsReady={setCommentActions}
            />
          ) : (
            /* Konva Canvas (legacy) */
            <Canvas
              width={window.innerWidth}
              height={window.innerHeight - 160} // Subtract header, tabs, and toolbar height
              initialViewport={canvasViewport}
              onViewportChange={handleCanvasViewportChange}
              stageRef={stageRef}
            >
              {/* Render all tables */}
              {whiteboard.tables.map((table) => (
                <TableNode
                  key={table.id}
                  table={table}
                  isSelected={selectedTableId === table.id}
                  onClick={setSelectedTableId}
                  onDragEnd={handleTableDragEnd}
                />
              ))}

              {/* Render all relationships */}
              {relationships.map((relationship) => {
                const sourceTable = whiteboard.tables.find(
                  (t) => t.id === relationship.sourceTableId,
                )
                const targetTable = whiteboard.tables.find(
                  (t) => t.id === relationship.targetTableId,
                )

                if (!sourceTable || !targetTable) {
                  console.warn(
                    'Missing table for relationship:',
                    relationship.id,
                  )
                  return null
                }

                return (
                  <RelationshipEdge
                    key={relationship.id}
                    relationship={relationship}
                    sourceTable={sourceTable}
                    targetTable={targetTable}
                    isSelected={selectedRelationshipId === relationship.id}
                    onClick={setSelectedRelationshipId}
                  />
                )
              })}
            </Canvas>
          )}

          {/* Minimap - only show when there are tables and using Konva */}
          {!USE_REACT_FLOW && whiteboard.tables.length > 0 && (
            <Minimap
              tables={whiteboard.tables}
              viewport={canvasViewport}
              canvasWidth={window.innerWidth}
              canvasHeight={window.innerHeight - 160}
              onNavigate={handleMinimapNavigate}
            />
          )}
        </div>
      </div>

      {/* Version history panel (GH #107) — trigger lives in the Toolbar
          (both the legacy and React Flow paths above wire onOpenHistory to
          this state); rendered here to avoid a circular import (the panel's
          preview reuses ReactFlowWhiteboard). */}
      <WhiteboardHistoryPanel
        whiteboardId={whiteboardId}
        viewerRole={viewerRole}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />

      {/* Canvas comments panel (GH #110) — React Flow path only; the legacy
          Konva canvas has no comment pins to navigate to. */}
      {USE_REACT_FLOW && (
        <WhiteboardCommentsPanel
          viewerRole={viewerRole}
          comments={comments}
          actions={commentActions}
          open={commentsOpen}
          onOpenChange={setCommentsOpen}
        />
      )}
    </div>
  )
}
