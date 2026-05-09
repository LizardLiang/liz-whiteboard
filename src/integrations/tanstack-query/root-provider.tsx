import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HTTP_UNAUTHORIZED, httpAuthEvents } from '@/lib/auth/http-events'

// Fire HTTP_UNAUTHORIZED on the event bus when any query or mutation receives
// an HTTP 401 error. AuthContext listens to this event and calls
// triggerSessionExpired() so the SessionExpiredModal appears.
function isUnauthorizedError(error: unknown): boolean {
  if (error instanceof Error) {
    // TanStack Start server functions throw errors whose message includes the
    // status code, e.g. "Unauthorized" or contain a statusCode field.
    const msg = error.message.toLowerCase()
    if (msg.includes('unauthorized') || msg.includes('401')) {
      return true
    }
    // Check statusCode property on the error (set by some server fn wrappers)
    if (typeof (error as Record<string, unknown>).statusCode === 'number') {
      return (error as Record<string, unknown>).statusCode === 401
    }
  }
  return false
}

function dispatchUnauthorized() {
  httpAuthEvents.dispatchEvent(new Event(HTTP_UNAUTHORIZED))
}

export function getContext() {
  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        if (isUnauthorizedError(error)) {
          dispatchUnauthorized()
        }
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        if (isUnauthorizedError(error)) {
          dispatchUnauthorized()
        }
      },
    }),
  })
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
