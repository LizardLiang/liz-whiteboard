// src/lib/canvas-undo/messages.ts
// Pure message-building for canvas undo/redo reporting (board-undo tactical
// plan, Wave 4, step 11 — "Canvas Undo Reports What It Did"). No React, no
// DOM, no `sonner` import here: this module only turns typed data into
// strings. use-canvas-undo.ts is the one place that hands a string to
// `toast`, matching the rest of canvas-undo/'s house style of keeping
// content decisions pure and testable in isolation from where they are
// displayed.

import type { CanvasElementKind } from '@/data/schema'
import type { CanvasUndoLabel } from './undo-stack'

/**
 * The noun for each kind. A `Record` keyed by the schema's own kind union, so
 * adding a kind to `canvasElementKindSchema` without naming it here stops
 * compiling — better than a toast that silently degrades to "element" for
 * every shape the user just drew.
 */
const ELEMENT_KIND_NOUNS: Readonly<Record<CanvasElementKind, string>> = {
  rectangle: 'rectangle',
  ellipse: 'ellipse',
  diamond: 'diamond',
  triangle: 'triangle',
  text: 'text element',
  connector: 'connector',
}

/**
 * The noun with its indefinite article — "a rectangle", "an ellipse".
 *
 * Chosen on the leading VOWEL, which is enough for this closed vocabulary and
 * is the whole reason this exists: the article used to be hardcoded as "a",
 * so the board said "creating a ellipse" the moment ellipses shipped, and
 * "creating a element" for the generic fallback before that. Every noun here
 * is one of `ELEMENT_KIND_NOUNS` plus "element", so no exception (an "hour",
 * a "unicorn") is reachable — revisit if a kind is ever named one.
 */
function withArticle(noun: string): string {
  return `${'aeiou'.includes(noun[0]) ? 'an' : 'a'} ${noun}`
}

function describeElementKind(kind: CanvasElementKind | undefined): string {
  // No kind could be resolved (an id absent from the entry, which should not
  // happen in practice) — still a truthful, generic noun rather than a crash
  // or an empty string in the toast.
  return kind ? ELEMENT_KIND_NOUNS[kind] : 'element'
}

/** The clause naming WHAT happened, shared by the undo and redo phrasing below. */
function describeGesture(label: CanvasUndoLabel): string {
  switch (label.gesture) {
    case 'create':
      return `creating ${withArticle(describeElementKind(label.elementKind))}`
    case 'move':
      return label.count > 1
        ? `moving ${label.count} elements`
        : 'moving an element'
    case 'resize':
      return 'resizing an element'
    case 'text-edit':
      return 'editing text'
    case 'reconnect':
      // Names the END moving, not the connector generally — the routing arm
      // below is also "a connector changed" and the two must not read alike.
      return 'moving a connector end'
    case 'style':
      // Names the PAINT, not "updating a shape": nothing moved and nothing
      // resized, so a vaguer word would leave the user guessing which of
      // several recent edits is about to come back.
      return label.count > 1
        ? `restyling ${label.count} shapes`
        : 'restyling a shape'
    case 'z-order':
      // Names the PAINT ORDER, not the appearance: `style` above is also "a
      // shape changed" and the two toasts must not read alike.
      return label.count > 1
        ? `reordering ${label.count} elements`
        : 'reordering an element'
    case 'routing':
      // Names the SHAPE change, not "updating a connector": the endpoints did
      // not move and nothing else about the row changed, so a vaguer word
      // would leave the user guessing what is about to come back.
      return 'rerouting a connector'
    case 'delete':
      return label.count > 1
        ? `deleting ${label.count} elements`
        : 'deleting an element'
    case 'paste':
      return label.count > 1
        ? `pasting ${label.count} elements`
        : 'pasting an element'
    case 'duplicate':
      // Names the KEY the user pressed, not the rows that appeared. A paste
      // and a duplicate create identical rows by the same code path, so
      // nothing about the result distinguishes them — only the gesture does,
      // and that is what the user is looking for when Ctrl+Z asks them what
      // is about to come back.
      return label.count > 1
        ? `duplicating ${label.count} elements`
        : 'duplicating an element'
    case 'cut':
      // Not "deleting": a cut also filled the clipboard, and a user who cut
      // intending to paste needs to see that the cut is what was reversed.
      return label.count > 1
        ? `cutting ${label.count} elements`
        : 'cutting an element'
    case 'quick-create':
      // Names BOTH halves of the gesture when both happened, because both
      // are about to reappear or disappear together and a toast saying only
      // "creating a rectangle" would leave the connector's return
      // unexplained. Each half is dropped from the wording when it did not
      // happen, rather than asserted generically — see the label's own
      // doc comment for when each case arises.
      if (!label.elementKind) return 'creating a connector'
      return label.connected
        ? `creating ${withArticle(describeElementKind(label.elementKind))} and a connector`
        : `creating ${withArticle(describeElementKind(label.elementKind))}`
  }
}

/**
 * "Successful undo is announced and shown" — names the gesture that was
 * reversed.
 */
export function describeUndoSuccess(label: CanvasUndoLabel): string {
  return `Undid ${describeGesture(label)}`
}

/** The redo counterpart — same gesture vocabulary, reapplied rather than reversed. */
export function describeRedoSuccess(label: CanvasUndoLabel): string {
  return `Redid ${describeGesture(label)}`
}

/**
 * "Refused undo is announced and shown" — names the element and states it
 * changed since the edit, WITHOUT asserting who changed it. Canvas element
 * rows record no last writer, so this wording must stay true whether the
 * actor was a collaborator or the SAME user in a second tab (Locked
 * Decision, tactical plan: "Multi-tab same-user contention"). Never write
 * "another user" or "someone else" here.
 */
export function describeUndoRefusal(
  elementKind: CanvasElementKind | undefined,
  reason: 'missing' | 'changed',
): string {
  const noun = describeElementKind(elementKind)
  return reason === 'missing'
    ? `This ${noun} no longer exists, so that change can't be undone.`
    : `This ${noun} changed since your edit, so that change can't be undone.`
}

/** The redo counterpart of `describeUndoRefusal`, same non-attribution rule. */
export function describeRedoRefusal(
  elementKind: CanvasElementKind | undefined,
  reason: 'missing' | 'changed',
): string {
  const noun = describeElementKind(elementKind)
  return reason === 'missing'
    ? `This ${noun} no longer exists, so that change can't be redone.`
    : `This ${noun} changed since your edit, so that change can't be redone.`
}

/** "Exhausted history is announced" — undo/redo with nothing eligible left. */
export const UNDO_EXHAUSTED_MESSAGE = 'Nothing left to undo.'
export const REDO_EXHAUSTED_MESSAGE = 'Nothing left to redo.'
