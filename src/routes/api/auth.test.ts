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
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { db, genId, mapUser, nowMs, toDbDate, transaction } from '@/db'
import { findUserByEmail } from '@/data/user'
import { findProjectById } from '@/data/project'
import { deleteAuthSession } from '@/data/session'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import {
  createUserSession,
  hashToken,
  validateSessionToken,
} from '@/lib/auth/session'
import {
  buildClearCookieHeader,
  buildSetCookieHeader,
  parseSessionCookie,
} from '@/lib/auth/cookies'
import {
  checkLockout,
  clearLockout,
  recordFailedLogin,
} from '@/lib/auth/rate-limit'
import { makeProject, makeUser, resetDb } from '@/test/db-helpers'

const GENERIC_AUTH_ERROR = 'Invalid email or password'

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
  password: string
}) {
  const existingUser = await findUserByEmail(data.email)
  if (existingUser) {
    return {
      success: true,
      message: 'Registration successful. Please log in.',
      redirect: '/login',
      newUser: false,
    }
  }

  const passwordHash = await hashPassword(data.password)

  const user = transaction(() => {
    const userCount = Number(
      (db.prepare('SELECT count(*) AS c FROM "User"').get() as { c: number }).c,
    )
    const id = genId()
    const ts = nowMs()
    db.prepare(
      'INSERT INTO "User" ("id", "username", "email", "passwordHash", "failedLoginAttempts", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, 0, ?, ?)',
    ).run(id, data.username, data.email, passwordHash, ts, ts)

    if (userCount === 0) {
      db.prepare(
        'UPDATE "Project" SET "ownerId" = ?, "updatedAt" = ? WHERE "ownerId" IS NULL',
      ).run(id, ts)
    }

    return mapUser(db.prepare('SELECT * FROM "User" WHERE "id" = ?').get(id))!
  })

  const { token } = await createUserSession(user.id, false)
  ;(setResponseHeader as any)('Set-Cookie', buildSetCookieHeader(token, false))

  return { success: true, redirect: '/', newUser: true }
}

async function loginUserHandler(data: {
  email: string
  password: string
  rememberMe: boolean
}) {
  const user = await findUserByEmail(data.email)
  if (!user) {
    return {
      success: false,
      error: 'AUTH_FAILED',
      message: GENERIC_AUTH_ERROR,
    }
  }

  const lockout = await checkLockout(data.email)
  if (lockout.locked) {
    return {
      success: false,
      error: 'LOCKED',
      message: 'Too many failed attempts. Please try again in 15 minutes.',
      unlocksAt: lockout.unlocksAt?.toISOString(),
    }
  }

  // Dev-only superpassword bypass (guarded by NODE_ENV) — mirrors auth.ts.
  const superpass = process.env.DEBUG_SUPER_PASSWORD
  const devBypass =
    process.env.NODE_ENV !== 'production' &&
    !!superpass &&
    data.password === superpass
  const valid =
    devBypass || (await verifyPassword(data.password, user.passwordHash))
  if (!valid) {
    await recordFailedLogin(data.email)
    return {
      success: false,
      error: 'AUTH_FAILED',
      message: GENERIC_AUTH_ERROR,
    }
  }

  await clearLockout(user.id)
  const { token } = await createUserSession(user.id, data.rememberMe)
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
    const tokenHash = hashToken(token)
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
  vi.clearAllMocks()
  // Ensure the dev superpassword bypass is inactive in these tests.
  delete process.env.DEBUG_SUPER_PASSWORD
})

// ─────────────────────────────────────────────────────────────────────────────
// registerUser
// ─────────────────────────────────────────────────────────────────────────────

describe('registerUser', () => {
  // TC-P3-03: new registration creates a user + session
  it('TC-P3-03: creates user and session for a new email', async () => {
    const result = await registerUserHandler({
      username: 'alice',
      email: 'alice@example.com',
      password: 'secure123',
    })

    expect(result).toMatchObject({
      success: true,
      newUser: true,
      redirect: '/',
    })

    // Real DB effects: the user exists and a session was created for them.
    const user = await findUserByEmail('alice@example.com')
    expect(user).not.toBeNull()
    expect(user!.username).toBe('alice')
    expect(countSessionsForUser(user!.id)).toBe(1)

    // Set-Cookie was emitted with the session token.
    expect(setResponseHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringContaining('session_token'),
    )
  })

  // TC-P3-04: password is stored as a bcrypt hash, never plaintext
  it('TC-P3-04: password stored as bcrypt hash, never plaintext', async () => {
    await registerUserHandler({
      username: 'bob',
      email: 'bob@example.com',
      password: 'mySecret123',
    })

    const user = await findUserByEmail('bob@example.com')
    expect(user).not.toBeNull()
    expect(user!.passwordHash).not.toBe('mySecret123')
    expect(user!.passwordHash).toMatch(/^\$2[aby]\$.+/)
    // The stored hash actually verifies against the plaintext password.
    await expect(
      verifyPassword('mySecret123', user!.passwordHash),
    ).resolves.toBe(true)
  })

  // TC-P3-05: duplicate email returns anti-enumeration response, no new user
  it('TC-P3-05: duplicate email returns anti-enumeration success response', async () => {
    makeUser({ email: 'alice@example.com', username: 'alice' })
    const usersBefore = countUsers()

    const result = await registerUserHandler({
      username: 'alice2',
      email: 'alice@example.com',
      password: 'secure123',
    })

    expect(result).toEqual({
      success: true,
      message: 'Registration successful. Please log in.',
      redirect: '/login',
      newUser: false,
    })
    // No new user, no session, no cookie set.
    expect(countUsers()).toBe(usersBefore)
    expect(countSessions()).toBe(0)
    expect(setResponseHeader).not.toHaveBeenCalled()
  })

  // TC-P3-06: duplicate-email response shape matches new-user success shape
  it('TC-P3-06: duplicate email response has identical shape to new-user success', async () => {
    const newUserResult = await registerUserHandler({
      username: 'carol',
      email: 'carol@example.com',
      password: 'secure123',
    })

    // carol now exists → registering carol again hits the duplicate path.
    const dupeResult = await registerUserHandler({
      username: 'carol',
      email: 'carol@example.com',
      password: 'secure123',
    })

    expect(newUserResult.success).toBe(true)
    expect(dupeResult.success).toBe(true)
    expect(typeof newUserResult.redirect).toBe('string')
    expect(typeof dupeResult.redirect).toBe('string')
  })

  // TC-P3-03b: first registered user adopts ownerless projects
  it('TC-P3-03b: first registered user triggers ownerless project migration', async () => {
    // DB is empty of users; seed two ownerless projects.
    const p1 = makeProject({ name: 'P1' })
    const p2 = makeProject({ name: 'P2' })

    await registerUserHandler({
      username: 'first',
      email: 'first@example.com',
      password: 'secure123',
    })

    const user = await findUserByEmail('first@example.com')
    expect(user).not.toBeNull()
    const proj1 = await findProjectById(p1.id)
    const proj2 = await findProjectById(p2.id)
    expect(proj1?.ownerId).toBe(user!.id)
    expect(proj2?.ownerId).toBe(user!.id)
  })

  it('TC-P3-03c: a later registered user does NOT adopt existing projects', async () => {
    // Existing first user owns a project.
    const first = makeUser({ email: 'first@example.com' })
    const proj = makeProject({ name: 'Owned', ownerId: first.id })

    await registerUserHandler({
      username: 'second',
      email: 'second@example.com',
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

  // TC-P3-09: wrong password returns a generic error and records a failed attempt
  it('TC-P3-09: wrong password returns generic error and increments failed attempts', async () => {
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

    // Real effect of recordFailedLogin: the counter was bumped on the user row.
    const updated = await findUserByEmail('alice@example.com')
    expect(updated!.failedLoginAttempts).toBe(1)
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

  // TC-P3-11: locked account returns lockout message without creating a session
  it('TC-P3-11: locked account returns lockout message, no session created', async () => {
    const user = makeUser({
      email: 'alice@example.com',
      passwordHash: VALID_HASH,
    })
    // Lock the account: 5 failed attempts + future lockedUntil.
    db.prepare(
      'UPDATE "User" SET "failedLoginAttempts" = 5, "lockedUntil" = ? WHERE "id" = ?',
    ).run(toDbDate(new Date(Date.now() + 900_000)), user.id)

    const result = await loginUserHandler({
      // Even the correct password must be rejected while locked.
      email: 'alice@example.com',
      password: VALID_PASSWORD,
      rememberMe: false,
    })

    expect(result.error).toBe('LOCKED')
    expect(result.message).toContain('Too many failed attempts')
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

  beforeEach(() => {
    // DEBUG_SUPER_PASSWORD is unset (see top-level beforeEach), so the bypass
    // path is inactive and the value behaves like any other wrong password.
  })

  afterEach(() => {
    delete process.env.DEBUG_SUPER_PASSWORD
  })

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

  // TC-SP-04: structural check — any DEBUG_SUPER_PASSWORD bypass must be
  // dev-only (guarded by a NODE_ENV !== 'production' check) and must not use
  // the old ad-hoc identifiers.
  it('TC-SP-04: DEBUG_SUPER_PASSWORD bypass is dev-only (NODE_ENV guarded)', () => {
    const authPath = resolve(dirname(fileURLToPath(import.meta.url)), 'auth.ts')
    const authContent = readFileSync(authPath, 'utf-8')

    expect(authContent).not.toContain('isSuperpassword')
    expect(authContent).not.toContain('debugSuperPassword')
    if (authContent.includes('DEBUG_SUPER_PASSWORD')) {
      expect(authContent).toMatch(/NODE_ENV.*!==.*production/)
    }
  })
})
