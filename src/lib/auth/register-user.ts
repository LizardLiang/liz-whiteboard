// src/lib/auth/register-user.ts
// Inserts a newly registered user. Registration NEVER assigns ownerless
// projects: an anonymous first registrant on a fresh or restored database
// must not take existing data. Ownerless projects are claimed only by the
// explicit OWNER_BACKFILL_EMAIL boot backfill (owner-email-backfill.ts).

import { db, genId, mapUser, nowMs } from '@/db'

export function insertRegisteredUser(data: {
  username: string
  email: string
  passwordHash: string
}) {
  const id = genId()
  const ts = nowMs()
  db.prepare(
    'INSERT INTO "User" ("id", "username", "email", "passwordHash", "failedLoginAttempts", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, 0, ?, ?)',
  ).run(id, data.username, data.email, data.passwordHash, ts, ts)

  return mapUser(db.prepare('SELECT * FROM "User" WHERE "id" = ?').get(id))!
}
