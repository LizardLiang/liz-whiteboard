// src/lib/auth/middleware.test.ts
// Unit tests for requireAuth HOF wrapper (TC-P3-01 through TC-P3-02)

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getSessionFromCookie } from './cookies'
import {
  isForbiddenError,
  isUnauthorizedError,
  requireAuth,
} from './middleware'

// Mock the TanStack Start server request context
vi.mock('@tanstack/react-start/server', () => ({
  getRequest: vi.fn(() => new Request('http://localhost/')),
}))

// Mock getSessionFromCookie used by the middleware
vi.mock('./cookies', () => ({
  getSessionFromCookie: vi.fn(),
}))

const mockUser = {
  id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  username: 'alice',
  email: 'alice@example.com',
}

const mockSession = {
  id: 'session-id',
  tokenHash: 'hash',
  userId: mockUser.id,
  expiresAt: new Date(Date.now() + 86400000),
  createdAt: new Date(),
}

describe('requireAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // TC-P3-01: returns 401 for missing session
  it('TC-P3-01: returns UNAUTHORIZED when session is missing', async () => {
    vi.mocked(getSessionFromCookie).mockResolvedValue(null)

    const innerHandler = vi.fn()
    const wrappedHandler = requireAuth(innerHandler)

    const result = await wrappedHandler({ data: undefined })

    expect(result).toEqual({ error: 'UNAUTHORIZED', status: 401 })
    expect(innerHandler).not.toHaveBeenCalled()
  })

  // TC-P3-02: passes user and session to handler for valid session
  it('TC-P3-02: passes user and session to handler when session is valid', async () => {
    vi.mocked(getSessionFromCookie).mockResolvedValue({
      user: mockUser as any,
      session: mockSession as any,
    })

    const capturedCtx: Array<any> = []
    const innerHandler = vi.fn().mockImplementation(async (ctx: any) => {
      capturedCtx.push(ctx)
      return { success: true }
    })
    const wrappedHandler = requireAuth(innerHandler)

    const result = await wrappedHandler({ data: { someInput: 'value' } })

    expect(innerHandler).toHaveBeenCalledOnce()
    expect(capturedCtx[0]).toMatchObject({
      user: expect.objectContaining({ id: mockUser.id }),
      session: expect.objectContaining({ id: 'session-id' }),
    })
    expect(result).toEqual({ success: true })
  })
})

describe('isUnauthorizedError', () => {
  it('returns true for { error: "UNAUTHORIZED", status: 401 }', () => {
    expect(isUnauthorizedError({ error: 'UNAUTHORIZED', status: 401 })).toBe(
      true,
    )
  })

  it('returns false for normal result objects', () => {
    expect(isUnauthorizedError({ id: '123', name: 'test' })).toBe(false)
  })

  it('returns false for null', () => {
    expect(isUnauthorizedError(null)).toBe(false)
  })

  it('returns false for objects with different error values', () => {
    expect(isUnauthorizedError({ error: 'FORBIDDEN', status: 403 })).toBe(false)
  })
})

describe('isForbiddenError', () => {
  it('returns true for { error: "FORBIDDEN", status: 403 }', () => {
    expect(
      isForbiddenError({
        error: 'FORBIDDEN',
        status: 403,
        message: 'No access',
      }),
    ).toBe(true)
  })

  it('returns false for unauthorized errors', () => {
    expect(isForbiddenError({ error: 'UNAUTHORIZED', status: 401 })).toBe(false)
  })

  it('returns false for null', () => {
    expect(isForbiddenError(null)).toBe(false)
  })
})
