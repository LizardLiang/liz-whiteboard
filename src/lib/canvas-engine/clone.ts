// src/lib/canvas-engine/clone.ts
// Copy/paste/duplicate planning (canvas copy-paste-duplicate tactical plan,
// step 1).
//
// One question: given some elements and where the copies should land, what
// new elements should exist? Answered as DATA — a list of elements nobody has
// persisted yet — for the same reason `z-order.ts` answers in data: a canvas
// edit has three consumers (the optimistic local scene, the persisted write,
// and the undo entry), and one plan is what stops them re-deriving the same
// arithmetic differently.
//
// THE ORDER OF THE RETURNED LIST IS PART OF THE CONTRACT. Non-connectors come
// first, connectors last, because that is the order they must be persisted
// in: a connector's endpoints name elements whose server ids do not exist
// until their own creates have been acknowledged. A connector written against
// a client-side id names a row that never existed — `remapConnectorEndpoints`
// in scene.ts documents what that failure looks like from the other side.
//
// Pure module: no React, no DOM, no database, no id generator. The id factory
// is INJECTED rather than importing `@/lib/uuid`, which keeps this directory's
// no-imports rule intact and makes every test here deterministic.

import { withGroupMembers } from './scene'
import type { CanvasElement, CanvasGroup, ConnectorEndpoint, Scene } from './scene'

/**
 * How far each copy sits from what it was copied from, in world units, and
 * the step a repeated paste advances by.
 *
 * Non-zero for a reason that is easy to miss until it bites: a copy at the
 * same coordinates as its original is invisible, and paste reads as having
 * done nothing at all. The offset and the z-lift below are what make the
 * operation observable.
 */
export const CLONE_OFFSET = 24

/**
 * Board coordinate bounds, restated from `boardCoordSchema` in
 * src/data/schema.ts, and the paint-order ceiling, restated from
 * `canvasZIndexSchema`.
 *
 * Restated rather than imported because this directory imports nothing —
 * that is what lets the engine be unit-tested with no browser and no
 * database, and the schema would pull Zod in. `clone.test.ts` asserts both
 * agree with their sources, the same drift guard `quick-create.ts` and
 * `z-order.ts` carry for their own copies.
 */
export const MAX_BOARD_COORD = 10_000_000
export const Z_MAX = 1_000_000

function clampCoord(value: number): number {
  return Math.min(MAX_BOARD_COORD, Math.max(-MAX_BOARD_COORD, value))
}

/** What `planClone` needs to know that the elements themselves cannot say. */
export interface ClonePlacement {
  /**
   * How many times this same buffer has already been pasted. 0 for the first
   * paste and for every duplicate, so the copies step a further `CLONE_OFFSET`
   * out each time rather than piling onto one spot.
   */
  offsetIndex: number
  /** The highest `zIndex` on the board, so the copies can be lifted above it. */
  topZIndex: number
  /** Mints each copy's client-side id. Injected — see the file header. */
  nextId: () => string
}

/** A finished plan: what to create, and which original each copy came from. */
export interface ClonePlan {
  /** Non-connectors first, then connectors — see the file header. */
  elements: Array<CanvasElement>
  /** Original id → copy id, for every element in `elements`. */
  idMap: Map<string, string>
}

/**
 * The elements a copy operation would take, in ascending paint order.
 *
 * Every kind is eligible, connectors included — unlike `zOrderTargets`, which
 * excludes them because re-ordering one changes nothing visible. Copying one
 * is different: the connector is filtered later, by whether both its ends
 * came along, not by what kind it is.
 *
 * EXPANDED THROUGH `withGroupMembers` FIRST (canvas-element-grouping
 * tactical plan, Wave 4): duplicating a selected group needs every
 * descendant at every nesting depth in the copy set too, exactly as
 * `deleteSelection`'s own `withGroupMembers` expansion does for delete —
 * otherwise a duplicated group would end up pointing at the ORIGINAL
 * members instead of copies of its own.
 */
export function cloneTargets(
  scene: Scene,
  selectedIds: ReadonlySet<string>,
): Array<CanvasElement> {
  const expanded = new Set(withGroupMembers(scene, [...selectedIds]))
  return scene.elements.filter((element) => expanded.has(element.id))
}

/** The id an endpoint names, or null when it floats free. */
function attachedId(endpoint: ConnectorEndpoint): string | null {
  return endpoint.kind === 'element' ? endpoint.elementId : null
}

/** One endpoint, repointed at the copy of whatever it named. */
function cloneEndpoint(
  endpoint: ConnectorEndpoint,
  idMap: ReadonlyMap<string, string>,
): ConnectorEndpoint {
  if (endpoint.kind !== 'element') return endpoint
  const copy = idMap.get(endpoint.elementId)
  return copy ? { ...endpoint, elementId: copy } : endpoint
}

/**
 * A group's `childIds`, remapped to the copies of whatever they named — the
 * SAME remap pattern `cloneEndpoint` above applies to a connector's
 * `source`/`target`, just for a different field (canvas-element-grouping
 * tactical plan, Wave 4).
 *
 * A child id with no copy is DROPPED rather than left pointing at the
 * ORIGINAL, uncloned element: a copy's group referencing a row it did not
 * create is exactly the dangling-reference state FR-018 forbids, and
 * `withGroupMembers` already guarantees every descendant is normally
 * present in `targets` — a missing copy here only happens when this
 * function is called directly with a partial target list, and dropping is
 * the same "unresolvable id, repaired rather than fatal" rule the adapter
 * and scene-load path already apply.
 *
 * Ordering is unconstrained, unlike connectors: `idMap` is fully populated
 * for every element before any `childIds` are rewritten, so a group can be
 * cloned in any relative order and stay in `plain` alongside shapes and
 * text — no ordering split like `plain`/`connectors` is needed for groups.
 */
function cloneGroupChildIds(
  group: CanvasGroup,
  idMap: ReadonlyMap<string, string>,
): CanvasGroup {
  return {
    childIds: group.childIds
      .map((id) => idMap.get(id))
      .filter((id): id is string => id !== undefined),
  }
}

/**
 * What a paste or duplicate would create.
 *
 * A CONNECTOR IS COPIED ONLY WHEN BOTH ITS ENDS ARE. A connector with one end
 * outside the selection has nothing to attach that end to among the copies,
 * and repointing it at the ORIGINAL would wire the new copy back into the
 * diagram it was copied out of — a paste that silently edits the thing you
 * copied. Dropping it is the honest outcome, and it is what leaves the
 * original connector untouched.
 *
 * Every other field is reproduced verbatim: kind, size, rotation, text and
 * style. Three are not:
 *
 *   - `id` — a fresh client-side id per copy, from the injected factory.
 *   - `x`/`y` — shifted by `CLONE_OFFSET` per paste, so the copy is visible.
 *   - `zIndex` — consecutive values above the board's current top, assigned in
 *     ascending source order so a multi-element copy keeps its own internal
 *     stacking instead of being reshuffled by the id tie-break.
 *
 * Text elements keep their STORED width and height. Nothing on this path has
 * a text measurer, and re-deriving geometry without one collapses a text
 * element to nothing — so the stored numbers are copied, never recomputed.
 *
 * Both the position and the paint order are CLAMPED to the stored bounds. A
 * board would need a great many pastes to reach them, but the write path's
 * validators reject anything past them, and a rejected write is a worse
 * failure than a copy that has run out of room to travel.
 */
export function planClone(
  targets: ReadonlyArray<CanvasElement>,
  placement: ClonePlacement,
): ClonePlan {
  const idMap = new Map<string, string>()
  if (targets.length === 0) return { elements: [], idMap }

  const shift = CLONE_OFFSET * (placement.offsetIndex + 1)
  const copiedIds = new Set(targets.map((element) => element.id))

  // Split before minting anything: only the connectors that SURVIVE the
  // both-ends test should consume an id, and the non-connectors must occupy
  // the lower `zIndex` values so the connectors are not interleaved among
  // them. (Paint order is moot for a connector — `render.ts` draws every one
  // of them beneath everything else regardless — but the values still have to
  // be assigned, and assigning them last keeps the shapes' order intact.)
  const plain = targets.filter((element) => !element.connector)
  const connectors = targets.filter((element) => {
    const ends = element.connector
    if (!ends) return false
    const source = attachedId(ends.source)
    const target = attachedId(ends.target)
    return (
      source !== null &&
      target !== null &&
      copiedIds.has(source) &&
      copiedIds.has(target)
    )
  })

  const ordered = [...plain, ...connectors]
  for (const element of ordered) idMap.set(element.id, placement.nextId())

  const elements = ordered.map((element, i) => {
    const copy: CanvasElement = {
      ...element,
      id: idMap.get(element.id) as string,
      x: clampCoord(element.x + shift),
      y: clampCoord(element.y + shift),
      zIndex: Math.min(placement.topZIndex + 1 + i, Z_MAX),
      // Cloned so the copy cannot share a mutable object with its original —
      // a later restyle of one would otherwise silently repaint the other.
      style: { ...element.style },
    }
    if (element.connector) {
      copy.connector = {
        ...element.connector,
        source: cloneEndpoint(element.connector.source, idMap),
        target: cloneEndpoint(element.connector.target, idMap),
      }
    }
    // `idMap` is FULLY populated by this point — every element in `ordered`
    // already has a minted id from the loop above — so a group's `childIds`
    // can be remapped regardless of where the group sits in `ordered`
    // relative to its members (canvas-element-grouping tactical plan, Wave
    // 4). This is why groups need no `plain`/`connectors`-style ordering
    // split: unlike a connector, a group's own copy does not have to be
    // built AFTER its members' copies to remap correctly.
    if (element.group) {
      copy.group = cloneGroupChildIds(element.group, idMap)
    }
    return copy
  })

  return { elements, idMap }
}
