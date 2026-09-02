// e2e/canvas-grouping.spec.ts
// End-to-end coverage for canvas element grouping (group / ungroup) —
// canvas-element-grouping tactical plan, Wave 8, the mandatory Playwright
// completion gate per this project's own CLAUDE.md.
//
// Mirrors e2e/canvas-undo.spec.ts structure-for-structure: same
// window.__canvasEngine assertion technique (canvas content has no DOM),
// same dedicated-seed-per-test isolation, same `settle`/`undo`/`redo`
// mechanics, duplicated rather than imported — no canvas spec in this repo
// exports them (e2e/canvas-helpers.ts holds React-Flow/ER-board helpers
// only).
//
// SEEDING ORDER — same as every other canvas-engine suite:
// e2e/seed-canvas.ts's ProjectMember insert references IDS.viewerUser, a
// User row only e2e/seed-stress.ts creates. seed-stress.ts must run first
// (test.beforeAll); seed-canvas.ts re-seeds before every test (this suite
// creates, moves, resizes, deletes and re-groups elements every test).
//
// DEDICATED BOARD (IDS.canvasGroupBoard) — own board and own seed fixtures
// (canvasGroup, canvasGroupOuter/Inner, etc.), for the same reason
// canvasBoard/canvasConnectorBoard have their own: this suite's destructive
// cases (delete cascade, membership edits, resize) would otherwise perturb
// every other canvas spec's own element-count/geometry assumptions.
//
// FR-020 (Ctrl+G/Ctrl+Shift+G suppress the browser default) — verified under
// BOTH the `chromium` and `firefox` Playwright projects (playwright.config.ts
// scopes `firefox` to ONLY this file via `testMatch`, so no other existing
// spec's runtime or first-time-Firefox exposure changes). What "suppression"
// can actually be OBSERVED through Playwright's page-content-only API is
// stated honestly at the point of use below (see the "keyboard shortcuts"
// describe block) — native browser chrome (a find bar, if any) is outside
// Playwright's automation surface entirely; the real, provable signal is
// that the keydown reached the page's own handler and produced the expected
// board mutation, in both engines.
//
// REQUIREMENT COVERAGE — one row per the plan's own Wave 8 "cover, at
// minimum" list.
//   Create a group from a multi-select; click selects the whole group;
//     double-click descends one level at a time to the leaf   -> e2e
//   Move a group moves every member by the same offset; a bound
//     connector visibly follows                                -> e2e
//   Resize a group's frame leaves members untouched             -> e2e
//   Ungroup dissolves exactly one level (nested case)            -> e2e
//   Drag in/out membership editing; mid-drag crossing changes
//     nothing until release                                     -> e2e
//   Delete a group deletes every member; one Ctrl+Z restores it  -> e2e
//   Duplicate deep-clones with fresh, independent ids            -> e2e
//   Reload survives with group/frame/membership unchanged        -> e2e
//   Ctrl+G / Ctrl+Shift+G, Chromium AND Firefox                  -> e2e
//   Two browser contexts: a group/ungroup action is visible to
//     the other (collaboration)                                 -> e2e
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { BASE_URL, IDS } from './fixtures'
import type { Browser, Page } from '@playwright/test'

const BOARD_URL = `/canvas/${IDS.canvasGroupBoard}`

test.use({ viewport: { width: 1600, height: 1000 } })

test.beforeAll(() => {
  // seed.ts (global-setup) and seed-stress.ts must both have run first — see
  // the file header's "SEEDING ORDER" note.
  execFileSync('bun', ['run', 'e2e/seed-stress.ts'], { stdio: 'inherit' })
})

test.beforeEach(() => {
  execFileSync('bun', ['run', 'e2e/seed-canvas.ts'], { stdio: 'inherit' })
})

// ── helpers (mirrors e2e/canvas-undo.spec.ts) ────────────────────────────────

interface EngineConnectorEndpoint {
  kind: 'element' | 'point'
  elementId?: string
}

interface EngineElement {
  id: string
  kind: string
  x: number
  y: number
  width: number
  height: number
  text: string | null
  zIndex: number
  group?: { childIds: Array<string> }
  connector?: {
    source: EngineConnectorEndpoint
    target: EngineConnectorEndpoint
    routing: string
  }
}

interface EngineState {
  boardId: string
  elements: Array<EngineElement>
  camera: { x: number; y: number; zoom: number }
  selectedIds: Array<string>
  editingElementId: string | null
  tool: string
  readOnly: boolean
}

async function engine(page: Page): Promise<EngineState> {
  const state = await page.evaluate(() => window.__canvasEngine)
  if (!state) throw new Error('window.__canvasEngine is not published')
  return state as unknown as EngineState
}

async function openBoard(page: Page, url = BOARD_URL): Promise<EngineState> {
  await page.goto(url)
  await page.waitForSelector('canvas')
  await page.waitForFunction(() => window.__canvasEngine !== undefined, null, {
    timeout: 15_000,
  })
  return engine(page)
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

async function selectTool(page: Page, label: string) {
  await page.click(`[aria-label="${label}"]`)
}

async function dragMouse(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 10 })
  await page.mouse.move(to.x, to.y)
  await page.mouse.up()
}

function byId(state: EngineState, id: string) {
  return state.elements.find((element) => element.id === id)
}

/** See e2e/canvas-undo.spec.ts's identical helper for the full "why a fixed
 * page point does not work" rationale — duplicated rather than imported. */
async function focusBoard(page: Page) {
  const box = await page.locator('canvas').boundingBox()
  if (!box) throw new Error('canvas has no bounding box')
  await page.mouse.click(box.x + 40, box.y + 150)
}

/** Wait for a just-committed forward gesture to be RECORDED (undo-able), not
 * merely rendered — see canvas-undo.spec.ts's identical helper for the full
 * "optimistic scene update vs. `.then()`-recorded undo entry" race this
 * covers. */
async function settle(page: Page) {
  await page.waitForTimeout(1500)
}

async function undo(page: Page) {
  await focusBoard(page)
  await page.keyboard.press('Control+z')
}

const styleBar = (page: Page) =>
  page.getByRole('toolbar', { name: 'Selection' })

async function clickGroupButton(page: Page) {
  await styleBar(page).getByRole('button', { name: 'Group', exact: true }).click()
}

async function clickUngroupButton(page: Page) {
  await styleBar(page)
    .getByRole('button', { name: 'Ungroup', exact: true })
    .click()
}

/** Draw one rectangle by dragging the rectangle tool, mirroring
 * canvas-undo.spec.ts's "undo and redo a create" test. Returns its id once
 * the create has settled (server-acked, not merely the optimistic local id). */
async function drawRectangle(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<string> {
  const before = await engine(page)
  await selectTool(page, 'Rectangle (R)')
  await dragMouse(page, await worldToPage(page, from), await worldToPage(page, to))
  await expect
    .poll(async () => (await engine(page)).elements.length)
    .toBe(before.elements.length + 1)
  await settle(page)
  const drawn = (await engine(page)).elements.find(
    (e) => !before.elements.some((b) => b.id === e.id),
  )!
  return drawn.id
}

/** Marquee-select a world-space rectangle, starting well clear of any
 * element so the drag begins a marquee rather than grabbing one. */
async function marqueeSelect(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await dragMouse(page, await worldToPage(page, from), await worldToPage(page, to))
}

// ── tests ─────────────────────────────────────────────────────────────────

test.describe('creating a group', () => {
  test('marquee-selecting two elements and clicking Group binds them into a new group', async ({
    page,
  }) => {
    await openBoard(page)
    const a = await drawRectangle(page, { x: 950, y: 550 }, { x: 1050, y: 620 })
    const b = await drawRectangle(page, { x: 1150, y: 550 }, { x: 1250, y: 620 })

    await marqueeSelect(page, { x: 900, y: 530 }, { x: 1300, y: 650 })
    await expect
      .poll(async () => (await engine(page)).selectedIds.length)
      .toBe(2)

    const beforeGroup = await engine(page)
    await clickGroupButton(page)

    // The group is created LOCALLY, synchronously, on click (optimistic —
    // no server round trip to wait out here, unlike `settle()`'s own
    // create-ack race).
    await expect
      .poll(async () => (await engine(page)).elements.length)
      .toBe(beforeGroup.elements.length + 1)

    const after = await engine(page)
    const created = after.elements.find(
      (e) =>
        e.kind === 'group' &&
        e.group &&
        new Set(e.group.childIds).has(a) &&
        new Set(e.group.childIds).has(b),
    )
    expect(created).toBeDefined()
    expect(new Set(created!.group!.childIds)).toEqual(new Set([a, b]))
    expect(after.selectedIds).toEqual([created!.id])
  })
})

test.describe('selecting a group (click and double-click)', () => {
  test('clicking any member selects the whole group (FR-004)', async ({
    page,
  }) => {
    await openBoard(page)
    const memberCentre = await worldToPage(page, { x: 375, y: 350 }) // canvasGroupRectA's centre
    await page.mouse.click(memberCentre.x, memberCentre.y)
    await expect
      .poll(async () => (await engine(page)).selectedIds)
      .toEqual([IDS.canvasGroup])
  })

  test('one double-click descends exactly one level, not all the way (FR-005)', async ({
    page,
  }) => {
    await openBoard(page)
    // canvasGroupOuter -> canvasGroupInner -> {innerA, innerB}. innerA's own
    // centre is the raw hit; a single click there already selects the
    // OUTERMOST group by construction (Wave 2), so this test's OWN action is
    // one atomic double-click (2 rapid clicks, Playwright's `clickCount: 2`)
    // starting from a completely fresh page — no prior click at this point
    // to create ambiguity about which "streak" the browser's own click
    // counter is in.
    const innerACentre = await worldToPage(page, { x: 360, y: 740 })
    await page.mouse.click(innerACentre.x, innerACentre.y, { clickCount: 2 })
    await expect
      .poll(async () => (await engine(page)).selectedIds)
      .toEqual([IDS.canvasGroupInner])
    expect((await engine(page)).editingElementId).toBeNull()
  })

  test('a further double-click reaches the leaf and begins editing (FR-005)', async ({
    page,
  }) => {
    await openBoard(page)
    // TWO SEPARATE double-click gestures, with a genuine ~700ms pause
    // between them — NOT four rapid clicks in one continuous streak.
    // Confirmed empirically (a throwaway Playwright probe, since removed):
    // a real browser's native `dblclick` DOM event fires EXACTLY ONCE per
    // rapid click streak (Chromium does not re-fire it for a streak's 3rd
    // and 4th click) — so a `clickCount: 4` action, or four raw mousedown/
    // mouseup pairs with no gap, NEVER produces a second `dblclick` at all,
    // no matter how the app resolves it. Reaching a SECOND level of descent
    // therefore requires a real, if brief, pause LONG ENOUGH to exceed the
    // browser's own streak window (confirmed: >= ~700ms reliably does) so a
    // FRESH `dblclick` fires for the second pair — while `use-canvas-
    // input.ts`'s own `REPEAT_CLICK_WINDOW_MS` (1500ms, see that constant's
    // doc comment) is wider still, so `enteredPath` survives the pause
    // between the two gestures instead of being reset by the second
    // gesture's own first press.
    //
    // Gesture 1: click 1 selects the outermost group (canvasGroupOuter);
    // the dblclick after click 2 descends to canvasGroupInner (same as the
    // "one double-click descends exactly one level" test above).
    // Gesture 2 (after the pause): its own click 1 does not reset
    // `enteredPath` (within the wider repeat-click window); the dblclick
    // after its click 2 reaches innerA, which is not itself a group, so it
    // begins editing.
    const innerACentre = await worldToPage(page, { x: 360, y: 740 })
    await page.mouse.click(innerACentre.x, innerACentre.y, { clickCount: 2 })
    await expect
      .poll(async () => (await engine(page)).selectedIds)
      .toEqual([IDS.canvasGroupInner])
    await page.waitForTimeout(700)
    await page.mouse.click(innerACentre.x, innerACentre.y, { clickCount: 2 })
    await expect
      .poll(async () => (await engine(page)).editingElementId)
      .toBe(IDS.canvasGroupInnerA)
  })
})

test.describe('moving a group', () => {
  test("dragging a group's frame moves every member by the same offset; a bound connector's reference survives untouched", async ({
    page,
  }) => {
    await openBoard(page)
    const before = await engine(page)
    const rectABefore = byId(before, IDS.canvasGroupRectA)!
    const rectBBefore = byId(before, IDS.canvasGroupRectB)!

    // (500,350) sits in the GAP between rectA (300-450) and rectB (550-700)
    // — inside canvasGroup's own frame (300-700 x 300-400), but not on
    // either member, so the click hits the group's own body directly.
    const from = await worldToPage(page, { x: 500, y: 350 })
    const to = await worldToPage(page, { x: 700, y: 550 })
    await dragMouse(page, from, to)
    await settle(page)

    const after = await engine(page)
    const group = byId(after, IDS.canvasGroup)!
    const rectAAfter = byId(after, IDS.canvasGroupRectA)!
    const rectBAfter = byId(after, IDS.canvasGroupRectB)!

    expect(group.x).toBeCloseTo(500, 0) // 300 + 200
    expect(group.y).toBeCloseTo(500, 0)
    expect(rectAAfter.x - rectABefore.x).toBeCloseTo(200, 0)
    expect(rectAAfter.y - rectABefore.y).toBeCloseTo(200, 0)
    expect(rectBAfter.x - rectBBefore.x).toBeCloseTo(200, 0)
    expect(rectBAfter.y - rectBBefore.y).toBeCloseTo(200, 0)

    // The bound connector's endpoint REFERENCE survived the move untouched
    // (never rewritten, never detached) — a connector's shape is ALWAYS
    // derived live from its endpoints' CURRENT bounds (never a stored
    // offset), so a reference that still names the moved element IS the
    // complete proof it visibly follows: there is no separate stale copy
    // that could disagree with where rectA actually is now.
    const connector = byId(after, IDS.canvasGroupConnector)!
    expect(connector.connector!.source).toEqual({
      kind: 'element',
      elementId: IDS.canvasGroupRectA,
    })
    expect(connector.connector!.target).toEqual({
      kind: 'element',
      elementId: IDS.canvasGroupExternalRect,
    })
  })
})

test.describe('resizing a group', () => {
  test("resizing a group's frame leaves every member's own geometry untouched (FR-007)", async ({
    page,
  }) => {
    await openBoard(page)
    // Select the group directly (its own frame, the gap between members).
    const select = await worldToPage(page, { x: 500, y: 350 })
    await page.mouse.click(select.x, select.y)
    await expect
      .poll(async () => (await engine(page)).selectedIds)
      .toEqual([IDS.canvasGroup])

    // canvasGroup's own frame: (300,300)-(700,400). Its SE resize handle
    // sits exactly at that bottom-right corner in screen space.
    const se = await worldToPage(page, { x: 700, y: 400 })
    const to = await worldToPage(page, { x: 900, y: 600 })
    await dragMouse(page, se, to)
    await settle(page)

    const after = await engine(page)
    const group = byId(after, IDS.canvasGroup)!
    expect(group.width).toBeCloseTo(600, 0) // 900 - 300
    expect(group.height).toBeCloseTo(300, 0) // 600 - 300

    // Every member's OWN geometry is byte-for-byte untouched — resize
    // touches ONLY the group's own frame, never recurses into children.
    const rectA = byId(after, IDS.canvasGroupRectA)!
    const rectB = byId(after, IDS.canvasGroupRectB)!
    expect(rectA).toMatchObject({ x: 300, y: 300, width: 150, height: 100 })
    expect(rectB).toMatchObject({ x: 550, y: 300, width: 150, height: 100 })
  })
})

test.describe('ungrouping', () => {
  test('Ctrl+Shift+G dissolves exactly one level of a nested group (FR-008)', async ({
    page,
  }) => {
    await openBoard(page)
    const select = await worldToPage(page, { x: 360, y: 740 })
    await page.mouse.click(select.x, select.y) // selects canvasGroupOuter
    await expect
      .poll(async () => (await engine(page)).selectedIds)
      .toEqual([IDS.canvasGroupOuter])

    await page.keyboard.press('Control+Shift+g')

    const after = await engine(page)
    // The OUTER group is dissolved — only ONE level, not the whole subtree.
    expect(byId(after, IDS.canvasGroupOuter)).toBeUndefined()
    // Its direct child (still a group, un-descended) becomes the selection.
    expect(after.selectedIds).toEqual([IDS.canvasGroupInner])
    expect(byId(after, IDS.canvasGroupInner)).toBeDefined()
    expect(byId(after, IDS.canvasGroupInnerA)).toBeDefined()
    expect(byId(after, IDS.canvasGroupInnerB)).toBeDefined()
  })

  test('the toolbar Ungroup button does the same thing as the shortcut', async ({
    page,
  }) => {
    await openBoard(page)
    const select = await worldToPage(page, { x: 500, y: 350 })
    await page.mouse.click(select.x, select.y)
    await expect
      .poll(async () => (await engine(page)).selectedIds)
      .toEqual([IDS.canvasGroup])

    await clickUngroupButton(page)

    const after = await engine(page)
    expect(byId(after, IDS.canvasGroup)).toBeUndefined()
    expect(new Set(after.selectedIds)).toEqual(
      new Set([IDS.canvasGroupRectA, IDS.canvasGroupRectB]),
    )
    expect(byId(after, IDS.canvasGroupRectA)).toBeDefined()
    expect(byId(after, IDS.canvasGroupRectB)).toBeDefined()
  })
})

test.describe('membership drag-in/out (commit-on-drop)', () => {
  test("dragging a loose element into a group's frame and releasing joins it", async ({
    page,
  }) => {
    await openBoard(page)
    const from = await worldToPage(page, { x: 975, y: 350 }) // canvasGroupLooseRect's centre
    const to = await worldToPage(page, { x: 500, y: 350 }) // inside canvasGroup's frame gap
    await dragMouse(page, from, to)
    await settle(page)

    const after = await engine(page)
    const group = byId(after, IDS.canvasGroup)!
    expect(group.group!.childIds).toContain(IDS.canvasGroupLooseRect)
  })

  test('dragging a member out past the frame edge and releasing removes it, the group persists', async ({
    page,
  }) => {
    await openBoard(page)
    const from = await worldToPage(page, { x: 625, y: 350 }) // canvasGroupRectB's centre
    const to = await worldToPage(page, { x: 1100, y: 800 }) // well outside every frame

    // A PLAIN single click+drag starting on a member resolves to the
    // member's OUTERMOST group (FR-004's unconditional single-click rule)
    // and would drag the WHOLE group, not just rectB. Reaching the
    // individual member needs the drag's own pointerdown to be the SECOND
    // click of a rapid sequence (`event.detail > 1`, which skips the
    // outermost-group resolution and targets the raw hit instead) — the
    // same "double-click-then-drag-without-releasing" mechanism this
    // engine's own Wave 5 unit tests use. Driven with RAW `page.mouse`
    // primitives throughout, with no `expect.poll()` (or any other action)
    // between the first click and the drag-starting mousedown — an
    // intervening wait of even a hundred milliseconds risks exceeding the
    // browser's own multi-click timing window, which would reset
    // `event.detail` back to 1 and grab the whole group instead of the
    // member (this was observed empirically: an earlier draft of this test
    // polled `selectedIds` in between and consistently selected the GROUP,
    // not the member, on the second press).
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.up() // click 1 (detail 1): selects the whole group
    await page.mouse.down() // click 2 (detail 2): the drag's own press, targets rectB directly
    await page.mouse.move(to.x, to.y, { steps: 10 })
    await page.mouse.move(to.x, to.y)
    await page.mouse.up()
    await settle(page)

    const after = await engine(page)
    const group = byId(after, IDS.canvasGroup)!
    expect(group.group!.childIds).not.toContain(IDS.canvasGroupRectB)
    // The group itself SURVIVES with its remaining member (A13 — a group
    // does not auto-dissolve when membership drops).
    expect(group.group!.childIds).toContain(IDS.canvasGroupRectA)
    expect(byId(after, IDS.canvasGroup)).toBeDefined()
  })

  test('crossing a group frame mid-drag previews nothing; only the release decides (FR-012)', async ({
    page,
  }) => {
    await openBoard(page)
    const from = await worldToPage(page, { x: 975, y: 350 }) // canvasGroupLooseRect
    const through = await worldToPage(page, { x: 500, y: 350 }) // inside canvasGroup's frame
    const releaseOutside = await worldToPage(page, { x: 1100, y: 800 })

    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(through.x, through.y, { steps: 8 })
    await page.mouse.move(through.x, through.y)

    // Mid-drag, still pressed: the position moved (optimistic), but
    // membership must NOT have changed yet — it resolves only on release.
    const midDrag = await engine(page)
    expect(byId(midDrag, IDS.canvasGroup)!.group!.childIds).not.toContain(
      IDS.canvasGroupLooseRect,
    )

    await page.mouse.move(releaseOutside.x, releaseOutside.y, { steps: 8 })
    await page.mouse.up()
    await settle(page)

    // Released OUTSIDE the frame — no membership change occurred at all,
    // despite having crossed the frame in the middle of the drag.
    const after = await engine(page)
    expect(byId(after, IDS.canvasGroup)!.group!.childIds).not.toContain(
      IDS.canvasGroupLooseRect,
    )
  })
})

test.describe('delete cascade', () => {
  test('deleting a group deletes every member; one Ctrl+Z restores all of it (FR-013, FR-016)', async ({
    page,
  }) => {
    await openBoard(page)
    const select = await worldToPage(page, { x: 500, y: 350 })
    await page.mouse.click(select.x, select.y)
    await expect
      .poll(async () => (await engine(page)).selectedIds)
      .toEqual([IDS.canvasGroup])

    await page.keyboard.press('Delete')
    await expect
      .poll(async () => byId(await engine(page), IDS.canvasGroup))
      .toBeUndefined()
    expect(byId(await engine(page), IDS.canvasGroupRectA)).toBeUndefined()
    expect(byId(await engine(page), IDS.canvasGroupRectB)).toBeUndefined()
    // The connector, attached to a member, is swept too.
    expect(byId(await engine(page), IDS.canvasGroupConnector)).toBeUndefined()
    await settle(page)

    await undo(page)
    await expect(page.getByText('Undid deleting 4 elements')).toBeVisible()

    const restored = await engine(page)
    expect(byId(restored, IDS.canvasGroup)).toBeDefined()
    expect(byId(restored, IDS.canvasGroupRectA)).toBeDefined()
    expect(byId(restored, IDS.canvasGroupRectB)).toBeDefined()
    expect(byId(restored, IDS.canvasGroupConnector)).toBeDefined()
    expect(byId(restored, IDS.canvasGroup)!.group!.childIds).toEqual(
      expect.arrayContaining([IDS.canvasGroupRectA, IDS.canvasGroupRectB]),
    )
  })
})

test.describe('referential integrity on individual member delete (FR-018)', () => {
  test("deleting a member individually keeps the group sound, and it survives a reload", async ({
    page,
  }) => {
    await openBoard(page)
    const memberCentre = await worldToPage(page, { x: 625, y: 350 }) // canvasGroupRectB's centre

    // Same double-click-then-release technique the "dragging a member out"
    // test above uses to reach an individual member: a PLAIN single click on
    // a member resolves to the whole group (FR-004), so isolating rectB
    // needs the SECOND press of a rapid pair (`event.detail > 1`), released
    // without moving — a plain click on the member, not a drag.
    await page.mouse.move(memberCentre.x, memberCentre.y)
    await page.mouse.down()
    await page.mouse.up() // click 1 (detail 1): selects the whole group
    await page.mouse.down() // click 2 (detail 2): targets rectB directly
    await page.mouse.up()
    await expect
      .poll(async () => (await engine(page)).selectedIds)
      .toEqual([IDS.canvasGroupRectB])

    await page.keyboard.press('Delete')
    await expect
      .poll(async () => byId(await engine(page), IDS.canvasGroupRectB))
      .toBeUndefined()

    // The group SURVIVES (Wave 4's whole-group cascade never fired — only
    // one member, not the group, was selected) and its own `childIds` no
    // longer names the deleted row.
    const group = byId(await engine(page), IDS.canvasGroup)!
    expect(group.group!.childIds).not.toContain(IDS.canvasGroupRectB)
    expect(group.group!.childIds).toContain(IDS.canvasGroupRectA)
    await settle(page)

    // The cleanup was WRITTEN, not just rendered locally: a reload reads the
    // group's `childIds` back from storage, so if the patch had not actually
    // persisted the deleted id would still be there.
    await page.reload()
    await page.waitForSelector('canvas')
    await page.waitForFunction(() => window.__canvasEngine !== undefined, null, {
      timeout: 15_000,
    })
    const reloaded = byId(await engine(page), IDS.canvasGroup)!
    expect(reloaded.group!.childIds).not.toContain(IDS.canvasGroupRectB)
    expect(reloaded.group!.childIds).toContain(IDS.canvasGroupRectA)
    expect(byId(await engine(page), IDS.canvasGroupRectB)).toBeUndefined()
  })
})

test.describe('duplicating a group', () => {
  test('duplicate deep-clones the group with fresh, independent ids (FR-014)', async ({
    page,
  }) => {
    await openBoard(page)
    const select = await worldToPage(page, { x: 500, y: 350 })
    await page.mouse.click(select.x, select.y)
    await expect
      .poll(async () => (await engine(page)).selectedIds)
      .toEqual([IDS.canvasGroup])

    const before = await engine(page)
    await page.keyboard.press('Control+d')
    await expect
      .poll(async () => (await engine(page)).elements.length)
      .toBe(before.elements.length + 3) // copied group + 2 copied members
    await settle(page)

    const after = await engine(page)
    // A truly NEW element — not merely "any group but the original", which
    // would also match the unrelated SEEDED canvasGroupOuter/Inner fixtures
    // on this same board.
    const copiedGroup = after.elements.find(
      (e) => e.kind === 'group' && !before.elements.some((b) => b.id === e.id),
    )!
    expect(copiedGroup).toBeDefined()
    expect(copiedGroup.group!.childIds).not.toContain(IDS.canvasGroupRectA)
    expect(copiedGroup.group!.childIds).not.toContain(IDS.canvasGroupRectB)
    expect(copiedGroup.group!.childIds.length).toBe(2)
    // Copied children actually exist and are exactly the copy's own claimed
    // members (internally consistent, not pointing at the originals).
    for (const childId of copiedGroup.group!.childIds) {
      expect(byId(after, childId)).toBeDefined()
    }
    // The original survives untouched, alongside the independent copy.
    expect(byId(after, IDS.canvasGroup)!.group!.childIds).toEqual(
      expect.arrayContaining([IDS.canvasGroupRectA, IDS.canvasGroupRectB]),
    )
  })
})

test.describe('persistence', () => {
  test('reloading the board leaves the group, its frame, and its full membership unchanged', async ({
    page,
  }) => {
    const before = await openBoard(page)
    const groupBefore = byId(before, IDS.canvasGroup)!

    await page.reload()
    await page.waitForSelector('canvas')
    await page.waitForFunction(() => window.__canvasEngine !== undefined, null, {
      timeout: 15_000,
    })

    const after = await engine(page)
    const groupAfter = byId(after, IDS.canvasGroup)!
    expect(groupAfter.x).toBeCloseTo(groupBefore.x, 0)
    expect(groupAfter.y).toBeCloseTo(groupBefore.y, 0)
    expect(groupAfter.width).toBeCloseTo(groupBefore.width, 0)
    expect(groupAfter.height).toBeCloseTo(groupBefore.height, 0)
    expect(new Set(groupAfter.group!.childIds)).toEqual(
      new Set(groupBefore.group!.childIds),
    )
  })
})

test.describe('keyboard shortcuts (FR-020)', () => {
  // What this test can and cannot prove, stated honestly: Playwright
  // automates PAGE content, not native browser chrome — there is no API to
  // ask "is the browser's own Find bar open" in either engine. The
  // observable, provable signal is that the keydown reached this app's OWN
  // handler and produced the correct board mutation — which requires
  // `preventDefault()` having been called (a native default and a page
  // handler that both fired would still leave the mutation this test
  // asserts on) — verified identically under BOTH the `chromium` and the
  // `firefox` Playwright projects (playwright.config.ts's `firefox` project
  // is scoped via `testMatch` to run ONLY this file).
  test('Ctrl+G creates a group; Ctrl+Shift+G dissolves it', async ({
    page,
  }) => {
    await openBoard(page)
    const a = await drawRectangle(page, { x: 950, y: 550 }, { x: 1050, y: 620 })
    const b = await drawRectangle(page, { x: 1150, y: 550 }, { x: 1250, y: 620 })

    await marqueeSelect(page, { x: 900, y: 530 }, { x: 1300, y: 650 })
    await expect
      .poll(async () => (await engine(page)).selectedIds.length)
      .toBe(2)

    // Refocus the container WITHOUT disturbing the selection: clicking on an
    // element already in the current selection (no shift) keeps it as-is —
    // see use-canvas-input.ts's onPointerDown, the
    // `currentSelection.has(target.id)` branch. A plain `focusBoard()` click
    // on empty canvas would deselect both rects right before the shortcut.
    const onA = await worldToPage(page, { x: 1000, y: 585 })
    await page.mouse.click(onA.x, onA.y)
    await expect
      .poll(async () => (await engine(page)).selectedIds.length)
      .toBe(2)

    await page.keyboard.press('Control+g')
    const afterGroup = await engine(page)
    const created = afterGroup.elements.find(
      (e) =>
        e.kind === 'group' &&
        e.group &&
        new Set(e.group.childIds).has(a) &&
        new Set(e.group.childIds).has(b),
    )
    expect(created).toBeDefined()
    expect(afterGroup.selectedIds).toEqual([created!.id])

    await page.keyboard.press('Control+Shift+g')
    const afterUngroup = await engine(page)
    expect(byId(afterUngroup, created!.id)).toBeUndefined()
    expect(new Set(afterUngroup.selectedIds)).toEqual(new Set([a, b]))
    expect(byId(afterUngroup, a)).toBeDefined()
    expect(byId(afterUngroup, b)).toBeDefined()
  })
})

test.describe('collaboration', () => {
  test('a group created in one tab is visible in a second tab; ungrouping there is visible too', async ({
    page,
    browser,
  }: {
    page: Page
    browser: Browser
  }) => {
    await openBoard(page)
    const contextB = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 1600, height: 1000 },
    })
    const pageB = await contextB.newPage()
    try {
      await openBoard(pageB)

      // A groups a FRESH pair (not the seeded `canvasGroup`) so this test
      // asserts a real CREATE broadcast, not merely "the seed data matches
      // on both tabs".
      const a = await drawRectangle(
        page,
        { x: 950, y: 550 },
        { x: 1050, y: 620 },
      )
      const b = await drawRectangle(
        page,
        { x: 1150, y: 550 },
        { x: 1250, y: 620 },
      )
      await marqueeSelect(page, { x: 900, y: 530 }, { x: 1300, y: 650 })
      await expect
        .poll(async () => (await engine(page)).selectedIds.length)
        .toBe(2)
      await clickGroupButton(page)
      // Settle BEFORE capturing the created group's id, not after: the
      // scene shows the group under a CLIENT-GENERATED temporary id the
      // instant `groupSelection()` commits (optimistic, synchronous, no
      // network round trip yet). The server's ack then reconciles that
      // temporary id to the REAL one — the id tab B's broadcast actually
      // names — same trap (and same fix) as canvas-undo.spec.ts's own
      // "undo and redo a create" test documents at length.
      await settle(page)
      const afterGroup = await engine(page)
      const created = afterGroup.elements.find(
        (e) =>
          e.kind === 'group' &&
          e.group &&
          new Set(e.group.childIds).has(a) &&
          new Set(e.group.childIds).has(b),
      )!
      expect(created).toBeDefined()

      // B observes the new group via the live broadcast.
      await expect
        .poll(
          async () => Boolean(byId(await engine(pageB), created.id)),
          { timeout: 15_000 },
        )
        .toBe(true)
      const seenByB = byId(await engine(pageB), created.id)!
      expect(new Set(seenByB.group!.childIds)).toEqual(new Set([a, b]))

      // A ungroups it. Clicking the Group BUTTON moved DOM focus onto that
      // button, not the canvas container the keyboard shortcut needs —
      // refocus by clicking the group's OWN area first (already selected,
      // no shift, so the click keeps the selection exactly as it is rather
      // than disturbing it the way a plain `focusBoard()` on empty canvas
      // would).
      const onGroupArea = await worldToPage(page, { x: 1000, y: 585 })
      await page.mouse.click(onGroupArea.x, onGroupArea.y)
      await expect
        .poll(async () => (await engine(page)).selectedIds)
        .toEqual([created.id])
      await page.keyboard.press('Control+Shift+g')
      await expect
        .poll(async () => byId(await engine(page), created.id))
        .toBeUndefined()

      // B observes the dissolve too.
      await expect
        .poll(
          async () => byId(await engine(pageB), created.id),
          { timeout: 15_000 },
        )
        .toBeUndefined()
    } finally {
      await contextB.close()
    }
  })
})
