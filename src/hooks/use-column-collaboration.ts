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

  // Track whether we have connected at least once so we can distinguish
  // the initial connect from a reconnect for the onReconnect callback.
  const hasConnectedRef = useRef(false)

  // Register event listeners
  useEffect(() => {
    const handleCreated = (data: ColumnCreatedEvent) => {
      // Ignore events from the current user (already applied optimistically)
      if (data.createdBy === userId) return
      callbacks.onColumnCreated(data)
    }

    const handleUpdated = (data: ColumnUpdatedEvent) => {
      if (data.updatedBy === userId) return
      callbacks.onColumnUpdated(data)
    }

    const handleDeleted = (data: ColumnDeletedEvent) => {
      if (data.deletedBy === userId) return
      callbacks.onColumnDeleted(data)
    }

    const handleError = (data: ColumnErrorEvent) => {
      // Only handle column-related errors
      if (
        data.event === 'column:create' ||
        data.event === 'column:update' ||
        data.event === 'column:delete'
      ) {
        callbacks.onColumnError(data)
      }
    }

    // On reconnect, trigger a state refresh so stale optimistic updates
    // that were not confirmed before the disconnect are replaced with
    // authoritative server data.
    const handleConnect = () => {
      if (hasConnectedRef.current) {
        // This is a reconnect — call the optional refresh callback
        callbacks.onReconnect?.()
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
  }, [on, off, userId, callbacks])

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
