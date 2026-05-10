// src/integrations/tanstack-query/root-provider.test.ts
// TC-HTTP401-01 / TC-HTTP401-02
// Verify that the QueryClient onSuccess interceptor fires HTTP_UNAUTHORIZED
// when a queryFn (or mutationFn) resolves { error: 'UNAUTHORIZED', status: 401 }.
//
// This tests the REAL interceptor path — not manual event dispatch.
// requireAuth() returns the 401 payload as a resolved value, not a thrown error,
// so onError cannot catch it. The onSuccess branch is the production code path.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getContext } from './root-provider'
import { HTTP_UNAUTHORIZED, httpAuthEvents } from '@/lib/auth/http-events'

describe('TC-HTTP401-01: QueryClient onSuccess fires HTTP_UNAUTHORIZED on resolved 401', () => {
  let listener: () => void
  let fired: boolean

  beforeEach(() => {
    fired = false
    listener = () => {
      fired = true
    }
    httpAuthEvents.addEventListener(HTTP_UNAUTHORIZED, listener)
  })

  afterEach(() => {
    httpAuthEvents.removeEventListener(HTTP_UNAUTHORIZED, listener)
  })

  it('dispatches HTTP_UNAUTHORIZED when a query resolves { error: "UNAUTHORIZED", status: 401 }', async () => {
    const { queryClient } = getContext()

    // Simulate requireAuth returning a resolved 401 payload (the production code path)
    await queryClient.fetchQuery({
      queryKey: ['test-401-query'],
      queryFn: async () => ({
        error: 'UNAUTHORIZED' as const,
        status: 401 as const,
      }),
      retry: false,
    })

    expect(fired).toBe(true)

    queryClient.clear()
  })
})

describe('TC-HTTP401-02: MutationCache onSuccess fires HTTP_UNAUTHORIZED on resolved 401', () => {
  let listener: () => void
  let fired: boolean

  beforeEach(() => {
    fired = false
    listener = () => {
      fired = true
    }
    httpAuthEvents.addEventListener(HTTP_UNAUTHORIZED, listener)
  })

  afterEach(() => {
    httpAuthEvents.removeEventListener(HTTP_UNAUTHORIZED, listener)
  })

  it('dispatches HTTP_UNAUTHORIZED when a mutation resolves { error: "UNAUTHORIZED", status: 401 }', async () => {
    const { queryClient } = getContext()

    // Simulate a mutation (server function) returning a resolved 401 payload
    await queryClient
      .getMutationCache()
      .build(queryClient, {
        mutationFn: async () => ({
          error: 'UNAUTHORIZED' as const,
          status: 401 as const,
        }),
        retry: false,
      })
      .execute(undefined)

    expect(fired).toBe(true)

    queryClient.clear()
  })
})

describe('TC-HTTP401-03: HTTP_UNAUTHORIZED listener cleanup prevents double-fire', () => {
  it('removing listener prevents subsequent events from being received', async () => {
    let fireCount = 0
    const listener = () => {
      fireCount++
    }

    httpAuthEvents.addEventListener(HTTP_UNAUTHORIZED, listener)
    httpAuthEvents.dispatchEvent(new Event(HTTP_UNAUTHORIZED))
    expect(fireCount).toBe(1)

    httpAuthEvents.removeEventListener(HTTP_UNAUTHORIZED, listener)
    httpAuthEvents.dispatchEvent(new Event(HTTP_UNAUTHORIZED))
    expect(fireCount).toBe(1) // no increase after removal
  })
})
