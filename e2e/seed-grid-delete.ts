// e2e/seed-grid-delete.ts
// Deterministic seed for e2e/project-grid-delete.spec.ts. Run under BUN:
// `bun run e2e/seed-grid-delete.ts`. Idempotent — wipes and recreates a
// dedicated project (IDS.gridDelProject) owned by IDS.user, with two ERD
// boards and two canvas boards at the project root.
import { Database } from 'bun:sqlite'
import { IDS } from './fixtures'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname

const db = new Database(DB_PATH)
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA busy_timeout = 30000')
const now = Date.now()

db.query('DELETE FROM "Project" WHERE id = ?').run(IDS.gridDelProject)
db.query(
  'INSERT INTO "Project" (id, name, description, createdAt, updatedAt, ownerId) VALUES (?,?,?,?,?,?)',
).run(
  IDS.gridDelProject,
  'Grid Delete Project',
  'grid delete e2e',
  now,
  now,
  IDS.user,
)
db.query(
  'INSERT INTO "ProjectMember" (id, projectId, userId, role, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
).run(crypto.randomUUID(), IDS.gridDelProject, IDS.user, 'ADMIN', now, now)

function whiteboard(id: string, name: string) {
  db.query(
    'INSERT INTO "Whiteboard" (id, name, projectId, folderId, canvasState, textSource, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)',
  ).run(id, name, IDS.gridDelProject, null, null, null, now, now)
}
function canvas(id: string, name: string) {
  db.query(
    'INSERT INTO "CanvasBoard" (id, name, projectId, folderId, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
  ).run(id, name, IDS.gridDelProject, null, now, now)
}

whiteboard(IDS.gridDelErdKeep, 'Grid Keep ERD')
whiteboard(IDS.gridDelErdDrop, 'Grid Drop ERD')
canvas(IDS.gridDelCanvasKeep, 'Grid Keep Canvas')
canvas(IDS.gridDelCanvasDrop, 'Grid Drop Canvas')
db.close()
