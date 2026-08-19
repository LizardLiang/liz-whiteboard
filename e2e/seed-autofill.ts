// e2e/seed-autofill.ts
// Cleanup seed for e2e/auth-autofill.spec.ts. The register half of that spec
// creates a REAL account through the real /register form, so the account must
// not exist when the spec starts or the second run would hit the duplicate-
// email path and never reach the success assertion. e2e/seed.ts only deletes
// its own fixed IDS.user, so this account needs its own teardown.
//
// Deletes by username AND email independently: a half-finished run can leave
// one without the other.
//
// Run under BUN (needs bun:sqlite): `bun run e2e/seed-autofill.ts`
import { Database } from 'bun:sqlite'
import { E2E_AUTOFILL_USER } from './fixtures'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname

const db = new Database(DB_PATH)
db.exec('PRAGMA foreign_keys = ON')

const owned = db
  .query('SELECT id FROM "User" WHERE username = ? OR email = ?')
  .all(E2E_AUTOFILL_USER.username, E2E_AUTOFILL_USER.email) as Array<{
  id: string
}>

for (const user of owned) {
  db.query('DELETE FROM "ProjectMember" WHERE userId = ?').run(user.id)
  db.query('DELETE FROM "Project" WHERE ownerId = ?').run(user.id)
  db.query('DELETE FROM "User" WHERE id = ?').run(user.id)
}

db.close()

console.log(
  `[seed-autofill] removed ${owned.length} prior autofill test user(s)`,
)
