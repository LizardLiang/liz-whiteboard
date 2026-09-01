// src/hooks/use-whiteboard-shapes.ts
// Shape/connector client state, initial query, socket listeners, and acked
// mutations with rollback (D-4). Mirrors use-whiteboard-areas.ts in
// structure, but follows the `area:create` pattern for EVERY mutation, not
// `area:update`/`area:delete` (which are fire-and-forget and drop failures
// silently — do not copy that half of the precedent).
//
// §6a (public share links): on the public path, `enabled` is false (no
// query, no socket listeners) and state is seeded once from `publicData`
// instead — mirrors how `nodes`/`edges` already do this in
// ReactFlowWhiteboard.tsx.

import { useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Connector, Shape } from '@/data/models'
import type { ConnectorStyle, CreateShape, UpdateShape } from '@/data/schema'
import { getWhiteboardShapes } from '@/lib/server-functions'
import { isUnauthorizedError } from '@/lib/auth/errors'

type Emit = (event: string, data: any, ack?: (res: any) => void) => void
type On = (event: string, handler: (...args: Array<any>) => void) => void
type Off = (event: string, handler: (...args: Array<any>) => void) => void

interface AckResult<T> {
  ok: boolean
  entity?: T
  message?: string
}

export interface CreateConnectorInput {
  sourceShapeId: string
  targetShapeId: string
  style?: Partial<ConnectorStyle>
}

export interface UseWhiteboardShapesReturn {
  shapes: Array<Shape>
  connectors: Array<Connector>
  createShape: (
    input: Omit<CreateShape, 'whiteboardId'>,
    onCreated?: (shape: Shape) => void,
  ) => void
  updateShape: (shapeId: string, patch: UpdateShape) => void
  deleteShape: (shapeId: string) => void
  createConnector: (input: CreateConnectorInput) => void
  deleteConnector: (connectorId: string) => void
}

export function useWhiteboardShapes(params: {
  whiteboardId: string
  userId: string
  /** Query + socket listeners enabled — false on the public path. */
  enabled: boolean
  on: On
  off: Off
  emit: Emit
  isPublic?: boolean
  /** Pre-fetched shapes/connectors for the public path (§6a site 3). */
  publicData?: { shapes: Array<Shape>; connectors: Array<Connector> }
}): UseWhiteboardShapesReturn {
  const {
    whiteboardId,
    userId,
    enabled,
    on,
    off,
    emit,
    isPublic = false,
    publicData,
  } = params
  const [shapes, setShapes] = useState<Array<Shape>>([])
  const [connectors, setConnectors] = useState<Array<Connector>>([])

  // Public path: seed once from the prefetched data prop. No query, no
  // socket — collaborationEnabled={!isPublic} already means `enabled` is
  // false here, but the query below is additionally gated on `!isPublic`
  // explicitly so a stray true `enabled` on the public path can never fire
  // the authed (401-prone) query.
  useEffect(() => {
    if (!isPublic) return
    setShapes(publicData?.shapes ?? [])
    setConnectors(publicData?.connectors ?? [])
  }, [isPublic, publicData])

  const { data } = useQuery({
    queryKey: ['shapes', whiteboardId],
    queryFn: async () => getWhiteboardShapes({ data: whiteboardId }),
    staleTime: 1000 * 60 * 5,
    enabled: enabled && !isPublic,
  })

  useEffect(() => {
    if (isPublic) return
    if (data && !isUnauthorizedError(data)) {
      setShapes(data.shapes)
      setConnectors(data.connectors)
    }
  }, [data, isPublic])

  // Keep the `['shapes', whiteboardId]` query CACHE in sync with every
  // local mutation (create/update/delete, both own and collaborator), not
  // just the initial fetch above. Every mutation in this hook only ever
  // calls the local `setShapes`/`setConnectors` state setters — without
  // this, `queryClient.getQueryData(['shapes', whiteboardId])` (read
  // elsewhere, e.g. WhiteboardHistoryPanel's FR-035a live-count copy)
  // would stay frozen at whatever the board looked like on first load,
  // silently going stale the moment the user draws, edits, or deletes a
  // shape — found while verifying FR-035a's restore-confirmation counts.
  const queryClient = useQueryClient()
  useEffect(() => {
    if (isPublic) return
    queryClient.setQueryData(['shapes', whiteboardId], { shapes, connectors })
  }, [shapes, connectors, whiteboardId, isPublic, queryClient])

  // Live sync from other collaborators.
  useEffect(() => {
    if (!enabled || isPublic) return

    const onShapeCreated = (shape: Shape & { createdBy: string }) => {
      if (shape.createdBy === userId) return
      setShapes((prev) =>
        prev.some((s) => s.id === shape.id) ? prev : [...prev, shape],
      )
    }
    const onShapeUpdated = (
      patch: Partial<Shape> & { shapeId: string; updatedBy: string },
    ) => {
      if (patch.updatedBy === userId) return
      setShapes((prev) =>
        prev.map((s) => (s.id === patch.shapeId ? { ...s, ...patch } : s)),
      )
    }
    const onShapeDeleted = (payload: {
      shapeId: string
      connectorIds: Array<string>
      deletedBy: string
    }) => {
      if (payload.deletedBy === userId) return
      setShapes((prev) => prev.filter((s) => s.id !== payload.shapeId))
      setConnectors((prev) =>
        prev.filter((c) => !payload.connectorIds.includes(c.id)),
      )
    }
    const onConnectorCreated = (
      connector: Connector & { createdBy: string },
    ) => {
      if (connector.createdBy === userId) return
      setConnectors((prev) =>
        prev.some((c) => c.id === connector.id) ? prev : [...prev, connector],
      )
    }
    const onConnectorDeleted = (payload: {
      connectorId: string
      deletedBy: string
    }) => {
      if (payload.deletedBy === userId) return
      setConnectors((prev) => prev.filter((c) => c.id !== payload.connectorId))
    }

    on('shape:created', onShapeCreated)
    on('shape:updated', onShapeUpdated)
    on('shape:deleted', onShapeDeleted)
    on('connector:created', onConnectorCreated)
    on('connector:deleted', onConnectorDeleted)
    return () => {
      off('shape:created', onShapeCreated)
      off('shape:updated', onShapeUpdated)
      off('shape:deleted', onShapeDeleted)
      off('connector:created', onConnectorCreated)
      off('connector:deleted', onConnectorDeleted)
    }
  }, [enabled, isPublic, on, off, userId])

  // Create — waits for the server ack so we get the real id, then appends.
  // `onCreated` (optional) fires with the full server row on success — the
  // caller's only way to learn the real (server-generated) id, e.g. to
  // select the just-drawn shape (FR-005).
  const createShape = useCallback(
    (
      input: Omit<CreateShape, 'whiteboardId'>,
      onCreated?: (shape: Shape) => void,
    ) => {
      emit(
        'shape:create',
        { ...input, whiteboardId },
        (res: AckResult<Shape>) => {
          if (res.ok && res.entity) {
            const created = res.entity
            setShapes((prev) =>
              prev.some((s) => s.id === created.id) ? prev : [...prev, created],
            )
            onCreated?.(created)
          } else {
            toast.error(res.message ?? 'Failed to create shape')
          }
        },
      )
    },
    [emit, whiteboardId],
  )

  // Update — optimistic local merge, acked with rollback (D-4, NOT the
  // area:update fire-and-forget precedent).
  const updateShape = useCallback(
    (shapeId: string, patch: UpdateShape) => {
      let previous: Shape | undefined
      setShapes((prev) => {
        previous = prev.find((s) => s.id === shapeId)
        return prev.map((s) =>
          s.id === shapeId ? ({ ...s, ...patch } as Shape) : s,
        )
      })
      emit('shape:update', { shapeId, ...patch }, (res: AckResult<Shape>) => {
        if (!res.ok) {
          const snapshot = previous
          if (snapshot) {
            setShapes((prev) =>
              prev.map((s) => (s.id === shapeId ? snapshot : s)),
            )
          }
          toast.error(res.message ?? 'Failed to update shape')
        } else if (res.entity) {
          const updated = res.entity
          setShapes((prev) => prev.map((s) => (s.id === shapeId ? updated : s)))
        }
      })
    },
    [emit],
  )

  // Delete — optimistic remove (shape + its local connectors), acked with
  // rollback. The server performs the real atomic cascade (FR-018); this is
  // only the client-side optimistic mirror of that outcome.
  const deleteShape = useCallback(
    (shapeId: string) => {
      let previousShapes: Array<Shape> = []
      let previousConnectors: Array<Connector> = []
      setShapes((prev) => {
        previousShapes = prev
        return prev.filter((s) => s.id !== shapeId)
      })
      setConnectors((prev) => {
        previousConnectors = prev
        return prev.filter(
          (c) => c.sourceShapeId !== shapeId && c.targetShapeId !== shapeId,
        )
      })
      emit('shape:delete', { shapeId }, (res: AckResult<unknown>) => {
        if (!res.ok) {
          setShapes(previousShapes)
          setConnectors(previousConnectors)
          toast.error(res.message ?? 'Failed to delete shape')
        }
      })
    },
    [emit],
  )

  // Create connector — acked, appended on success.
  const createConnector = useCallback(
    (input: CreateConnectorInput) => {
      emit(
        'connector:create',
        { ...input, whiteboardId },
        (res: AckResult<Connector>) => {
          if (res.ok && res.entity) {
            const created = res.entity
            setConnectors((prev) =>
              prev.some((c) => c.id === created.id) ? prev : [...prev, created],
            )
          } else {
            toast.error(res.message ?? 'Failed to create connector')
          }
        },
      )
    },
    [emit, whiteboardId],
  )

  // Delete connector — optimistic remove, acked with rollback (M1).
  const deleteConnector = useCallback(
    (connectorId: string) => {
      let previous: Array<Connector> = []
      setConnectors((prev) => {
        previous = prev
        return prev.filter((c) => c.id !== connectorId)
      })
      emit('connector:delete', { connectorId }, (res: AckResult<unknown>) => {
        if (!res.ok) {
          setConnectors(previous)
          toast.error(res.message ?? 'Failed to delete connector')
        }
      })
    },
    [emit],
  )

  return {
    shapes,
    connectors,
    createShape,
    updateShape,
    deleteShape,
    createConnector,
    deleteConnector,
  }
}
