/**
 * useColumnCollaboration — column WebSocket event listeners + emitters
 *
 * Listens for column:created, column:updated, column:deleted, and error events.
 * Exposes emitColumnCreate, emitColumnUpdate, emitColumnDelete.
 * Ignores events from current user (already applied optimistically).
 *
 * This hook is the sole persistence path for column mutations.
 */

import { useCallback, useEffect, useRef } from 'react'
import { useCollaboration } from './use-collaboration'
import type { Column } from '@prisma/client'
import type { DataType, UpdateColumn } from '@/data/schema'

export interface ColumnCreatedEvent extends Column {
  createdBy: string
}

export interface ColumnUpdatedEvent {
  columnId: string
  tableId: string
  updatedBy: string
  [key: string]: any
}

export interface ColumnDeletedEvent {
  columnId: string
  tableId: string
  deletedBy: string
}

export interface ColumnErrorEvent {
  event: string
  error: string
  message: string
  columnId?: string
  tableId?: string
  name?: string
}

export interface UseColumnCollaborationCallbacks {
  onColumnCreated: (column: ColumnCreatedEvent) => void
  onColumnUpdated: (data: ColumnUpdatedEvent) => void
  onColumnDeleted: (data: ColumnDeletedEvent) => void
  onColumnError: (data: ColumnErrorEvent) => void
  /**
   * Called when the server confirms a column:create emitted by this user.
   * Provides the real DB column (with permanent ID) so the client can
   * replace any optimistic temp ID it inserted locally.
   */
  onOwnColumnCreated?: (column: ColumnCreatedEvent) => void
  /**
   * Called when the WebSocket reconnects after a disconnection.
   * The consumer should re-fetch server state to discard any stale
   * optimistic updates that were not confirmed before the disconnect.
   */
  onReconnect?: () => void
}

export function useColumnCollaboration(
  whiteboardId: string,
  userId: string,
  callbacks: UseColumnCollaborationCallbacks,
) {
  const { emit, on, off, connectionState } = useCollaboration(
    whiteboardId,
    userId,
  )

  const isConnected = connectionState === 'connected'

  // Store callbacks in a ref so the listener effect does not need to re-run
  // every time the callbacks object changes identity (e.g. on each render of
  // the parent component). The ref is always kept up-to-date so handlers
  // always call the latest version of each callback.
  const callbacksRef = useRef(callbacks)
  useEffect(() => {
    callbacksRef.current = callbacks
  })

  // Track whether we have connected at least once so we can distinguish
  // the initial connect from a reconnect for the onReconnect callback.
  const hasConnectedRef = useRef(false)

  // Register event listeners — depends only on stable values (on, off, userId)
  // so listeners are only torn down and re-registered on mount/unmount or when
  // the socket instance or userId changes, not on every render.
  useEffect(() => {
    const handleCreated = (data: ColumnCreatedEvent) => {
      if (data.createdBy === userId) {
        // This is the server confirmation for our own create.
        // Notify the consumer so it can replace the optimistic temp ID
        // with the real database ID.
        callbacksRef.current.onOwnColumnCreated?.(data)
        return
      }
      callbacksRef.current.onColumnCreated(data)
    }

    const handleUpdated = (data: ColumnUpdatedEvent) => {
      if (data.updatedBy === userId) return
      callbacksRef.current.onColumnUpdated(data)
    }

    const handleDeleted = (data: ColumnDeletedEvent) => {
      if (data.deletedBy === userId) return
      callbacksRef.current.onColumnDeleted(data)
    }

    const handleError = (data: ColumnErrorEvent) => {
      // Only handle column-related errors
      if (
        data.event === 'column:create' ||
        data.event === 'column:update' ||
        data.event === 'column:delete'
      ) {
        callbacksRef.current.onColumnError(data)
      }
    }

    // On reconnect, trigger a state refresh so stale optimistic updates
    // that were not confirmed before the disconnect are replaced with
    // authoritative server data.
    const handleConnect = () => {
      if (hasConnectedRef.current) {
        // This is a reconnect — call the optional refresh callback
        callbacksRef.current.onReconnect?.()
      } else {
        hasConnectedRef.current = true
      }
    }

    on('column:created', handleCreated)
    on('column:updated', handleUpdated)
    on('column:deleted', handleDeleted)
    on('error', handleError)
    on('connect', handleConnect)

    return () => {
      off('column:created', handleCreated)
      off('column:updated', handleUpdated)
      off('column:deleted', handleDeleted)
      off('error', handleError)
      off('connect', handleConnect)
    }
  }, [on, off, userId])

  const emitColumnCreate = useCallback(
    (data: {
      tableId: string
      name: string
      dataType: DataType
      order: number
      isPrimaryKey?: boolean
      isForeignKey?: boolean
      isUnique?: boolean
      isNullable?: boolean
    }) => {
      if (!isConnected) {
        console.warn('Cannot emit column:create: not connected')
        return
      }
      emit('column:create', data)
    },
    [emit, isConnected],
  )

  const emitColumnUpdate = useCallback(
    (columnId: string, data: Partial<UpdateColumn>) => {
      if (!isConnected) {
        console.warn('Cannot emit column:update: not connected')
        return
      }
      emit('column:update', { columnId, ...data })
    },
    [emit, isConnected],
  )

  const emitColumnDelete = useCallback(
    (columnId: string) => {
      if (!isConnected) {
        console.warn('Cannot emit column:delete: not connected')
        return
      }
      emit('column:delete', { columnId })
    },
    [emit, isConnected],
  )

  return {
    emitColumnCreate,
    emitColumnUpdate,
    emitColumnDelete,
    isConnected,
    connectionState,
  }
}
