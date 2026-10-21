// e2e/seed-navigator.ts
// Deterministic seed for e2e/navigator-breadcrumb.spec.ts. Run under BUN:
// `bun run e2e/seed-navigator.ts`. Idempotent — wipes and recreates a
// dedicated project (IDS.navProject) owned by IDS.user (seeded by seed.ts,
// which global-setup.ts runs first).
import { Database } from 'bun:sqlite'
import { IDS } from './fixtures'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname

const db = new Database(DB_PATH)
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA busy_timeout = 5000')
const now = Date.now()

db.query('DELETE FROM "Project" WHERE id = ?').run(IDS.navProject)
db.query(
  'INSERT INTO "Project" (id, name, description, createdAt, updatedAt, ownerId) VALUES (?,?,?,?,?,?)',
).run(IDS.navProject, 'Nav Project', 'navigator e2e', now, now, IDS.user)
db.query(
  'INSERT INTO "ProjectMember" (id, projectId, userId, role, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
).run(crypto.randomUUID(), IDS.navProject, IDS.user, 'ADMIN', now, now)

function folder(id: string, name: string, parent: string | null) {
  db.query(
    'INSERT INTO "Folder" (id, name, projectId, parentFolderId, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
  ).run(id, name, IDS.navProject, parent, now, now)
}
function whiteboard(id: string, name: string, folderId: string | null) {
  db.query(
    'INSERT INTO "Whiteboard" (id, name, projectId, folderId, canvasState, textSource, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)',
  ).run(id, name, IDS.navProject, folderId, null, null, now, now)
}
function canvas(id: string, name: string, folderId: string | null) {
  db.query(
    'INSERT INTO "CanvasBoard" (id, name, projectId, folderId, createdAt, updatedAt) VALUES (?,?,?,?,?,?)',
  ).run(id, name, IDS.navProject, folderId, now, now)
}

folder(IDS.navDesignFolder, 'Design', null)
folder(IDS.navSpecsFolder, 'Specs', IDS.navDesignFolder)
folder(IDS.navEmptyFolder, 'Empty Folder', null)
whiteboard(IDS.navRootBoard, 'Nav Root ERD', null)
whiteboard(IDS.navDesignBoard, 'Design Overview', IDS.navDesignFolder)
whiteboard(IDS.navSpecsBoard, 'Quarterly Orders ERD', IDS.navSpecsFolder)
canvas(IDS.navSpecsCanvas, 'Quarterly Flow Sketch', IDS.navSpecsFolder)
db.close()
