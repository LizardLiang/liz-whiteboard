// src/lib/auth/owner-email-backfill.ts
// Backfills ownerless (NULL or empty-string ownerId) Projects to a specific,
// pre-designated account, identified by email and configured through the
// OWNER_BACKFILL_EMAIL env var. There is no default: when the variable is
// unset, the backfill does nothing and logs one line.
//
// This is the ONLY way ownerless projects get claimed. Registration never
// assigns them (an anonymous first registrant must not take existing data).
// The backfill runs at DB-init time (src/db.ts), and only claims projects
// when the target user already exists at startup. It never creates a user.

import { db, nowMs } from '@/db'

/**
 * Assign every ownerless Project (ownerId IS NULL or '') to the user with
 * the given email. No-op (does not create a user) if the email is unset or
 * no user with that email exists yet. Idempotent: once every Project has an
 * owner, later calls match zero rows.
 *
 * @param email - Target account's email (defaults to the OWNER_BACKFILL_EMAIL env var, read at call time)
 */
export async function backfillOwnerlessProjectsByEmail(
  email: string | undefined = process.env.OWNER_BACKFILL_EMAIL,
): Promise<void> {
  const target = email?.trim()
  if (!target) {
    console.log(
      '[owner-backfill] OWNER_BACKFILL_EMAIL is not set; ownerless projects are left unclaimed',
    )
    return
  }

  const user = db
    .prepare('SELECT "id" FROM "User" WHERE "email" = ?')
    .get(target) as { id: string } | undefined

  if (!user) return

  db.prepare(
    `UPDATE "Project" SET "ownerId" = ?, "updatedAt" = ? WHERE "ownerId" IS NULL OR "ownerId" = ''`,
  ).run(user.id, nowMs())
}
