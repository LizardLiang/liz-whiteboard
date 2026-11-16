// e2e/edge-side-area-member.spec.ts
// An edge from a table inside an area must leave from the side that faces its
// partner. React Flow keeps an area member's position RELATIVE to its area;
// edge routing needs ABSOLUTE positions. The one-shot re-route that runs after
// React Flow measures the nodes used the relative ones, so a member of an area
// far left of the origin "looked" right of its partner: the edge left from the
// member's LEFT side and entered the partner's RIGHT side, looping around both
// tables. Boards built through the MCP hit it often, because the agent puts
// most tables into areas.
//
// Seeded inline under Bun (Playwright's runner is Node, no bun:sqlite); the
// seed resets only this board, so it is safe to run before every test.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { tableNode } from './canvas-helpers'
import { IDS as SHARED } from './fixtures'
import type { Page } from '@playwright/test'

test.use({ viewport: { width: 1600, height: 1000 } })

const IDS = {
  whiteboard: 'e5d00000-0000-4000-8000-000000000001',
  area: 'e5d00000-0000-4000-8000-000000000002',
  member: 'e5d00000-0000-4000-8000-000000000011',
  memberId: 'e5d00000-0000-4000-8000-000000000021',
  memberFk: 'e5d00000-0000-4000-8000-000000000022',
  partner: 'e5d00000-0000-4000-8000-000000000012',
  partnerId: 'e5d00000-0000-4000-8000-000000000023',
  relationship: 'e5d00000-0000-4000-8000-000000000031',
}

// The area starts far left of the origin, so the member's relative x (300) and
// absolute x (-1700) put it on opposite sides of the partner (x -300).
const AREA = { x: -2000, y: 0, w: 600, h: 300 }
const MEMBER = { x: -1700, y: 60 }
const PARTNER = { x: -300, y: 60 }

const SEED_SCRIPT = `
import { Database } from 'bun:sqlite'
const db = new Database(process.env.E2E_DB_PATH ?? 'data/app.db')
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA busy_timeout = 30000')
const I = JSON.parse(process.env.SEED_IDS)
const G = JSON.parse(process.env.SEED_GEOMETRY)
const now = Date.now()
db.query('DELETE FROM "Whiteboard" WHERE id = ?').run(I.whiteboard)
db.query('INSERT INTO "Whiteboard" (id, name, projectId, folderId, canvasState, textSource, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)')
  .run(I.whiteboard, 'E2E Edge Side Area Member', process.env.PROJECT_ID, null, null, null, now, now)
const table = db.query('INSERT INTO "DiagramTable" (id, whiteboardId, name, description, positionX, positionY, width, height, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)')
table.run(I.member, I.whiteboard, 'report_detail', null, G.member.x, G.member.y, null, null, now, now)
table.run(I.partner, I.whiteboard, 'report', null, G.partner.x, G.partner.y, null, null, now, now)
const col = db.query('INSERT INTO "Column" (id, tableId, name, dataType, isPrimaryKey, isForeignKey, isUnique, isNullable, "order", createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
col.run(I.memberId, I.member, 'id', 'UUID', 1, 0, 1, 0, 0, now, now)
col.run(I.memberFk, I.member, 'report_id', 'UUID', 0, 1, 0, 0, 1, now, now)
col.run(I.partnerId, I.partner, 'id', 'UUID', 1, 0, 1, 0, 0, now, now)
db.query('INSERT INTO "Relationship" (id, whiteboardId, sourceTableId, targetTableId, sourceColumnId, targetColumnId, cardinality, label, routingPoints, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  .run(I.relationship, I.whiteboard, I.member, I.partner, I.memberFk, I.partnerId, 'ONE_TO_ONE', null, null, now, now)
db.query('INSERT INTO "Area" (id, whiteboardId, name, color, positionX, positionY, width, height, memberTableIds, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  .run(I.area, I.whiteboard, 'Far left', '#8b5cf6', G.area.x, G.area.y, G.area.w, G.area.h, JSON.stringify([I.member]), now, now)
console.log('[e2e edge-side-area-member] seeded')
`

test.beforeEach(() => {
  execFileSync('bun', ['-e', SEED_SCRIPT], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PROJECT_ID: SHARED.project,
      SEED_IDS: JSON.stringify(IDS),
      SEED_GEOMETRY: JSON.stringify({
        area: AREA,
        member: MEMBER,
        partner: PARTNER,
      }),
    },
  })
})

/** The edge path's first and last point, in flow coordinates (the path is
 *  drawn inside the viewport transform, so its own space IS flow space). */
async function edgeEnds(page: Page) {
  return page
    .locator(`path.react-flow__edge-path[id="${IDS.relationship}"]`)
    .evaluate((el: SVGPathElement) => {
      const start = el.getPointAtLength(0)
      const end = el.getPointAtLength(el.getTotalLength())
      return { startX: start.x, endX: end.x }
    })
}

/** Flow-space centre x of a node, read from React Flow's own absolute
 *  position so the check does not depend on the rendered table width. */
async function centreX(page: Page, name: string) {
  const node = tableNode(page, name).first()
  const box = await node.boundingBox()
  const pane = await page.locator('.react-flow__viewport').evaluate((el) => {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform)
    return { tx: m.e, scale: m.a }
  })
  const paneBox = await page.locator('.react-flow').first().boundingBox()
  if (!box || !paneBox) throw new Error(`no box for ${name}`)
  return (box.x + box.width / 2 - paneBox.x - pane.tx) / pane.scale
}

test('an area member far from the origin connects on the side facing its partner', async ({
  page,
}) => {
  await page.goto(`/whiteboard/${IDS.whiteboard}`)
  await expect(tableNode(page, 'report_detail').first()).toBeVisible()
  await expect(tableNode(page, 'report').first()).toBeVisible()
  const edge = page.locator(
    `path.react-flow__edge-path[id="${IDS.relationship}"]`,
  )
  await expect(edge).toHaveCount(1)

  // The wrong side came from a re-route that runs once React Flow has
  // measured the nodes — after the first, correct pass. Let it run, then read
  // once (no polling: a poll could pass on the early, correct frame).
  await page.waitForTimeout(1500)

  const memberCentre = await centreX(page, 'report_detail')
  const partnerCentre = await centreX(page, 'report')
  // Sanity: the seed really puts the member left of the partner on screen.
  expect(memberCentre).toBeLessThan(partnerCentre)

  const { startX, endX } = await edgeEnds(page)
  // Source = the member: the edge must leave from its RIGHT side…
  expect(startX).toBeGreaterThan(memberCentre)
  // …and enter the partner from its LEFT side.
  expect(endX).toBeLessThan(partnerCentre)

  // Same answer after a reload (the page-load path, not just this session).
  await page.reload()
  await expect(edge).toHaveCount(1)
  await page.waitForTimeout(1500)
  const again = await edgeEnds(page)
  expect(again.startX).toBeGreaterThan(memberCentre)
  expect(again.endX).toBeLessThan(partnerCentre)
})
