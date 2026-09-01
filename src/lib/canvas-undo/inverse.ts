// src/lib/canvas-undo/inverse.ts
// Pure inverse-operation builder for canvas undo (board-undo tactical plan,
// Wave 2, step 6). No React, no DOM, no database: given an entry and the
// CURRENT revision of every element it touched, decide whether the entry is
// still safe to apply and, if so, produce the write(s) that reverse it.
//
// "Current revision" is a parameter, not a lookup this module performs —
// this module never talks to the database or the scene. The caller
// (use-canvas-undo.ts, Wave 3, out of scope for this phase) is responsible
// for supplying it from the live scene or a fresh server read.

import type { CanvasElementSnapshot, CanvasUndoEntry } from './undo-stack'

/**
 * One write the caller must issue to reverse one element of an entry.
 *
 * The `update` variant carries no patch payload (Hermes review, finding 8):
 * it used to (`CanvasElementInversePatch`, built from `operation.before`
 * below), but the sole caller (`use-canvas-undo.ts`'s `applyInverseWrite`)
 * never read it — it reconstructs the write from the operation's own
 * `before` snapshot instead, since that snapshot is the strict superset the
 * write actually needs (id/kind/rotation included, which `before` alone
 * carries and a patch-of-just-the-mutable-fields cannot). A field built and
 * asserted in tests but never read in production is exactly the kind of
 * silent drift risk this module's "pure, single source of truth" design is
 * meant to avoid — the caller already has `before` (via the `CanvasUndoEntry`
 * it owns), so this module reports only WHAT to guard (`expectedRevision`),
 * not WHAT to write, for the `update` case, matching `delete`'s existing
 * shape (which never carried a payload either — a delete needs only an id).
 */
export type InverseWrite =
  | { kind: 'create'; elementId: string; snapshot: CanvasElementSnapshot }
  | { kind: 'update'; elementId: string; expectedRevision: number }
  | { kind: 'delete'; elementId: string; expectedRevision: number }

export interface ContestedMember {
  elementId: string
  /** `missing` — the row this inverse needs is gone. `changed` — it exists but was written since the operation being undone. */
  reason: 'missing' | 'changed'
}

export type InverseResult =
  | { status: 'ok'; writes: Array<InverseWrite> }
  | { status: 'contested'; members: Array<ContestedMember> }

/**
 * Current revision of every element this entry touches, or `undefined` when
 * the element does not currently exist. A `Map` rather than a lookup
 * function so this module stays pure — no callback into caller state at
 * build time.
 */
export type CurrentRevisions = ReadonlyMap<string, number | undefined>

/**
 * Build the inverse of one undo entry, or report why it cannot be applied.
 *
 * "Canvas Undo Refuses A Contested Element": a member is contested if the
 * row it targets no longer exists, or exists but was written since the
 * operation being undone (its current revision no longer matches the
 * revision that operation produced). "A multi-element entry is contested if
 * ANY member is contested, and is then applied not at all, never
 * partially" — enforced by returning `writes` only when NO member is
 * contested.
 */
export function buildInverse(
  entry: CanvasUndoEntry,
  currentRevisions: CurrentRevisions,
): InverseResult {
  const members: Array<ContestedMember> = []
  const writes: Array<InverseWrite> = []

  for (const operation of entry.operations) {
    const current = currentRevisions.get(operation.elementId)

    switch (operation.kind) {
      case 'create': {
        // Forward op created the element; the inverse deletes it.
        if (current === undefined) {
          members.push({ elementId: operation.elementId, reason: 'missing' })
          break
        }
        if (current !== operation.afterRevision) {
          members.push({ elementId: operation.elementId, reason: 'changed' })
          break
        }
        writes.push({
          kind: 'delete',
          elementId: operation.elementId,
          expectedRevision: operation.afterRevision,
        })
        break
      }

      case 'update': {
        // Forward op changed the element; the inverse writes `before` back.
        if (current === undefined) {
          members.push({ elementId: operation.elementId, reason: 'missing' })
          break
        }
        if (current !== operation.afterRevision) {
          members.push({ elementId: operation.elementId, reason: 'changed' })
          break
        }
        writes.push({
          kind: 'update',
          elementId: operation.elementId,
          expectedRevision: operation.afterRevision,
        })
        break
      }

      case 'delete': {
        // Forward op removed the element; the inverse recreates it under its
        // ORIGINAL id. There is no row left to compare a revision against,
        // so the only contest condition is that id already being occupied.
        if (current !== undefined) {
          members.push({ elementId: operation.elementId, reason: 'changed' })
          break
        }
        writes.push({
          kind: 'create',
          elementId: operation.elementId,
          snapshot: operation.before,
        })
        break
      }
    }
  }

  if (members.length > 0) {
    return { status: 'contested', members }
  }
  return { status: 'ok', writes }
}
