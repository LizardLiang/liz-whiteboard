// e2e/shape-connector-outline.spec.ts
// A connector attached to a diamond must end ON the diamond's drawn outline,
// not on its bounding rectangle.
//
// The seed (e2e/seed-shape-connector.ts) makes the connector board's target a
// diamond and leaves the connector unanchored, so its end comes from the
// centre-to-centre ray. The assertion reads the path the renderer itself draws,
// published by the `window.__canvasEngine` test hook while exactly one
// connector is selected, and checks the L1 outline equation |dx|/a + |dy|/b = 1.
// On the bounding box that sum is above 1 for every point but the four edge
// midpoints, so the check fails without the fix.
//
// SEEDING ORDER — seed-canvas.ts references IDS.viewerUser, which only
// seed-stress.ts creates, hence the beforeAll. Canvas is the default renderer,
// so no ?canvas flag is needed. Canvas mutations persist in dev too, but this
// spec only reads.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import type { Page } from '@playwright/test'

const BOARD_URL = `/canvas/${IDS.canvasConnectorBoard}`

test.use({ viewport: { width: 1600, height: 1000 } })

test.beforeAll(() => {
  execFileSync('bun', ['run', 'e2e/seed-stress.ts'], { stdio: 'inherit' })
})

test.beforeEach(() => {
  execFileSync('bun', ['run', 'e2e/seed-canvas.ts'], { stdio: 'inherit' })
  execFileSync('bun', ['run', 'e2e/seed-shape-connector.ts'], {
    stdio: 'inherit',
  })
})

interface Point {
  x: number
  y: number
}

interface EngineElement {
  id: string
  kind: string
  x: number
  y: number
  width: number
  height: number
}

interface EngineState {
  elements: Array<EngineElement>
  camera: { x: number; y: number; zoom: number }
  selectedIds: Array<string>
  connectorPath: Array<Point> | null
}

async function engine(page: Page): Promise<EngineState> {
  const state = await page.evaluate(() => window.__canvasEngine)
  if (!state) throw new Error('window.__canvasEngine is not published')
  return state as unknown as EngineState
}

test('a connector ends on the diamond outline, not its bounding box', async ({
  page,
}) => {
  await page.goto(BOARD_URL)
  await page.waitForSelector('canvas')
  await page.waitForFunction(() => window.__canvasEngine !== undefined, null, {
    timeout: 15_000,
  })

  const state = await engine(page)
  const source = state.elements.find((e) => e.id === IDS.canvasConnSource)!
  const diamond = state.elements.find((e) => e.id === IDS.canvasConnTarget)!
  expect(diamond.kind).toBe('diamond')

  // Click the connector at the midpoint of the two centres, which lies on the
  // centre-to-centre line.
  const box = (await page.locator('canvas').boundingBox())!
  const { camera } = state
  const mid = {
    x: (source.x + source.width / 2 + diamond.x + diamond.width / 2) / 2,
    y: (source.y + source.height / 2 + diamond.y + diamond.height / 2) / 2,
  }
  await page.mouse.click(
    box.x + (mid.x - camera.x) * camera.zoom,
    box.y + (mid.y - camera.y) * camera.zoom,
  )
  await expect
    .poll(async () => (await engine(page)).selectedIds)
    .toEqual([IDS.canvasConnector])

  const path = (await engine(page)).connectorPath
  expect(path).not.toBeNull()
  const end = path![path!.length - 1]

  const cx = diamond.x + diamond.width / 2
  const cy = diamond.y + diamond.height / 2
  const l1 =
    Math.abs(end.x - cx) / (diamond.width / 2) +
    Math.abs(end.y - cy) / (diamond.height / 2)
  expect(l1).toBeCloseTo(1, 2)

  // And it is not the bounding-box landing point: that has a larger L1 norm
  // and sits on the rect border.
  const onBboxBorder =
    Math.abs(end.x - diamond.x) < 0.5 ||
    Math.abs(end.x - (diamond.x + diamond.width)) < 0.5 ||
    Math.abs(end.y - diamond.y) < 0.5 ||
    Math.abs(end.y - (diamond.y + diamond.height)) < 0.5
  expect(onBboxBorder).toBe(false)
})
