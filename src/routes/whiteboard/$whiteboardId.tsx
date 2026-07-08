// src/routes/whiteboard/$whiteboardId.tsx
// Whiteboard editor route - loads and renders full ER diagram

import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { CreateRelationship, CreateTable } from '@/data/schema'
import type { DiagramAST } from '@/lib/parser/ast'
import type { ZoomControls } from '@/components/whiteboard/Toolbar'
import type { CommentActions } from '@/components/whiteboard/ReactFlowWhiteboard'
import type { CommentWithAuthor } from '@/data/models'
import type { ShowMode } from '@/lib/react-flow/types'
import { ReactFlowWhiteboard } from '@/components/whiteboard/ReactFlowWhiteboard'
import { WhiteboardAccessDenied } from '@/components/whiteboard/WhiteboardAccessDenied'
import { WhiteboardHistoryPanel } from '@/components/whiteboard/WhiteboardHistoryPanel'
import { WhiteboardCommentsPanel } from '@/components/whiteboard/WhiteboardCommentsPanel'
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

  // Zen mode — hides all UI chrome so only the canvas is visible
  const { isZenMode, toggleZenMode } = useZenMode()

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

  // SQL DDL import orchestration (Issue #105) — threaded through as a prop to
  // the Toolbar ReactFlowWhiteboard renders internally. Toolbar's onImportSql
  // contract discards the resolved summary (void | Promise<void>) —
  // ImportSqlDialog only needs to know success/failure.
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

  // WebSocket collaboration - MUST be called before any early returns
  const { emit, on, off, connectionState, isUnauthorized } = useCollaboration(
    whiteboardId,
    userId,
    triggerSessionExpired,
  )

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
  //
  // GH #125: this effect used to also register a `table:created` listener
  // here, but it never fired live (a dead/non-effective subscription — see
  // use-whiteboard-collaboration.ts for the working socket path). Live
  // table-creation sync is now handled entirely by
  // useWhiteboardCollaboration's table:created effect + ReactFlowWhiteboard's
  // handleTableCreated, which patch the canvas's own query cache. Removed
  // rather than reinstated here. The sibling handlers below
  // (relationship:created, text:updated, whiteboard:restored) share the same
  // family of non-firing-subscription risk but are explicitly out of scope
  // for #125 — flagged as a follow-up, not touched in this change.
  useEffect(() => {
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

    on('table:moved', handleTableMoved)
    on('relationship:created', handleRelationshipCreated)
    on('text:updated', handleTextUpdated)
    on('whiteboard:restored', handleWhiteboardRestored)

    return () => {
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

  const { whiteboard } = whiteboardData
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
            {commentUnreadCount > 0 && (
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
        {/* Canvas — React Flow renders its own Toolbar internally. */}
        <div className="flex-1 overflow-hidden relative">
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
        </div>
      </div>

      {/* Version history panel (GH #107) — trigger lives in the Toolbar
          (wired via onOpenHistory above); rendered here to avoid a circular
          import (the panel's preview reuses ReactFlowWhiteboard). */}
      <WhiteboardHistoryPanel
        whiteboardId={whiteboardId}
        viewerRole={viewerRole}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />

      {/* Canvas comments panel (GH #110) */}
      <WhiteboardCommentsPanel
        viewerRole={viewerRole}
        comments={comments}
        actions={commentActions}
        open={commentsOpen}
        onOpenChange={setCommentsOpen}
      />
    </div>
  )
}
