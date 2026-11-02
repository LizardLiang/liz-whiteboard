// e2e/canvas-diagram-style.spec.ts
// End-to-end coverage for the board diagram style (card / classic), the card
// role / step / shadow / border / fill-tint settings, hover path highlight and
// the flow-dot frame loop.
//
// Canvas content has no DOM, so the cases read pixels from the 2D context and
// element state from `window.__canvasEngine`. Pixel probes are POLLED: React
// state settles a frame before the canvas repaints.
//
// DEV/PROD — the collaborator broadcast (`board:settings-updated`) needs the
// single-process prod build; `io` is null in the dev Vite process. The style
// switch is therefore asserted through a reload, which proves persistence.
//
// SEEDING ORDER — seed-canvas.ts creates the project this board lives in, and
// its ProjectMember insert needs the viewer user from seed-stress.ts.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import type { Page } from '@playwright/test'

const BOARD_URL = `/canvas/${IDS.canvasStyleBoard}`
const RED_FILL = 'rgba(239, 68, 68, 0.10)'
const SIZE_B = { x: 860, y: 290, width: 200, height: 120 }
const NOTE = { x: 560, y: 560, width: 200, height: 120 }

test.use({ viewport: { width: 1600, height: 1000 } })

test.beforeAll(() => {
  execFileSync('bun', ['run', 'e2e/seed-stress.ts'], { stdio: 'inherit' })
})

test.beforeEach(async ({ page }) => {
  execFileSync('bun', ['run', 'e2e/seed-canvas.ts'], { stdio: 'inherit' })
  execFileSync('bun', ['run', 'e2e/seed-diagram-style.ts'], {
    stdio: 'inherit',
  })
  await page.addInitScript(() => {
    localStorage.setItem('theme', 'dark')
    const w = window as unknown as { __rafCount: number }
    w.__rafCount = 0
    const original = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (cb) => {
      w.__rafCount += 1
      return original(cb)
    }
  })
})

interface EngineElement {
  id: string
  style: Record<string, unknown>
}

async function engine(page: Page) {
  const state = await page.evaluate(() => window.__canvasEngine)
  if (!state) throw new Error('window.__canvasEngine is not published')
  return state as unknown as {
    elements: Array<EngineElement>
    camera: { x: number; y: number; zoom: number }
    selectedIds: Array<string>
    hoveredId: string | null
  }
}

async function openBoard(page: Page) {
  await page.goto(BOARD_URL)
  await page.waitForSelector('canvas')
  await page.waitForFunction(() => window.__canvasEngine !== undefined, null, {
    timeout: 15_000,
  })
}

async function worldToPage(page: Page, world: { x: number; y: number }) {
  const box = await page.locator('canvas').boundingBox()
  if (!box) throw new Error('canvas has no bounding box')
  const { camera } = await engine(page)
  return {
    x: box.x + (world.x - camera.x) * camera.zoom,
    y: box.y + (world.y - camera.y) * camera.zoom,
  }
}

async function pixelAtWorld(page: Page, world: { x: number; y: number }) {
  const { camera } = await engine(page)
  return page.evaluate(
    ({ target, view }) => {
      const c = document.querySelector('canvas')
      const ctx = c?.getContext('2d')
      if (!c || !ctx) return null
      const rect = c.getBoundingClientRect()
      const ratio = c.width / rect.width
      const x = Math.round((target.x - view.x) * view.zoom * ratio)
      const y = Math.round((target.y - view.y) * view.zoom * ratio)
      if (x < 0 || y < 0 || x >= c.width || y >= c.height) return null
      const d = ctx.getImageData(x, y, 1, 1).data
      return [d[0], d[1], d[2], d[3]]
    },
    { target: world, view: camera },
  )
}

/** A point inside a card but clear of its centred text and the round corners. */
const insideCorner = (r: {
  x: number
  y: number
  width: number
  height: number
}) => ({
  x: r.x + 24,
  y: r.y + r.height - 20,
})

async function openBoardStyle(page: Page) {
  await page.getByRole('button', { name: '看板樣式', exact: true }).click()
  await expect(
    page.getByRole('group', { name: '樣式', exact: true }),
  ).toBeVisible()
}

test('card look, per-card settings and persistence', async ({ page }) => {
  await openBoard(page)

  // Default board (no stored settings) opens as cards.
  await openBoardStyle(page)
  await expect(page.getByRole('button', { name: '樣式 卡片' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.keyboard.press('Escape')

  // Surface #161a23, not the stored pale blue.
  await expect
    .poll(async () =>
      (await pixelAtWorld(page, insideCorner(SIZE_B)))?.slice(0, 4),
    )
    .toEqual([22, 26, 35, 255])

  // Select card B and edit its card settings.
  const select = await worldToPage(page, insideCorner(SIZE_B))
  await page.mouse.click(select.x, select.y)
  const bar = page.getByRole('toolbar', { name: 'Selection' })
  await bar.getByRole('button', { name: '卡片', exact: true }).click()
  await page.getByRole('button', { name: '角色 系統' }).click()
  const step = page.getByRole('textbox', { name: '步驟' })
  await step.fill('02')
  await step.press('Enter')
  await page.getByRole('button', { name: '陰影 關' }).click()
  await page.getByRole('button', { name: '外框 強調' }).click()
  await page.keyboard.press('Escape')
  await bar.getByRole('button', { name: 'Fill', exact: true }).click()
  await page.getByRole('button', { name: 'Fill Red' }).click()
  await page.keyboard.press('Escape')

  // The writes are acked asynchronously: reload until they have persisted.
  await expect(async () => {
    await page.reload()
    await page.waitForFunction(() => window.__canvasEngine !== undefined)
    const b = (await engine(page)).elements.find(
      (e) => e.id === IDS.canvasStyleRectB,
    )!
    expect(b.style).toMatchObject({
      role: 'system',
      step: '02',
      cardShadow: 'off',
      cardBorder: 'accent',
      fill: RED_FILL,
    })
  }).toPass({ timeout: 15_000 })

  // Surface mixed 14% with red: red-tinted, and not the stored rgba.
  await expect
    .poll(async () => {
      const px = await pixelAtWorld(page, insideCorner(SIZE_B))
      return px ? px[0] - px[1] > 12 && px[3] === 255 : false
    })
    .toBe(true)
})

test('hover fades everything outside the flow path', async ({ page }) => {
  await openBoard(page)
  const away = await worldToPage(page, { x: 100, y: 800 })
  await page.mouse.move(away.x, away.y)
  const note = insideCorner(NOTE)
  await expect.poll(async () => (await pixelAtWorld(page, note))?.[3]).toBe(255)

  const over = await worldToPage(page, insideCorner(SIZE_B))
  await page.mouse.move(over.x, over.y, { steps: 5 })
  await expect
    .poll(async () => (await pixelAtWorld(page, note))?.[3], { timeout: 5_000 })
    .toBeLessThan(200)

  await page.mouse.move(away.x, away.y, { steps: 5 })
  await expect.poll(async () => (await pixelAtWorld(page, note))?.[3]).toBe(255)
})

test('always mode keeps the frame loop running, classic restores stored paint', async ({
  page,
}) => {
  await openBoard(page)
  const away = await worldToPage(page, { x: 100, y: 800 })
  await page.mouse.move(away.x, away.y)

  await openBoardStyle(page)
  await page.getByRole('button', { name: '流動點 一直跑' }).click()
  const rafCount = () =>
    page.evaluate(
      () => (window as unknown as { __rafCount: number }).__rafCount,
    )
  const before = await rafCount()
  await expect
    .poll(async () => (await rafCount()) - before, { timeout: 10_000 })
    .toBeGreaterThan(10)

  await page.getByRole('button', { name: '樣式 經典' }).click()
  await page.keyboard.press('Escape')

  // Classic: the stored 10% blue fill over an empty canvas, not an opaque
  // card. Reload until the style write has persisted.
  await expect(async () => {
    await page.reload()
    await page.waitForFunction(() => window.__canvasEngine !== undefined)
    await expect
      .poll(
        async () => {
          const px = await pixelAtWorld(page, insideCorner(SIZE_B))
          return px ? px[3] < 60 && px[2] > px[0] + 100 : false
        },
        { timeout: 3_000 },
      )
      .toBe(true)
  }).toPass({ timeout: 20_000 })

  await openBoardStyle(page)
  await expect(page.getByRole('button', { name: '樣式 經典' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(
    page.getByRole('button', { name: '流動點 一直跑' }),
  ).toHaveAttribute('aria-pressed', 'true')
})
