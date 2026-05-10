// src/components/auth/AuthContext.tsx
// React context for auth state and session-expired modal trigger

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import { HTTP_UNAUTHORIZED, httpAuthEvents } from '@/lib/auth/http-events'

interface AuthContextValue {
  /** Whether the session-expired modal should be shown */
  sessionExpired: boolean
  /** Trigger the session-expired modal (called on 401 or WS session_expired event) */
  triggerSessionExpired: () => void
  /** Dismiss the session-expired modal */
  dismissSessionExpired: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

/**
 * AuthProvider wraps the app shell to provide auth state.
 * Mount this at root level so both HTTP 401 responses and WebSocket
 * session_expired events can trigger the modal.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [sessionExpired, setSessionExpired] = useState(false)

  const triggerSessionExpired = useCallback(() => {
    setSessionExpired(true)
  }, [])

  const dismissSessionExpired = useCallback(() => {
    setSessionExpired(false)
  }, [])

  // SEC-MODAL-03: listen for HTTP 401 events dispatched by the QueryClient
  // (via the event bus in http-events.ts). This bridges the architectural gap
  // where QueryClient wraps the full tree but AuthContext is nested inside it.
  useEffect(() => {
    const handler = () => triggerSessionExpired()
    httpAuthEvents.addEventListener(HTTP_UNAUTHORIZED, handler)
    return () => httpAuthEvents.removeEventListener(HTTP_UNAUTHORIZED, handler)
  }, [triggerSessionExpired])

  return (
    <AuthContext.Provider
      value={{ sessionExpired, triggerSessionExpired, dismissSessionExpired }}
    >
      {children}
    </AuthContext.Provider>
  )
}

/**
 * useAuthContext — access the auth context.
 * Must be used inside an AuthProvider.
 */
export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuthContext must be used within an AuthProvider')
  }
  return ctx
}
