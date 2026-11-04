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
import { recalculateEdgeRouting } from '@/lib/react-flow/edge-bundles'
import { buildParentIndex, toRelative } from '@/lib/react-flow/node-nesting'
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
  ) => void
  /**
   * Called once after a layout run's optimistic apply + persist has
   * succeeded — used by ReactFlowWhiteboard to patch the React Query cache
   * (the source of truth that `ReactFlowCanvas` re-syncs `initialNodes`
   * from) and to adopt and broadcast the new area bounds. Not called on
   * layout error, persist failure, or auth error.
   *
   * Receives the applied table positions and the new area bounds (empty
   * when the board has no areas). Both use absolute coordinates.
   */
  onAfterLayout?: (
    positions: Array<{ id: string; x: number; y: number }>,
    areas: Array<AreaLayoutOutputArea>,
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
  onAfterLayout,
}: UseAutoLayoutOrchestratorArgs): UseAutoLayoutOrchestratorResult {
  const { setNodes, setEdges, getNodes, getEdges, fitView } = useReactFlow()
  const { triggerSessionExpired } = useAuthContext()
  const t = useT()

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
          toast.error(t('hooks.autoLayout.sessionExpired'), {
            action: {
              label: t('common.retry'),
              onClick: () => {
                if (!isMountedRef.current) return
                if (!lastPayloadRef.current) return
                void handleRetryRef.current()
              },
            },
          })
        }
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
          lastPayloadRef.current.areas ?? [],
        )
      }
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!isMountedRef.current) return
      setPersistError(err)
      toast.error(t('hooks.autoLayout.retryFailed'))
    }
  }, [emitBulkPositionUpdate, handlePersistResult, onAfterLayout, t])

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
      const relationshipEdgesOnly = getEdges().filter(
        (e): e is RelationshipEdgeType => e.type === 'relationship',
      )
      const areaInputs: Array<AreaLayoutInputArea> = currentNodes
        .filter(
          (n): n is AreaNodeType =>
            n.type === 'area' &&
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            (n as AreaNodeType).data?.area != null,
        )
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

      if (!isMountedRef.current) return
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
      const updatedNodes = applyBulkPositions(getNodes(), positions)
      let storeNodes: typeof updatedNodes = updatedNodes
      if (areaBounds.length > 0) {
        const boundsById = new Map(areaBounds.map((a) => [a.id, a]))
        const parentIndex = buildParentIndex(
          areaInputs.map((a) => {
            const b = boundsById.get(a.id)
            return b
              ? { ...a, positionX: b.positionX, positionY: b.positionY }
              : a
          }),
        )
        storeNodes = updatedNodes.map((n) => {
          if (n.type === 'area') {
            const b = boundsById.get(n.id)
            if (!b) return n
            const areaNode = n as AreaNodeType
            return {
              ...areaNode,
              position: { x: b.positionX, y: b.positionY },
              width: b.width,
              height: b.height,
              data: {
                ...areaNode.data,
                area: {
                  ...areaNode.data.area,
                  positionX: b.positionX,
                  positionY: b.positionY,
                  width: b.width,
                  height: b.height,
                },
              },
            }
          }
          const parent = parentIndex.get(n.id)
          if (!parent) return n
          return { ...n, position: toRelative(n.position, parent) }
        })
      }
      setNodes(storeNodes)
      // Edges only ever connect table and reference nodes (never area/comment
      // pins) — narrow for recalculateEdgeRouting below, which reads position
      // and size off each node. Reference nodes are routed like tables, as the
      // page-load path does, so an edge to one follows where the node now sits.
      const updatedTableNodes = updatedNodes.filter(
        (n): n is TableNodeType =>
          n.type === 'table' || n.type === 'externalTable',
      )
      const allMovedIds = new Set(positions.map((p) => p.id))

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

      // Step 3 — Stash payload BEFORE the await so Retry can re-submit
      // (Bundle offsets are UI-only; only node positions are persisted.)
      const payload: BulkPayload = {
        whiteboardId,
        positions: positions.map((p) => ({
          id: p.id,
          positionX: p.x,
          positionY: p.y,
        })),
        ...(areaBounds.length > 0 ? { areas: areaBounds } : {}),
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
        toast.error(t('hooks.autoLayout.notPersisted'), {
          action: {
            label: t('common.retry'),
            onClick: () => {
              if (!isMountedRef.current) return
              if (!lastPayloadRef.current) return
              void handleRetry()
            },
          },
        })
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
        // Step 7 — Hand the applied positions and area bounds to the caller
        // so it can patch the query cache and adopt/broadcast the new areas
        // (area-autolayout-persistence-fix).
        onAfterLayout?.(positions, areaBounds)
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
    t,
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
