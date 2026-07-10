// src/hooks/use-auto-layout-orchestrator.ts
// Central hook that wires all Auto Layout phases together inside ReactFlowWhiteboard.
// Owns the full user-facing flow:
//   button click → optional confirmation dialog → layout computation
//   → optimistic setNodes → bulk persist → emit broadcast → fitView → toast.
//
// Error handling:
//   - Layout error (thrown): show error toast, no setNodes
//   - Auth error (resolved AuthErrorResponse): persist-failure UX + triggerSessionExpired
//   - Persist error (thrown): persist-failure UX with Retry toast
//
// Apollo findings addressed:
//   Finding 1: isUnauthorizedError(result) check on every updateTablePositionsBulk await
//   Finding 3: Orchestrator emits table:move:bulk after server function success (not inside SF)
//   Finding 4: isMountedRef guards all state setters and the Retry handler
//   Finding 5: emitBulkPositionUpdate uses userId (not updatedBy)

import { useCallback, useEffect, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { toast } from 'sonner'
import type {
  LayoutOutputEdge,
  LayoutOutputPosition,
} from '@/lib/auto-layout/d3-force-layout'
import type {
  RelationshipEdgeType,
  TableNodeType,
} from '@/lib/react-flow/types'
import { applyBulkPositions } from '@/lib/auto-layout'
import { recalculateEdgesForDraggedNodes } from '@/lib/react-flow/edge-routing'
import { isUnauthorizedError } from '@/lib/auth/errors'
import { useAuthContext } from '@/components/auth/AuthContext'
import { updateTablePositionsBulk } from '@/lib/server-functions'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BulkPayload = {
  whiteboardId: string
  positions: Array<{ id: string; positionX: number; positionY: number }>
}

export interface UseAutoLayoutOrchestratorArgs {
  whiteboardId: string
  /** The d3-force layout function from useD3ForceLayout */
  runD3ForceLayout: (
    nodes: Array<TableNodeType>,
    edges: Array<RelationshipEdgeType>,
  ) => Promise<{
    positions: Array<LayoutOutputPosition>
    edgeOffsets: Array<LayoutOutputEdge>
  } | null>
  /** Emits table:move:bulk after successful persistence */
  emitBulkPositionUpdate: (
    positions: Array<{ tableId: string; positionX: number; positionY: number }>,
  ) => void
  /**
   * Called once after a layout run's optimistic apply + persist has
   * succeeded (GH #106 Bug 2 fix) — used by ReactFlowWhiteboard to re-fit
   * every subject area around its members now that the (area-excluded)
   * table layout has settled. Not called on layout error, persist failure,
   * or auth error.
   *
   * Receives the applied positions (area-autolayout-persistence-fix) so the
   * caller can also patch the React Query cache (the source of truth that
   * `ReactFlowCanvas` re-syncs `initialNodes` from) and refit areas from the
   * fresh positions instead of stale `getNodes()` state.
   */
  onAfterLayout?: (positions: Array<{ id: string; x: number; y: number }>) => void
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
}: UseAutoLayoutOrchestratorArgs): UseAutoLayoutOrchestratorResult {
  const { setNodes, setEdges, getNodes, getEdges, fitView } = useReactFlow()
  const { triggerSessionExpired } = useAuthContext()

  const [isRunning, setIsRunning] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [persistError, setPersistError] = useState<unknown>(null)

  // Stash the last payload so handleRetry can re-submit without recomputing.
  const lastPayloadRef = useRef<BulkPayload | null>(null)

  // handlePersistResult (below) and handleRetry are mutually recursive:
  // handlePersistResult's toast action invokes handleRetry, and handleRetry
  // calls handlePersistResult. Declaring either as a direct dependency of the
  // other is a temporal-dead-zone crash (both are `const` in the same
  // function scope). Route the forward reference through a ref, kept in
  // sync on every render, so handlePersistResult never needs handleRetry in
  // its own dependency array.
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
  // handlePersistResult — shared between runLayout and handleRetry
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
          toast.error(
            'Your session expired before Auto Layout could be saved. Please sign in to retry.',
            {
              action: {
                label: 'Retry',
                onClick: () => {
                  if (!isMountedRef.current) return
                  if (!lastPayloadRef.current) return
                  void handleRetryRef.current()
                },
              },
            },
          )
        }
        return false
      }

      // Success path
      setTimeout(() => {
        if (!isMountedRef.current) return
        fitView({ padding: 0.2, duration: 300 })
      }, 100)
      toast.success(`Layout applied to ${positionsCount} tables`)
      return true
    },
    [fitView, triggerSessionExpired],
  )

  // ---------------------------------------------------------------------------
  // handleRetry — re-submit the last payload without recomputing layout
  // ---------------------------------------------------------------------------
  const handleRetry = useCallback(async (): Promise<void> => {
    // Mount-guard at the entry of the action (Apollo Finding 4).
    if (!isMountedRef.current) return
    if (!lastPayloadRef.current) return

    try {
      const result = await updateTablePositionsBulk({
        data: lastPayloadRef.current,
      })
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!isMountedRef.current) return // re-check after await

      const ok = handlePersistResult(
        result,
        lastPayloadRef.current.positions.length,
      )
      if (ok) {
        // Re-emit the broadcast on successful retry.
        emitBulkPositionUpdate(
          lastPayloadRef.current.positions.map((p) => ({
            tableId: p.id,
            positionX: p.positionX,
            positionY: p.positionY,
          })),
        )
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (isMountedRef.current) setPersistError(null)
        onAfterLayout?.(
          lastPayloadRef.current.positions.map((p) => ({
            id: p.id,
            x: p.positionX,
            y: p.positionY,
          })),
        )
      }
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!isMountedRef.current) return
      setPersistError(err)
      toast.error('Auto Layout could not be saved on retry. Please try again.')
    }
  }, [emitBulkPositionUpdate, handlePersistResult, onAfterLayout])

  // Keep the ref pointed at the latest handleRetry so handlePersistResult's
  // toast action always invokes the current closure (see handleRetryRef
  // comment above).
  handleRetryRef.current = handleRetry

  // ---------------------------------------------------------------------------
  // runLayout — the core flow
  // ---------------------------------------------------------------------------
  const runLayout = useCallback(async (): Promise<void> => {
    if (isMountedRef.current) setIsRunning(true)
    if (isMountedRef.current) setPersistError(null)

    try {
      // Step 1 — Compute layout (may return null on error). Subject-area
      // (GH #106) and comment-pin (GH #110) nodes are excluded from the
      // layout input: d3-force would otherwise treat them like a table,
      // scattering them away from their members/anchors (Bug 2) — they have
      // no `data.table` for computeD3ForceLayout to size against. `positions`
      // therefore never contains an area/comment id, so the bulk-apply/
      // persist below leaves them untouched and never targets a
      // non-existent DiagramTable row.
      const tableNodesOnly = getNodes().filter(
        (n): n is TableNodeType => n.type === 'table',
      )
      const relationshipEdgesOnly = getEdges().filter(
        (e): e is RelationshipEdgeType => e.type === 'relationship',
      )
      const layoutResult = await runD3ForceLayout(
        tableNodesOnly,
        relationshipEdgesOnly,
      )

      if (!isMountedRef.current) return
      if (!layoutResult) {
        // runD3ForceLayout already sets error state on the hook and calls onLayoutError;
        // the orchestrator surfaces the user-facing toast here.
        toast.error('Auto Layout failed — please try again.')
        return
      }

      const { positions, edgeOffsets } = layoutResult

      // Step 2 — Optimistic local apply (before network round-trip).
      // Build updated nodes once so we can pass the same array to both
      // setNodes and edge-handle recalculation.
      const updatedNodes = applyBulkPositions(getNodes(), positions)
      setNodes(updatedNodes)
      // Edges only ever connect table nodes (never area/comment pins) —
      // narrow for recalculateEdgesForDraggedNodes below, which reads
      // data.table off each node.
      const updatedTableNodes = updatedNodes.filter(
        (n): n is TableNodeType => n.type === 'table',
      )

      // Build a lookup for fast per-edge offset access
      const offsetById = new Map(edgeOffsets.map((o) => [o.id, o]))
      const allMovedIds = new Set(positions.map((p) => p.id))

      setEdges((prev) => {
        // Every edge in this app is a 'relationship' edge (the sole
        // registered edge type — see node-types.ts) — filter narrows the
        // type accordingly for recalculateEdgesForDraggedNodes below.
        const relationshipEdges = prev.filter(
          (e): e is RelationshipEdgeType => e.type === 'relationship',
        )
        // Apply bundle offsets to edge data first, then recalculate handle sides.
        const withOffsets: Array<RelationshipEdgeType> = relationshipEdges.map(
          (e): RelationshipEdgeType => {
            const off = offsetById.get(e.id)
            if (
              !off ||
              (off.handleYOffset === 0 && off.centerXOffset === 0) ||
              !e.data
            ) {
              return e
            }
            return {
              ...e,
              data: {
                ...e.data,
                bundleHandleYOffset: off.handleYOffset,
                bundleCenterXOffset: off.centerXOffset,
              },
            }
          },
        )
        return recalculateEdgesForDraggedNodes(
          withOffsets,
          updatedTableNodes,
          allMovedIds,
        )
      })

      // Step 3 — Stash payload BEFORE the await so Retry can re-submit
      // (Bundle offsets are UI-only; only node positions are persisted.)
      const payload: BulkPayload = {
        whiteboardId,
        positions: positions.map((p) => ({
          id: p.id,
          positionX: p.x,
          positionY: p.y,
        })),
      }
      lastPayloadRef.current = payload

      // Step 4 — Persist
      let result: unknown
      try {
        result = await updateTablePositionsBulk({ data: payload })
      } catch (persistErr) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!isMountedRef.current) return
        console.error('Auto Layout persist failed:', persistErr)
        setPersistError(persistErr)
        toast.error(
          'Auto Layout could not be saved — your changes are visible locally but not persisted.',
          {
            action: {
              label: 'Retry',
              onClick: () => {
                if (!isMountedRef.current) return
                if (!lastPayloadRef.current) return
                void handleRetry()
              },
            },
          },
        )
        return
        // No fitView on persist failure (PRD NFR Persistence — failure UX).
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!isMountedRef.current) return

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
        )
        // Step 7 — Re-fit subject areas around their (now-relaid-out) members
        // now that apply + persist has fully succeeded (GH #106 Bug 2 fix).
        // Pass the applied positions (area-autolayout-persistence-fix) so the
        // caller can also patch the query cache and refit from fresh data
        // instead of stale getNodes() state.
        onAfterLayout?.(positions)
      }
    } finally {
      if (isMountedRef.current) setIsRunning(false)
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
    handleRetry,
    onAfterLayout,
  ])

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
