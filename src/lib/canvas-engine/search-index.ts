// src/lib/canvas-engine/search-index.ts
// Search index for the Cmd/Ctrl+K canvas palette (canvas-cmd-k-search-panel
// tactical plan, step 1) — the bespoke-canvas sibling of
// src/lib/react-flow/search-index.ts.
//
// Builds a flat, client-side index of every LABELLED element in the current
// scene so the palette can filter by text and jump the camera to the match.
// No API call: `CanvasElement.text` already carries everything there is to
// search — see `buildCanvasSearchIndex`'s own rules below for what counts as
// labelled.
//
// Pure module: no React, no DOM, no database. Imports only `./scene`'s
// types, matching every other file in this directory.

import type { CanvasElementKind, Scene } from './scene'

/** One searchable element — selecting it navigates to `elementId`. */
export interface CanvasSearchEntry {
  elementId: string
  kind: CanvasElementKind
  text: string
}

/**
 * Flatten a scene into a search index: one entry per element that carries
 * text, in SCENE order (ascending z-order — `scene.ts`'s own invariant, and
 * the order `scene.elements` is already stored in).
 *
 * Two kinds of element are absent, and both are absences the app already
 * enforces elsewhere rather than a policy choice made here:
 *   - A `group` has no text by construction — `hit-test.ts`'s
 *     `resolveClickTarget` reports `editable: !isGroup` for exactly that
 *     reason, so a group entry could never be produced by real user data.
 *     Skipped as a guard against a hand-edited row, not a real case.
 *   - An element whose `text` is null, or whitespace-only once trimmed, has
 *     nothing to match on. An unlabelled rectangle is unfindable by search —
 *     a real, intended consequence, not an oversight.
 *
 * Every OTHER kind is indexed, connectors included: a connector's text is
 * real content the user typed, and `hit-test.ts`'s `resolvedBounds` already
 * resolves a connector to its drawn path's bounds, so there is nowhere for
 * search to fall over on one.
 *
 * NOT re-sorted by kind: the palette does its own grouping
 * (`CanvasSearch.tsx`), and a second ordering rule here is how the two would
 * drift apart.
 */
export function buildCanvasSearchIndex(
  scene: Scene,
): Array<CanvasSearchEntry> {
  const entries: Array<CanvasSearchEntry> = []
  for (const element of scene.elements) {
    if (element.kind === 'group') continue
    const text = element.text?.trim()
    if (!text) continue
    entries.push({ elementId: element.id, kind: element.kind, text })
  }
  return entries
}
