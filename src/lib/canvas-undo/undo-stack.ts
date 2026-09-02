// src/lib/canvas-undo/undo-stack.ts
// Pure per-tab undo/redo stack for the canvas board (board-undo tactical
// plan, Wave 2, step 5). No React, no DOM, no database — matches
// canvas-engine/scene.ts's house style: immutable state, every operation
// returns a NEW stack.
//
// This module owns WHAT happened (the entry/operation vocabulary) and WHEN
// (push/pop ordering, the retention cap, redo invalidation). It does not
// know HOW to reverse an operation — that is inverse.ts — and it does not
// talk to the server, the scene, or React state — that is
// use-canvas-undo.ts, out of scope for this phase (Wave 3).

import type { CanvasElementSnapshot } from '@/lib/canvas-element-adapter'
import type { CanvasElementKind } from '@/data/schema'

/**
 * Row-shaped snapshot of one element (positionX/positionY, not the engine's
 * x/y) — everything needed to write it back exactly as it was, without a
 * second database read.
 *
 * Defined in canvas-element-adapter.ts, not here: that file is "the one
 * place the stored row and the engine's scene value meet" (its own header),
 * and this snapshot shape is one more form of that same rename. Re-exported
 * from this module (imported above for local use, re-exported below) so
 * every existing importer of `CanvasElementSnapshot` from `undo-stack.ts`
 * (inverse.ts, use-canvas-undo.ts, and their tests) needs no import-path
 * change (Hermes review, finding 3 — this type and its to/from conversions
 * used to be duplicated here and in use-canvas-undo.ts).
 */
export type { CanvasElementSnapshot } from '@/lib/canvas-element-adapter'

/**
 * One element's role within an undo entry.
 *
 * - `create` — the element did not exist before the gesture. Its inverse is
 *   a delete. `afterRevision` is the revision the create produced, used to
 *   detect whether anything has touched the row since. `after` is the
 *   content the gesture created — redo reapplies it directly.
 * - `update` — the element existed and changed. `before` is the row as it
 *   was BEFORE the gesture; `afterRevision` is the revision the gesture's
 *   write produced; `after` is the row as it was AFTER the gesture — redo
 *   reapplies it directly.
 * - `delete` — the element existed and was removed. `before` is the full
 *   row as it was, including its original id — the inverse is a
 *   create-with-id. There is no `afterRevision`: no row remains after a
 *   delete for a revision to belong to. There is likewise no `after`: redo
 *   of a delete-entry re-deletes the (restored) element, needing only its
 *   id, not its content.
 *
 * `after` is optional rather than a second required field so existing
 * fixtures in `inverse.test.ts`/`undo-stack.test.ts` (which never read it —
 * `inverse.ts` only ever needs `before`/`afterRevision`) do not all need
 * updating for a value irrelevant to what they assert.
 *
 * IMPORTANT for anything that keys ephemeral, caller-owned state to "this
 * operation" or "this entry": `refreshRevision` (below) returns a NEW
 * operation object (via spread) for every `create`/`update` operation whose
 * `afterRevision` it refreshes, and therefore a NEW entry object wrapping
 * it too. Keying a `WeakMap` by the operation/entry OBJECT REFERENCE is
 * therefore unsafe the moment `refreshRevision` has ever touched it — the
 * reference callers captured at record time silently stops matching the one
 * later retrieved via `popRedoEntry`/`popUndoEntry` (this was BUG-1: a
 * headed-browser-only defect the unit suite's identity-blind mocks never
 * exercised). `after` is carried as DATA on the operation itself instead,
 * precisely because spread-based rewrites preserve every field they do not
 * explicitly overwrite — it survives being cloned, where an external
 * identity-keyed side-table does not.
 */
export type CanvasUndoOperation =
  | {
      kind: 'create'
      elementId: string
      afterRevision: number
      after?: CanvasElementSnapshot
    }
  | {
      kind: 'update'
      elementId: string
      before: CanvasElementSnapshot
      afterRevision: number
      after?: CanvasElementSnapshot
    }
  | { kind: 'delete'; elementId: string; before: CanvasElementSnapshot }

/**
 * Which user gesture an entry reverses, and just enough shape to build a
 * specific report about it (Wave 4, step 11's toasts match on this).
 *
 * A discriminated union rather than the free-form `string` this field used
 * to be (Hermes review carry-over on the Wave 1-3 fix pass): a `string`
 * invited ad hoc values at every call site that pushes an entry, with
 * nothing stopping the toast layer from hard-coding string comparisons
 * against whatever happened to be written there. `create` is always a
 * single element (`recordCreate` in use-canvas-undo.ts records one create at
 * a time), so its `elementKind` is unambiguous; `resize` and `text-edit` are
 * likewise always single-element gestures — only `move` and `delete` can
 * span several elements in one entry, hence their `count`.
 */
export type CanvasUndoLabel =
  | { gesture: 'create'; elementKind: CanvasElementKind }
  | { gesture: 'move'; count: number }
  | { gesture: 'resize' }
  | { gesture: 'text-edit' }
  /**
   * A connector's routing changed from the floating picker (canvas
   * quick-create-handles tactical plan, Wave 5). Always exactly one element —
   * the picker appears only for a single selected connector — so it carries
   * no `count`, like `resize` and `text-edit`.
   */
  | { gesture: 'routing' }
  /**
   * One END of a connector was dragged somewhere else — re-anchored to a
   * different side, moved onto a different element, or detached to float
   * free. Always exactly one element (the connector), so no `count`.
   *
   * Distinct from `routing`, which changes the line's SHAPE and leaves both
   * ends where they were. Folding the two together would make one toast
   * describe two visibly different edits.
   */
  | { gesture: 'reconnect' }
  /**
   * A `curved` connector's BOW was dragged by its midpoint grip. Always
   * exactly one element, so no `count`.
   *
   * A third connector arm rather than a reuse of either neighbour, because it
   * is the third visibly different edit: `routing` swaps the line for a
   * different kind of line, `reconnect` moves an end, and this changes only
   * how far the line bulges between two ends that never moved. A user who
   * bent a curve and then pressed Ctrl+Z needs the toast to say so — "Undid
   * rerouting a connector" would describe an edit they did not make and would
   * leave them unsure whether the right thing came back.
   */
  | { gesture: 'bend' }
  /**
   * Fill or stroke changed from the floating style toolbar. Carries a
   * `count` — like `move` and unlike `routing` — because one click restyles
   * every selected shape, and a toast saying "an element" after eight of
   * them changed colour would understate what Ctrl+Z is about to reverse.
   */
  | { gesture: 'style'; count: number }
  /**
   * Paint order changed from the toolbar's arrange row. Carries a `count` for
   * the same reason `style` does — one click re-orders the whole selection.
   */
  | { gesture: 'z-order'; count: number }
  | { gesture: 'delete'; count: number }
  /**
   * The copy family (canvas copy-paste-duplicate tactical plan, step 4) —
   * every one of them multi-element, hence the `count`.
   *
   * Three arms rather than one with a mode field, because the toast has to
   * name the gesture the user actually made: `paste` and `duplicate` create
   * the same rows by the same code path, but the user pressed different keys
   * and is looking for different words when Ctrl+Z asks them what is coming
   * back.
   *
   * `cut` is deliberately NOT folded into `delete` even though its inverse is
   * identical. The two remove the same rows, but only one of them also filled
   * the clipboard, and a user who cut expecting to paste needs to see that
   * the cut is what was reversed.
   */
  | { gesture: 'paste'; count: number }
  | { gesture: 'duplicate'; count: number }
  | { gesture: 'cut'; count: number }
  /**
   * A creation-handle gesture (canvas quick-create-handles tactical plan,
   * Wave 4, step 11) — up to TWO elements created by one press-and-release.
   *
   * Deliberately not folded into `create`: that arm is documented as always
   * single-element (`recordCreate` records one at a time, and
   * `elementKindForOperation` used to lean on that), and a quick-create's two
   * creates have DIFFERENT kinds — the new element and the connector joining
   * it to the source.
   *
   * `elementKind` is null when no element was created, which is the
   * drag-onto-an-existing-element case: the gesture produced only the
   * connector. `connected` is false when the element was created but its
   * connector's write did not land, so the toast never claims a link that
   * does not exist.
   */
  | {
      gesture: 'quick-create'
      elementKind: CanvasElementKind | null
      connected: boolean
    }
  /**
   * Canvas element grouping (tactical plan, Wave 7). `group` binds the
   * current selection into a new group element — one `create` operation for
   * the group row itself, never a write to any member (grouping only ever
   * touches the group's own `childIds`, canvas-engine/scene.ts's `group?`
   * field). `ungroup` dissolves exactly one group — one `delete` operation
   * for the group row, again with no member write. `count` is the number of
   * DIRECT children bound or released, matching `move`/`delete`'s own
   * "how many elements does this toast's number describe" convention —
   * always the group's own `childIds.length`, since the members themselves
   * carry no operation of their own for either gesture.
   */
  | { gesture: 'group'; count: number }
  | { gesture: 'ungroup'; count: number }

/**
 * One undo-able gesture. `operations` holds more than one member only for a
 * gesture that touched several elements at once (a multi-select move or a
 * multi-delete) — one entry either way, per the one-gesture-one-entry rule
 * ("One Canvas Gesture Is One Undo Entry").
 */
export interface CanvasUndoEntry {
  /**
   * Names the gesture for the success/refusal toast. Captured at the point
   * the gesture is known (use-canvas-undo.ts's recordCreate/recordUpdate/
   * recordDelete), not reconstructed later from the operations.
   */
  label: CanvasUndoLabel
  operations: Array<CanvasUndoOperation>
}

/**
 * The kind of the element one specific operation within an entry targets —
 * for naming that element in a refusal or success message (Wave 4, step 11).
 *
 * `create` operations carry no kind of their own (undo-stack.ts's own
 * `CanvasUndoOperation` union only stores `elementId`/`afterRevision` for
 * that case); the kind lives on the ENTRY's `label` instead, which is only
 * meaningful for a `create`-gesture entry. That is never ambiguous: a
 * `create` operation only ever appears inside a `create`-gesture entry
 * (`recordCreate` always produces exactly one operation, in an entry whose
 * label it sets to `{ gesture: 'create', ... }` in the same call), so there
 * is never a `create` operation sitting inside a `move`/`resize`/`text-edit`/
 * `delete` entry for this lookup to get wrong.
 */
export function elementKindForOperation(
  entry: CanvasUndoEntry,
  elementId: string,
): CanvasElementKind | undefined {
  const operation = entry.operations.find((op) => op.elementId === elementId)
  if (!operation) return undefined
  if (operation.kind === 'create') {
    // `after` — the row the create produced (the BUG-1 fix above) — is the
    // authoritative answer whenever it is present, and it is the ONLY correct
    // answer for an entry holding several creates of different kinds: a
    // quick-create's element and its connector are both `create` operations
    // inside one entry, so the entry's single `elementKind` cannot name both.
    if (operation.after) return operation.after.kind
    // Fallback for the single-create case, where the kind lives on the label
    // instead (and for fixtures predating `after`).
    return entry.label.gesture === 'create'
      ? entry.label.elementKind
      : undefined
  }
  return operation.before.kind
}

export interface UndoStack {
  entries: Array<CanvasUndoEntry>
  redo: Array<CanvasUndoEntry>
}

export const EMPTY_UNDO_STACK: UndoStack = { entries: [], redo: [] }

/**
 * Retention cap. The spec-delta's floor is 50 ("Canvas Undo History Is
 * Bounded"); 100 is comfortably at or above it, matching the tactical plan's
 * number exactly.
 */
export const UNDO_STACK_CAP = 100

/**
 * Record a new entry.
 *
 * Clears redo — a fresh edit invalidates whatever was previously undone, per
 * "Canvas Redo"'s "New edit clears redo" scenario. Evicts the OLDEST entry
 * once the cap is exceeded so retention never grows past it, however many
 * pushes have happened.
 */
export function pushUndoEntry(
  stack: UndoStack,
  entry: CanvasUndoEntry,
): UndoStack {
  const entries = [...stack.entries, entry]
  const trimmed =
    entries.length > UNDO_STACK_CAP
      ? entries.slice(entries.length - UNDO_STACK_CAP)
      : entries
  return { entries: trimmed, redo: [] }
}

export type UndoPopResult =
  | { status: 'ok'; entry: CanvasUndoEntry; stack: UndoStack }
  | { status: 'nothing-to-undo' }

/**
 * Remove and return the most recent entry.
 *
 * Does NOT move it to redo — a contested undo must discard its entry rather
 * than make it redoable, so the caller pushes to redo itself, and only on
 * success (`pushRedoEntry`).
 *
 * Typed `nothing-to-undo` rather than `null`/`undefined`: an exhausted stack
 * must be reported to the user ("Canvas Undo History Is Bounded" /
 * "Reaching the cap is not silent"; "No own edits remain"), never treated as
 * a silent no-op.
 */
export function popUndoEntry(stack: UndoStack): UndoPopResult {
  if (stack.entries.length === 0) return { status: 'nothing-to-undo' }
  const entry = stack.entries[stack.entries.length - 1]
  return {
    status: 'ok',
    entry,
    stack: { entries: stack.entries.slice(0, -1), redo: stack.redo },
  }
}

/** Record a successfully-applied undo onto the redo stack. */
export function pushRedoEntry(
  stack: UndoStack,
  entry: CanvasUndoEntry,
): UndoStack {
  return { entries: stack.entries, redo: [...stack.redo, entry] }
}

export type RedoPopResult =
  | { status: 'ok'; entry: CanvasUndoEntry; stack: UndoStack }
  | { status: 'nothing-to-redo' }

/**
 * Remove the most recent redo entry and move it back onto the undo stack in
 * the same step, so a reapplied edit is itself undoable again.
 *
 * Does NOT go through `pushUndoEntry` — that clears redo as a side effect
 * for a NEW edit, and reapplying a redo must not wipe the rest of the redo
 * stack it just came from.
 *
 * Typed `nothing-to-redo` for the same reason `popUndoEntry` is typed:
 * exhaustion must be reported, not silent.
 */
export function popRedoEntry(stack: UndoStack): RedoPopResult {
  if (stack.redo.length === 0) return { status: 'nothing-to-redo' }
  const entry = stack.redo[stack.redo.length - 1]
  return {
    status: 'ok',
    entry,
    stack: {
      entries: [...stack.entries, entry],
      redo: stack.redo.slice(0, -1),
    },
  }
}

/**
 * Update the recorded `afterRevision` of every surviving `create`/`update`
 * operation referencing `elementId`, across BOTH the undo and redo arrays, to
 * `revision`.
 *
 * `afterRevision` records "the revision the FORWARD gesture that pushed this
 * entry produced" — a snapshot taken once, at push time. Every subsequent
 * successful write to the SAME element — an inverse this hook issues on
 * undo, a reapplication it issues on redo, or another gesture's own forward
 * write recorded in a DIFFERENT entry — advances the row's real revision
 * without rewriting that snapshot. Left unrefreshed, an untouched entry's
 * `afterRevision` goes stale, and the NEXT undo targeting that same element
 * reads as contested even though the only writer since was the user's own
 * undo/redo (Hermes review, BLOCKER B1 — "each user's own undo makes their
 * next undo look contested").
 *
 * Call this after EVERY successful write this hook's own `undo()`/`redo()`
 * issues, keyed by the ack's revision, not the entry's own stored one.
 *
 * `delete` operations are left untouched — they carry no `afterRevision`,
 * since no row exists after a delete for a revision to belong to.
 */
export function refreshRevision(
  stack: UndoStack,
  elementId: string,
  revision: number,
): UndoStack {
  const refresh = (entries: Array<CanvasUndoEntry>): Array<CanvasUndoEntry> =>
    entries.map((entry) => {
      const operations = entry.operations.map((op) =>
        op.elementId === elementId && op.kind !== 'delete'
          ? { ...op, afterRevision: revision }
          : op,
      )
      const changed = operations.some((op, i) => op !== entry.operations[i])
      return changed ? { ...entry, operations } : entry
    })
  return { entries: refresh(stack.entries), redo: refresh(stack.redo) }
}
