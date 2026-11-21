// e2e/seed-security-remaining.ts
// Seed helper for e2e/security-audit-remaining.spec.ts. Run under BUN (needs
// bun:sqlite): `bun run e2e/seed-security-remaining.ts <op>` with the op's
// arguments as JSON in SEC_ARGS. The raw signup and invite tokens are never
// stored (only their SHA-256 hash), and the e2e server never sends mail, so the
// spec makes its own raw token and passes the hash here. Every account this
// helper makes has an email that starts with `sec-`, which `reset` removes.
//
// Ops: reset | user | signup | invite | comment | role | hasuser
import './busy-report'
import { createHash, randomUUID } from 'node:crypto'
import { Database } from 'bun:sqlite'
import bcrypt from 'bcryptjs'
import { IDS } from './fixtures'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname

const op = process.argv[2]
const args = JSON.parse(process.env.SEC_ARGS ?? '{}') as Record<string, string>

const db = new Database(DB_PATH)
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA busy_timeout = 30000')
const now = Date.now()

async function hashPassword(password: string): Promise<string> {
  const sha256 = createHash('sha256').update(password).digest('hex')
  return bcrypt.hash(sha256, 12)
}

const COMMENT_MARK = 'sec-audit-comment'

function userIdByEmail(email: string): string {
  const row = db.query('SELECT id FROM "User" WHERE email = ?').get(email) as {
    id: string
  } | null
  if (!row) throw new Error(`no user ${email}`)
  return row.id
}

if (op === 'reset') {
  db.query('DELETE FROM "Comment" WHERE body LIKE ?').run(`${COMMENT_MARK}%`)
  db.query('DELETE FROM "SignupToken" WHERE email LIKE ?').run('sec-%')
  db.query('DELETE FROM "ProjectEmailInvite" WHERE email LIKE ?').run('sec-%')
  db.query('DELETE FROM "User" WHERE email LIKE ?').run('sec-%')
} else if (op === 'user') {
  db.query(
    'INSERT INTO "User" (id, username, email, passwordHash, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
  ).run(
    randomUUID(),
    args.username,
    args.email,
    await hashPassword(args.password),
    now,
    now,
  )
} else if (op === 'signup') {
  db.query(
    'INSERT INTO "SignupToken" (id, email, username, redirectTo, tokenHash, expiresAt, usedAt, createdAt) VALUES (?,?,?,?,?,?,?,?)',
  ).run(
    randomUUID(),
    args.email,
    args.username,
    null,
    args.hash,
    now + Number(args.ttlMs),
    null,
    now,
  )
} else if (op === 'invite') {
  db.query(
    'INSERT INTO "ProjectEmailInvite" (id, projectId, email, role, tokenHash, invitedByUserId, expiresAt, createdAt) VALUES (?,?,?,?,?,?,?,?)',
  ).run(
    randomUUID(),
    IDS.project,
    args.email,
    args.role,
    args.hash,
    IDS.user,
    now + Number(args.ttlMs),
    now,
  )
} else if (op === 'comment') {
  db.query(
    'INSERT INTO "Comment" (id, whiteboardId, parentId, targetType, targetTableId, authorId, body, resolved, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
  ).run(
    randomUUID(),
    IDS.whiteboard,
    null,
    'table',
    IDS.usersTable,
    userIdByEmail(args.authorEmail),
    `${COMMENT_MARK} ${args.text}`,
    0,
    now,
    now,
  )
} else if (op === 'role') {
  const row = db
    .query(
      'SELECT m.role AS role FROM "ProjectMember" m INNER JOIN "User" u ON u.id = m.userId WHERE m.projectId = ? AND u.email = ?',
    )
    .get(IDS.project, args.email) as { role: string } | null
  console.log(row ? row.role : 'NONE')
} else if (op === 'hasuser') {
  const row = db
    .query('SELECT 1 AS x FROM "User" WHERE email = ?')
    .get(args.email)
  console.log(row ? '1' : '0')
} else {
  throw new Error(`unknown op ${String(op)}`)
}
