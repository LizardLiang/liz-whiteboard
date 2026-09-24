// e2e/seed-forgot-password.ts
// Deterministic seed for the forgot-password Playwright suite (LizMeter
// #1283). Run under BUN (needs bun:sqlite): `bun run e2e/seed-forgot-password.ts`.
// Idempotent — wipes and recreates a DEDICATED user (E2E_RESET_USER, not
// E2E_USER) on every run, so this suite's password change and session
// revocation never touch any other spec's login.
//
// Optionally seeds one known PasswordResetToken row when RESET_TOKEN_HASH is
// set in the environment. The spec generates the raw token itself (Node's
// crypto, available in Playwright's runner) and passes only its SHA-256
// hash here — matching the app's own invariant that the raw token is never
// persisted. RESET_TOKEN_EXPIRES_IN_MS (default 30 minutes) lets a test seed
// an already-expired token by passing a negative value.
//
// Password hashing is replicated inline from src/lib/auth/password.ts
// (SHA-256 pre-hash -> bcrypt cost 12) rather than imported, to keep this
// script free of app path-alias resolution — mirrors e2e/seed.ts.
import { createHash, randomUUID } from 'node:crypto'
import { Database } from 'bun:sqlite'
import bcrypt from 'bcryptjs'
import { E2E_RESET_USER, IDS } from './fixtures'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname

async function hashPassword(password: string): Promise<string> {
  const sha256 = createHash('sha256').update(password).digest('hex')
  return bcrypt.hash(sha256, 12)
}

const db = new Database(DB_PATH)
db.exec('PRAGMA foreign_keys = ON')
// The live dev server holds its own WAL writer against this same file — see
// e2e/seed.ts's identical comment.
db.exec('PRAGMA busy_timeout = 5000')
const now = Date.now()

// Wipe this user's prior rows (fixed id, so this is safe to re-run).
db.query('DELETE FROM "PasswordResetToken" WHERE "userId" = ?').run(
  IDS.resetPwUser,
)
db.query('DELETE FROM "Session" WHERE "userId" = ?').run(IDS.resetPwUser)
db.query('DELETE FROM "User" WHERE "id" = ?').run(IDS.resetPwUser)

db.query(
  'INSERT INTO "User" (id, username, email, passwordHash, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
).run(
  IDS.resetPwUser,
  E2E_RESET_USER.username,
  E2E_RESET_USER.email,
  await hashPassword(E2E_RESET_USER.password),
  now,
  now,
)

const tokenHash = process.env.RESET_TOKEN_HASH
if (tokenHash) {
  const expiresInMs = process.env.RESET_TOKEN_EXPIRES_IN_MS
    ? Number(process.env.RESET_TOKEN_EXPIRES_IN_MS)
    : 30 * 60 * 1000
  db.query(
    'INSERT INTO "PasswordResetToken" (id, userId, tokenHash, expiresAt, usedAt, createdAt) VALUES (?,?,?,?,?,?)',
  ).run(randomUUID(), IDS.resetPwUser, tokenHash, now + expiresInMs, null, now)
}

console.log(`[e2e seed] ok — forgot-password user ${IDS.resetPwUser}`)
