// e2e/multi-drag-area-members.spec.ts
// Regression guard for #2258: a multi-select drag of area-member tables must
// persist ABSOLUTE board positions. React Flow reports a member's position
// relative to its area, so a missed conversion at the canvas boundary would
// save area-relative values and the table would jump on reload.
//
// Persisted positions are read from the database by shelling out to Bun
// (Playwright's runner is Node, no bun:sqlite). Persistence is asserted from
// the DB, not the live broadcast, because `io` is null in the dev Vite process.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { tableNode } from './canvas-helpers'
import { IDS } from './fixtures'
import type { Page } from '@playwright/test'

test.use({ viewport: { width: 1700, height: 1000 } })

const SEEDED: Record<string, { x: number; y: number }> = {
  [IDS.mdaMember1]: { x: 140, y: 160 },
  [IDS.mdaMember2]: { x: 140, y: 340 },
  [IDS.mdaMember3]: { x: 420, y: 160 },
  [IDS.mdaFree]: { x: 1000, y: 160 },
}

const READ_SCRIPT = `
import { Database } from 'bun:sqlite'
const db = new Database(process.env.E2E_DB_PATH ?? 'data/app.db', { readonly: true })
const wb = process.env.WB_ID
const tables = db.query('SELECT id, positionX AS x, positionY AS y FROM "DiagramTable" WHERE whiteboardId = ?').all(wb)
const a = db.query('SELECT memberTableIds AS m FROM "Area" WHERE whiteboardId = ?').get(wb)
console.log(JSON.stringify({ tables, members: JSON.parse(a.m) }))
`

function readPersisted() {
  const out = execFileSync('bun', ['-e', READ_SCRIPT], {
    env: { ...process.env, WB_ID: IDS.mdaWhiteboard },
    encoding: 'utf8',
  })
  const parsed = JSON.parse(out.trim().split('\n').pop() as string) as {
    tables: Array<{ id: string; x: number; y: number }>
    members: Array<string>
  }
  const pos = new Map(parsed.tables.map((t) => [t.id, { x: t.x, y: t.y }]))
  return { pos, members: parsed.members }
}

/** Flow units. A mouse drag lands within a few units of the requested offset
 * (drag threshold, sub-pixel zoom). A relative-vs-absolute mix-up is off by
 * the area origin (100+), so this tolerance cannot hide it. */
const TOL = 6

const NAMES: Record<string, string> = {
  [IDS.mdaMember1]: 'alpha',
  [IDS.mdaMember2]: 'bravo',
  [IDS.mdaMember3]: 'charlie',
  [IDS.mdaFree]: 'delta',
}

/** Persisted position of every table as "name:x,y" lines, snapped to the
 * expected value when within TOL units so a pass compares equal and a failure
 * prints the real numbers. */
function snapshot(moved: Array<string>, dx: number, dy: number): string {
  const { pos } = readPersisted()
  return Object.keys(SEEDED)
    .map((id) => {
      const want = moved.includes(id)
        ? { x: SEEDED[id].x + dx, y: SEEDED[id].y + dy }
        : SEEDED[id]
      const got = pos.get(id) ?? { x: NaN, y: NaN }
      const ok =
        Math.abs(got.x - want.x) <= TOL && Math.abs(got.y - want.y) <= TOL
      const shown = ok ? want : got
      return NAMES[id] + ':' + shown.x + ',' + shown.y
    })
    .join(' | ')
}

function expectedSnapshot(moved: Array<string>, dx: number, dy: number) {
  return Object.keys(SEEDED)
    .map((id) => {
      const want = moved.includes(id)
        ? { x: SEEDED[id].x + dx, y: SEEDED[id].y + dy }
        : SEEDED[id]
      return NAMES[id] + ':' + want.x + ',' + want.y
    })
    .join(' | ')
}

test.beforeEach(() => {
  execFileSync('bun', ['run', 'e2e/seed-multi-drag-area.ts'], {
    stdio: 'inherit',
  })
})

async function openBoard(page: Page) {
  await page.goto(`/whiteboard/${IDS.mdaWhiteboard}`)
  await expect(
    page.getByRole('heading', { name: 'E2E Multi-Drag Area' }),
  ).toBeVisible()
  for (const n of ['alpha', 'bravo', 'charlie', 'delta']) {
    await expect(tableNode(page, n).first()).toBeVisible()
  }
}

async function viewportScale(page: Page): Promise<number> {
  const t = await page
    .locator('.react-flow__viewport')
    .evaluate((el) => (el as HTMLElement).style.transform)
  const m = /scale\(([-\d.]+)\)/.exec(t)
  if (!m) throw new Error(`unexpected viewport transform: ${t}`)
  return parseFloat(m[1])
}

async function anchor(page: Page, name: string) {
  const box = await tableNode(page, name).first().boundingBox()
  if (!box) throw new Error(`no box for ${name}`)
  return { x: box.x + 20, y: box.y + 10 }
}

/** Plain-click the first table, Ctrl-click the rest. */
async function selectTables(page: Page, names: Array<string>) {
  for (const [i, name] of names.entries()) {
    await tableNode(page, name)
      .first()
      .click({
        position: { x: 20, y: 10 },
        modifiers: i === 0 ? [] : ['Control'],
      })
  }
}

async function dragSelection(
  page: Page,
  leader: string,
  dxFlow: number,
  dyFlow: number,
) {
  const scale = await viewportScale(page)
  const a = await anchor(page, leader)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(
    a.x + (dxFlow * scale) / 2,
    a.y + (dyFlow * scale) / 2,
    { steps: 8 },
  )
  await page.mouse.move(a.x + dxFlow * scale, a.y + dyFlow * scale, {
    steps: 8,
  })
  await page.mouse.up()
}

async function expectPersistedThenStable(
  page: Page,
  moved: Array<string>,
  dx: number,
  dy: number,
) {
  await expect
    .poll(() => snapshot(moved, dx, dy), {
      timeout: 8000,
      message: 'moved tables persist as ABSOLUTE old position + offset',
    })
    .toBe(expectedSnapshot(moved, dx, dy))
  const { members } = readPersisted()
  expect(new Set(members)).toEqual(
    new Set([IDS.mdaMember1, IDS.mdaMember2, IDS.mdaMember3]),
  )
  // A reload must not change what is stored (no write-back of a different
  // value) and must render fine.
  await page.reload()
  await expect(tableNode(page, 'alpha').first()).toBeVisible()
  expect(snapshot(moved, dx, dy)).toBe(expectedSnapshot(moved, dx, dy))
}

test.describe('Multi-select drag of area members persists absolute positions (#2258)', () => {
  test('two members of one area (ctrl-click selection)', async ({ page }) => {
    await openBoard(page)
    await selectTables(page, ['alpha', 'bravo'])
    await dragSelection(page, 'alpha', 60, 40)
    await expectPersistedThenStable(
      page,
      [IDS.mdaMember1, IDS.mdaMember2],
      60,
      40,
    )
  })

  test('two members plus an ungrouped table', async ({ page }) => {
    await openBoard(page)
    await selectTables(page, ['alpha', 'charlie', 'delta'])
    await dragSelection(page, 'alpha', 50, 30)
    await expectPersistedThenStable(
      page,
      [IDS.mdaMember1, IDS.mdaMember3, IDS.mdaFree],
      50,
      30,
    )
  })

  test('shift-drag box selection over two members (selects the area too, so all members travel)', async ({
    page,
  }) => {
    await openBoard(page)
    const scale = await viewportScale(page)
    const a = await tableNode(page, 'alpha').first().boundingBox()
    const c = await tableNode(page, 'charlie').first().boundingBox()
    if (!a || !c) throw new Error('missing boxes')
    // Marquee over alpha + charlie (same row). Partial selection mode also
    // selects the area under the marquee, so the area is dragged with its
    // selected members and bravo travels with it.
    await page.keyboard.down('Shift')
    await page.mouse.move(a.x - 5 * scale, a.y - 5 * scale)
    await page.mouse.down()
    await page.mouse.move(c.x + c.width + 5 * scale, c.y + c.height, {
      steps: 10,
    })
    await page.mouse.up()
    await page.keyboard.up('Shift')
    await dragSelection(page, 'alpha', 40, 50)
    await expectPersistedThenStable(
      page,
      [IDS.mdaMember1, IDS.mdaMember2, IDS.mdaMember3],
      40,
      50,
    )
  })
})
