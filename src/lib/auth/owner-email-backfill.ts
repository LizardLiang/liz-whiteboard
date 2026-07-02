// src/lib/auth/owner-email-backfill.ts
// Backfills ownerless (NULL or empty-string ownerId) Projects to a specific,
// pre-designated account — identified by email, configurable via the
// OWNER_BACKFILL_EMAIL env var (defaults to shotup0101@gmail.com). Distinct
// from src/lib/auth/first-user-migration.ts's "assign to whichever user
// registers first" migration: this one targets a KNOWN account by email,
// regardless of registration order.
//
// Ordering with first-user-migration: this backfill runs first, at DB-init
// time (src/db.ts, right after the schema is created) — before any HTTP
// request (and therefore before any registration) can happen. If the target
// email's user already exists at that point, it claims any ownerless
// projects immediately, "winning" over the first-registered-user rule. If
// the target user does not exist yet, this is a no-op (it never creates the
// user) — ownerless projects are left for whichever user registers first
// (src/routes/api/auth.ts's registerUser's inline first-user logic) to
// claim; if the target email registers later, in a fresh install where
// someone else registered first, there is nothing left to backfill — that
// race is the documented, accepted trade-off (this backfill only ever wins
// when the target account already exists at startup).

import { db, nowMs } from '@/db'

const DEFAULT_OWNER_BACKFILL_EMAIL = 'shotup0101@gmail.com'

/** The configured target email — env var override, else the documented default. */
export const OWNER_BACKFILL_EMAIL =
  process.env.OWNER_BACKFILL_EMAIL || DEFAULT_OWNER_BACKFILL_EMAIL

/**
 * Assign every ownerless Project (ownerId IS NULL or '') to the user with
 * the given email. No-op (does not create a user) if no user with that
 * email exists yet. Idempotent — safe to call on every startup: once every
 * Project has an owner, subsequent calls match zero rows.
 *
 * @param email - Target account's email (defaults to OWNER_BACKFILL_EMAIL)
 */
export async function backfillOwnerlessProjectsByEmail(
  email: string = OWNER_BACKFILL_EMAIL,
): Promise<void> {
  const user = db
    .prepare('SELECT "id" FROM "User" WHERE "email" = ?')
    .get(email) as { id: string } | undefined

  if (!user) return

  db.prepare(
    `UPDATE "Project" SET "ownerId" = ?, "updatedAt" = ? WHERE "ownerId" IS NULL OR "ownerId" = ''`,
  ).run(user.id, nowMs())
}
