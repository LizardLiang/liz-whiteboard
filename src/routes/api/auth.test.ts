// src/routes/api/auth.test.ts
// Phase 3 auth integration tests (TC-P3-03 through TC-P3-12, TC-P3-24)
// plus SEC-SP-04 superpassword-bypass regression.
//
// These exercise the real register/login/logout business logic against an
// in-memory SQLite database. The handler functions below mirror the logic of
// the createServerFn handlers in auth.ts (we cannot invoke the server fns
// directly because they need a server runtime context), but every data-layer
// call is REAL — no @/db / data-layer mocks. Only the TanStack Start server
// context (getRequest / setResponseHeader) is mocked, since there is no HTTP
// request in scope.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { db } from '@/db'
import { findUserByEmail } from '@/data/user'
import { findProjectById } from '@/data/project'
import { deleteAuthSession } from '@/data/session'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import {
  createUserSession,
  validateSessionToken,
} from '@/lib/auth/session'
import {
  buildClearCookieHeader,
  buildSetCookieHeader,
  parseSessionCookie,
} from '@/lib/auth/cookies'
import { issueSignupEmail } from '@/lib/auth/signup-flow'
import { hashOpaqueToken } from '@/lib/auth/opaque-token'
import { isSafeRedirect, sanitizeRedirect } from '@/lib/safe-redirect'
import {
  completeSignup as completeSignupRow,
  getSignupTokenState,
} from '@/data/signup-token'
import { checkCredentials, failureNeedsChallenge } from '@/lib/auth/login-flow'
import { _resetLoginFailuresForTests } from '@/lib/auth/rate-limit'
import { makeProject, makeUser, resetDb } from '@/test/db-helpers'

const GENERIC_AUTH_ERROR = 'Invalid email or password'

const sendEmail = vi.hoisted(() => vi.fn())
vi.mock('@/lib/email/resend', () => ({ sendEmail }))

// Mock only the TanStack Start server context — there is no real HTTP request.
vi.mock('@tanstack/react-start/server', () => ({
  getRequest: vi.fn(() => new Request('http://localhost/')),
  setResponseHeader: vi.fn(),
}))

// ─────────────────────────────────────────────────────────────────────────────
// Handlers mirroring auth.ts logic, using the REAL data layer.
// ─────────────────────────────────────────────────────────────────────────────

async function registerUserHandler(data: {
  username: string
  email: string
  redirect?: string
}) {
  await issueSignupEmail({
    email: data.email,
    username: data.username,
    redirectTo:
      data.redirect && isSafeRedirect(data.redirect) && data.redirect !== '/'
        ? data.redirect
        : null,
    locale: 'en',
    requestOrigin: 'http://localhost:3000',
  })
  return { success: true as const, redirect: '/register/check-email' }
}

/** Mirrors completeSignup in auth.ts. */
async function completeSignupHandler(data: {
  token: string
  username: string
  password: string
}) {
  const tokenHash = hashOpaqueToken(data.token)
  if (getSignupTokenState(tokenHash).state !== 'valid') {
    return { success: false as const, error: 'INVALID_TOKEN' }
  }
  const passwordHash = await hashPassword(data.password)
  const result = completeSignupRow({
    tokenHash,
    username: data.username,
    passwordHash,
  })
  if (!result.ok) {
    return {
      success: false as const,
      error:
        result.reason === 'username_taken' ? 'VALIDATION_ERROR' : 'INVALID_TOKEN',
    }
  }
  const { token } = await createUserSession(result.user.id, false)
  ;(setResponseHeader as any)('Set-Cookie', buildSetCookieHeader(token, false))
  return {
    success: true as const,
    redirect: sanitizeRedirect(result.redirectTo ?? '/'),
  }
}

/** The raw signup token from the last mail sent. */
function lastSignupToken(): string {
  const calls = sendEmail.mock.calls
  const text = calls[calls.length - 1][0].text as string
  return /\/signup\/([0-9a-f]{64})/.exec(text)![1]
}

async function loginUserHandler(data: {
  email: string
  password: string
  rememberMe: boolean
  turnstileToken?: string
}) {
  const result = await checkCredentials(data.email, data.password, {
    turnstileToken: data.turnstileToken,
    ip: '1.1.1.1',
  })
  if (!result.ok) {
    if (failureNeedsChallenge(result, data.email)) {
      return {
        success: false,
        error: 'CHALLENGE_REQUIRED',
        message: GENERIC_AUTH_ERROR,
      }
    }
    return {
      success: false,
      error: 'AUTH_FAILED',
      message: GENERIC_AUTH_ERROR,
    }
  }

  const { token } = await createUserSession(result.userId, data.rememberMe)
  ;(setResponseHeader as any)(
    'Set-Cookie',
    buildSetCookieHeader(token, data.rememberMe),
  )

  return { success: true, redirect: '/' }
}

async function logoutUserHandler() {
  const request = (getRequest as any)()
  const cookieHeader = request.headers.get('cookie')
  const token = parseSessionCookie(cookieHeader)

  if (token) {
    const tokenHash = hashOpaqueToken(token)
    const session = db
      .prepare('SELECT "id", "userId" FROM "Session" WHERE "tokenHash" = ?')
      .get(tokenHash) as { id: string; userId: string } | undefined
    if (session) {
      await deleteAuthSession(session.id)
    }
  }

  ;(setResponseHeader as any)('Set-Cookie', buildClearCookieHeader())
  return { success: true, redirect: '/login' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function countSessionsForUser(userId: string): number {
  return Number(
    (
      db
        .prepare('SELECT count(*) AS c FROM "Session" WHERE "userId" = ?')
        .get(userId) as { c: number }
    ).c,
  )
}

function countSessions(): number {
  return Number(
    (db.prepare('SELECT count(*) AS c FROM "Session"').get() as { c: number })
      .c,
  )
}

function countUsers(): number {
  return Number(
    (db.prepare('SELECT count(*) AS c FROM "User"').get() as { c: number }).c,
  )
}

const VALID_PASSWORD = 'correctPassword123'
let VALID_HASH = ''

beforeAll(async () => {
  // bcrypt is slow; hash the canonical password once and reuse it.
  VALID_HASH = await hashPassword(VALID_PASSWORD)
})

beforeEach(() => {
  resetDb()
  _resetLoginFailuresForTests()
  vi.clearAllMocks()
  sendEmail.mockResolvedValue(undefined)
  vi.stubEnv('APP_BASE_URL', 'http://localhost:3000')
})

// ─────────────────────────────────────────────────────────────────────────────
// registerUser
// ─────────────────────────────────────────────────────────────────────────────

describe('registerUser', () => {
  // TC-P3-03: a new email gets a pending signup and a mail, no user, no cookie
  it('TC-P3-03: new email creates no user and no session, sends the signup link', async () => {
    const result = await registerUserHandler({
      username: 'alice',
      email: 'alice@example.com',
    })

    expect(result).toEqual({ success: true, redirect: '/register/check-email' })
    expect(await findUserByEmail('alice@example.com')).toBeNull()
    expect(countSessions()).toBe(0)
    expect(setResponseHeader).not.toHaveBeenCalled()
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0][0].text).toContain('/signup/')
  })

  // TC-P3-04: the link sets the password, stored as a bcrypt hash, and logs in
  it('TC-P3-04: the signup link sets a bcrypt password hash and signs the user in', async () => {
    await registerUserHandler({ username: 'bob', email: 'bob@example.com' })
    const result = await completeSignupHandler({
      token: lastSignupToken(),
      username: 'bob',
      password: 'mySecret123',
    })

    expect(result).toEqual({ success: true, redirect: '/' })
    const user = await findUserByEmail('bob@example.com')
    expect(user).not.toBeNull()
    expect(user!.passwordHash).not.toBe('mySecret123')
    expect(user!.passwordHash).toMatch(/^\$2[aby]\$.+/)
    await expect(
      verifyPassword('mySecret123', user!.passwordHash),
    ).resolves.toBe(true)
    expect(countSessionsForUser(user!.id)).toBe(1)
    expect(setResponseHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringContaining('session_token'),
    )
  })

  // TC-P3-05: existing email: same reply, no new user, no cookie, the other mail
  it('TC-P3-05: existing email returns the identical reply and sends the account-exists mail', async () => {
    makeUser({ email: 'alice@example.com', username: 'alice' })
    const usersBefore = countUsers()

    const result = await registerUserHandler({
      username: 'alice2',
      email: 'alice@example.com',
    })

    expect(result).toEqual({ success: true, redirect: '/register/check-email' })
    expect(countUsers()).toBe(usersBefore)
    expect(countSessions()).toBe(0)
    expect(setResponseHeader).not.toHaveBeenCalled()
    expect(sendEmail.mock.calls[0][0].text).not.toContain('/signup/')
    expect(sendEmail.mock.calls[0][0].text).toContain('/login')
  })

  // TC-P3-06: new and existing replies are deeply equal
  it('TC-P3-06: new and existing email replies are deeply equal', async () => {
    makeUser({ email: 'old@example.com', username: 'old' })
    const existing = await registerUserHandler({
      username: 'x_old',
      email: 'old@example.com',
    })
    const fresh = await registerUserHandler({
      username: 'x_new',
      email: 'new@example.com',
    })
    expect(fresh).toEqual(existing)
  })

  it('TC-P3-06b: a taken username does not change the register reply', async () => {
    makeUser({ email: 'o@example.com', username: 'taken' })
    const result = await registerUserHandler({
      username: 'taken',
      email: 'fresh@example.com',
    })
    expect(result).toEqual({ success: true, redirect: '/register/check-email' })
  })

  it('TC-P3-06c: an invite return path survives register -> email link -> set password', async () => {
    await registerUserHandler({
      username: 'invitee',
      email: 'invitee@example.com',
      redirect: '/invite/abc123',
    })
    const result = await completeSignupHandler({
      token: lastSignupToken(),
      username: 'invitee',
      password: 'secure123',
    })
    expect(result).toEqual({ success: true, redirect: '/invite/abc123' })
  })

  it('TC-P3-06d: an unsafe return path is dropped', async () => {
    await registerUserHandler({
      username: 'evil',
      email: 'evil@example.com',
      redirect: '//evil.com',
    })
    const result = await completeSignupHandler({
      token: lastSignupToken(),
      username: 'evil',
      password: 'secure123',
    })
    expect(result).toEqual({ success: true, redirect: '/' })
  })

  it('TC-P3-06e: a used link is refused', async () => {
    await registerUserHandler({ username: 'once', email: 'once@example.com' })
    const token = lastSignupToken()
    await completeSignupHandler({ token, username: 'once', password: 'secure123' })
    const again = await completeSignupHandler({
      token,
      username: 'once2',
      password: 'secure123',
    })
    expect(again).toEqual({ success: false, error: 'INVALID_TOKEN' })
  })

  it('TC-P3-06f: a username taken before the link is used is refused, the link stays usable', async () => {
    await registerUserHandler({ username: 'race', email: 'race@example.com' })
    const token = lastSignupToken()
    makeUser({ username: 'race', email: 'other@example.com' })
    const clash = await completeSignupHandler({
      token,
      username: 'race',
      password: 'secure123',
    })
    expect(clash).toEqual({ success: false, error: 'VALIDATION_ERROR' })
    const ok = await completeSignupHandler({
      token,
      username: 'race2',
      password: 'secure123',
    })
    expect(ok.success).toBe(true)
  })

  // TC-P3-03b: signup must NOT take ownerless projects
  it('TC-P3-03b: a signed-up user does NOT adopt ownerless projects', async () => {
    const p1 = makeProject({ name: 'P1' })
    const p2 = makeProject({ name: 'P2' })

    await registerUserHandler({ username: 'first', email: 'first@example.com' })
    await completeSignupHandler({
      token: lastSignupToken(),
      username: 'first',
      password: 'secure123',
    })

    expect(await findUserByEmail('first@example.com')).not.toBeNull()
    expect((await findProjectById(p1.id))?.ownerId).toBeNull()
    expect((await findProjectById(p2.id))?.ownerId).toBeNull()
  })

  it('TC-P3-03c: a later signed-up user does NOT adopt existing projects', async () => {
    const first = makeUser({ email: 'first@example.com' })
    const proj = makeProject({ name: 'Owned', ownerId: first.id })

    await registerUserHandler({ username: 'second', email: 'second@example.com' })
    await completeSignupHandler({
      token: lastSignupToken(),
      username: 'second',
      password: 'secure123',
    })

    const adopted = await findProjectById(proj.id)
    expect(adopted?.ownerId).toBe(first.id)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// loginUser
// ─────────────────────────────────────────────────────────────────────────────

describe('loginUser', () => {
  // TC-P3-08: correct credentials create a session and set an HttpOnly cookie
  it('TC-P3-08: correct credentials create session and set HttpOnly cookie', async () => {
    const user = makeUser({
      email: 'alice@example.com',
      passwordHash: VALID_HASH,
    })

    const result = await loginUserHandler({
      email: 'alice@example.com',
      password: VALID_PASSWORD,
      rememberMe: false,
    })

    expect(result.success).toBe(true)
    expect(result.redirect).toBe('/')
    // A real session row was created for the user.
    expect(countSessionsForUser(user.id)).toBe(1)

    // The Set-Cookie header carries a non-Secure, HttpOnly, SameSite=Lax cookie.
    expect(setResponseHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringContaining('HttpOnly'),
    )
    const cookieValue = (setResponseHeader as any).mock.calls[0][1] as string
    expect(cookieValue).toContain('SameSite=Lax')
    expect(cookieValue).not.toContain('Secure')
  })

  // TC-P3-09: wrong password returns a generic error and no session
  it('TC-P3-09: wrong password returns generic error', async () => {
    const user = makeUser({
      email: 'alice@example.com',
      passwordHash: VALID_HASH,
    })

    const result = await loginUserHandler({
      email: 'alice@example.com',
      password: 'wrongpassword',
      rememberMe: false,
    })

    expect(result.success).toBe(false)
    expect(result.message).toBe(GENERIC_AUTH_ERROR)
    expect(setResponseHeader).not.toHaveBeenCalled()
    expect(countSessionsForUser(user.id)).toBe(0)
  })

  // TC-P3-10: non-existent email returns generic error; nothing recorded/created
  it('TC-P3-10: non-existent email returns generic error, no session created', async () => {
    const result = await loginUserHandler({
      email: 'nobody@example.com',
      password: 'anypassword',
      rememberMe: false,
    })

    expect(result.message).toBe(GENERIC_AUTH_ERROR)
    expect(countSessions()).toBe(0)
    expect(setResponseHeader).not.toHaveBeenCalled()
  })

  // TC-P3-11: after 5 failures the challenge replaces the lock
  it('TC-P3-11: 5 failures require the challenge, same reply for a registered and an unknown email', async () => {
    const user = makeUser({
      email: 'alice@example.com',
      passwordHash: VALID_HASH,
    })
    for (const email of ['alice@example.com', 'ghost@example.com']) {
      for (let i = 0; i < 4; i++) {
        const r = await loginUserHandler({ email, password: 'bad', rememberMe: false })
        expect(r.error).toBe('AUTH_FAILED')
      }
      // The 5th failure already answers with the challenge, for both emails.
      const fifth = await loginUserHandler({ email, password: 'bad', rememberMe: false })
      expect(fifth.error).toBe('CHALLENGE_REQUIRED')
    }

    const real = await loginUserHandler({
      // Even the correct password is refused without a Turnstile token.
      email: 'alice@example.com',
      password: VALID_PASSWORD,
      rememberMe: false,
    })
    const ghost = await loginUserHandler({
      email: 'ghost@example.com',
      password: VALID_PASSWORD,
      rememberMe: false,
    })

    expect(real).toEqual(ghost)
    expect(real.error).toBe('CHALLENGE_REQUIRED')
    expect(countSessionsForUser(user.id)).toBe(0)
    expect(setResponseHeader).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// logoutUser
// ─────────────────────────────────────────────────────────────────────────────

describe('logoutUser', () => {
  // TC-P3-12: logout deletes the session and clears the cookie
  it('TC-P3-12: logout invalidates session and sets Max-Age=0 cookie', async () => {
    const user = makeUser({ email: 'alice@example.com' })
    const { token } = await createUserSession(user.id, false)
    expect(countSessionsForUser(user.id)).toBe(1)
    ;(getRequest as any).mockReturnValue(
      new Request('http://localhost/', {
        headers: { cookie: `session_token=${token}` },
      }),
    )

    const result = await logoutUserHandler()

    // Session row is gone.
    expect(countSessionsForUser(user.id)).toBe(0)
    expect(setResponseHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringContaining('Max-Age=0'),
    )
    expect(result.redirect).toBe('/login')
  })

  // TC-P3-24: after logout the former token can no longer be validated
  it('TC-P3-24: logout deletes session so the former token cannot be reused', async () => {
    const user = makeUser({ email: 'alice@example.com' })
    const { token } = await createUserSession(user.id, false)

    // The token is valid before logout.
    expect(await validateSessionToken(token)).not.toBeNull()
    ;(getRequest as any).mockReturnValue(
      new Request('http://localhost/', {
        headers: { cookie: `session_token=${token}` },
      }),
    )
    await logoutUserHandler()

    // After logout, the same token is rejected.
    expect(await validateSessionToken(token)).toBeNull()
  })

  it('TC-P3-12b: logout without a session cookie still clears the cookie and redirects', async () => {
    // Seed a session for a different (still-valid) user to prove nothing is deleted.
    const user = makeUser({ email: 'alice@example.com' })
    await createUserSession(user.id, false)
    ;(getRequest as any).mockReturnValue(new Request('http://localhost/'))

    const result = await logoutUserHandler()

    expect(countSessionsForUser(user.id)).toBe(1)
    expect(setResponseHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringContaining('Max-Age=0'),
    )
    expect(result.redirect).toBe('/login')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// requireAuth gate (TC-P3-23)
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-P3-23: requireAuth wrapper returns 401 when unauthenticated', () => {
  it('returns UNAUTHORIZED when the session cookie is missing', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware')

    // A request with no cookie → getSessionFromCookie (real) returns null.
    ;(getRequest as any).mockReturnValue(new Request('http://localhost/'))

    const handler = vi.fn().mockResolvedValue({ projects: [] })
    const wrapped = requireAuth(handler)

    const result = await wrapped({ data: undefined })

    expect(result).toEqual({ error: 'UNAUTHORIZED', status: 401 })
    expect(handler).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SEC-SP-04 Regression: the superpassword bypass must be absent / dev-guarded
// (TC-SP-01 through TC-SP-04)
// ─────────────────────────────────────────────────────────────────────────────

describe('SEC-SP-04 Regression: superpassword bypass must be absent', () => {
  const DEBUG_SUPER_PASSWORD_VALUE = 'debug-super-password-literal-value'

  // TC-SP-01: a superpassword-shaped value is rejected → AUTH_FAILED, no session
  it('TC-SP-01: debug superpassword value rejected → AUTH_FAILED', async () => {
    const user = makeUser({
      email: 'alice@example.com',
      passwordHash: VALID_HASH,
    })

    const result = await loginUserHandler({
      email: 'alice@example.com',
      password: DEBUG_SUPER_PASSWORD_VALUE,
      rememberMe: false,
    })

    expect(result.success).toBe(false)
    expect((result as any).error).toBe('AUTH_FAILED')
    expect(countSessionsForUser(user.id)).toBe(0)
  })

  // TC-SP-02: the correct real password still succeeds
  it('TC-SP-02: correct real password succeeds', async () => {
    const user = makeUser({
      email: 'alice@example.com',
      passwordHash: VALID_HASH,
    })

    const result = await loginUserHandler({
      email: 'alice@example.com',
      password: VALID_PASSWORD,
      rememberMe: false,
    })

    expect(result.success).toBe(true)
    expect((result as any).redirect).toBe('/')
    expect(countSessionsForUser(user.id)).toBe(1)
  })

  // TC-SP-03: a wrong password and the superpassword value fail identically
  it('TC-SP-03: wrong password and superpassword value fail with the same generic error', async () => {
    makeUser({ email: 'alice@example.com', passwordHash: VALID_HASH })

    const result1 = await loginUserHandler({
      email: 'alice@example.com',
      password: 'wrongPassword',
      rememberMe: false,
    })
    const result2 = await loginUserHandler({
      email: 'alice@example.com',
      password: DEBUG_SUPER_PASSWORD_VALUE,
      rememberMe: false,
    })

    expect((result1 as any).error).toBe('AUTH_FAILED')
    expect((result2 as any).error).toBe('AUTH_FAILED')
    expect((result1 as any).message).toBe((result2 as any).message)
  })

  // TC-SP-04: the env-var bypass is deleted outright, not merely guarded.
  it('TC-SP-04: DEBUG_SUPER_PASSWORD no longer appears in auth.ts', () => {
    const authPath = resolve(dirname(fileURLToPath(import.meta.url)), 'auth.ts')
    const authContent = readFileSync(authPath, 'utf-8')

    expect(authContent).not.toContain('DEBUG_SUPER_PASSWORD')
    expect(authContent).not.toContain('isSuperpassword')
    expect(authContent).not.toContain('debugSuperPassword')
  })
})
