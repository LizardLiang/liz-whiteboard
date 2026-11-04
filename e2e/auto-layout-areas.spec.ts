// e2e/auto-layout-areas.spec.ts
// Auto Layout must treat an area as one block: its member tables are arranged
// INSIDE it, the area is resized to fit them, and no table ever leaves the
// area. Drives the real Auto Layout button in the bottom dock toolbar.
//
// Persisted result is read from the database after a reload, by shelling out
// to Bun (Playwright's runner is Node, no bun:sqlite). Table widths are NULL in
// the seed, so geometry uses the client's 220 px default width (DEFAULT_W); heights follow
// calculateTableHeight (40 header + 28 per column + 12 padding). Persistence
// is asserted via reload because `io` is null in the dev Vite process.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { tableNode } from './canvas-helpers'
import { IDS } from './fixtures'
import type { Page } from '@playwright/test'

test.use({ viewport: { width: 1600, height: 1000 } })

// Client-side layout width: DEFAULT_W (canvas-node-geometry) — the toolbar
// button lays out with the browser's measured widths, not the server's 250.
const TABLE_W = 220
const TABLE_H = 40 + 2 * 28 + 12
const MEMBER_IDS = [IDS.alaMember1, IDS.alaMember2, IDS.alaMember3]
const FREE_IDS = [IDS.alaFree1, IDS.alaFree2]

interface Rect {
  id: string
  x: number
  y: number
  w: number
  h: number
}
interface Persisted {
  tables: Array<{ id: string; x: number; y: number }>
  area: { x: number; y: number; w: number; h: number; members: Array<string> }
}

const READ_SCRIPT = `
import { Database } from 'bun:sqlite'
const db = new Database(process.env.E2E_DB_PATH ?? 'data/app.db', { readonly: true })
const wb = process.env.WB_ID
const tables = db.query('SELECT id, positionX AS x, positionY AS y FROM "DiagramTable" WHERE whiteboardId = ?').all(wb)
const a = db.query('SELECT positionX AS x, positionY AS y, width AS w, height AS h, memberTableIds AS m FROM "Area" WHERE whiteboardId = ?').get(wb)
console.log(JSON.stringify({ tables, area: { x: a.x, y: a.y, w: a.w, h: a.h, members: JSON.parse(a.m) } }))
`

function readPersisted(): Persisted {
  const out = execFileSync('bun', ['-e', READ_SCRIPT], {
    env: { ...process.env, WB_ID: IDS.alaWhiteboard },
    encoding: 'utf8',
  })
  return JSON.parse(out.trim().split('\n').pop() as string) as Persisted
}

function box(t: { id: string; x: number; y: number }): Rect {
  return { id: t.id, x: t.x, y: t.y, w: TABLE_W, h: TABLE_H }
}
function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  )
}
function centreInside(t: Rect, a: Persisted['area']): boolean {
  const cx = t.x + t.w / 2
  const cy = t.y + t.h / 2
  return cx >= a.x && cx <= a.x + a.w && cy >= a.y && cy <= a.y + a.h
}

test.beforeEach(() => {
  execFileSync('bun', ['run', 'e2e/seed-auto-layout-areas.ts'], {
    stdio: 'inherit',
  })
})

async function openBoard(page: Page) {
  await page.goto(`/whiteboard/${IDS.alaWhiteboard}`)
  await expect(
    page.getByRole('heading', { name: 'E2E Auto-Layout Areas' }),
  ).toBeVisible()
  await expect(tableNode(page, 'orders').first()).toBeVisible()
  await expect(tableNode(page, 'audit').first()).toBeVisible()
}

async function runAutoLayout(page: Page) {
  await openBoard(page)
  await page.getByRole('button', { name: 'Auto Layout' }).click()
  await expect(page.getByText('Layout applied to 5 tables')).toBeVisible()
  await page.reload()
  await expect(tableNode(page, 'orders').first()).toBeVisible()
}

test.describe('Auto Layout with areas', () => {
  test('keeps members inside their resized area, never changes membership, clears ungrouped tables', async ({
    page,
  }) => {
    // The messy seed must not already satisfy the assertions.
    const before = readPersisted()
    const membersInsideBefore = before.tables
      .map(box)
      .filter((t) => MEMBER_IDS.includes(t.id))
      .every(
        (t) =>
          t.x >= before.area.x &&
          t.x + t.w <= before.area.x + before.area.w &&
          t.y >= before.area.y &&
          t.y + t.h <= before.area.y + before.area.h,
      )
    expect(membersInsideBefore).toBe(false)

    await runAutoLayout(page)
    const after = readPersisted()
    const boxes = after.tables.map(box)
    const area: Rect = {
      id: IDS.alaArea,
      x: after.area.x,
      y: after.area.y,
      w: after.area.w,
      h: after.area.h,
    }

    // Membership is untouched.
    expect(new Set(after.area.members)).toEqual(new Set(MEMBER_IDS))

    // Every member lies fully inside the (resized) area, label header cleared.
    for (const t of boxes.filter((b) => MEMBER_IDS.includes(b.id))) {
      expect(t.x, `${t.id} left`).toBeGreaterThanOrEqual(area.x)
      expect(t.x + t.w, `${t.id} right`).toBeLessThanOrEqual(area.x + area.w)
      expect(t.y, `${t.id} top`).toBeGreaterThanOrEqual(area.y + 40)
      expect(t.y + t.h, `${t.id} bottom`).toBeLessThanOrEqual(area.y + area.h)
      expect(centreInside(t, after.area)).toBe(true)
    }

    // The area was resized (it was 500x420).
    expect([after.area.w, after.area.h]).not.toEqual([500, 420])

    // No two tables overlap, and no ungrouped table sits on the area box.
    for (const f of boxes.filter((b) => FREE_IDS.includes(b.id))) {
      expect(overlaps(f, area), `${f.id} overlaps the area`).toBe(false)
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(
          overlaps(boxes[i], boxes[j]),
          `${boxes[i].id} overlaps ${boxes[j].id}`,
        ).toBe(false)
      }
    }
  })

  test('rendered member boxes stay inside the rendered area box', async ({
    page,
  }) => {
    await runAutoLayout(page)

    const areaBox = await page
      .locator('.react-flow__node-area')
      .first()
      .boundingBox()
    expect(areaBox).not.toBeNull()
    const tol = 1
    for (const id of MEMBER_IDS) {
      const b = await page
        .locator(`.react-flow__node[data-id="${id}"]`)
        .boundingBox()
      expect(b, `${id} rendered`).not.toBeNull()
      expect(b!.x).toBeGreaterThanOrEqual(areaBox!.x - tol)
      expect(b!.y).toBeGreaterThanOrEqual(areaBox!.y - tol)
      expect(b!.x + b!.width).toBeLessThanOrEqual(
        areaBox!.x + areaBox!.width + tol,
      )
      expect(b!.y + b!.height).toBeLessThanOrEqual(
        areaBox!.y + areaBox!.height + tol,
      )
    }
  })
})
