import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthContext } from '@/components/auth/AuthContext'
import { isUnauthorizedError } from '@/lib/auth/middleware'

/**
 * Check if a thrown error or returned value represents a 401 Unauthorized.
 */
function check401(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  return isUnauthorizedError(value)
}

/**
 * Build a QueryClient with global 401 interception.
 * On any query or mutation that returns/throws a 401, the SessionExpiredModal
 * is triggered via AuthContext.
 */
function buildQueryClient(onUnauthorized: () => void): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          if (check401(error)) return false
          return failureCount < 3
        },
        throwOnError: false,
      },
      mutations: {
        onError: (error) => {
          if (check401(error)) {
            onUnauthorized()
          }
        },
        onSuccess: (data) => {
          if (check401(data)) {
            onUnauthorized()
          }
        },
      },
    },
  })
}

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

/**
 * AuthAwareQueryProvider wraps children with a QueryClient that triggers
 * the SessionExpiredModal on 401 responses.
 * Use this instead of Provider when AuthContext is available.
 */
export function AuthAwareQueryProvider({
  children,
  queryClient: externalClient,
}: {
  children: React.ReactNode
  queryClient?: QueryClient
}) {
  const { triggerSessionExpired } = useAuthContext()
  const client = externalClient ?? buildQueryClient(triggerSessionExpired)

  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}
