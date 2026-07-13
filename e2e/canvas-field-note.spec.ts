// e2e/canvas-field-note.spec.ts
// End-to-end coverage for the canvas-native field-note popover (tactical
// plan: canvas-field-note-popover). Before this change, clicking the
// canvas-drawn field-note glyph mounted the full-DOM edit overlay
// (CanvasNodeLayer.tsx's `fieldnote` click branch called `requestEdit`);
// now it opens an in-place ColumnNotePopover, anchored beside the clicked
// column's row, the same canvas-native way the table-note/comment glyphs
// already work (see canvas-affordances.spec.ts).
//
// Reuses the same stress-seed harness as canvas-affordances.spec.ts (own
// beforeAll re-seed). e2e/seed-stress.ts sets a `description` on
// stress_table_0's PK column (`id`, order 0 → the first/earliest visible
// row) specifically for this spec — no other seeded column carries one, so
// without that fixture no field-note glyph would ever render.
//
// Wrinkle (unlike note/comment, which are driven via the right-click context
// menu): the field-note glyph is canvas-click-only — there is no menu item
// for it. This spec instead computes the glyph's on-screen coordinate from
// the target node's boundingBox() + live zoom (see canvas-helpers.ts's
// HEADER_H/ROW_H/PAD_X, duplicated from canvas-node-geometry.ts) and clicks
// it directly with `page.mouse.click`. CanvasNodeLayer's click listener is a
// CAPTURE-phase listener on the pane container itself (not the glyph), so it
// receives the click regardless of whatever DOM element (e.g. an edge's wide
// invisible hit-path) is actually topmost at that point.
//
// Real-time broadcast is NOT asserted here (dev Socket.IO `io` is null —
// same limitation noted in canvas-affordances.spec.ts); this spec only
// exercises the open/anchor/no-overlay behavior, not persistence, since the
// popover here is opened via a canvas click rather than the context menu.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import { HEADER_H, PAD_X, ROW_H, getViewportScale, tableNode } from './canvas-helpers'
import type { Page } from '@playwright/test'

const STRESS_TABLE_COUNT = 12
const WB_URL = `/whiteboard/${IDS.stressWhiteboard}?canvas=1`
const FIELD_NOTE_TEXT = 'Stress fixture field note for stress_table_0.id.'
// stress_table_0's PK column (`id`) is order 0 — the first/earliest visible
// row (rowIndex 0 within chromeLightRowColumns, ALL_FIELDS default showMode).
const FIELD_NOTE_ROW_INDEX = 0

test.use({ viewport: { width: 1600, height: 1000 } })

test.beforeAll(() => {
  execFileSync('bun', ['run', 'e2e/seed-stress.ts'], {
    stdio: 'inherit',
    env: { ...process.env, STRESS_TABLE_COUNT: String(STRESS_TABLE_COUNT) },
  })
})

async function openStressWhiteboardCanvasMode(page: Page) {
  await page.goto(WB_URL)
  await expect(
    page.getByRole('heading', { name: `E2E Stress (${STRESS_TABLE_COUNT})` }),
  ).toBeVisible()
  await expect(page.getByTestId('canvas-node-layer')).toBeVisible()
}

function chromeLightNodes(page: Page) {
  return page.locator('[data-testid="table-node-chrome-light"]')
}

/** Click the field-note glyph on `stress_table_0`'s first row — world→screen
 * coordinate math mirrors CanvasNodeLayer's draw loop exactly (glyph center
 * at `x + w - PAD_X - 6`, row center at `HEADER_H + rowIndex*ROW_H +
 * ROW_H/2`), scaled by the live viewport zoom. */
async function clickFieldNoteGlyph(page: Page) {
  const node = tableNode(page, 'stress_table_0')
  await expect(node).toBeVisible()
  const box = await node.boundingBox()
  if (!box) throw new Error('stress_table_0 node has no bounding box')
  const zoom = await getViewportScale(page)
  const x = box.x + box.width - (PAD_X + 6) * zoom
  const y = box.y + (HEADER_H + FIELD_NOTE_ROW_INDEX * ROW_H + ROW_H / 2) * zoom
  await page.mouse.click(x, y)
}

test.describe('Canvas field-note popover (tactical plan: canvas-field-note-popover)', () => {
  test('clicking the field-note glyph opens the note in place, pre-filled, without mounting the edit overlay', async ({
    page,
  }) => {
    await openStressWhiteboardCanvasMode(page)

    await clickFieldNoteGlyph(page)

    // Popover opens with the seeded field-note text pre-filled — proves the
    // SAME ColumnNotePopover/handleDescriptionUpdate the full-DOM ColumnRow
    // uses is reused, not a stub.
    const textarea = page.getByRole('textbox')
    await expect(textarea).toBeVisible()
    await expect(textarea).toHaveValue(FIELD_NOTE_TEXT)

    // The table never left its canvas-drawn, chrome-light form: no full-DOM
    // edit overlay mounted (`.table-header` stays 0, unlike double-clicking
    // the table — canvas-edit-overlay.spec.ts), and every stress table is
    // still chrome-light.
    await expect(page.locator('.table-header')).toHaveCount(0)
    await expect(chromeLightNodes(page)).toHaveCount(STRESS_TABLE_COUNT)

    await page.keyboard.press('Escape')
  })
})

// A coordinate-based VIEWER assertion (clicking the would-be glyph position
// and asserting no popover opens) is deliberately omitted here — per the
// tactical plan, it's brittle (the glyph isn't drawn at all for a viewer, so
// there's no stable coordinate to derive without editor-only geometry) and
// the editor-only gate (`canEdit &&` in CanvasNodeLayer's draw loop) is
// primarily covered by the mandatory manual/visual check instead (no
// field-note glyph rendered anywhere on the canvas for a VIEWER session).
