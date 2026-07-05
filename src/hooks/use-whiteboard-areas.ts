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

type Emit = (event: string, data: any, ack?: (res: any) => void) => void
type On = (event: string, handler: (...args: Array<any>) => void) => void
type Off = (event: string, handler: (...args: Array<any>) => void) => void

interface AckResult {
  ok: boolean
  entity?: Area
  message?: string
}

export interface UseWhiteboardAreasReturn {
  areas: Array<Area>
  createArea: (input: Omit<CreateArea, 'whiteboardId'>) => void
  updateArea: (areaId: string, patch: UpdateArea) => void
  deleteArea: (areaId: string) => void
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
    if (data) setAreas(data)
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

  return { areas, createArea, updateArea, deleteArea }
}
