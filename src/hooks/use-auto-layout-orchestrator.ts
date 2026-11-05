// src/hooks/use-auto-layout-orchestrator.ts
// Central hook that wires all Auto Layout phases together inside ReactFlowWhiteboard.
// Owns the full user-facing flow:
//   button click → optional confirmation dialog → layout computation
//   → optimistic setNodes → bulk persist → emit broadcast → fitView → toast.
//
// Error handling:
//   - Layout error (thrown): show error toast, no setNodes
//   - Auth error (resolved AuthErrorResponse): persist-failure UX + triggerSessionExpired
//   - Persist error (thrown): persist-failure UX with Retry toast; the rollback
//     restores only what the layout itself changed (edits by peers stay)
//   - Retry re-runs Auto Layout from the current board
//
// Apollo findings addressed:
//   Finding 1: isUnauthorizedError(result) check on every updateTablePositionsBulk await
//   Finding 3: Orchestrator emits table:move:bulk after server function success (not inside SF)
//   Finding 4: isMountedRef guards all state setters and the Retry handler
//   Finding 5: emitBulkPositionUpdate uses userId (not updatedBy)

import { useCallback, useEffect, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { toast } from 'sonner'
import type { Node } from '@xyflow/react'
import type { LayoutOutputPosition } from '@/lib/auto-layout/d3-force-layout'
import type {
  AreaLayoutInputArea,
  AreaLayoutOutputArea,
} from '@/lib/auto-layout/area-aware-layout'
import type { LayoutableNodeType } from '@/hooks/use-d3-force-layout'
import type {
  AreaNodeType,
  RelationshipEdgeType,
  TableNodeType,
} from '@/lib/react-flow/types'
import { useT } from '@/lib/i18n/use-t'
import { applyBulkPositions } from '@/lib/auto-layout'
import { toStoreNodes } from '@/lib/auto-layout/to-store-nodes'
import {
  rollbackLayout,
  toAbsoluteTableNodes,
} from '@/lib/auto-layout/rollback-layout'
import { recalculateEdgeRouting } from '@/lib/react-flow/edge-bundles'
import { isUnauthorizedError } from '@/lib/auth/errors'
import { useAuthContext } from '@/components/auth/AuthContext'
import { updateTablePositionsBulk } from '@/lib/server-functions'
import { DOCK_FIT_PADDING } from '@/lib/react-flow/fit-view-padding'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BulkPayload = {
  whiteboardId: string
  positions: Array<{ id: string; positionX: number; positionY: number }>
  /** New bounds for every area; omitted when the board has no areas */
  areas?: Array<AreaLayoutOutputArea>
}

export interface UseAutoLayoutOrchestratorArgs {
  whiteboardId: string
  /** The d3-force layout function from useD3ForceLayout */
  runD3ForceLayout: (
    nodes: Array<LayoutableNodeType>,
    edges: Array<RelationshipEdgeType>,
    areas?: Array<AreaLayoutInputArea>,
  ) => Promise<{
    positions: Array<LayoutOutputPosition>
    areas?: Array<AreaLayoutOutputArea>
  } | null>
  /** Emits table:move:bulk after successful persistence */
  emitBulkPositionUpdate: (
    positions: Array<{ tableId: string; positionX: number; positionY: number }>,
    areas?: Array<AreaLayoutOutputArea>,
  ) => void
  /**
   * Called once after a layout run's optimistic apply + persist has
   * succeeded — used by ReactFlowWhiteboard to patch the React Query cache
   * (the source of truth that `ReactFlowCanvas` re-syncs `initialNodes`
   * from). Not called on
   * layout error, persist failure, or auth error.
   *
   * Receives the applied table positions and the new area bounds (empty
   * when the board has no areas). Both use absolute coordinates. The area
   * bounds are already persisted and broadcast with the positions.
   */
  onAfterLayout?: (
    positions: Array<{ id: string; x: number; y: number }>,
    areas: Array<AreaLayoutOutputArea>,
  ) => void
  /**
   * Mirrors area bounds into the caller's `areas` state WITHOUT emitting or
   * persisting. The orchestrator calls it with the new bounds when it writes
   * the optimistic layout to the React Flow store, and with the previous
   * bounds when a failed persist rolls the store back. This keeps the store
   * (members relative to the area origin) and `areas` state (which membership
   * reconcile reads) on the same origin at all times.
   */
  onAreaBoundsChange?: (areas: Array<AreaLayoutOutputArea>) => void
}

export interface UseAutoLayoutOrchestratorResult {
  /** True while the layout simulation or persistence is running */
  isRunning: boolean
  /** True when the confirmation dialog should be shown (> 50 tables) */
  showConfirmDialog: boolean
  /** The last persist error, or null */
  persistError: unknown
  /** Called when the toolbar Auto Layout button is clicked */
  handleAutoLayoutClick: (tableCount: number) => void
  /** Called when the user confirms in the dialog */
  handleConfirm: () => void
  /** Called when the user cancels the dialog */
  handleCancel: () => void
  /** Called when the user clicks Retry on the persist-failure toast */
  handleRetry: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAutoLayoutOrchestrator({
  whiteboardId,
  runD3ForceLayout,
  emitBulkPositionUpdate,
  onAfterLayout,
  onAreaBoundsChange,
}: UseAutoLayoutOrchestratorArgs): UseAutoLayoutOrchestratorResult {
  const { setNodes, setEdges, getNodes, getEdges, fitView } = useReactFlow()
  const { triggerSessionExpired } = useAuthContext()
  const t = useT()

  const [isRunning, setIsRunning] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [persistError, setPersistError] = useState<unknown>(null)

  // Rolls back the optimistic layout of the current run (its own table
  // positions, area bounds and edge routing). Set by runLayout.
  const layoutActionsRef = useRef<{ revert: () => void } | null>(null)

  // Generation counter: every runLayout call takes the next number. A run
  // that finds a newer number after an await is stale and leaves the board,
  // the toasts and the broadcast alone.
  const runIdRef = useRef(0)

  // handlePersistResult's toast action invokes handleRetry, and handleRetry
  // (through runLayout) calls handlePersistResult. Declaring either as a
  // direct dependency of the other is a temporal-dead-zone crash (both are
  // `const` in the same function scope). Route the forward reference through
  // a ref, kept in sync on every render.
  const handleRetryRef = useRef<() => Promise<void>>(async () => {})

  // Mount tracking — Retry and all state setters must no-op after unmount
  // (resolves Apollo Finding 4 — isMountedRef stale Retry guard).
  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // ---------------------------------------------------------------------------
  // handlePersistResult — result handling for runLayout
  // Returns true on success, false on auth-error
  // ---------------------------------------------------------------------------
  const handlePersistResult = useCallback(
    (result: unknown, positionsCount: number): boolean => {
      // Auth error (RETURNED as a value, NOT thrown — Apollo Finding 1).
      // Must be checked before treating the result as a success.
      if (isUnauthorizedError(result)) {
        if (isMountedRef.current) {
          setPersistError(result)
          triggerSessionExpired()
          toast.error(t('hooks.autoLayout.sessionExpired'), {
            action: {
              label: t('common.retry'),
              onClick: () => {
                if (!isMountedRef.current) return
                void handleRetryRef.current()
              },
            },
          })
        }
        layoutActionsRef.current?.revert()
        return false
      }

      // Success path
      setTimeout(() => {
        if (!isMountedRef.current) return
        fitView({ padding: DOCK_FIT_PADDING, duration: 300 })
      }, 100)
      toast.success(t('hooks.autoLayout.applied', { count: positionsCount }))
      return true
    },
    [fitView, triggerSessionExpired, t],
  )

  // ---------------------------------------------------------------------------
  // runLayout — the core flow
  // ---------------------------------------------------------------------------
  const runLayout = useCallback(async (): Promise<void> => {
    const myRun = ++runIdRef.current
    const isStale = () => runIdRef.current !== myRun
    if (isMountedRef.current) setIsRunning(true)
    if (isMountedRef.current) setPersistError(null)

    try {
      // Step 1 — Compute layout (may return null on error). Comment-pin
      // (GH #110) nodes are excluded from the layout input: they have no
      // `data.table` to size against and are anchored to a point or table.
      // Subject areas (GH #106) are not table nodes either: they are passed
      // separately, and the layout treats each area as one block. Its member
      // tables are arranged inside it and it is resized around them, so the
      // grouping survives. `positions` never contains an area/comment id, so
      // the table persist never targets a non-existent DiagramTable row.
      // Area bounds travel in their own `areas` list.
      // Cross-file references (LizMeter #83) are laid out with the tables:
      // they occupy space and carry relationships, so leaving them where they
      // were dropped is what makes a laid-out board still look overlapped.
      // They are also DiagramTable rows, so the bulk persist below writes
      // their positions through the same path with no special case.
      //
      // The layout adapter (use-d3-force-layout.ts) already falls back to the
      // measured node box when a node has no `data.table`, which is exactly
      // what a reference node is.
      const currentNodes = getNodes()
      const tableNodesOnly = currentNodes.filter(
        (n): n is LayoutableNodeType =>
          n.type === 'table' || n.type === 'externalTable',
      )
      // Nothing to arrange: areas alone give the server an empty positions
      // list, which its schema rejects, so Retry could never succeed.
      if (tableNodesOnly.length === 0) return

      const relationshipEdgesOnly = getEdges().filter(
        (e): e is RelationshipEdgeType => e.type === 'relationship',
      )
      const areaInputs: Array<AreaLayoutInputArea> = currentNodes
        .filter((n): n is AreaNodeType => n.type === 'area')
        .map((n) => ({
          id: n.id,
          positionX: n.position.x,
          positionY: n.position.y,
          width: n.width ?? n.data.area.width,
          height: n.height ?? n.data.area.height,
          memberTableIds: n.data.area.memberTableIds,
        }))
      const layoutResult = await runD3ForceLayout(
        tableNodesOnly,
        relationshipEdgesOnly,
        areaInputs,
      )

      if (!isMountedRef.current || isStale()) return
      if (!layoutResult) {
        // runD3ForceLayout already sets error state on the hook and calls onLayoutError;
        // the orchestrator surfaces the user-facing toast here.
        toast.error(t('hooks.autoLayout.failed'))
        return
      }

      const { positions } = layoutResult
      const areaBounds = layoutResult.areas ?? []

      // Step 2 — Optimistic local apply (before network round-trip).
      // `updatedNodes` holds ABSOLUTE table positions: it feeds edge routing,
      // which speaks absolute coordinates. The store gets the same nodes with
      // member tables made RELATIVE to their area's NEW origin, because React
      // Flow paints a child at parent.position + child.position.
      const snapshotNodes = getNodes()
      const previousAreaBounds: Array<AreaLayoutOutputArea> = snapshotNodes
        .filter(
          (n): n is AreaNodeType =>
            n.type === 'area' && areaBounds.some((b) => b.id === n.id),
        )
        .map((n) => ({
          id: n.id,
          positionX: n.data.area.positionX,
          positionY: n.data.area.positionY,
          width: n.data.area.width,
          height: n.data.area.height,
        }))
      const updatedNodes = applyBulkPositions(snapshotNodes, positions)
      const storeNodes =
        areaBounds.length > 0
          ? toStoreNodes(snapshotNodes, positions, areaBounds, areaInputs)
          : updatedNodes
      // Edges only ever connect table and reference nodes (never area/comment
      // pins) — narrow for recalculateEdgeRouting below, which reads position
      // and size off each node. Reference nodes are routed like tables, as the
      // page-load path does, so an edge to one follows where the node now sits.
      const updatedTableNodes = updatedNodes.filter(
        (n): n is TableNodeType =>
          n.type === 'table' || n.type === 'externalTable',
      )
      const allMovedIds = new Set(positions.map((p) => p.id))

      // Apply the optimistic layout.
      setNodes(storeNodes)
      setEdges((prev) => {
        // Every edge in this app is a 'relationship' edge (the sole
        // registered edge type — see node-types.ts) — filter narrows the
        // type accordingly for recalculateEdgeRouting below.
        const relationshipEdges = prev.filter(
          (e): e is RelationshipEdgeType => e.type === 'relationship',
        )
        // Handle sides and bundle offsets both derive from the new positions.
        return recalculateEdgeRouting(
          relationshipEdges,
          updatedTableNodes,
          allMovedIds,
        )
      })
      if (areaBounds.length > 0) onAreaBoundsChange?.(areaBounds)

      // Roll back ONLY what this layout changed, in the store's coordinate
      // space (members relative to their area's origin). A table whose store
      // position no longer equals the one the layout applied was moved by
      // someone else since, so it keeps that position. Nodes and edges added
      // or edited meanwhile stay. `reverted` makes a second call a no-op.
      let reverted = false
      layoutActionsRef.current = {
        revert: () => {
          if (reverted) return
          reverted = true
          let next: Array<Node> = []
          let restoredAreas = new Set<string>()
          let restoredTableIds = new Set<string>()
          setNodes((prev) => {
            const out = rollbackLayout(
              prev,
              snapshotNodes,
              storeNodes,
              allMovedIds,
              areaBounds,
              previousAreaBounds,
            )
            next = out.nodes
            restoredAreas = out.restoredAreaIds
            restoredTableIds = out.restoredTableIds
            return out.nodes
          })
          const absTables = toAbsoluteTableNodes(next)
          setEdges((prev) => {
            const relationshipEdges = prev.filter(
              (e): e is RelationshipEdgeType => e.type === 'relationship',
            )
            return recalculateEdgeRouting(
              relationshipEdges,
              absTables,
              restoredTableIds,
            )
          })
          const restoredBounds = previousAreaBounds.filter((b) =>
            restoredAreas.has(b.id),
          )
          if (restoredBounds.length > 0) onAreaBoundsChange?.(restoredBounds)
        },
      }

      const payload: BulkPayload = {
        whiteboardId,
        positions: positions.map((p) => ({
          id: p.id,
          positionX: p.x,
          positionY: p.y,
        })),
        ...(areaBounds.length > 0 ? { areas: areaBounds } : {}),
      }

      // Step 4 — Persist
      let result: unknown
      try {
        result = await updateTablePositionsBulk({ data: payload })
      } catch (persistErr) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!isMountedRef.current || isStale()) return
        console.error('Auto Layout persist failed:', persistErr)
        layoutActionsRef.current.revert()
        setPersistError(persistErr)
        toast.error(t('hooks.autoLayout.notPersisted'), {
          action: {
            label: t('common.retry'),
            onClick: () => {
              if (!isMountedRef.current) return
              void handleRetryRef.current()
            },
          },
        })
        return
        // No fitView on persist failure (PRD NFR Persistence — failure UX).
      }

      // The server holds the layout. Peers and the query cache must learn of
      // it even when this component unmounted during the request or a newer
      // run started; only the toast, fitView and state updates are skipped.
      // A newer run overwrites the positions again when it succeeds.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!isMountedRef.current || isStale()) {
        if (!isUnauthorizedError(result)) {
          emitBulkPositionUpdate(
            positions.map((p) => ({
              tableId: p.id,
              positionX: p.x,
              positionY: p.y,
            })),
            areaBounds,
          )
          onAfterLayout?.(positions, areaBounds)
        }
        return
      }

      // Step 5 — Handle result (auth-error or success)
      const ok = handlePersistResult(result, positions.length)
      if (ok) {
        // Step 6 — Emit broadcast AFTER server-function success
        // Mirrors the single-table updateTablePositionMutation.onSuccess pattern
        // (resolves Apollo Finding 3).
        emitBulkPositionUpdate(
          positions.map((p) => ({
            tableId: p.id,
            positionX: p.x,
            positionY: p.y,
          })),
          areaBounds,
        )
        // Step 7 — Hand the applied positions and area bounds to the caller
        // so it can patch the query cache (area-autolayout-persistence-fix).
        onAfterLayout?.(positions, areaBounds)
      }
    } finally {
      if (isMountedRef.current && !isStale()) setIsRunning(false)
    }
  }, [
    whiteboardId,
    runD3ForceLayout,
    getNodes,
    getEdges,
    setNodes,
    setEdges,
    handlePersistResult,
    emitBulkPositionUpdate,
    onAfterLayout,
    onAreaBoundsChange,
    t,
  ])

  // ---------------------------------------------------------------------------
  // handleRetry — run Auto Layout again from the current board. The board may
  // have changed since the failed save, so the failed payload is not re-sent.
  // ---------------------------------------------------------------------------
  const handleRetry = useCallback(async (): Promise<void> => {
    // Mount-guard at the entry of the action (Apollo Finding 4).
    if (!isMountedRef.current) return
    await runLayout()
  }, [runLayout])

  // Keep the ref pointed at the latest handleRetry so handlePersistResult's
  // toast action always invokes the current closure (see handleRetryRef
  // comment above).
  handleRetryRef.current = handleRetry

  // ---------------------------------------------------------------------------
  // Dialog handlers
  // ---------------------------------------------------------------------------

  const handleAutoLayoutClick = useCallback(
    (tableCount: number) => {
      if (tableCount > 50) {
        setShowConfirmDialog(true)
      } else {
        void runLayout()
      }
    },
    [runLayout],
  )

  const handleConfirm = useCallback(() => {
    setShowConfirmDialog(false)
    void runLayout()
  }, [runLayout])

  const handleCancel = useCallback(() => {
    setShowConfirmDialog(false)
  }, [])

  return {
    isRunning,
    showConfirmDialog,
    persistError,
    handleAutoLayoutClick,
    handleConfirm,
    handleCancel,
    handleRetry,
  }
}
