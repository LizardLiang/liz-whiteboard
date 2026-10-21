// e2e/board-render.spec.ts
// End-to-end coverage for the headless render pages the MCP server screenshots
// (/render/whiteboard/$token and /render/canvas/$token):
//   - a token minted through POST /api/render-token opens each page with NO
//     session cookie (the token is the whole credential);
//   - the page signals readiness, paints Chinese text, and keeps columns at
//     full detail even when fit zoom is below the level-of-detail threshold;
//   - the three framings (fit / focus / tile) report what they show;
//   - bad, unknown-focus and expired tokens produce a machine-readable error.
//
// Minting needs the collab JWT, which /api/collab-token issues to the MCP
// confidential client. Start the dev server with MCP_CLIENT_SECRET set and
// export the same value for this run (default: e2e-mcp-secret), e.g.
//   MCP_CLIENT_SECRET=e2e-mcp-secret bun run dev
//   bun run test:e2e e2e/board-render.spec.ts
// Both boards are seeded by e2e/seed-render.ts.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import type { APIRequestContext, Page } from '@playwright/test'

const MCP_CLIENT_ID = process.env.MCP_CLIENT_ID ?? 'mcp-server'
const MCP_CLIENT_SECRET = process.env.MCP_CLIENT_SECRET ?? 'e2e-mcp-secret'

// The render page is token-authenticated: prove it needs no session cookie.
test.use({ storageState: { cookies: [], origins: [] } })

test.beforeAll(() => {
  execFileSync('bun', ['run', 'e2e/seed.ts'], { stdio: 'inherit' })
  execFileSync('bun', ['run', 'e2e/seed-render.ts'], { stdio: 'inherit' })
})

async function mintRenderToken(
  request: APIRequestContext,
  kind: 'whiteboard' | 'canvas',
  boardId: string,
): Promise<string> {
  const collab = await request.post('/api/collab-token', {
    data: {
      client_id: MCP_CLIENT_ID,
      client_secret: MCP_CLIENT_SECRET,
      user_id: IDS.user,
    },
  })
  expect(
    collab.status(),
    'collab-token failed: start the dev server with MCP_CLIENT_SECRET set to the value this spec uses',
  ).toBe(200)
  const { token: collabJwt } = (await collab.json()) as { token: string }

  const render = await request.post('/api/render-token', {
    headers: { Authorization: `Bearer ${collabJwt}` },
    data: { kind, boardId },
  })
  expect(render.status()).toBe(200)
  return ((await render.json()) as { token: string }).token
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}
interface TileGrid {
  cols: number
  rows: number
  tileWidth: number
  tileHeight: number
  originX: number
  originY: number
  occupied: Array<[number, number]>
}

const root = (page: Page) => page.locator('[data-render-root]')

async function openRender(
  page: Page,
  kind: 'whiteboard' | 'canvas',
  token: string,
  query = '',
) {
  await page.goto(`/render/${kind}/${token}${query}`)
  await expect(root(page)).toHaveAttribute('data-render-ready', 'true', {
    timeout: 20_000,
  })
}

async function worldRect(page: Page): Promise<Rect> {
  const raw = await root(page).getAttribute('data-world-rect')
  return JSON.parse(raw ?? 'null') as Rect
}

async function tileGrid(page: Page): Promise<TileGrid> {
  const raw = await root(page).getAttribute('data-tile-grid')
  return JSON.parse(raw ?? 'null') as TileGrid
}

const tableNode = (page: Page, name: string) =>
  page.locator(`[data-table-name="${name}"]`).first()

test.describe('Board render pages (MCP board images)', () => {
  test('ER fit: paints Chinese text and full-detail columns below the LOD zoom', async ({
    page,
    request,
  }) => {
    const token = await mintRenderToken(
      request,
      'whiteboard',
      IDS.renderWhiteboard,
    )
    await openRender(page, 'whiteboard', token)

    await expect(tableNode(page, '用户表')).toBeVisible()
    await expect(tableNode(page, '订单')).toBeVisible()
    await expect(tableNode(page, 'far_away')).toBeVisible()

    // Columns exist at fit zoom. The board is wide enough that fit zoom is
    // under LOD_ZOOM_THRESHOLD (0.35); without the forced full detail the
    // column rows would collapse to handles and these labels would be gone.
    const view = page.viewportSize()!
    const seen = await worldRect(page)
    expect(view.width / seen.width).toBeLessThan(0.35)
    await expect(page.getByText('姓名')).toBeVisible()
    await expect(page.getByText('user_id')).toBeVisible()

    // No chrome: nothing but the board.
    await expect(page.getByText('Read-only')).toHaveCount(0)
    await expect(root(page)).not.toHaveAttribute('data-render-error')
  })

  test('ER tile: reports the grid and frames one window at zoom 1', async ({
    page,
    request,
  }) => {
    const token = await mintRenderToken(
      request,
      'whiteboard',
      IDS.renderWhiteboard,
    )
    await openRender(page, 'whiteboard', token)
    const grid = await tileGrid(page)
    expect(grid.occupied.length).toBeGreaterThan(1)
    expect(grid.cols * grid.rows).toBeGreaterThan(grid.occupied.length)

    const [row, col] = grid.occupied[0]
    await openRender(page, 'whiteboard', token, `?mode=tile&tile=${row},${col}`)
    const seen = await worldRect(page)
    expect(seen.x).toBeCloseTo(grid.originX + col * grid.tileWidth, 1)
    expect(seen.y).toBeCloseTo(grid.originY + row * grid.tileHeight, 1)
    expect(seen.width).toBeCloseTo(page.viewportSize()!.width, 1)
    await expect(tableNode(page, '用户表')).toBeInViewport()
    await expect(tableNode(page, 'far_away')).not.toBeInViewport()

    const [farRow, farCol] = grid.occupied[grid.occupied.length - 1]
    await openRender(
      page,
      'whiteboard',
      token,
      `?mode=tile&tile=${farRow},${farCol}`,
    )
    await expect(tableNode(page, 'far_away')).toBeInViewport()
  })

  test('ER focus: frames the named tables; an unknown id is an error', async ({
    page,
    request,
  }) => {
    const token = await mintRenderToken(
      request,
      'whiteboard',
      IDS.renderWhiteboard,
    )
    await openRender(
      page,
      'whiteboard',
      token,
      `?mode=focus&focus=${IDS.renderFarTable}&theme=dark`,
    )
    await expect(tableNode(page, 'far_away')).toBeInViewport()
    await expect(tableNode(page, '用户表')).not.toBeInViewport()
    await expect(page.locator('html')).toHaveClass(/dark/)

    await page.goto(`/render/whiteboard/${token}?mode=focus&focus=nope`)
    await expect(root(page)).toHaveAttribute(
      'data-render-error',
      'unknown-focus:nope',
    )
  })

  test('canvas board: paints elements, frames tiles, honours the theme', async ({
    page,
    request,
  }) => {
    const token = await mintRenderToken(
      request,
      'canvas',
      IDS.renderCanvasBoard,
    )
    await openRender(page, 'canvas', token)

    const painted = () =>
      page.evaluate(() => {
        const canvas = document.querySelector('canvas')!
        const ctx = canvas.getContext('2d')!
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
        for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true
        return false
      })
    expect(await painted()).toBe(true)
    // No search / export / tool chrome in the shot.
    await expect(page.getByRole('toolbar')).toHaveCount(0)
    await expect(page.getByLabel(/Search canvas elements/)).toHaveCount(0)

    const grid = await tileGrid(page)
    expect(grid.occupied.length).toBeGreaterThan(1)
    const [row, col] = grid.occupied[grid.occupied.length - 1]
    await openRender(
      page,
      'canvas',
      token,
      `?mode=tile&tile=${row},${col}&theme=dark`,
    )
    expect(await painted()).toBe(true)
    await expect(page.locator('html')).toHaveClass(/dark/)
    const seen = await worldRect(page)
    expect(seen.x).toBeCloseTo(grid.originX + col * grid.tileWidth, 1)

    await page.goto(
      `/render/canvas/${token}?mode=focus&focus=${IDS.renderCanvasRect},missing`,
    )
    await expect(root(page)).toHaveAttribute(
      'data-render-error',
      'unknown-focus:missing',
    )
  })

  test('a garbage token shows the invalid state', async ({ page }) => {
    await page.goto('/render/whiteboard/not-a-real-token')
    await expect(root(page)).toHaveAttribute(
      'data-render-error',
      'invalid-token',
    )
    await expect(root(page)).not.toHaveAttribute('data-render-ready')
  })

  test('a token for the wrong board kind shows the invalid state', async ({
    page,
    request,
  }) => {
    const token = await mintRenderToken(
      request,
      'canvas',
      IDS.renderCanvasBoard,
    )
    await page.goto(`/render/whiteboard/${token}`)
    await expect(root(page)).toHaveAttribute(
      'data-render-error',
      'invalid-token',
    )
  })

  test('an unknown board gets 404 from the mint route', async ({ request }) => {
    const collab = await request.post('/api/collab-token', {
      data: {
        client_id: MCP_CLIENT_ID,
        client_secret: MCP_CLIENT_SECRET,
        user_id: IDS.user,
      },
    })
    const { token } = (await collab.json()) as { token: string }
    const resp = await request.post('/api/render-token', {
      headers: { Authorization: `Bearer ${token}` },
      data: { kind: 'canvas', boardId: 'e1000000-0000-4000-8000-0000000000ff' },
    })
    expect(resp.status()).toBe(404)
  })

  test('an expired token shows the expired state', async ({
    page,
    request,
  }) => {
    // Real expiry: the token lives 60 seconds, so wait it out.
    test.setTimeout(120_000)
    const token = await mintRenderToken(
      request,
      'whiteboard',
      IDS.renderWhiteboard,
    )
    // Wait on the token's own `exp` against this machine's clock rather than a
    // fixed 62 seconds: a skewed or throttled clock would otherwise open the
    // page while the token is still live.
    const { exp } = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString(),
    ) as { exp: number }
    while (Date.now() / 1000 < exp + 2) await page.waitForTimeout(1000)
    await page.goto(`/render/whiteboard/${token}`)
    await expect(root(page)).toHaveAttribute(
      'data-render-error',
      'token-expired',
    )
    await expect(root(page)).not.toHaveAttribute('data-render-ready')
  })
})
