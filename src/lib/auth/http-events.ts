// src/lib/auth/http-events.ts
// Module-level event bus that bridges the HTTP layer (QueryClient, fetch)
// with AuthContext (which lives inside the React route tree).
//
// The architectural problem: QueryClient wraps the entire app tree but
// AuthContext is nested *inside* the route tree. The QueryClient's onError
// callback cannot reach AuthContext directly.
//
// Solution: a module-level EventTarget that both layers can import. When a
// server function returns an HTTP 401, the QueryClient fires HTTP_UNAUTHORIZED
// on this bus. AuthContext listens and calls triggerSessionExpired().

/** Shared event bus for HTTP-layer auth events */
export const httpAuthEvents = new EventTarget()

/** Event name dispatched when any server function returns HTTP 401 */
export const HTTP_UNAUTHORIZED = 'http:unauthorized'
