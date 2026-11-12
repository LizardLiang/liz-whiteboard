// e2e/auto-layout-area-peers.spec.ts
// A peer must never see an area member outside its area while another user
// runs Auto Layout. Table positions and area bounds used to reach the peer as
// separate messages (table:move:bulk, then area:update), so for a frame or
// more the members were placed against the OLD area box. They now travel in
// one table:move:bulk message and are applied in one callback.
//
// Run against playwright.coedit.config.ts (PROD build): in dev the Socket.IO
// `io` is null in the Vite process, so no broadcast would reach bob.
//
// The intermediate frame lasts only a render or two, so bob's page samples the
// rendered boxes on EVERY animation frame (requestAnimationFrame) instead of
// polling from the test runner.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { loginAndSaveState } from './global-setup-collab'
import {
  COEDIT_ALICE_STORAGE_STATE,
  COEDIT_BASE_URL,
  COEDIT_BOB_STORAGE_STATE,
} from './fixtures-collab'
import {
  COLLAB_AREA_WHITEBOARD_ID,
  COLLAB_ID,
  COLLAB_USERS,
} from './seed-collab-constants'
import type { Page } from '@playwright/test'

test.use({ viewport: { width: 1600, height: 1000 } })

const WB_URL = `/whiteboard/${COLLAB_AREA_WHITEBOARD_ID}`
const MEMBER_IDS = [
  COLLAB_ID.areaMember1,
  COLLAB_ID.areaMember2,
  COLLAB_ID.areaMember3,
]
/** Pixel slack for sub-pixel rounding of rendered boxes. */
const TOLERANCE = 1
/** How long bob's page keeps sampling after Alice clicks Auto Layout. */
const SAMPLE_WINDOW_MS = 4000

interface Box {
  x: number
  y: number
  w: number
  h: number
}
interface Sample {
  area: Box | null
  members: Record<string, Box | null>
}

/** Start a per-animation-frame sampler of the area and member boxes. */
async function startSampler(page: Page, memberIds: Array<string>) {
  await page.evaluate((ids) => {
    const w = window as unknown as {
      __samples: Array<unknown>
      __sampling: boolean
    }
    w.__samples = []
    w.__sampling = true
    const rect = (el: Element | null) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    }
    const tick = () => {
      if (!w.__sampling) return
      w.__samples.push({
        area: rect(document.querySelector('.react-flow__node-area')),
        members: Object.fromEntries(
          ids.map((id) => [
            id,
            rect(document.querySelector(`.react-flow__node[data-id="${id}"]`)),
          ]),
        ),
      })
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, memberIds)
}

async function stopSampler(page: Page): Promise<Array<Sample>> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __samples: Array<unknown>
      __sampling: boolean
    }
    w.__sampling = false
    return w.__samples
  }) as Promise<Array<Sample>>
}

function inside(m: Box, a: Box): boolean {
  return (
    m.x >= a.x - TOLERANCE &&
    m.y >= a.y - TOLERANCE &&
    m.x + m.w <= a.x + a.w + TOLERANCE &&
    m.y + m.h <= a.y + a.h + TOLERANCE
  )
}

/** Member position relative to its area origin, in screen pixels. */
function offset(s: Sample, id: string) {
  const m = s.members[id]
  if (!s.area || !m) return null
  return { x: m.x - s.area.x, y: m.y - s.area.y }
}

async function openBoard(page: Page) {
  await page.goto(WB_URL)
  await expect(page.getByRole('heading', { name: 'Area ERD' })).toBeVisible()
  await expect(
    page.locator('.react-flow__node[data-id="' + MEMBER_IDS[0] + '"]'),
  ).toBeVisible()
  await expect(page.locator('.react-flow__node-area').first()).toBeVisible()
}

test('a peer never sees an area member outside its area during Auto Layout', async ({
  browser,
}) => {
  const aliceContext = await browser.newContext({
    baseURL: COEDIT_BASE_URL,
    storageState: COEDIT_ALICE_STORAGE_STATE,
  })
  const bobContext = await browser.newContext({
    baseURL: COEDIT_BASE_URL,
    storageState: COEDIT_BOB_STORAGE_STATE,
  })

  try {
    const alicePage = await aliceContext.newPage()
    const bobPage = await bobContext.newPage()
    await openBoard(alicePage)
    await openBoard(bobPage)

    // Both pages start from the same tidy state: members inside the area.
    const bobStart = await bobPage.evaluate((ids) => {
      const r = (el: Element | null) => {
        const b = el!.getBoundingClientRect()
        return { x: b.x, y: b.y, w: b.width, h: b.height }
      }
      return {
        area: r(document.querySelector('.react-flow__node-area')),
        members: ids.map((id) =>
          r(document.querySelector(`.react-flow__node[data-id="${id}"]`)),
        ),
      }
    }, MEMBER_IDS)
    for (const m of bobStart.members) {
      expect(inside(m, bobStart.area)).toBe(true)
    }

    await startSampler(bobPage, MEMBER_IDS)

    await alicePage.getByRole('button', { name: 'Auto Layout' }).click()
    await expect(
      alicePage.getByText('Layout applied to 5 tables'),
    ).toBeVisible()

    // Wait for the layout to reach bob: a member moves relative to its area.
    await expect
      .poll(
        async () => {
          const probe = await bobPage.evaluate((id) => {
            const m = document
              .querySelector(`.react-flow__node[data-id="${id}"]`)
              ?.getBoundingClientRect()
            const a = document
              .querySelector('.react-flow__node-area')
              ?.getBoundingClientRect()
            return m && a ? { x: m.x - a.x, y: m.y - a.y } : null
          }, MEMBER_IDS[0])
          return probe
        },
        { timeout: 10_000 },
      )
      .not.toEqual({
        x: bobStart.members[0].x - bobStart.area.x,
        y: bobStart.members[0].y - bobStart.area.y,
      })

    // Keep sampling a little longer so a late area:updated would also be caught.
    await bobPage.waitForTimeout(SAMPLE_WINDOW_MS / 4)
    const samples = await stopSampler(bobPage)
    expect(samples.length).toBeGreaterThan(10)

    // Every frame: every member lies inside the area box rendered in that frame.
    const bad: Array<string> = []
    samples.forEach((s, i) => {
      for (const id of MEMBER_IDS) {
        const m = s.members[id]
        if (!s.area || !m || !inside(m, s.area)) {
          bad.push(
            `frame ${i}: ${id.slice(-2)} ${JSON.stringify(m)} vs area ${JSON.stringify(s.area)}`,
          )
        }
      }
    })
    expect(bad, bad.slice(0, 3).join('\n')).toEqual([])

    // Final state on bob matches alice (relative to the area, which is
    // independent of each page's pan/zoom).
    const finalOffsets = async (page: Page) =>
      page.evaluate((ids) => {
        const a = document
          .querySelector('.react-flow__node-area')!
          .getBoundingClientRect()
        const scale = a.width
        return ids.map((id) => {
          const m = document
            .querySelector(`.react-flow__node[data-id="${id}"]`)!
            .getBoundingClientRect()
          return {
            x: (m.x - a.x) / scale,
            y: (m.y - a.y) / scale,
          }
        })
      }, MEMBER_IDS)
    const aliceFinal = await finalOffsets(alicePage)
    const bobFinal = await finalOffsets(bobPage)
    aliceFinal.forEach((o, i) => {
      expect(bobFinal[i].x).toBeCloseTo(o.x, 2)
      expect(bobFinal[i].y).toBeCloseTo(o.y, 2)
    })
    // Sanity: layout really moved something relative to the start.
    expect(offset(samples[samples.length - 1], MEMBER_IDS[0])).not.toEqual({
      x: bobStart.members[0].x - bobStart.area.x,
      y: bobStart.members[0].y - bobStart.area.y,
    })
  } finally {
    await aliceContext.close()
    await bobContext.close()
  }
})

/** React Flow paints a node at `style.transform`; members are area-relative. */
async function memberTransforms(page: Page) {
  return page.evaluate(
    (ids) =>
      ids.map(
        (id) =>
          document.querySelector<HTMLElement>(
            `.react-flow__node[data-id="${id}"]`,
          )?.style.transform ?? null,
      ),
    MEMBER_IDS,
  )
}

// A peer's table:created patches the query cache, and ReactFlowCanvas re-syncs
// its node store from that cache. Until the save succeeded the cache held the
// pre-layout positions, so every laid-out table snapped back on Alice's screen
// while her save was pending (LizMeter #2246). Alice's bulk save is held back
// here, so the assertions run strictly inside the pending-save window.
test('a peer creating a table during the save does not snap the layout back', async ({
  browser,
}) => {
  // The first test already laid the board out and saved it, and Auto Layout is
  // deterministic, so a second run would not move anything. Re-seed the board
  // (this drops the sessions) and log both users in again.
  execFileSync('bun', ['run', 'e2e/seed-collab.ts'], { stdio: 'inherit' })
  for (const [username, state] of [
    ['alice_collab', COEDIT_ALICE_STORAGE_STATE],
    ['bob_collab', COEDIT_BOB_STORAGE_STATE],
  ] as const) {
    const user = COLLAB_USERS.find((u) => u.username === username)
    if (!user) throw new Error(`no ${username} in COLLAB_USERS`)
    await loginAndSaveState(user.email, state)
  }

  const aliceContext = await browser.newContext({
    baseURL: COEDIT_BASE_URL,
    storageState: COEDIT_ALICE_STORAGE_STATE,
  })
  const bobContext = await browser.newContext({
    baseURL: COEDIT_BASE_URL,
    storageState: COEDIT_BOB_STORAGE_STATE,
  })

  let releaseSave!: () => void
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve
  })

  try {
    const alicePage = await aliceContext.newPage()
    const bobPage = await bobContext.newPage()

    // Prod server-function URLs are hashes, not names: match the request by
    // its body. Only the bulk layout save carries a `positions` list.
    let saveHeld = false
    await alicePage.route('**/_serverFn/*', async (route) => {
      const req = route.request()
      if (
        req.method() === 'POST' &&
        (req.postData() ?? '').includes('positions')
      ) {
        saveHeld = true
        await saveGate
      }
      await route.continue()
    })

    await openBoard(alicePage)
    await openBoard(bobPage)

    const seedTransforms = await memberTransforms(alicePage)
    const nodeCount = () => alicePage.locator('.react-flow__node').count()
    const nodesBefore = await nodeCount()

    await alicePage.getByRole('button', { name: 'Auto Layout' }).click()

    // The optimistic layout reaches Alice's store before the save returns.
    await expect
      .poll(async () => memberTransforms(alicePage), { timeout: 10_000 })
      .not.toEqual(seedTransforms)
    await expect.poll(() => saveHeld).toBe(true)
    const laidOut = await memberTransforms(alicePage)

    // Bob creates a table while Alice's save is pending.
    await bobPage.getByRole('button', { name: 'Add Table' }).click()
    await bobPage.getByPlaceholder('e.g., Users').fill('snapback_probe')
    await bobPage.getByRole('button', { name: 'Create Table' }).click()

    // Alice receives the new table (her cache is patched and the store
    // re-syncs from it) ...
    await expect.poll(nodeCount, { timeout: 10_000 }).toBe(nodesBefore + 1)
    await alicePage.waitForTimeout(500)

    // ... and the layout is still on screen, with the save still pending.
    expect(await memberTransforms(alicePage)).toEqual(laidOut)
    expect(await memberTransforms(alicePage)).not.toEqual(seedTransforms)

    // Release the save: the layout stays.
    releaseSave()
    await expect(
      alicePage.getByText(/Layout applied to \d+ tables/),
    ).toBeVisible()
    expect(await memberTransforms(alicePage)).toEqual(laidOut)
  } finally {
    releaseSave()
    await aliceContext.close()
    await bobContext.close()
  }
})
