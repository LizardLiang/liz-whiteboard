import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { HTTP_UNAUTHORIZED, httpAuthEvents } from '@/lib/auth/http-events'
import { isUnauthorizedError } from '@/lib/auth/errors'

// Fire HTTP_UNAUTHORIZED on the event bus when any query or mutation receives
// an HTTP 401 response — either as a thrown error (rejected promise) or as a
// resolved value carrying { error: 'UNAUTHORIZED', status: 401 }.
//
// Why both onError AND onSuccess:
//   requireAuth() in src/lib/auth/middleware.ts returns the 401 payload as a
//   RESOLVED value (not a throw). React Query's onError only fires on rejected
//   promises. onSuccess + isUnauthorizedError() catches the resolved-value path.
//   onError catches any future paths where the error IS thrown.

function isErrorWith401Status(error: unknown): boolean {
  if (error instanceof Error) {
    // TanStack Start server functions may throw errors with statusCode
    if (typeof (error as Record<string, unknown>).statusCode === 'number') {
      return (error as Record<string, unknown>).statusCode === 401
    }
    const msg = error.message.toLowerCase()
    if (msg.includes('unauthorized') || msg.includes('401')) {
      return true
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
      // Catches resolved-value 401s (requireAuth returns { error: 'UNAUTHORIZED', status: 401 })
      onSuccess: (data) => {
        if (isUnauthorizedError(data)) {
          dispatchUnauthorized()
        }
      },
      // Catches thrown 401s (future paths where requireAuth throws)
      onError: (error) => {
        if (isErrorWith401Status(error)) {
          dispatchUnauthorized()
        }
      },
    }),
    mutationCache: new MutationCache({
      // Catches resolved-value 401s
      onSuccess: (data) => {
        if (isUnauthorizedError(data)) {
          dispatchUnauthorized()
        }
      },
      // Catches thrown 401s
      onError: (error) => {
        if (isErrorWith401Status(error)) {
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
