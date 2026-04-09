// src/hooks/use-whiteboard-collaboration.ts
// React Flow-specific WebSocket collaboration hook

import { useCallback, useEffect, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useAuthContext } from '@/components/auth/AuthContext'
import { useCollaboration } from './use-collaboration'
import type { TableErrorEvent } from './use-table-mutations'
import type { RelationshipErrorEvent } from './use-relationship-mutations'

/**
 * Position update event data from WebSocket
 */
export interface PositionUpdateEvent {
  tableId: string
  positionX: number
  positionY: number
  userId?: string
}

/**
 * useWhiteboardCollaboration hook - React Flow integration for real-time collaboration
 *
 * This hook integrates the base WebSocket collaboration with React Flow's state management.
 * It handles incoming position updates from other users and emits outgoing updates.
 *
 * @param whiteboardId - Whiteboard UUID to connect to
 * @param userId - Current user UUID for authentication
 * @param onPositionUpdate - Callback to update React Flow nodes when other users move tables
 * @returns Collaboration state and emit function
 *
 * @example
 * ```tsx
 * const { connectionState, emitPositionUpdate } = useWhiteboardCollaboration(
 *   whiteboardId,
 *   userId,
 *   (tableId, x, y) => {
 *     // Update React Flow nodes state
 *     setNodes((nds) =>
 *       nds.map((node) =>
 *         node.id === tableId ? { ...node, position: { x, y } } : node
 *       )
 *     )
 *   }
 * )
 * ```
 */
export function useWhiteboardCollaboration(
  whiteboardId: string,
  userId: string,
  onPositionUpdate: (
    tableId: string,
    positionX: number,
    positionY: number,
  ) => void,
  onTableDeleted?: (tableId: string) => void,
  onTableError?: (data: TableErrorEvent) => void,
  onRelationshipDeleted?: (relationshipId: string) => void,
  onRelationshipError?: (data: RelationshipErrorEvent) => void,
  onRelationshipUpdated?: (relationshipId: string, label: string) => void,
) {
  // Use the base collaboration hook
  const { triggerSessionExpired } = useAuthContext()
  const { emit, on, off, connectionState, activeUsers } = useCollaboration(
    whiteboardId,
    userId,
    triggerSessionExpired,
  )
  const router = useRouter()
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Listen for table position updates from other users
  useEffect(() => {
    const handlePositionUpdate = (data: PositionUpdateEvent) => {
      // Ignore updates from current user (already applied optimistically)
      if (data.userId === userId) return

      console.log('Position update from another user:', data)
      onPositionUpdate(data.tableId, data.positionX, data.positionY)
    }

    // Register event listeners
    on('table:moved', handlePositionUpdate)
    on('table:position-updated', handlePositionUpdate) // Support both event names

    // Cleanup on unmount
    return () => {
      off('table:moved', handlePositionUpdate)
      off('table:position-updated', handlePositionUpdate)
    }
  }, [on, off, userId, onPositionUpdate])

  // Listen for table deletion events from other users
  useEffect(() => {
    if (!onTableDeleted) return

    const handleTableDeleted = (data: {
      tableId: string
      deletedBy: string
    }) => {
      // Ignore if we deleted it (already applied optimistically)
      if (data.deletedBy === userId) return
      onTableDeleted(data.tableId)
    }

    on('table:deleted', handleTableDeleted)
    return () => {
      off('table:deleted', handleTableDeleted)
    }
  }, [on, off, userId, onTableDeleted])

  // Listen for table:delete error events
  useEffect(() => {
    if (!onTableError) return

    const handleError = (data: TableErrorEvent) => {
      // Only handle table:delete errors — column errors are handled by useColumnCollaboration
      if (data.event !== 'table:delete') return
      onTableError(data)
    }

    on('error', handleError)
    return () => {
      off('error', handleError)
    }
  }, [on, off, onTableError])

  // Listen for relationship deletion events from other users
  useEffect(() => {
    if (!onRelationshipDeleted) return

    const handleRelationshipDeleted = (data: {
      relationshipId: string
      deletedBy: string
    }) => {
      // Ignore if we deleted it (already applied optimistically)
      if (data.deletedBy === userId) return
      onRelationshipDeleted(data.relationshipId)
    }

    on('relationship:deleted', handleRelationshipDeleted)
    return () => {
      off('relationship:deleted', handleRelationshipDeleted)
    }
  }, [on, off, userId, onRelationshipDeleted])

  // Listen for relationship:delete error events
  useEffect(() => {
    if (!onRelationshipError) return

    const handleError = (data: RelationshipErrorEvent) => {
      // Only handle relationship:delete errors
      if (data.event !== 'relationship:delete') return
      onRelationshipError(data)
    }

    on('error', handleError)
    return () => {
      off('error', handleError)
    }
  }, [on, off, onRelationshipError])

  // Listen for relationship update events from other users
  useEffect(() => {
    if (!onRelationshipUpdated) return

    const handleRelationshipUpdated = (data: {
      relationshipId: string
      label: string
      updatedBy: string
    }) => {
      // Ignore if we updated it (already applied optimistically)
      if (data.updatedBy === userId) return
      onRelationshipUpdated(data.relationshipId, data.label)
    }

    on('relationship:updated', handleRelationshipUpdated)
    return () => {
      off('relationship:updated', handleRelationshipUpdated)
    }
  }, [on, off, userId, onRelationshipUpdated])

  // Handle permission_revoked event: show toast + redirect to project list
  useEffect(() => {
    const handlePermissionRevoked = (data: { projectId: string }) => {
      console.warn('Permission revoked for project:', data.projectId)
      toast.error('Your access to this project has been removed', {
        description: 'You will be redirected to the project list in 5 seconds.',
        duration: 5000,
      })
      redirectTimerRef.current = setTimeout(() => {
        router.navigate({ to: '/' })
      }, 5000)
    }

    on('permission_revoked', handlePermissionRevoked)
    return () => {
      off('permission_revoked', handlePermissionRevoked)
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current)
      }
    }
  }, [on, off, router])

  // Emit position update to other users
  const emitPositionUpdate = useCallback(
    (tableId: string, positionX: number, positionY: number) => {
      emit('table:move', {
        tableId,
        positionX,
        positionY,
        userId,
      })
    },
    [emit, userId],
  )

  // Emit table delete to server
  const emitTableDelete = useCallback(
    (tableId: string) => {
      emit('table:delete', { tableId })
    },
    [emit],
  )

  // Emit relationship delete to server
  const emitRelationshipDelete = useCallback(
    (relationshipId: string) => {
      emit('relationship:delete', { relationshipId })
    },
    [emit],
  )

  // Emit relationship label update to server
  const emitRelationshipUpdate = useCallback(
    (relationshipId: string, label: string) => {
      emit('relationship:update', { relationshipId, label })
    },
    [emit],
  )

  return {
    connectionState,
    activeUsers,
    emitPositionUpdate,
    emitTableDelete,
    emitRelationshipDelete,
    emitRelationshipUpdate,
  }
}
