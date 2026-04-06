import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// NOTE: 401 interception for mutations is handled via the beforeLoad auth guard
// in __root.tsx, which redirects to /login on session expiry. The SessionExpiredModal
// is triggered by the WebSocket session_expired event in use-whiteboard-collaboration.ts.
// Mutation-level 401 interception via QueryClient is not wired up here because
// AuthContext (required for triggerSessionExpired) is nested inside the route tree
// while the QueryClient Provider must wrap the entire tree. Any mutation returning
// 401 will result in stale data until the next navigation triggers beforeLoad.

export function getContext() {
  const queryClient = new QueryClient()
  return {
    queryClient,
  }
}

export function Provider({
  children,
  queryClient,
}: {
  children: React.ReactNode
  queryClient: QueryClient
}) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}
