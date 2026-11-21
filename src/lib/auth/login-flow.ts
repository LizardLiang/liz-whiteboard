// src/lib/auth/login-flow.ts
// Credential check for loginUser. Server-only (static imports are fine here;
// the route file imports this module dynamically).
//
// Properties this module guarantees:
//  - attempts for one email are serialized (withEmailLock) so the failure
//    counter is re-read before each bcrypt run — N parallel guesses cannot all
//    pass the challenge check;
//  - every failure is counted per email, registered or not, so the Turnstile
//    challenge (after 5 failures) is identical for every email;
//  - when the challenge is required, the Turnstile token is checked BEFORE the
//    password, and a missing or bad token returns 'challenge' without a
//    password check;
//  - unknown email and wrong password return the SAME result, and the
//    unknown-email path still spends a bcrypt verification, so neither the
//    body nor the timing reveals which case happened.

import { findUserByEmail } from '@/data/user'
import { verifyPassword } from '@/lib/auth/password'
import {
  clearLoginFailures,
  isLoginChallengeRequired,
  recordLoginFailure,
  withEmailLock,
} from '@/lib/auth/rate-limit'
import { verifyTurnstile } from '@/lib/auth/turnstile'

/** bcrypt (cost 12) of an arbitrary string; nobody knows a matching password. */
export const DUMMY_PASSWORD_HASH =
  '$2b$12$i0JEpDz.EqrNtYlsTutaZ.5LtKOdg9Z.5jWg0kjSW5ldM4VBcg45e'

export type CredentialResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'challenge' }
  | {
      ok: false
      reason: 'unknown' | 'bad_password'
      /** True when a valid Turnstile token was supplied for this attempt. */
      challengePassed: boolean
    }

/**
 * Whether a failed login answers CHALLENGE_REQUIRED (show the widget) instead
 * of AUTH_FAILED. A missing or bad token always does. A wrong password after a
 * VALID token answers AUTH_FAILED, so the user learns the password was wrong;
 * the failure that just reached the threshold answers CHALLENGE_REQUIRED, so
 * the form shows the widget at once. Every email gets the same answer.
 */
export function failureNeedsChallenge(
  result: Extract<CredentialResult, { ok: false }>,
  email: string,
): boolean {
  if (result.reason === 'challenge') return true
  return !result.challengePassed && isLoginChallengeRequired(email)
}

export function checkCredentials(
  email: string,
  password: string,
  challenge: { turnstileToken?: string | null; ip: string } = { ip: 'unknown' },
): Promise<CredentialResult> {
  return withEmailLock(email, async () => {
    let challengePassed = false
    if (isLoginChallengeRequired(email)) {
      challengePassed = await verifyTurnstile(
        challenge.turnstileToken,
        challenge.ip,
      )
      if (!challengePassed) return { ok: false, reason: 'challenge' }
    }

    const user = await findUserByEmail(email)
    if (!user) {
      await verifyPassword(password, DUMMY_PASSWORD_HASH)
      recordLoginFailure(email)
      return { ok: false, reason: 'unknown', challengePassed }
    }

    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) {
      recordLoginFailure(email)
      return { ok: false, reason: 'bad_password', challengePassed }
    }

    clearLoginFailures(email)
    return { ok: true, userId: user.id }
  })
}
