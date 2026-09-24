// src/routes/api/auth.ts
// Authentication server functions: register, login, logout, getCurrentUser
//
// IMPORTANT: All server-only imports (prisma, session, crypto, etc.) MUST be
// dynamic imports inside .handler() callbacks. Top-level imports of server
// modules cause them to be bundled into the client, breaking hydration because
// Node.js built-ins (node:crypto, etc.) aren't available in the browser.

import { createServerFn } from '@tanstack/react-start'
import {
  forgotPasswordInputSchema,
  loginInputSchema,
  registerInputSchema,
  resetPasswordInputSchema,
} from '@/data/schema'
import { AUTH_ERROR_CODES } from '@/lib/auth/errors'

const GENERIC_AUTH_ERROR = 'Invalid email or password'

/**
 * Register a new user.
 * Anti-enumeration: duplicate email returns same success-shaped response.
 * First user: assigns all existing ownerless projects to them.
 *
 * @requires unauthenticated
 */
export const registerUser = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => registerInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { setResponseHeader } = await import('@tanstack/react-start/server')
    const { transaction, db, genId, nowMs, mapUser } = await import('@/db')
    const { hashPassword } = await import('@/lib/auth/password')
    const { createUserSession } = await import('@/lib/auth/session')
    const { buildSetCookieHeader } = await import('@/lib/auth/cookies')
    const { findUserByEmail, findUserByUsername } = await import('@/data/user')

    // Check for duplicate email (anti-enumeration)
    const existingUser = await findUserByEmail(data.email)
    if (existingUser) {
      // Return same success-shaped response to prevent email enumeration
      return {
        success: true,
        message: 'Registration successful. Please log in.',
        redirect: '/login',
        newUser: false,
      }
    }

    // Check for duplicate username (no anti-enumeration needed — usernames are public)
    const existingUsername = await findUserByUsername(data.username)
    if (existingUsername) {
      return {
        success: false,
        error: AUTH_ERROR_CODES.VALIDATION_ERROR,
        fields: { username: 'Username is already taken' },
      }
    }

    // Hash password (SHA-256 pre-hash + bcrypt)
    const passwordHash = await hashPassword(data.password)

    // Create user and optionally migrate ownerless projects (atomic transaction)
    const user = transaction(() => {
      const userCount = Number(
        (db.prepare('SELECT count(*) AS c FROM "User"').get() as { c: number })
          .c,
      )

      const id = genId()
      const ts = nowMs()
      db.prepare(
        'INSERT INTO "User" ("id", "username", "email", "passwordHash", "failedLoginAttempts", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, 0, ?, ?)',
      ).run(id, data.username, data.email, passwordHash, ts, ts)

      // First user: assign all ownerless projects
      if (userCount === 0) {
        db.prepare(
          'UPDATE "Project" SET "ownerId" = ?, "updatedAt" = ? WHERE "ownerId" IS NULL',
        ).run(id, ts)
      }

      return mapUser(db.prepare('SELECT * FROM "User" WHERE "id" = ?').get(id))!
    })

    // Create session and set cookie
    const { token } = await createUserSession(user.id, false)

    setResponseHeader('Set-Cookie', buildSetCookieHeader(token, false))

    console.log(`[auth] User registered: ${user.id}`)

    return {
      success: true,
      redirect: '/',
      newUser: true,
    }
  })

/**
 * Login with email and password.
 * Generic error on any failure (anti-enumeration).
 * Account lockout after 5 failed attempts.
 *
 * @requires unauthenticated
 */
export const loginUser = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => loginInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { setResponseHeader } = await import('@tanstack/react-start/server')
    const { createUserSession } = await import('@/lib/auth/session')
    const { buildSetCookieHeader } = await import('@/lib/auth/cookies')
    const { checkLockout, recordFailedLogin, clearLockout } = await import(
      '@/lib/auth/rate-limit'
    )
    const { findUserByEmail } = await import('@/data/user')
    const { verifyPassword } = await import('@/lib/auth/password')

    // Find user (return generic error if not found — anti-enumeration)
    const user = await findUserByEmail(data.email)
    if (!user) {
      return {
        success: false,
        error: 'AUTH_FAILED',
        message: GENERIC_AUTH_ERROR,
      }
    }

    // Check lockout
    const lockout = await checkLockout(data.email)
    if (lockout.locked) {
      return {
        success: false,
        error: 'LOCKED',
        message: 'Too many failed attempts. Please try again in 15 minutes.',
        unlocksAt: lockout.unlocksAt?.toISOString(),
      }
    }

    // Verify password
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

    // Success: clear lockout, create session, set cookie
    await clearLockout(user.id)
    const { token } = await createUserSession(user.id, data.rememberMe)

    setResponseHeader(
      'Set-Cookie',
      buildSetCookieHeader(token, data.rememberMe),
    )

    console.log(`[auth] User logged in: ${user.id}`)

    return { success: true, redirect: '/' }
  })

/**
 * Logout: delete session, clear cookie.
 *
 * @requires authenticated
 */
export const logoutUser = createServerFn({ method: 'POST' }).handler(
  async () => {
    const { getRequest, setResponseHeader } = await import(
      '@tanstack/react-start/server'
    )
    const { db } = await import('@/db')
    const { parseSessionCookie, buildClearCookieHeader } = await import(
      '@/lib/auth/cookies'
    )
    const { deleteAuthSession } = await import('@/data/session')
    const { hashToken } = await import('@/lib/auth/session')

    const request = getRequest()
    const cookieHeader = request.headers.get('cookie')
    const token = parseSessionCookie(cookieHeader)

    if (token) {
      const tokenHash = hashToken(token)
      // Find and delete the session
      const session = db
        .prepare('SELECT "id", "userId" FROM "Session" WHERE "tokenHash" = ?')
        .get(tokenHash) as { id: string; userId: string } | undefined
      if (session) {
        await deleteAuthSession(session.id)
        console.log(`[auth] User logged out: ${session.userId}`)
      }
    }

    setResponseHeader('Set-Cookie', buildClearCookieHeader())
    return { success: true, redirect: '/login' }
  },
)

/**
 * Get the currently authenticated user.
 * Returns null if not authenticated (does not throw).
 *
 * @requires authenticated
 */
export const getCurrentUser = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { getRequest } = await import('@tanstack/react-start/server')
    const { parseSessionCookie } = await import('@/lib/auth/cookies')
    const { validateSessionToken } = await import('@/lib/auth/session')

    const request = getRequest()
    const cookieHeader = request.headers.get('cookie')
    const token = parseSessionCookie(cookieHeader)

    if (!token) return null

    const authResult = await validateSessionToken(token)
    if (!authResult) return null

    return { user: authResult.user }
  },
)

/**
 * Return the public Turnstile site key for the forgot-password widget, so
 * the client reads it from the server rather than hard-coding it.
 *
 * @requires unauthenticated
 */
export const getTurnstileSiteKey = createServerFn({ method: 'GET' }).handler(
  () => {
    return { siteKey: process.env.TURNSTILE_SITE_KEY ?? null }
  },
)

/**
 * Request a password-reset email. Always replies with the same
 * success-shaped, generic message regardless of whether the email matches an
 * account (anti-enumeration) — the only branch that reveals anything is the
 * IP-based rate limit, which says nothing about the email itself.
 *
 * Order: IP rate limit -> Turnstile -> lazy token cleanup -> lookup -> (if
 * eligible) issue token and fire the email without awaiting it, so every
 * branch replies in about the same time.
 *
 * @requires unauthenticated
 */
export const requestPasswordReset = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => forgotPasswordInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { getRequest } = await import('@tanstack/react-start/server')
    const { extractClientIp } = await import('@/lib/rate-limit')
    const { checkResetIpRateLimit, canSendReset } = await import(
      '@/lib/auth/reset-limits'
    )
    const { verifyTurnstile } = await import('@/lib/auth/turnstile')
    const { findUserByEmail } = await import('@/data/user')
    const { createResetToken, deleteResetTokensOlderThan } = await import(
      '@/data/password-reset'
    )
    const { generateResetToken, hashResetToken } = await import(
      '@/lib/auth/reset-token'
    )
    const { sendEmail } = await import('@/lib/email/resend')

    const request = getRequest()
    const ip = extractClientIp(request)

    const GENERIC_SUCCESS = {
      success: true as const,
      message: 'If an account exists for that email, a reset link is on its way.',
    }

    if (!checkResetIpRateLimit(ip)) {
      return { success: false as const, error: 'RATE_LIMITED' as const }
    }

    const turnstileOk = await verifyTurnstile(data.turnstileToken, ip)
    if (!turnstileOk) {
      return { success: false as const, error: 'CAPTCHA_FAILED' as const }
    }

    // Lazy cleanup: rows older than 7 days are no longer needed for either
    // redemption or the rolling 24h abuse-limit windows.
    await deleteResetTokensOlderThan(7 * 24 * 60 * 60 * 1000)

    const user = await findUserByEmail(data.email)
    if (user && (await canSendReset(user.id))) {
      const rawToken = generateResetToken()
      const tokenHash = hashResetToken(rawToken)
      await createResetToken(user.id, tokenHash)

      const baseUrl = process.env.APP_BASE_URL
      if (!baseUrl) {
        if (process.env.NODE_ENV === 'production') {
          console.error(
            '[password-reset] APP_BASE_URL is not set — reset email not sent.',
          )
        }
      } else {
        const link = `${baseUrl.replace(/\/$/, '')}/reset-password?token=${rawToken}`
        void sendEmail({
          to: user.email,
          subject: 'Reset your password',
          text: `Use this link to reset your password: ${link}\n\nThis link expires in 30 minutes and can only be used once. If you did not request this, you can ignore this email.`,
          html: `<p>Use this link to reset your password:</p><p><a href="${link}">${link}</a></p><p>This link expires in 30 minutes and can only be used once. If you did not request this, you can ignore this email.</p>`,
        }).catch((err: unknown) => {
          console.error('[password-reset] sendEmail failed:', err)
        })
      }
    }

    return GENERIC_SUCCESS
  })

/**
 * Set a new password from a valid reset link. Signs the user out everywhere:
 * completePasswordReset deletes every Session and OauthRefreshToken row for
 * the account, and this handler also clears the current browser's own
 * session cookie.
 *
 * @requires unauthenticated
 */
export const resetPassword = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => resetPasswordInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { setResponseHeader } = await import('@tanstack/react-start/server')
    const { hashResetToken } = await import('@/lib/auth/reset-token')
    const { completePasswordReset, findValidResetToken } = await import(
      '@/data/password-reset'
    )
    const { hashPassword } = await import('@/lib/auth/password')
    const { buildClearCookieHeader } = await import('@/lib/auth/cookies')

    const tokenHash = hashResetToken(data.token)
    const resetToken = await findValidResetToken(tokenHash)
    if (!resetToken) {
      return { success: false as const, error: 'INVALID_TOKEN' as const }
    }

    const newPasswordHash = await hashPassword(data.password)
    completePasswordReset(resetToken.userId, newPasswordHash)

    setResponseHeader('Set-Cookie', buildClearCookieHeader())

    console.log(`[auth] Password reset completed: ${resetToken.userId}`)

    return { success: true as const, redirect: '/login?reset=success' }
  })

/**
 * Check whether a reset token (from a `/reset-password?token=` link) is
 * still valid, for the route loader to decide which form state to render.
 * Deliberately returns only a boolean — never the token's owner or any other
 * detail a client-side check shouldn't be able to read.
 *
 * @requires unauthenticated
 */
export const validateResetToken = createServerFn({ method: 'GET' })
  .inputValidator((token: unknown) => {
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('Invalid token')
    }
    return token
  })
  .handler(async ({ data: token }) => {
    const { hashResetToken } = await import('@/lib/auth/reset-token')
    const { findValidResetToken } = await import('@/data/password-reset')

    const tokenHash = hashResetToken(token)
    const resetToken = await findValidResetToken(tokenHash)
    return { valid: resetToken !== null }
  })
