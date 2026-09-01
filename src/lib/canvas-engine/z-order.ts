// src/lib/canvas-engine/z-order.ts
// Paint-order planning for a selection.
//
// The scene stores elements in ASCENDING z, so "in front" means a HIGHER
// `zIndex`. This module answers one question — which rows must change, and to
// what — and answers it as DATA rather than by mutating a scene. That is what
// lets one plan drive all three consumers a canvas edit has: the optimistic
// local scene, the persisted write, and the undo entry's pre-state. A version
// that returned a new Scene would leave the other two to re-derive the same
// arithmetic, which is the drift this codebase keeps designing away from.
//
// ONLY THE SELECTION MOVES. Neither operation here touches a row the user did
// not select: bring-to-front stacks above the current maximum, send-to-back
// stacks below the current minimum. That keeps a re-order to as many writes as
// there are selected elements, and keeps the undo entry honest — it restores
// exactly what the gesture changed.
//
// Pure module: no React, no DOM, no database.

import { withGroupMembers } from './scene'
import type { CanvasElement, Scene } from './scene'

/**
 * Paint-order bounds, restated from `canvasZIndexSchema` (src/data/schema.ts).
 *
 * Restated rather than imported because this directory imports nothing — that
 * is what lets the engine be unit-tested with no browser and no database, and
 * the schema would pull Zod in. `z-order.test.ts` asserts the two agree, the
 * same drift guard `canvas-style-palette.ts` carries for its own constants.
 */
export const Z_MIN = -1_000_000
export const Z_MAX = 1_000_000

/** Which end of the stack a selection is being moved to. */
export type ZOrderCommand = 'front' | 'back'

/** One row's new paint order. */
export interface ZIndexChange {
  id: string
  zIndex: number
}

/**
 * The elements a z-order command may move, in ascending paint order.
 *
 * CONNECTORS ARE EXCLUDED. `render.ts` paints every connector before any other
 * element regardless of z, so re-ordering one against a rectangle changes a
 * stored number and nothing a user can see. A control that reports success and
 * visibly does nothing is worse than one that is absent — the same rule
 * `shapeStyleTargets` applies to text and connectors.
 *
 * EXPANDED THROUGH `withGroupMembers` FIRST (canvas-element-grouping
 * tactical plan, Wave 3): a selected group's whole subtree — the group
 * itself plus every descendant at every nesting depth — must move together
 * so ordering commands cannot interleave a non-member between two of its
 * members (FR-015). Expanding here, before the connector filter, is what
 * makes every other consumer (`planZOrder`'s own "already at that end"
 * short-circuit and its consecutive-value assignment, and
 * `SelectionToolbar.tsx`'s `sets.arrange`, which is built FROM this
 * function's own result) group-aware for free — none of them need to know
 * groups exist.
 */
export function zOrderTargets(
  scene: Scene,
  selectedIds: ReadonlySet<string>,
): Array<CanvasElement> {
  const expanded = new Set(withGroupMembers(scene, [...selectedIds]))
  return scene.elements.filter(
    (element) => expanded.has(element.id) && !element.connector,
  )
}

/**
 * What a z-order command would change, or an empty array if it would change
 * nothing.
 *
 * The relative order WITHIN the selection is preserved: the targets are read
 * in ascending scene order and given consecutive values in that same order, so
 * moving three overlapping shapes to the front keeps them stacked among
 * themselves exactly as they were. Assigning them all one value instead would
 * silently reshuffle them against each other by the id tie-break.
 *
 * Returns nothing when the selection is ALREADY at that end, so a repeated
 * click cannot push an undo entry that reverses to itself — the same guard the
 * style toolbar states for a swatch that is already active. "Already at that
 * end" is decided on scene ORDER, not on raw values: several rows legitimately
 * share a `zIndex` (the column defaults to 0, and raw seed scripts write it),
 * and comparing numbers would call a tied element "not at the front" forever
 * and re-plan a move on every click.
 *
 * CLAMPED to the stored bounds. A board would need a million re-orders to
 * reach them, but `canvasZIndexSchema` rejects anything past them, and a
 * rejected write is a worse failure than a shape that has run out of room to
 * climb. At the bound the operation degrades to a no-op rather than throwing.
 */
export function planZOrder(
  scene: Scene,
  selectedIds: ReadonlySet<string>,
  command: ZOrderCommand,
): Array<ZIndexChange> {
  const targets = zOrderTargets(scene, selectedIds)
  if (targets.length === 0) return []

  // The paintable stack, in the order the renderer walks it. Connectors are
  // absent for the same reason they are absent from `targets`: they are
  // painted before everything else whatever their z, so they cannot be what a
  // shape is in front of or behind.
  const stack = scene.elements.filter((element) => !element.connector)
  const targetIds = new Set(targets.map((element) => element.id))
  const occupiesEnd = (slice: Array<CanvasElement>) =>
    slice.every((element) => targetIds.has(element.id))
  if (
    command === 'front'
      ? occupiesEnd(stack.slice(stack.length - targets.length))
      : occupiesEnd(stack.slice(0, targets.length))
  ) {
    return []
  }

  // Measured across the WHOLE scene, connectors included. A connector's stored
  // z is real and occupies a value even though the renderer ignores it, so
  // ignoring it here could hand a shape a value a connector already holds.
  const zs = scene.elements.map((element) => element.zIndex)
  const planned =
    command === 'front'
      ? // Consecutive values starting one above the current top.
        targets.map((element, i) => ({
          id: element.id,
          zIndex: Math.min(Math.max(...zs) + 1 + i, Z_MAX),
        }))
      : // Consecutive values ending one below the current bottom, so the LAST
        // target lands directly beneath everything else and the first sits
        // beneath that — preserving their order among themselves.
        targets.map((element, i) => ({
          id: element.id,
          zIndex: Math.max(Math.min(...zs) - targets.length + i, Z_MIN),
        }))

  const currentById = new Map(targets.map((element) => [element.id, element.zIndex]))
  return planned.filter((change) => currentById.get(change.id) !== change.zIndex)
}
