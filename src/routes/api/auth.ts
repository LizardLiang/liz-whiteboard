// src/routes/api/auth.ts
// Authentication server functions: register (email-link signup), login, logout, getCurrentUser
//
// IMPORTANT: All server-only imports (prisma, session, crypto, etc.) MUST be
// dynamic imports inside .handler() callbacks. Top-level imports of server
// modules cause them to be bundled into the client, breaking hydration because
// Node.js built-ins (node:crypto, etc.) aren't available in the browser.

import { createServerFn } from '@tanstack/react-start'
import {
  completeSignupInputSchema,
  forgotPasswordInputSchema,
  loginInputSchema,
  registerInputSchema,
  resendSignupInputSchema,
  resetPasswordInputSchema,
} from '@/data/schema'
import { AUTH_ERROR_CODES } from '@/lib/auth/errors'
import { isSafeRedirect } from '@/lib/safe-redirect'

const GENERIC_AUTH_ERROR = 'Invalid email or password'

/** A same-origin return path worth storing, or null (unsafe, or just '/'). */
function returnPathOrNull(path: string | undefined): string | null {
  return path && isSafeRedirect(path) && path !== '/' ? path : null
}

/**
 * Start an email-link signup: the form takes email + username only. Every
 * well-formed request gets the same reply, with no cookie, so the reply does
 * not show whether the email has an account. A new email gets a signup link;
 * an existing email gets "you already have an account" with login and reset
 * links. No User row exists until /signup/$token sets the password. Only a
 * malformed username differs, and that is a zod check with no lookup.
 *
 * @requires unauthenticated
 */
export const registerUser = createServerFn({ method: 'POST' })
  .validator((data: unknown) => registerInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { getRequest } = await import('@tanstack/react-start/server')
    const { checkRegisterIpRateLimit } = await import('@/lib/auth/auth-limits')
    const { extractClientIp } = await import('@/lib/rate-limit')
    const { issueSignupEmail } = await import('@/lib/auth/signup-flow')
    const { getRequestLocale } = await import('@/lib/i18n/server-locale')

    const request = getRequest()
    if (!checkRegisterIpRateLimit(extractClientIp(request))) {
      return {
        success: false as const,
        error: AUTH_ERROR_CODES.RATE_LIMITED,
        message: 'Too many attempts. Please try again later.',
      }
    }

    const redirectTo = returnPathOrNull(data.redirect)

    await issueSignupEmail({
      email: data.email,
      username: data.username,
      redirectTo,
      locale: await getRequestLocale(),
      requestOrigin: new URL(request.url).origin,
    })

    return { success: true as const, redirect: '/register/check-email' }
  })

/**
 * Resend the signup email from the check-email page. Same reply for every
 * email. Uses the forgot-password per-IP limit; the per-email cooldown and
 * daily cap are applied inside issueSignupEmail and refuse silently.
 *
 * @requires unauthenticated
 */
export const resendSignupEmail = createServerFn({ method: 'POST' })
  .validator((data: unknown) => resendSignupInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { getRequest } = await import('@tanstack/react-start/server')
    const { extractClientIp } = await import('@/lib/rate-limit')
    const { checkResetIpRateLimit } = await import('@/lib/auth/reset-limits')
    const { issueSignupEmail } = await import('@/lib/auth/signup-flow')
    const { getRequestLocale } = await import('@/lib/i18n/server-locale')

    const request = getRequest()
    if (!checkResetIpRateLimit(extractClientIp(request))) {
      return { success: false as const, error: AUTH_ERROR_CODES.RATE_LIMITED }
    }

    await issueSignupEmail({
      email: data.email,
      username: null,
      redirectTo: returnPathOrNull(data.redirect),
      locale: await getRequestLocale(),
      requestOrigin: new URL(request.url).origin,
    })

    return { success: true as const }
  })

/**
 * Preview a signup link for the /signup/$token page: valid, expired, used or
 * invalid. Returns the pending username only for a valid link.
 *
 * @requires unauthenticated
 */
export const validateSignupToken = createServerFn({ method: 'GET' })
  .validator((token: unknown) => {
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('Invalid token')
    }
    return token
  })
  .handler(async ({ data: token }) => {
    const { hashOpaqueToken } = await import('@/lib/auth/opaque-token')
    const { getSignupTokenState } = await import('@/data/signup-token')

    const { state, token: row } = getSignupTokenState(hashOpaqueToken(token))
    return {
      state,
      username: state === 'valid' && row ? row.username : null,
    }
  })

/**
 * Finish a signup: set the password, create the user and sign them in. The
 * token and the username are re-checked in one transaction. The new user
 * lands on the return path stored with the token (an invite link) or '/'.
 *
 * @requires unauthenticated
 */
export const completeSignup = createServerFn({ method: 'POST' })
  .validator((data: unknown) => completeSignupInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { setResponseHeader } = await import('@tanstack/react-start/server')
    const { hashPassword } = await import('@/lib/auth/password')
    const { createUserSession } = await import('@/lib/auth/session')
    const { buildSetCookieHeader } = await import('@/lib/auth/cookies')
    const { hashOpaqueToken } = await import('@/lib/auth/opaque-token')
    const { completeSignup: completeSignupRow, getSignupTokenState } =
      await import('@/data/signup-token')
    const { sanitizeRedirect } = await import('@/lib/safe-redirect')

    const tokenHash = hashOpaqueToken(data.token)
    if (getSignupTokenState(tokenHash).state !== 'valid') {
      return { success: false as const, error: AUTH_ERROR_CODES.INVALID_TOKEN }
    }

    const passwordHash = await hashPassword(data.password)
    const result = completeSignupRow({
      tokenHash,
      username: data.username,
      passwordHash,
    })
    if (!result.ok) {
      if (result.reason === 'username_taken') {
        return {
          success: false as const,
          error: AUTH_ERROR_CODES.VALIDATION_ERROR,
          fields: { username: 'Username is already taken' },
        }
      }
      return { success: false as const, error: AUTH_ERROR_CODES.INVALID_TOKEN }
    }

    const { token } = await createUserSession(result.user.id, false)
    setResponseHeader('Set-Cookie', buildSetCookieHeader(token, false))

    console.log(`[auth] User registered: ${result.user.id}`)

    return {
      success: true as const,
      redirect: sanitizeRedirect(result.redirectTo ?? '/'),
    }
  })

/**
 * Login with email and password.
 * Generic error on any failure (anti-enumeration).
 * After 5 failed attempts for an email (registered or not), login needs a
 * Turnstile pass: the CHALLENGE_REQUIRED reply is identical for every email.
 *
 * @requires unauthenticated
 */
export const loginUser = createServerFn({ method: 'POST' })
  .validator((data: unknown) => loginInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { setResponseHeader, getRequest } =
      await import('@tanstack/react-start/server')
    const { createUserSession } = await import('@/lib/auth/session')
    const { buildSetCookieHeader } = await import('@/lib/auth/cookies')
    const { checkCredentials, failureNeedsChallenge } =
      await import('@/lib/auth/login-flow')
    const { checkLoginIpRateLimit } = await import('@/lib/auth/auth-limits')
    const { extractClientIp } = await import('@/lib/rate-limit')

    const ip = extractClientIp(getRequest())
    if (!checkLoginIpRateLimit(ip)) {
      // Log it: this refusal returns a normal-looking failure and no cookie,
      // so without a line here it is invisible in the server output. The IP is
      // a network address, not a credential; the email is deliberately absent.
      console.warn(`[auth] Login refused: IP rate limit reached (ip=${ip})`)
      return {
        success: false,
        error: AUTH_ERROR_CODES.RATE_LIMITED,
        message: 'Too many attempts. Please try again later.',
      }
    }

    // Unknown email and wrong password return the same generic failure; a
    // missing or bad Turnstile token returns CHALLENGE_REQUIRED (same for every
    // email). Neither is an account-state oracle for unauthenticated callers.
    const result = await checkCredentials(data.email, data.password, {
      turnstileToken: data.turnstileToken,
      ip,
    })
    if (!result.ok) {
      // See failureNeedsChallenge: the reply is identical for registered and
      // unknown emails, and a wrong password after a valid token says so.
      if (failureNeedsChallenge(result, data.email)) {
        return {
          success: false,
          error: AUTH_ERROR_CODES.CHALLENGE_REQUIRED,
          message: GENERIC_AUTH_ERROR,
        }
      }
      return {
        success: false,
        error: 'AUTH_FAILED',
        message: GENERIC_AUTH_ERROR,
      }
    }
    const user = { id: result.userId }

    // Success: create session, set cookie (failure counter already cleared)
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
    const { getRequest, setResponseHeader } =
      await import('@tanstack/react-start/server')
    const { db } = await import('@/db')
    const { parseSessionCookie, buildClearCookieHeader } =
      await import('@/lib/auth/cookies')
    const { deleteAuthSession } = await import('@/data/session')
    const { hashOpaqueToken } = await import('@/lib/auth/opaque-token')

    const request = getRequest()
    const cookieHeader = request.headers.get('cookie')
    const token = parseSessionCookie(cookieHeader)

    if (token) {
      const tokenHash = hashOpaqueToken(token)
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
 * branch replies in about the same time. The abuse-limit check and the token
 * insert happen together, atomically, in tryCreateResetToken — see that
 * function's comment for why they cannot be two separate awaited steps.
 *
 * @requires unauthenticated
 */
export const requestPasswordReset = createServerFn({ method: 'POST' })
  .validator((data: unknown) => forgotPasswordInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { getRequest } = await import('@tanstack/react-start/server')
    const { extractClientIp } = await import('@/lib/rate-limit')
    const { checkResetIpRateLimit } = await import('@/lib/auth/reset-limits')
    const { verifyTurnstile } = await import('@/lib/auth/turnstile')
    const { findUserByEmail } = await import('@/data/user')
    const {
      RESET_TOKEN_CLEANUP_AGE_MS,
      deleteResetTokensOlderThan,
      tryCreateResetToken,
    } = await import('@/data/password-reset')
    const { generateOpaqueToken, hashOpaqueToken } =
      await import('@/lib/auth/opaque-token')
    const { sendEmail } = await import('@/lib/email/resend')
    const { resolveBaseUrl } = await import('@/lib/email/base-url')
    const { buildLinkEmailHtml } = await import('@/lib/auth/escape-html')

    const { getRequestLocale } = await import('@/lib/i18n/server-locale')
    const { translate } = await import('@/lib/i18n/translate')

    const request = getRequest()
    const ip = extractClientIp(request)
    const locale = await getRequestLocale()

    const GENERIC_SUCCESS = {
      success: true as const,
      message:
        'If an account exists for that email, a reset link is on its way.',
    }

    if (!checkResetIpRateLimit(ip)) {
      return { success: false as const, error: AUTH_ERROR_CODES.RATE_LIMITED }
    }

    const turnstileOk = await verifyTurnstile(data.turnstileToken, ip)
    if (!turnstileOk) {
      return { success: false as const, error: AUTH_ERROR_CODES.CAPTCHA_FAILED }
    }

    // Lazy cleanup: rows older than the cleanup age are no longer needed for
    // either redemption or the rolling abuse-limit windows.
    await deleteResetTokensOlderThan(RESET_TOKEN_CLEANUP_AGE_MS)

    const user = await findUserByEmail(data.email)
    if (user) {
      const rawToken = generateOpaqueToken()
      const tokenHash = hashOpaqueToken(rawToken)
      const created = tryCreateResetToken(user.id, tokenHash)

      if (created) {
        const baseUrl = resolveBaseUrl(new URL(request.url).origin)
        if (!baseUrl) {
          console.error(
            '[password-reset] APP_BASE_URL is not set — reset email not sent.',
          )
        } else {
          const link = `${baseUrl}/reset-password?token=${rawToken}`
          void sendEmail({
            to: user.email,
            subject: translate(locale, 'email.resetSubject'),
            text: translate(locale, 'email.resetText', { link }),
            html: buildLinkEmailHtml({
              intro: translate(locale, 'email.resetHtmlIntro'),
              link,
              outro: translate(locale, 'email.resetHtmlOutro'),
            }),
          }).catch((err: unknown) => {
            console.error('[password-reset] sendEmail failed:', err)
          })
        }
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
  .validator((data: unknown) => resetPasswordInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { setResponseHeader } = await import('@tanstack/react-start/server')
    const { hashOpaqueToken } = await import('@/lib/auth/opaque-token')
    const { completePasswordReset, findValidResetToken } =
      await import('@/data/password-reset')
    const { hashPassword } = await import('@/lib/auth/password')
    const { buildClearCookieHeader } = await import('@/lib/auth/cookies')

    const tokenHash = hashOpaqueToken(data.token)
    const resetToken = await findValidResetToken(tokenHash)
    if (!resetToken) {
      return { success: false as const, error: AUTH_ERROR_CODES.INVALID_TOKEN }
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
  .validator((token: unknown) => {
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('Invalid token')
    }
    return token
  })
  .handler(async ({ data: token }) => {
    const { hashOpaqueToken } = await import('@/lib/auth/opaque-token')
    const { findValidResetToken } = await import('@/data/password-reset')

    const tokenHash = hashOpaqueToken(token)
    const resetToken = await findValidResetToken(tokenHash)
    return { valid: resetToken !== null }
  })
