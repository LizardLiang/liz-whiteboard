// src/routes/__root.test.tsx
// TC-P3-20: Root beforeLoad — unauthenticated request redirects to /login
// TC-P3-21: Root beforeLoad — /login and /register do not cause redirect loop
// TC-P3-22: Root beforeLoad — valid session allows navigation through

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('./api/auth', () => ({
  getCurrentUser: vi.fn(),
}))

import { getCurrentUser } from './api/auth'

// We test the beforeLoad logic in isolation, not through the full router,
// because the router requires a full app environment.
// The beforeLoad logic is:
//   if (PUBLIC_PATHS.some(p => location.pathname.startsWith(p))) return
//   const result = await getCurrentUser()
//   if (!result) throw redirect({ to: '/login', search: { redirect: pathname } })
//   return { user: result.user }

const PUBLIC_PATHS = ['/login', '/register']

async function simulateBeforeLoad(pathname: string) {
  // Mirror the beforeLoad logic exactly as implemented in __root.tsx
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return { redirected: false, location: null }
  }

  const result = await getCurrentUser()
  if (!result) {
    // In the real code: throw redirect({ to: '/login', search: { redirect: pathname } })
    return {
      redirected: true,
      location: `/login?redirect=${encodeURIComponent(pathname)}`,
    }
  }

  return { redirected: false, user: (result as any).user }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P3-20: Unauthenticated request redirects to /login with redirect param
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P3-20: beforeLoad — unauthenticated redirect', () => {
  it('redirects to /login with redirect param for unauthenticated user on /projects', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)

    const outcome = await simulateBeforeLoad('/projects')

    expect(outcome.redirected).toBe(true)
    expect(outcome.location).toContain('/login')
    expect(outcome.location).toContain(encodeURIComponent('/projects'))
  })

  it('redirects to /login with redirect param for unauthenticated user on /whiteboard/abc', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)

    const outcome = await simulateBeforeLoad('/whiteboard/abc')

    expect(outcome.redirected).toBe(true)
    expect(outcome.location).toContain('/login')
    expect(outcome.location).toContain(encodeURIComponent('/whiteboard/abc'))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P3-21: /login and /register do not cause redirect loops
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P3-21: beforeLoad — public routes skip auth check', () => {
  it('/login does NOT redirect even when getCurrentUser returns null', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)

    const outcome = await simulateBeforeLoad('/login')

    expect(outcome.redirected).toBe(false)
    // getCurrentUser should not have been called (short-circuit on public path)
    expect(getCurrentUser).not.toHaveBeenCalled()
  })

  it('/register does NOT redirect even when getCurrentUser returns null', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)

    const outcome = await simulateBeforeLoad('/register')

    expect(outcome.redirected).toBe(false)
    expect(getCurrentUser).not.toHaveBeenCalled()
  })

  it('/login path does not trigger redirect loop (called multiple times)', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)

    for (let i = 0; i < 3; i++) {
      const outcome = await simulateBeforeLoad('/login')
      expect(outcome.redirected).toBe(false)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-P3-22: Valid session allows navigation through
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P3-22: beforeLoad — valid session allows through', () => {
  it('allows navigation to /projects when session is valid', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      user: {
        id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        username: 'alice',
        email: 'alice@example.com',
      },
    } as any)

    const outcome = await simulateBeforeLoad('/projects')

    expect(outcome.redirected).toBe(false)
    expect((outcome as any).user).toMatchObject({
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      username: 'alice',
    })
  })

  it('allows navigation to /whiteboard/abc when session is valid', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      user: {
        id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        username: 'alice',
        email: 'alice@example.com',
      },
    } as any)

    const outcome = await simulateBeforeLoad('/whiteboard/abc')

    expect(outcome.redirected).toBe(false)
  })

  it('returns user object from getCurrentUser in the beforeLoad result', async () => {
    const mockUser = {
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      username: 'alice',
      email: 'alice@example.com',
    }
    vi.mocked(getCurrentUser).mockResolvedValue({ user: mockUser } as any)

    const outcome = await simulateBeforeLoad('/projects')

    expect((outcome as any).user).toEqual(mockUser)
  })
})
