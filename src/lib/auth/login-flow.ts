// src/lib/auth/login-flow.ts
// Credential check for loginUser. Server-only (static imports are fine here;
// the route file imports this module dynamically).
//
// Properties this module guarantees:
//  - attempts for one email are serialized (withEmailLock) so the lockout
//    state is re-read before each bcrypt run — N parallel guesses cannot all
//    pass the lockout check;
//  - the failed-attempt increment is a single atomic SQL UPDATE;
//  - unknown email, wrong password and locked account return the SAME
//    result, and the unknown-email path still spends a bcrypt verification,
//    so neither the body nor the timing reveals which case happened.

import { findUserByEmail } from '@/data/user'
import { verifyPassword } from '@/lib/auth/password'
import {
  checkLockout,
  clearLockout,
  recordFailedLogin,
  withEmailLock,
} from '@/lib/auth/rate-limit'

/** bcrypt (cost 12) of an arbitrary string; nobody knows a matching password. */
export const DUMMY_PASSWORD_HASH =
  '$2b$12$i0JEpDz.EqrNtYlsTutaZ.5LtKOdg9Z.5jWg0kjSW5ldM4VBcg45e'

export type CredentialResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'unknown' | 'bad_password' | 'locked' }

export function checkCredentials(
  email: string,
  password: string,
): Promise<CredentialResult> {
  return withEmailLock(email, async () => {
    const user = await findUserByEmail(email)
    if (!user) {
      await verifyPassword(password, DUMMY_PASSWORD_HASH)
      return { ok: false, reason: 'unknown' }
    }

    const lockout = await checkLockout(user.email)
    if (lockout.locked) {
      // Equal-cost path: still verify, result is discarded.
      await verifyPassword(password, DUMMY_PASSWORD_HASH)
      return { ok: false, reason: 'locked' }
    }

    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) {
      await recordFailedLogin(user.email)
      return { ok: false, reason: 'bad_password' }
    }

    await clearLockout(user.id)
    return { ok: true, userId: user.id }
  })
}
