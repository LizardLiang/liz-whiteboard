// e2e/relationship-reconnect.spec.ts
// Drag either end of a relationship line onto another column handle to move it.
//
// Seeded inline under Bun (Playwright's runner is Node, no bun:sqlite), in its
// own project: ADMIN e2e user + the VIEWER member, so the viewer case has a
// board it may open but not edit. The seed resets only this project.
//
// Persistence is asserted via the DB after a reload. The live broadcast to
// peers needs the single-process prod build (`io` is null in the dev Vite
// process), so peer sync is not asserted here.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { settle, tableNode, trackAcks } from './canvas-helpers'
import { IDS as SHARED } from './fixtures'
import { openViewerPage } from './viewer-session'
import type { Page } from '@playwright/test'

test.use({ viewport: { width: 1600, height: 1000 } })

const P = 'e6d00000-0000-4000-8000-'
const IDS = {
  project: `${P}000000000001`,
  whiteboard: `${P}000000000002`,
  users: `${P}000000000011`,
  orders: `${P}000000000012`,
  accounts: `${P}000000000013`,
  usersId: `${P}000000000021`,
  usersEmail: `${P}000000000022`,
  usersName: `${P}000000000023`,
  usersCreated: `${P}000000000024`,
  ordersId: `${P}000000000031`,
  ordersUserId: `${P}000000000032`,
  ordersTotal: `${P}000000000033`,
  ordersStatus: `${P}000000000034`,
  ordersCreated: `${P}000000000035`,
  accountsId: `${P}000000000041`,
  accountsOwner: `${P}000000000042`,
  accountsPlan: `${P}000000000043`,
  accountsRegion: `${P}000000000044`,
  relationship: `${P}000000000051`,
}

const SEED_SCRIPT = `
import { Database } from 'bun:sqlite'
const db = new Database(process.env.E2E_DB_PATH ?? 'data/app.db')
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA busy_timeout = 30000')
const I = JSON.parse(process.env.SEED_IDS)
const now = Date.now()
db.query('DELETE FROM "Project" WHERE id = ?').run(I.project)
db.query('INSERT INTO "Project" (id, name, description, createdAt, updatedAt, ownerId) VALUES (?,?,?,?,?,?)')
  .run(I.project, 'E2E Relationship Reconnect', 'relationship-reconnect e2e', now, now, process.env.OWNER_ID)
const member = db.query('INSERT INTO "ProjectMember" (id, projectId, userId, role, createdAt, updatedAt) VALUES (?,?,?,?,?,?)')
member.run(I.project + 'm1', I.project, process.env.OWNER_ID, 'ADMIN', now, now)
member.run(I.project + 'm2', I.project, process.env.VIEWER_ID, 'VIEWER', now, now)
db.query('INSERT INTO "Whiteboard" (id, name, projectId, folderId, canvasState, textSource, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)')
  .run(I.whiteboard, 'E2E Relationship Reconnect', I.project, null, null, null, now, now)
const table = db.query('INSERT INTO "DiagramTable" (id, whiteboardId, name, description, positionX, positionY, width, height, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)')
table.run(I.orders, I.whiteboard, 'orders', null, 0, 100, null, null, now, now)
table.run(I.users, I.whiteboard, 'users', null, 700, 0, null, null, now, now)
table.run(I.accounts, I.whiteboard, 'accounts', null, 700, 420, null, null, now, now)
const col = db.query('INSERT INTO "Column" (id, tableId, name, dataType, isPrimaryKey, isForeignKey, isUnique, isNullable, "order", createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
const cols = [
  [I.usersId, I.users, 'id', 'UUID', 1, 0],
  [I.usersEmail, I.users, 'email', 'VARCHAR', 0, 0],
  [I.usersName, I.users, 'display_name', 'VARCHAR', 0, 0],
  [I.usersCreated, I.users, 'created_at', 'TIMESTAMP', 0, 0],
  [I.ordersId, I.orders, 'id', 'UUID', 1, 0],
  [I.ordersUserId, I.orders, 'user_id', 'UUID', 0, 1],
  [I.ordersTotal, I.orders, 'total', 'DECIMAL', 0, 0],
  [I.ordersStatus, I.orders, 'status', 'VARCHAR', 0, 0],
  [I.ordersCreated, I.orders, 'created_at', 'TIMESTAMP', 0, 0],
  [I.accountsId, I.accounts, 'id', 'UUID', 1, 0],
  [I.accountsOwner, I.accounts, 'owner_name', 'VARCHAR', 0, 0],
  [I.accountsPlan, I.accounts, 'plan', 'VARCHAR', 0, 0],
  [I.accountsRegion, I.accounts, 'region', 'VARCHAR', 0, 0],
]
const orderOf = {}
for (const [id, tableId, name, type, pk, fk] of cols) {
  const order = (orderOf[tableId] = (orderOf[tableId] ?? -1) + 1)
  col.run(id, tableId, name, type, pk, fk, pk, pk ? 0 : 1, order, now, now)
}
db.query('INSERT INTO "Relationship" (id, whiteboardId, sourceTableId, targetTableId, sourceColumnId, targetColumnId, cardinality, label, routingPoints, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  .run(I.relationship, I.whiteboard, I.orders, I.users, I.ordersUserId, I.usersId, 'MANY_TO_ONE', 'places', null, now, now)
console.log('[e2e relationship-reconnect] seeded')
`

const READ_SCRIPT = `
import { Database } from 'bun:sqlite'
const db = new Database(process.env.E2E_DB_PATH ?? 'data/app.db', { readonly: true })
const row = db.query('SELECT sourceTableId, sourceColumnId, targetTableId, targetColumnId, cardinality, label FROM "Relationship" WHERE id = ?').get(process.env.REL_ID)
console.log(JSON.stringify(row))
`

function readRelationship() {
  const out = execFileSync('bun', ['-e', READ_SCRIPT], {
    env: { ...process.env, REL_ID: IDS.relationship },
    encoding: 'utf8',
  })
  return JSON.parse(out.trim().split('\n').pop()!) as {
    sourceTableId: string
    sourceColumnId: string
    targetTableId: string
    targetColumnId: string
    cardinality: string
    label: string | null
  }
}

const ORIGINAL = {
  sourceTableId: IDS.orders,
  sourceColumnId: IDS.ordersUserId,
  targetTableId: IDS.users,
  targetColumnId: IDS.usersId,
  cardinality: 'MANY_TO_ONE',
  label: 'places',
}

test.beforeEach(() => {
  const ids = execFileSync(
    'bun',
    [
      '-e',
      `import { Database } from 'bun:sqlite'
const db = new Database(process.env.E2E_DB_PATH ?? 'data/app.db', { readonly: true })
const owner = db.query('SELECT id FROM "User" WHERE username = ?').get(process.env.OWNER_NAME)
const viewer = db.query('SELECT id FROM "User" WHERE username = ?').get(process.env.VIEWER_NAME)
console.log(JSON.stringify({ owner: owner.id, viewer: viewer.id }))`,
    ],
    {
      env: {
        ...process.env,
        OWNER_NAME: 'e2e_dogfood',
        VIEWER_NAME: 'e2e_viewer',
      },
      encoding: 'utf8',
    },
  )
  const { owner, viewer } = JSON.parse(ids.trim().split('\n').pop()!)
  execFileSync('bun', ['-e', SEED_SCRIPT], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PROJECT_ID: SHARED.project,
      OWNER_ID: owner,
      VIEWER_ID: viewer,
      SEED_IDS: JSON.stringify(IDS),
    },
  })
})

async function openBoard(page: Page) {
  trackAcks(page)
  await page.goto(`/whiteboard/${IDS.whiteboard}`)
  for (const name of ['orders', 'users', 'accounts']) {
    await expect(tableNode(page, name).first()).toBeVisible()
  }
  await expect(
    page.locator(`.react-flow__edge[data-id="${IDS.relationship}"]`),
  ).toHaveCount(1)
  // Let the one-shot post-measure re-route and the socket connect finish.
  await page.waitForTimeout(1500)
}

const edge = (page: Page) =>
  page.locator(`.react-flow__edge[data-id="${IDS.relationship}"]`)

/** Drag one end of the relationship line onto a column handle, in steps. */
async function dragEnd(
  page: Page,
  end: 'source' | 'target',
  toHandleId: string,
) {
  await edge(page).locator('path.react-flow__edge-path').hover({ force: true })
  const grip = edge(page).locator(`.react-flow__edgeupdater-${end}`)
  const gripBox = await grip.boundingBox()
  if (!gripBox) throw new Error(`no ${end} grip`)
  await page.mouse.move(
    gripBox.x + gripBox.width / 2,
    gripBox.y + gripBox.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    gripBox.x + gripBox.width / 2 + 12,
    gripBox.y + gripBox.height / 2 + 12,
    { steps: 4 },
  )
  const handle = page.locator(`[data-handleid="${toHandleId}"]`).first()
  const box = await handle.boundingBox()
  if (!box) throw new Error(`no handle ${toHandleId}`)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 12,
  })
  await page.mouse.up()
}

test('dragging the target end onto another table column moves it and keeps cardinality and label', async ({
  page,
}) => {
  await openBoard(page)
  expect(readRelationship()).toEqual(ORIGINAL)

  await dragEnd(
    page,
    'target',
    `${IDS.accounts}__${IDS.accountsId}__left__target`,
  )
  await settle(page)

  await page.reload()
  await expect(edge(page)).toHaveCount(1)
  expect(readRelationship()).toEqual({
    ...ORIGINAL,
    targetTableId: IDS.accounts,
    targetColumnId: IDS.accountsId,
  })
  await expect(page.locator('.react-flow').getByText('places')).toBeVisible()
})

test('dragging the source end onto another column of the same table moves it', async ({
  page,
}) => {
  await openBoard(page)

  await dragEnd(
    page,
    'source',
    `${IDS.orders}__${IDS.ordersTotal}__right__source`,
  )
  await settle(page)

  await page.reload()
  await expect(edge(page)).toHaveCount(1)
  expect(readRelationship()).toEqual({
    ...ORIGINAL,
    sourceColumnId: IDS.ordersTotal,
  })
})

test('releasing an end on empty canvas snaps back and saves nothing', async ({
  page,
}) => {
  await openBoard(page)
  await edge(page).locator('path.react-flow__edge-path').hover({ force: true })
  const grip = await edge(page)
    .locator('.react-flow__edgeupdater-target')
    .boundingBox()
  if (!grip) throw new Error('no target grip')
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(1450, 900, { steps: 12 })
  await page.mouse.up()
  await settle(page)

  await expect(edge(page)).toHaveCount(1)
  expect(readRelationship()).toEqual(ORIGINAL)
  await page.reload()
  await expect(edge(page)).toHaveCount(1)
  expect(readRelationship()).toEqual(ORIGINAL)
})

test('a viewer cannot move a line end', async ({ browser }) => {
  const page = await openViewerPage(browser)
  await openBoard(page)
  // No grips are offered at all, and nothing is saved.
  await expect(edge(page).locator('.react-flow__edgeupdater')).toHaveCount(0)
  expect(readRelationship()).toEqual(ORIGINAL)
})
