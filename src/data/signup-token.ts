// src/data/signup-token.ts
// Data access layer for the SignupToken (email-link signup) entity. Raw SQL in
// the style of src/data/password-reset.ts.

import type { SignupToken, User } from '@/data/models'
import {
  RESET_COOLDOWN_MS,
  RESET_DAILY_WINDOW_MS,
  RESET_PER_USER_DAILY_MAX,
} from '@/data/password-reset'
import { db, genId, insert, mapSignupToken, nowMs, transaction } from '@/db'
import { insertRegisteredUser } from '@/lib/auth/register-user'
import { SIGNUP_TOKEN_TTL_MS } from '@/lib/auth/signup-token'

/** Age past which a SignupToken row is no longer needed (used or expired). */
export const SIGNUP_TOKEN_CLEANUP_AGE_MS = 7 * 24 * 60 * 60 * 1000

function countForEmailSince(email: string, sinceMs: number): number {
  const row = db
    .prepare(
      'SELECT count(*) AS c FROM "SignupToken" WHERE "email" = ? AND "createdAt" >= ?',
    )
    .get(email, sinceMs) as { c: number }
  return Number(row.c)
}

/**
 * Check the per-email send limits (the forgot-password cooldown and daily
 * cap, counted from the DB) and, if they pass, store one signup row. Earlier
 * unused rows stay valid until they expire or a signup completes (an anonymous
 * request must not cancel another person's link). The whole check-and-write
 * runs in one synchronous transaction.
 *
 * `voided` stores the row already used. The caller sets it when the email
 * already has an account, so both cases count against the same limits and do
 * the same DB work.
 *
 * @returns the new row, or null when a limit blocked the send
 */
export function tryCreateSignupToken(params: {
  email: string
  username: string
  redirectTo: string | null
  tokenHash: string
  voided: boolean
}): SignupToken | null {
  return transaction(() => {
    const now = nowMs()
    if (countForEmailSince(params.email, now - RESET_COOLDOWN_MS) > 0) {
      return null
    }
    if (
      countForEmailSince(params.email, now - RESET_DAILY_WINDOW_MS) >=
      RESET_PER_USER_DAILY_MAX
    ) {
      return null
    }

    const id = genId()
    insert('SignupToken', {
      id,
      email: params.email,
      username: params.username,
      redirectTo: params.redirectTo,
      tokenHash: params.tokenHash,
      expiresAt: now + SIGNUP_TOKEN_TTL_MS,
      usedAt: params.voided ? now : null,
      createdAt: now,
    })
    return mapSignupToken(
      db.prepare('SELECT * FROM "SignupToken" WHERE "id" = ?').get(id),
    )
  })
}

/** The newest signup row for an email, in any state (used, expired or live). */
export function findLatestSignupTokenForEmail(
  email: string,
): SignupToken | null {
  return mapSignupToken(
    db
      .prepare(
        'SELECT * FROM "SignupToken" WHERE "email" = ? ORDER BY "createdAt" DESC LIMIT 1',
      )
      .get(email),
  )
}

export type SignupTokenState = 'valid' | 'expired' | 'used' | 'invalid'

/** Look up a token by hash and say whether it can still be used. */
export function getSignupTokenState(tokenHash: string): {
  state: SignupTokenState
  token: SignupToken | null
} {
  const token = mapSignupToken(
    db
      .prepare('SELECT * FROM "SignupToken" WHERE "tokenHash" = ?')
      .get(tokenHash),
  )
  if (!token) return { state: 'invalid', token: null }
  if (token.usedAt) return { state: 'used', token }
  if (token.expiresAt.getTime() <= nowMs()) return { state: 'expired', token }
  return { state: 'valid', token }
}

export type CompleteSignupResult =
  | { ok: true; user: User; redirectTo: string | null }
  | { ok: false; reason: 'invalid' | 'username_taken' }

/**
 * Use a signup link: re-check the token, the username and the email in ONE
 * transaction, insert the user, and void every unused row of that email. The
 * caller hashes the password before the call, because bcrypt is async and a
 * transaction cannot span an await.
 */
export function completeSignup(params: {
  tokenHash: string
  username: string
  passwordHash: string
}): CompleteSignupResult {
  return transaction(() => {
    const { state, token } = getSignupTokenState(params.tokenHash)
    if (state !== 'valid' || !token) return { ok: false, reason: 'invalid' }

    const emailTaken = db
      .prepare('SELECT 1 FROM "User" WHERE lower("email") = lower(?)')
      .get(token.email)
    if (emailTaken) return { ok: false, reason: 'invalid' }

    const usernameTaken = db
      .prepare('SELECT 1 FROM "User" WHERE "username" = ?')
      .get(params.username)
    if (usernameTaken) return { ok: false, reason: 'username_taken' }

    const user = insertRegisteredUser({
      username: params.username,
      email: token.email,
      passwordHash: params.passwordHash,
    })
    db.prepare(
      'UPDATE "SignupToken" SET "usedAt" = ? WHERE "email" = ? AND "usedAt" IS NULL',
    ).run(nowMs(), token.email)

    return { ok: true, user, redirectTo: token.redirectTo }
  })
}

/** Delete rows created more than `ageMs` ago. Returns the number deleted. */
export function deleteSignupTokensOlderThan(ageMs: number): number {
  const result = db
    .prepare('DELETE FROM "SignupToken" WHERE "createdAt" < ?')
    .run(nowMs() - ageMs)
  return Number(result.changes)
}
