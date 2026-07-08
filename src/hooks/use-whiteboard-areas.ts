// src/hooks/use-whiteboard-areas.ts
// Subject-area state + realtime CRUD (GH #106). Consumes the generic socket
// primitives (on/off/emit) from useWhiteboardCollaboration so it shares the
// single whiteboard connection. Areas are loaded once via getWhiteboardAreas
// and then kept live through area:created/updated/deleted events.

import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Area } from '@/data/models'
import type { CreateArea, UpdateArea } from '@/data/schema'
import { getWhiteboardAreas } from '@/lib/server-functions'
import { isUnauthorizedError } from '@/lib/auth/errors'

type Emit = (event: string, data: any, ack?: (res: any) => void) => void
type On = (event: string, handler: (...args: Array<any>) => void) => void
type Off = (event: string, handler: (...args: Array<any>) => void) => void

interface AckResult {
  ok: boolean
  entity?: Area
  message?: string
}

/**
 * Ack payload for the area:move atomic-drag event (area-atomic-move fix).
 * Mirrors the server's MoveAckResult (src/routes/api/collaboration.ts) — the
 * success case carries no `entity` since the move was already applied
 * optimistically during the drag.
 */
export interface MoveAreaAckResult {
  ok: boolean
  code?: string
  message?: string
}

export interface UseWhiteboardAreasReturn {
  areas: Array<Area>
  createArea: (input: Omit<CreateArea, 'whiteboardId'>) => void
  updateArea: (areaId: string, patch: UpdateArea) => void
  deleteArea: (areaId: string) => void
  /**
   * Atomically move an area + its member tables (area-atomic-move fix).
   * Does NOT apply any local state itself — the caller has already applied
   * the optimistic move (React Flow's own drag-preview state + the caller's
   * own setNodes/applyRemoteAreaMove calls). This only emits the request and
   * forwards the server ack to `onResult` so the caller can roll back on
   * failure.
   */
  moveArea: (
    areaId: string,
    position: { positionX: number; positionY: number },
    members: Array<{ tableId: string; positionX: number; positionY: number }>,
    onResult?: (res: MoveAreaAckResult) => void,
  ) => void
  /**
   * Merge a remote (or local-optimistic) area position into `areas` state.
   * No emit — pure state update. Used both to apply an incoming peer
   * `area:moved` broadcast and for the local optimistic apply during a drag.
   */
  applyRemoteAreaMove: (
    areaId: string,
    position: { positionX: number; positionY: number },
  ) => void
}

export function useWhiteboardAreas(params: {
  whiteboardId: string
  userId: string
  enabled: boolean
  on: On
  off: Off
  emit: Emit
}): UseWhiteboardAreasReturn {
  const { whiteboardId, userId, enabled, on, off, emit } = params
  const [areas, setAreas] = useState<Array<Area>>([])

  // Initial load — disabled on the public read-only path (getWhiteboardAreas is
  // requireAuth-gated, mirroring the tables/relationships queries).
  const { data } = useQuery({
    queryKey: ['areas', whiteboardId],
    queryFn: async () => getWhiteboardAreas({ data: whiteboardId }),
    staleTime: 1000 * 60 * 5,
    enabled,
  })

  useEffect(() => {
    // Session expired — root-provider's global handler surfaces the
    // session-expired modal; nothing to reconcile locally.
    if (data && !isUnauthorizedError(data)) setAreas(data)
  }, [data])

  // Live sync from other collaborators.
  useEffect(() => {
    if (!enabled) return

    const onCreated = (area: Area & { createdBy: string }) => {
      if (area.createdBy === userId) return
      setAreas((prev) =>
        prev.some((a) => a.id === area.id) ? prev : [...prev, area],
      )
    }
    const onUpdated = (
      patch: Partial<Area> & { areaId: string; updatedBy: string },
    ) => {
      if (patch.updatedBy === userId) return
      setAreas((prev) =>
        prev.map((a) => (a.id === patch.areaId ? { ...a, ...patch } : a)),
      )
    }
    const onDeleted = (payload: { areaId: string; deletedBy: string }) => {
      if (payload.deletedBy === userId) return
      setAreas((prev) => prev.filter((a) => a.id !== payload.areaId))
    }

    on('area:created', onCreated)
    on('area:updated', onUpdated)
    on('area:deleted', onDeleted)
    return () => {
      off('area:created', onCreated)
      off('area:updated', onUpdated)
      off('area:deleted', onDeleted)
    }
  }, [enabled, on, off, userId])

  // Create — waits for the server ack so we get the real id, then appends.
  const createArea = useCallback(
    (input: Omit<CreateArea, 'whiteboardId'>) => {
      emit('area:create', { ...input, whiteboardId }, (res: AckResult) => {
        if (res.ok && res.entity) {
          const created = res.entity
          setAreas((prev) =>
            prev.some((a) => a.id === created.id) ? prev : [...prev, created],
          )
        } else {
          toast.error(res.message ?? 'Failed to create area')
        }
      })
    },
    [emit, whiteboardId],
  )

  // Update — optimistic local merge, then emit.
  const updateArea = useCallback(
    (areaId: string, patch: UpdateArea) => {
      setAreas((prev) =>
        prev.map((a) => (a.id === areaId ? { ...a, ...patch } : a)),
      )
      emit('area:update', { areaId, ...patch })
    },
    [emit],
  )

  // Delete — optimistic remove, then emit.
  const deleteArea = useCallback(
    (areaId: string) => {
      setAreas((prev) => prev.filter((a) => a.id !== areaId))
      emit('area:delete', { areaId })
    },
    [emit],
  )

  // Merge a position into `areas` state only — no emit. Shared by the local
  // optimistic apply (drag) and the remote area:moved listener (peer apply).
  const applyRemoteAreaMove = useCallback(
    (areaId: string, position: { positionX: number; positionY: number }) => {
      setAreas((prev) =>
        prev.map((a) => (a.id === areaId ? { ...a, ...position } : a)),
      )
    },
    [],
  )

  // Atomic move (area-atomic-move fix) — area position + member positions
  // persist server-side in one transaction and rebroadcast as one
  // area:moved event. This function only emits + forwards the ack; the
  // caller owns the optimistic apply and any failure rollback (it needs
  // access to React Flow's setNodes, which this hook does not have).
  const moveArea = useCallback(
    (
      areaId: string,
      position: { positionX: number; positionY: number },
      members: Array<{
        tableId: string
        positionX: number
        positionY: number
      }>,
      onResult?: (res: MoveAreaAckResult) => void,
    ) => {
      emit(
        'area:move',
        { areaId, ...position, members },
        (res: MoveAreaAckResult) => {
          onResult?.(res)
        },
      )
    },
    [emit],
  )

  return {
    areas,
    createArea,
    updateArea,
    deleteArea,
    moveArea,
    applyRemoteAreaMove,
  }
}
