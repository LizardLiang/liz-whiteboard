// e2e/canvas-board-viewport.spec.ts
// End-to-end coverage for LizMeter #63 — the Canvas 2D board route had the
// same viewport-overflow bug as the ERD whiteboard route (the user folded
// both into this one ticket rather than opening a second).
//
// Root cause: identical to e2e/whiteboard-viewport.spec.ts — this route's own
// top-level wrapper used `h-screen` (100vh) while nested inside __root.tsx's
// already height-reduced `<main className="flex-1 overflow-auto">`, pushing
// the wrapper's bottom edge past `window.innerHeight`. Fixed by switching the
// wrapper from `h-screen` to `h-full`.
//
// Auth comes from global-setup (storageState). The canvas board itself is
// NOT seeded by global-setup — this file seeds it directly via
// e2e/seed-canvas.ts, mirroring e2e/canvas-board.spec.ts's own beforeAll, but
// only once (not per test): these tests only read geometry and never mutate
// the board.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import type { Page } from '@playwright/test'

const BOARD_URL = `/canvas/${IDS.canvasBoard}`

test.beforeAll(() => {
  execFileSync('bun', ['run', 'e2e/seed-canvas.ts'], { stdio: 'inherit' })
})

async function openBoard(page: Page) {
  await page.goto(BOARD_URL)
  await page.waitForSelector('canvas')
  await page.waitForFunction(() => window.__canvasEngine !== undefined, null, {
    timeout: 15_000,
  })
}

/**
 * Geometry of the route's own top-level wrapper — `<main>`'s single direct
 * child (the div this route's component returns). See
 * e2e/whiteboard-viewport.spec.ts's identical helper for why `<main>` itself
 * cannot be measured instead: its own flexbox-allocated height never reflects
 * an overflowing child (that's what `overflow-auto` is for).
 */
async function routeGeometry(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector('main')
    const root = document.querySelector('main > div')
    if (!main || !root) return null
    const rect = root.getBoundingClientRect()
    return {
      bottom: rect.bottom,
      innerHeight: window.innerHeight,
      mainScrollHeight: main.scrollHeight,
      mainClientHeight: main.clientHeight,
    }
  })
}

test.describe('Canvas board viewport fit (LizMeter #63)', () => {
  test('the route fills the shell without overflowing the viewport', async ({
    page,
  }) => {
    await openBoard(page)
    const geometry = await routeGeometry(page)
    expect(geometry).not.toBeNull()

    // Bidirectional: the bottom edge must not exceed the viewport, and must
    // not fall short of it by more than 2px of rounding slack.
    expect(geometry!.bottom).toBeLessThanOrEqual(geometry!.innerHeight)
    expect(geometry!.bottom).toBeGreaterThanOrEqual(geometry!.innerHeight - 2)
  })

  test('the authenticated shell has nothing left to scroll', async ({
    page,
  }) => {
    await openBoard(page)
    const geometry = await routeGeometry(page)
    expect(geometry).not.toBeNull()
    expect(geometry!.mainScrollHeight).toBeLessThanOrEqual(
      geometry!.mainClientHeight + 2,
    )
  })
})
