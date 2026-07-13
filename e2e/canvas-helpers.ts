// e2e/canvas-helpers.ts
// Shared LOD_ZOOM_THRESHOLD constant + zoom-driving helpers for the canvas
// e2e suite (canvas-rendering.spec.ts, canvas-edit-overlay.spec.ts) — single-
// sourced here (Hermes review WARNING 2) instead of copy-pasted per spec
// file, so the two specs can never silently drift on the threshold value the
// same way canvas-node-geometry.ts's `getEffectiveShowMode` exists to keep
// the canvas draw and chrome-light DOM from drifting in the app code itself.
//
// `tableNode` (canvas-unconditional-default) — the addressability hook every
// e2e spec rewritten off `?canvas=0` uses to find a table by name once canvas
// mode strips its DOM text: `data-table-name` is set on both the chrome-light
// AND full-DOM node roots (TableNode.tsx), so this one selector works
// regardless of which branch is currently rendering that table (e.g. the
// active edit overlay, or a table with its relations panel open).
import type { Locator, Page } from '@playwright/test'

/** Find a table node by name — works whether it's currently chrome-light
 * (canvas-drawn) or full-DOM (edit overlay / relations panel open), since
 * `data-table-name` is set on both node roots. Prefer this over
 * `.react-flow__node.filter({ hasText: name })`, which only matches
 * chrome-light tables by accident when some OTHER text node happens to
 * contain the name — chrome-light itself carries no text content at all. */
export function tableNode(page: Page, name: string): Locator {
  return page.locator(`[data-table-name="${name}"]`)
}

/** Zoom level below which TableNode/CanvasNodeLayer collapse to header-only
 * (tactical plan Phase 4, "parity sweep" item 4 — `getEffectiveShowMode` in
 * canvas-node-geometry.ts is the single source of truth both render paths
 * consult). Matches level-of-detail.ts's own `LOD_ZOOM_THRESHOLD` constant. */
export const LOD_ZOOM_THRESHOLD = 0.35

/** Read the live zoom straight from React Flow's own `.react-flow__viewport`
 * `translate(...) scale(z)` inline style — same technique
 * multi-select-drag.spec.ts's `getViewportScale` uses. */
export async function getViewportScale(page: Page): Promise<number> {
  const transform = await page
    .locator('.react-flow__viewport')
    .evaluate((el) => (el as HTMLElement).style.transform)
  const match = /scale\(([-\d.]+)\)/.exec(transform)
  if (!match) throw new Error(`unexpected viewport transform: ${transform}`)
  return parseFloat(match[1])
}

/** Zoom out via the Controls "zoom out" button until the board is below
 * LOD_ZOOM_THRESHOLD — reproduces the dense-board working zoom canvas mode
 * is actually used at (the seeded stress board's own fitView scale can land
 * above OR below the threshold depending on table count/viewport, so this
 * drives it deliberately below rather than relying on fitView alone). */
export async function zoomBelowLodThreshold(page: Page) {
  const zoomOutButton = page.locator('.react-flow__controls-zoomout')
  for (let i = 0; i < 30; i++) {
    if ((await getViewportScale(page)) < LOD_ZOOM_THRESHOLD) return
    await zoomOutButton.click()
  }
  throw new Error(
    `could not zoom below LOD_ZOOM_THRESHOLD (${LOD_ZOOM_THRESHOLD}) after 30 clicks`,
  )
}

/** Zoom in via the Controls "zoom in" button until the board is AT OR ABOVE
 * LOD_ZOOM_THRESHOLD — proves the collapse reverses cleanly (not a stuck
 * state) once zoomed back in, and reproduces the zoom a per-column
 * chrome-light row still exists at. */
export async function zoomAboveLodThreshold(page: Page) {
  const zoomInButton = page.locator('.react-flow__controls-zoomin')
  for (let i = 0; i < 30; i++) {
    if ((await getViewportScale(page)) >= LOD_ZOOM_THRESHOLD) return
    await zoomInButton.click()
  }
  throw new Error(
    `could not zoom above LOD_ZOOM_THRESHOLD (${LOD_ZOOM_THRESHOLD}) after 30 clicks`,
  )
}
