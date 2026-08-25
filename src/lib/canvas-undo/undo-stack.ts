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

import type {
  CanvasElementKind,
  CanvasElementProps,
  CanvasElementStyle,
} from '@/data/schema'

/**
 * Everything needed to write this element back exactly as it was, without a
 * second read of the database. Row vocabulary (positionX/positionY, not the
 * engine's x/y) because this is what the create/update write payloads speak
 * — see canvas-element.ts's file header on why that rename happens in
 * exactly one place.
 */
export interface CanvasElementSnapshot {
  id: string
  boardId: string
  kind: CanvasElementKind
  positionX: number
  positionY: number
  width: number
  height: number
  rotation: number
  zIndex: number
  text: string | null
  style: CanvasElementStyle
  props: CanvasElementProps
}

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
  | { gesture: 'delete'; count: number }

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
