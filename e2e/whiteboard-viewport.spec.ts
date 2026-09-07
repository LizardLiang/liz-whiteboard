// e2e/whiteboard-viewport.spec.ts
// End-to-end coverage for LizMeter #63 — the ERD whiteboard canvas area did
// not fully display in the viewport, making it hard to read.
//
// Root cause: __root.tsx renders the authenticated shell as
// `<main className="flex-1 overflow-auto">`, already height-reduced by the
// fixed-height `<Header/>` above it. This route's own top-level wrapper used
// `h-screen` (100vh) as if IT were the layout root, so its true height was
// computed from the full viewport instead of from `<main>`'s own (smaller)
// box — pushing the wrapper's bottom edge past `window.innerHeight`. React
// Flow's pane then ate the wheel events that would otherwise let that
// overflow scroll into view on `<main>`, making the extra strip permanently
// unreachable. Fixed by switching the wrapper from `h-screen` to `h-full`
// (fills the parent's already-correct height instead of re-deriving 100vh).
//
// Auth + seed data come from global-setup (storageState) — this route needs
// no extra seeding beyond global-setup's own seed.ts (IDS.whiteboard).
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import { tableNode } from './canvas-helpers'
import type { Page } from '@playwright/test'

const WB_URL = `/whiteboard/${IDS.whiteboard}`

async function openWhiteboard(page: Page) {
  await page.goto(WB_URL)
  await expect(page.getByRole('heading', { name: 'E2E ERD' })).toBeVisible()
  // Canvas ready: the seeded "users" table's chrome-light DOM node exists.
  await expect(tableNode(page, 'users').first()).toBeVisible()
}

/**
 * Geometry of the route's own top-level wrapper — `<main>`'s single direct
 * child (the div this route's component returns). `<main>` itself always
 * reports its own flexbox-allocated height regardless of what overflows
 * inside it (that's what `overflow-auto` is for), so measuring `<main>`
 * would hide exactly the bug this spec exists to catch — the overflow has to
 * be measured on the child that actually carries the (former) `h-screen`.
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

test.describe('Whiteboard viewport fit (LizMeter #63)', () => {
  test('the route fills the shell without overflowing the viewport', async ({
    page,
  }) => {
    await openWhiteboard(page)
    const geometry = await routeGeometry(page)
    expect(geometry).not.toBeNull()

    // Bidirectional: the bottom edge must not exceed the viewport, and must
    // not fall short of it by more than 2px of rounding slack — a real gap
    // would mean the route stopped filling the shell again.
    expect(geometry!.bottom).toBeLessThanOrEqual(geometry!.innerHeight)
    expect(geometry!.bottom).toBeGreaterThanOrEqual(geometry!.innerHeight - 2)
  })

  test('the authenticated shell has nothing left to scroll', async ({
    page,
  }) => {
    // The bug's actual symptom: the extra strip existed only as an
    // unreachable scroll offset on `<main>`, because React Flow's pane ate
    // the wheel events that would have exposed it. A correctly sized route
    // leaves `<main>` with nothing to scroll at all.
    await openWhiteboard(page)
    const geometry = await routeGeometry(page)
    expect(geometry).not.toBeNull()
    expect(geometry!.mainScrollHeight).toBeLessThanOrEqual(
      geometry!.mainClientHeight + 2,
    )
  })
})
