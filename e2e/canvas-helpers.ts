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
import { expect } from '@playwright/test'
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

/** Zoom out via the dock's zoom out button until the board is below
 * LOD_ZOOM_THRESHOLD — reproduces the dense-board working zoom canvas mode
 * is actually used at (the seeded stress board's own fitView scale can land
 * above OR below the threshold depending on table count/viewport, so this
 * drives it deliberately below rather than relying on fitView alone). */
export async function zoomBelowLodThreshold(page: Page) {
  const zoomOutButton = page.getByTitle('Zoom Out (Ctrl/Cmd + -)')
  for (let i = 0; i < 30; i++) {
    if ((await getViewportScale(page)) < LOD_ZOOM_THRESHOLD) return
    await zoomOutButton.click()
  }
  throw new Error(
    `could not zoom below LOD_ZOOM_THRESHOLD (${LOD_ZOOM_THRESHOLD}) after 30 clicks`,
  )
}

/**
 * Table geometry constants (tactical plan: canvas-field-note-popover) —
 * duplicated from src/lib/react-flow/canvas-node-geometry.ts (HEADER_H,
 * ROW_H, PAD_X). Same rationale as `LOD_ZOOM_THRESHOLD` above: e2e specs
 * run under Playwright's own TS transform, not the app's Vite/tsconfig-path
 * resolution, so importing `@/lib/...` from here is unproven territory —
 * these are single-sourced HERE instead and must be kept in sync with
 * canvas-node-geometry.ts by hand if either changes.
 */
export const HEADER_H = 34
export const ROW_H = 28
export const PAD_X = 12

/** Zoom in via the dock's zoom in button until the board is AT OR ABOVE
 * LOD_ZOOM_THRESHOLD — proves the collapse reverses cleanly (not a stuck
 * state) once zoomed back in, and reproduces the zoom a per-column
 * chrome-light row still exists at. */
export async function zoomAboveLodThreshold(page: Page) {
  const zoomInButton = page.getByTitle('Zoom In (Ctrl/Cmd + +)')
  for (let i = 0; i < 30; i++) {
    if ((await getViewportScale(page)) >= LOD_ZOOM_THRESHOLD) return
    await zoomInButton.click()
  }
  throw new Error(
    `could not zoom above LOD_ZOOM_THRESHOLD (${LOD_ZOOM_THRESHOLD}) after 30 clicks`,
  )
}

// ── ack tracking ────────────────────────────────────────────────────────────
// The undo entry for a write is pushed only when the server's ack arrives
// (use-canvas-undo.ts records nothing optimistically), and a paste or a
// duplicate pushes ONE entry only after every create in it has acked. The
// scene shows the copies at once, so "the copies are on screen" says nothing
// about whether Ctrl+Z has an entry for them. A fixed sleep guessed at the
// ack time and lost that guess under load (parallel stacks): Ctrl+Z then
// popped an older entry, or none, and the "Undid pasting 2 elements" toast
// never came. So the spec watches the Socket.IO frames itself: an emitted
// event that carries an ack id is pending until the ack frame with that id
// arrives.

interface AckTracker {
  /** Emits that carry an ack id and have no ack yet. */
  pending: Set<string>
  /** `performance.now()` at the last emit or ack frame. Monotonic: the wall
   * clock of this machine steps by 15 s, which would skip or stretch the
   * quiet time. */
  lastActivity: number
}

const ackTrackers = new WeakMap<Page, AckTracker>()
const SOCKET_EMIT_FRAME = /^42(?:\/[^,]*,)?(\d+)\[/
const SOCKET_ACK_FRAME = /^43(?:\/[^,]*,)?(\d+)\[/

/** Start watching the page's sockets. Call BEFORE the page opens its socket. */
export function trackAcks(page: Page) {
  if (ackTrackers.has(page)) return
  const tracker: AckTracker = {
    pending: new Set(),
    lastActivity: performance.now(),
  }
  ackTrackers.set(page, tracker)
  page.on('websocket', (socket) => {
    socket.on('framesent', (frame) => {
      if (typeof frame.payload !== 'string') return
      const id = SOCKET_EMIT_FRAME.exec(frame.payload)?.[1]
      if (id === undefined) return
      tracker.pending.add(id)
      tracker.lastActivity = performance.now()
    })
    socket.on('framereceived', (frame) => {
      if (typeof frame.payload !== 'string') return
      const id = SOCKET_ACK_FRAME.exec(frame.payload)?.[1]
      if (id === undefined) return
      tracker.pending.delete(id)
      tracker.lastActivity = performance.now()
    })
    // A closed socket (reload, navigation) never delivers its acks, and the
    // next socket numbers its ack ids from the start again.
    socket.on('close', () => {
      tracker.pending.clear()
      tracker.lastActivity = performance.now()
    })
  })
}

/** Quiet time that must follow the last emit or ack. A paste writes its
 * connectors in a second round, only after the first round's acks. */
const ACK_QUIET_MS = 400

/** Wait until every emitted write has its ack and no new frame came for a
 * short quiet time, so the undo entry the acks push exists. */
export async function settle(page: Page) {
  const tracker = ackTrackers.get(page)
  if (!tracker) {
    // A page this spec did not open through the board-open helper that calls `trackAcks` (no frame watching).
    await page.waitForTimeout(1500)
    return
  }
  await expect
    .poll(
      () =>
        tracker.pending.size === 0 &&
        performance.now() - tracker.lastActivity >= ACK_QUIET_MS,
      { timeout: 30_000, intervals: [50] },
    )
    .toBe(true)
  // Let the page run the callbacks that the last ack frame queued.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)))
}
