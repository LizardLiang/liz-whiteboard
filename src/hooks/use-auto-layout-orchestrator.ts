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
import { isUnauthorizedError } from '@/lib/auth/errors'
import { useAuthContext } from '@/components/auth/AuthContext'
import { updateTablePositionsBulk } from '@/lib/server-functions'
import type { Node, Edge } from '@xyflow/react'
import type { LayoutOutputPosition } from '@/lib/auto-layout/d3-force-layout'

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
    nodes: Node[],
    edges: Edge[],
  ) => Promise<LayoutOutputPosition[] | null>
  /** Emits table:move:bulk after successful persistence */
  emitBulkPositionUpdate: (
    positions: Array<{ tableId: string; positionX: number; positionY: number }>,
  ) => void
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
}: UseAutoLayoutOrchestratorArgs): UseAutoLayoutOrchestratorResult {
  const { setNodes, getNodes, getEdges, fitView } = useReactFlow()
  const { triggerSessionExpired } = useAuthContext()

  const [isRunning, setIsRunning] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [persistError, setPersistError] = useState<unknown>(null)

  // Stash the last payload so handleRetry can re-submit without recomputing.
  const lastPayloadRef = useRef<BulkPayload | null>(null)

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
                  void handleRetry()
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (!isMountedRef.current) return // re-check after await

      const ok = handlePersistResult(result, lastPayloadRef.current.positions.length)
      if (ok) {
        // Re-emit the broadcast on successful retry.
        emitBulkPositionUpdate(
          lastPayloadRef.current.positions.map((p) => ({
            tableId: p.id,
            positionX: p.positionX,
            positionY: p.positionY,
          })),
        )
        if (isMountedRef.current) setPersistError(null)
      }
    } catch (err) {
      if (!isMountedRef.current) return
      setPersistError(err)
      toast.error('Auto Layout could not be saved on retry. Please try again.')
    }
  }, [emitBulkPositionUpdate, handlePersistResult])

  // ---------------------------------------------------------------------------
  // runLayout — the core flow
  // ---------------------------------------------------------------------------
  const runLayout = useCallback(async (): Promise<void> => {
    if (isMountedRef.current) setIsRunning(true)
    if (isMountedRef.current) setPersistError(null)

    try {
      // Step 1 — Compute layout (may return null on error)
      const positions = await runD3ForceLayout(getNodes(), getEdges())

      if (!isMountedRef.current) return
      if (!positions) {
        // runD3ForceLayout already sets error state on the hook and calls onLayoutError;
        // the orchestrator surfaces the user-facing toast here.
        toast.error('Auto Layout failed — please try again.')
        return
      }

      // Step 2 — Optimistic local apply (before network round-trip)
      setNodes((prev) =>
        prev.map((n) => {
          const p = positions.find((pp) => pp.id === n.id)
          return p ? { ...n, position: { x: p.x, y: p.y } } : n
        }),
      )

      // Step 3 — Stash payload BEFORE the await so Retry can re-submit
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
    handlePersistResult,
    emitBulkPositionUpdate,
    handleRetry,
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
