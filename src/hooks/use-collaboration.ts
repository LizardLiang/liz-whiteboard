// src/hooks/use-collaboration.ts
// WebSocket connection hook for real-time collaboration

import { useCallback, useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import type { CursorPosition } from '@/data/schema'

/**
 * Active collaborator data
 */
export interface ActiveUser {
  userId: string
  cursor?: CursorPosition
  lastActivityAt: string
}

/**
 * Connection state
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected'

/**
 * Collaboration hook return value
 */
export interface UseCollaborationReturn {
  socket: Socket | null
  connectionState: ConnectionState
  sessionId: string | null
  activeUsers: Array<ActiveUser>
  isUnauthorized: boolean
  emit: (event: string, data: any, ack?: (res: any) => void) => void
  on: (event: string, handler: (...args: Array<any>) => void) => void
  off: (event: string, handler: (...args: Array<any>) => void) => void
  requestSync: () => void
}

/**
 * WebSocket connection hook for real-time collaboration
 * Connects to /whiteboard/:whiteboardId namespace with authentication
 * Handles reconnection logic automatically
 *
 * @param whiteboardId - Whiteboard UUID to connect to
 * @param userId - Current user UUID for authentication
 * @returns Collaboration state and event handlers
 *
 * @example
 * ```tsx
 * const { socket, connectionState, activeUsers, emit, on, off } = useCollaboration(
 *   whiteboardId,
 *   currentUserId
 * );
 *
 * // Listen for table creation
 * useEffect(() => {
 *   const handler = (table) => {
 *     console.log('Table created:', table);
 *   };
 *   on('table:created', handler);
 *   return () => off('table:created', handler);
 * }, [on, off]);
 *
 * // Emit table creation
 * const createTable = (name: string, x: number, y: number) => {
 *   emit('table:create', { name, positionX: x, positionY: y });
 * };
 * ```
 */
export function useCollaboration(
  whiteboardId: string,
  userId: string,
  onSessionExpired: () => void,
  enabled: boolean = true,
): UseCollaborationReturn {
  const socketRef = useRef<Socket | null>(null)
  const [connectionState, setConnectionState] =
    useState<ConnectionState>('disconnected')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [activeUsers, setActiveUsers] = useState<Array<ActiveUser>>([])
  const [isUnauthorized, setIsUnauthorized] = useState(false)

  // Reconnection settings
  const reconnectionAttempts = useRef(0)
  const maxReconnectionAttempts = 5

  // Socket lifecycle effect below intentionally keys off only
  // [whiteboardId, userId, enabled] — adding `onSessionExpired` directly
  // would tear down and reopen the socket connection whenever the caller
  // passes a new function reference (HIGH loop risk on every parent
  // re-render). Route the forward reference through a ref, kept current on
  // every render, so the effect's `session_expired` handler always calls the
  // latest callback without re-running the connect/disconnect lifecycle.
  const onSessionExpiredRef = useRef(onSessionExpired)
  onSessionExpiredRef.current = onSessionExpired

  useEffect(() => {
    // R1 (GH #109): public read-only share links (/share/$token) must never
    // open a Socket.IO connection — no read, no write, no presence. `enabled`
    // defaults to true for every existing authenticated caller; the public
    // whiteboard render path is the only caller that passes `false`.
    if (!whiteboardId || !enabled) {
      return
    }

    // Create socket connection
    // NOTE: auth.userId is kept for backwards compat with any client code that
    // reads it, but server-side auth now reads userId from the session cookie.
    // withCredentials ensures the session_token cookie is sent with the handshake.
    setConnectionState('connecting')
    // Reset from any prior connection's denial — otherwise switching to a
    // new whiteboardId the user DOES have access to stays stuck on the
    // access-denied state from the previous whiteboard.
    setIsUnauthorized(false)

    const socket = io(`/whiteboard/${whiteboardId}`, {
      auth: userId ? { userId } : undefined,
      withCredentials: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: maxReconnectionAttempts,
      transports: ['websocket', 'polling'],
    })

    socketRef.current = socket

    // Connection handlers
    socket.on('connect', () => {
      console.log('Connected to whiteboard collaboration')
      setConnectionState('connected')
      reconnectionAttempts.current = 0
    })

    socket.on(
      'connected',
      (data: { sessionId: string; activeUsers: Array<ActiveUser> }) => {
        console.log('Collaboration session established:', data.sessionId)
        setSessionId(data.sessionId)
        setActiveUsers(data.activeUsers)
      },
    )

    socket.on('disconnect', (reason) => {
      console.log('Disconnected from whiteboard:', reason)
      setConnectionState('disconnected')
      setSessionId(null)
    })

    socket.on('connect_error', (error) => {
      console.error('Connection error:', error)
      reconnectionAttempts.current += 1

      if (reconnectionAttempts.current >= maxReconnectionAttempts) {
        console.error('Max reconnection attempts reached')
        setConnectionState('disconnected')
      }
    })

    socket.on('reconnect', (attemptNumber) => {
      console.log(`Reconnected after ${attemptNumber} attempts`)
      setConnectionState('connected')
      reconnectionAttempts.current = 0

      // Request full state sync after reconnection
      socket.emit('sync:request')
    })

    socket.on('reconnect_failed', () => {
      console.error('Reconnection failed')
      setConnectionState('disconnected')
    })

    // Presence event handlers
    socket.on(
      'user:connected',
      (data: { userId: string; sessionId: string }) => {
        console.log('User connected:', data.userId)
        setActiveUsers((prev) => [
          ...prev,
          { userId: data.userId, lastActivityAt: new Date().toISOString() },
        ])
      },
    )

    socket.on('user:disconnected', (data: { userId: string }) => {
      console.log('User disconnected:', data.userId)
      setActiveUsers((prev) =>
        prev.filter((user) => user.userId !== data.userId),
      )
    })

    socket.on(
      'cursor:moved',
      (data: { userId: string; x: number; y: number }) => {
        setActiveUsers((prev) =>
          prev.map((user) =>
            user.userId === data.userId
              ? { ...user, cursor: { x: data.x, y: data.y } }
              : user,
          ),
        )
      },
    )

    // Layout event handlers
    socket.on('layout:compute', (data: { userId: string }) => {
      console.log('Layout computation started by user:', data.userId)
      // UI can show loading indicator
    })

    socket.on(
      'layout:computed',
      (data: {
        positions: Array<{ id: string; x: number; y: number }>
        userId: string
      }) => {
        console.log('Layout computed by user:', data.userId)
        // Positions will be applied via query invalidation
      },
    )

    // Session expired: server signals that the session token is no longer valid.
    // The onSessionExpired callback (if provided) will trigger the SessionExpiredModal.
    socket.on('session_expired', () => {
      console.warn('Session expired — WebSocket connection closed')
      setConnectionState('disconnected')
      try {
        onSessionExpiredRef.current()
      } catch {
        // TC-MODAL-04: if triggerSessionExpired throws, fall back to hard navigation
        // so the UI is never stuck in a broken state.
        if (typeof window !== 'undefined') {
          window.location.assign(
            `/login?redirect=${encodeURIComponent(window.location.pathname)}`,
          )
        }
      }
    })

    // Error handler
    socket.on(
      'error',
      (data: {
        event?: string
        error?: string
        code?: 'FORBIDDEN' | 'BATCH_DENIED'
        message: string
      }) => {
        if (data.code === 'BATCH_DENIED') {
          // SEC-BATCH-UX-02: route to banner state — the caller component handles
          // rendering; we log and let the component re-emit via its own error handler.
          console.warn(
            `[auth] BATCH_DENIED on event=${data.event ?? 'unknown'}:`,
            data.message,
          )
        } else if (data.code === 'FORBIDDEN') {
          // SEC-ERR-02: canonical auth denial — toast (components handle this via on/off).
          // When the denial happens on the initial namespace connection (rather than a
          // later gated event like table:create), the server also disconnects the socket
          // (see routes/api/collaboration.ts) — surface that as isUnauthorized so the
          // whiteboard route can render a friendly access-denied state instead of a
          // stuck "Connecting..." indicator.
          console.warn(`[auth] FORBIDDEN on event=${data.event ?? 'unknown'}`)
          if (data.event === 'connection') {
            setIsUnauthorized(true)
          }
        } else {
          // Legacy error shape (AD-5): non-auth errors keep existing logging
          console.error(
            `Collaboration error [${data.event ?? 'unknown'}]:`,
            data.message,
          )
        }
      },
    )

    // Heartbeat: emit every 2 minutes so the server's 5-minute stale-session
    // cleanup never deletes an active session while the tab is open.
    const heartbeatInterval = setInterval(
      () => {
        if (socket.connected) {
          socket.emit('activity:heartbeat', { action: 'heartbeat' })
        }
      },
      2 * 60 * 1000,
    )

    // Cleanup on unmount
    return () => {
      clearInterval(heartbeatInterval)
      console.log('Cleaning up collaboration connection')
      socket.removeAllListeners()
      socket.disconnect()
      socketRef.current = null
    }
  }, [whiteboardId, userId, enabled])

  // Emit event to server. An optional ack callback receives the server's
  // acknowledgement (Socket.IO ack) — used by callers that need the persisted
  // entity back (e.g. area:create returns the new area with its real id).
  const emit = useCallback(
    (event: string, data: any, ack?: (res: any) => void) => {
      if (socketRef.current && socketRef.current.connected) {
        if (ack) socketRef.current.emit(event, data, ack)
        else socketRef.current.emit(event, data)
      } else {
        console.warn(`Cannot emit ${event}: socket not connected`)
      }
    },
    [],
  )

  // Listen for event from server
  const on = useCallback(
    (event: string, handler: (...args: Array<any>) => void) => {
      if (socketRef.current) {
        socketRef.current.on(event, handler)
      }
    },
    [],
  )

  // Remove event listener
  const off = useCallback(
    (event: string, handler: (...args: Array<any>) => void) => {
      if (socketRef.current) {
        socketRef.current.off(event, handler)
      }
    },
    [],
  )

  // Request full state sync from server
  const requestSync = useCallback(() => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('sync:request')
    }
  }, [])

  return {
    socket: socketRef.current,
    connectionState,
    sessionId,
    activeUsers,
    isUnauthorized,
    emit,
    on,
    off,
    requestSync,
  }
}

/**
 * Throttle function for cursor updates (60Hz = 16ms)
 * @param func - Function to throttle
 * @param delay - Delay in milliseconds
 * @returns Throttled function
 */
export function throttle<T extends (...args: Array<any>) => void>(
  func: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let lastCall = 0
  let timeoutId: NodeJS.Timeout | null = null

  return function (...args: Parameters<T>) {
    const now = Date.now()
    const timeSinceLastCall = now - lastCall

    if (timeSinceLastCall >= delay) {
      lastCall = now
      func(...args)
    } else {
      // Schedule call at the end of delay period
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      timeoutId = setTimeout(() => {
        lastCall = Date.now()
        func(...args)
      }, delay - timeSinceLastCall)
    }
  }
}

/**
 * Debounce function for text updates (500ms)
 * @param func - Function to debounce
 * @param delay - Delay in milliseconds
 * @returns Debounced function
 */
export function debounce<T extends (...args: Array<any>) => void>(
  func: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null

  return function (...args: Parameters<T>) {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      func(...args)
    }, delay)
  }
}
