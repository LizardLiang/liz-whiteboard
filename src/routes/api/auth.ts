// src/routes/api/auth.ts
// Authentication server functions: register, login, logout, getCurrentUser

import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { prisma } from '@/db'
import { registerInputSchema, loginInputSchema } from '@/data/schema'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { createUserSession, validateSessionToken } from '@/lib/auth/session'
import {
  parseSessionCookie,
  buildSetCookieHeader,
  buildClearCookieHeader,
} from '@/lib/auth/cookies'
import { checkLockout, recordFailedLogin, clearLockout } from '@/lib/auth/rate-limit'
import { findUserByEmail, findUserByUsername } from '@/data/user'
import { deleteAuthSession } from '@/data/session'
import { hashToken } from '@/lib/auth/session'

const GENERIC_AUTH_ERROR = 'Invalid email or password'

/**
 * Register a new user.
 * Anti-enumeration: duplicate email returns same success-shaped response.
 * First user: assigns all existing ownerless projects to them.
 */
export const registerUser = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => registerInputSchema.parse(data))
  .handler(async ({ data }) => {
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
        error: 'VALIDATION_ERROR',
        fields: { username: 'Username is already taken' },
      }
    }

    // Hash password (SHA-256 pre-hash + bcrypt)
    const passwordHash = await hashPassword(data.password)

    // Create user and optionally migrate ownerless projects (atomic transaction)
    const user = await prisma.$transaction(async (tx) => {
      const userCount = await tx.user.count()

      const newUser = await tx.user.create({
        data: {
          username: data.username,
          email: data.email,
          passwordHash,
        },
      })

      // First user: assign all ownerless projects
      if (userCount === 0) {
        await tx.project.updateMany({
          where: { ownerId: null },
          data: { ownerId: newUser.id },
        })
      }

      return newUser
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
 */
export const loginUser = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => loginInputSchema.parse(data))
  .handler(async ({ data }) => {
    // Find user (return generic error if not found — anti-enumeration)
    const user = await findUserByEmail(data.email)
    if (!user) {
      return { success: false, error: 'AUTH_FAILED', message: GENERIC_AUTH_ERROR }
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
    const valid = await verifyPassword(data.password, user.passwordHash)
    if (!valid) {
      await recordFailedLogin(data.email)
      return { success: false, error: 'AUTH_FAILED', message: GENERIC_AUTH_ERROR }
    }

    // Success: clear lockout, create session, set cookie
    await clearLockout(user.id)
    const { token } = await createUserSession(user.id, data.rememberMe)

    setResponseHeader('Set-Cookie', buildSetCookieHeader(token, data.rememberMe))

    console.log(`[auth] User logged in: ${user.id}`)

    return { success: true, redirect: '/' }
  })

/**
 * Logout: delete session, clear cookie.
 */
export const logoutUser = createServerFn({ method: 'POST' }).handler(
  async () => {
    const request = getRequest()
    const cookieHeader = request.headers.get('cookie')
    const token = parseSessionCookie(cookieHeader)

    if (token) {
      const tokenHash = hashToken(token)
      // Find and delete the session
      const session = await prisma.session.findUnique({
        where: { tokenHash },
        select: { id: true, userId: true },
      })
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
 */
export const getCurrentUser = createServerFn({ method: 'GET' }).handler(
  async () => {
    const request = getRequest()
    const cookieHeader = request.headers.get('cookie')
    const token = parseSessionCookie(cookieHeader)

    if (!token) return null

    const authResult = await validateSessionToken(token)
    if (!authResult) return null

    return { user: authResult.user }
  },
)
