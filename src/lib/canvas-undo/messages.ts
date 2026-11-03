// src/lib/canvas-undo/messages.ts
// Pure message-building for canvas undo/redo reporting (board-undo tactical
// plan, Wave 4, step 11 — "Canvas Undo Reports What It Did"). No React, no
// DOM, no `sonner` import here: this module only turns typed data into
// strings. use-canvas-undo.ts is the one place that hands a string to
// `toast`, matching the rest of canvas-undo/'s house style of keeping
// content decisions pure and testable in isolation from where they are
// displayed.

import type { CanvasElementKind } from '@/data/schema'
import type { TFunction } from '@/lib/i18n/translate'
import type { CanvasUndoLabel } from './undo-stack'
import { translate } from '@/lib/i18n/translate'

/** English by default, so callers without a locale keep the original wording. */
const defaultT: TFunction = (key, vars) => translate('en', key, vars)

/**
 * Keys are the schema's own kind union, so adding a kind to
 * `canvasElementKindSchema` without naming it in the dictionary stops
 * compiling there (the dictionary is typed against the English shape).
 */
function nounKey(kind: CanvasElementKind | undefined): string {
  return kind ?? 'element'
}

/** The noun with its indefinite article, e.g. "a rectangle", "an ellipse". */
function describeKindWithArticle(
  kind: CanvasElementKind | undefined,
  t: TFunction,
): string {
  return t(`undo.nounA.${nounKey(kind)}`)
}

function describeElementKind(
  kind: CanvasElementKind | undefined,
  t: TFunction,
): string {
  // No kind could be resolved (an id absent from the entry, which should not
  // happen in practice) — still a truthful, generic noun rather than a crash
  // or an empty string in the toast.
  return t(`undo.noun.${nounKey(kind)}`)
}

function plural(
  label: { count: number },
  one: string,
  many: string,
  t: TFunction,
): string {
  return label.count > 1 ? t(many, { count: label.count }) : t(one)
}

/** The clause naming WHAT happened, shared by the undo and redo phrasing below. */
function describeGesture(label: CanvasUndoLabel, t: TFunction): string {
  switch (label.gesture) {
    case 'create':
      return t('undo.gesture.create', {
        kind: describeKindWithArticle(label.elementKind, t),
      })
    case 'move':
      return plural(label, 'undo.gesture.moveOne', 'undo.gesture.moveMany', t)
    case 'resize':
      return t('undo.gesture.resize')
    case 'text-edit':
      return t('undo.gesture.textEdit')
    case 'reconnect':
      // Names the END moving, not the connector generally.
      return t('undo.gesture.reconnect')
    case 'bend':
      // Names the CURVE: the three "a connector changed" arms stay distinct.
      return t('undo.gesture.bend')
    case 'style':
      return plural(label, 'undo.gesture.styleOne', 'undo.gesture.styleMany', t)
    case 'z-order':
      return plural(
        label,
        'undo.gesture.zOrderOne',
        'undo.gesture.zOrderMany',
        t,
      )
    case 'routing':
      return t('undo.gesture.routing')
    case 'delete':
      return plural(
        label,
        'undo.gesture.deleteOne',
        'undo.gesture.deleteMany',
        t,
      )
    case 'paste':
      return plural(label, 'undo.gesture.pasteOne', 'undo.gesture.pasteMany', t)
    case 'duplicate':
      // Names the KEY the user pressed, not the rows that appeared.
      return plural(
        label,
        'undo.gesture.duplicateOne',
        'undo.gesture.duplicateMany',
        t,
      )
    case 'cut':
      return plural(label, 'undo.gesture.cutOne', 'undo.gesture.cutMany', t)
    case 'quick-create':
      // Names BOTH halves of the gesture when both happened.
      if (!label.elementKind) return t('undo.gesture.quickCreateConnector')
      return label.connected
        ? t('undo.gesture.quickCreateBoth', {
            kind: describeKindWithArticle(label.elementKind, t),
          })
        : t('undo.gesture.create', {
            kind: describeKindWithArticle(label.elementKind, t),
          })
    case 'group':
      return plural(label, 'undo.gesture.groupOne', 'undo.gesture.groupMany', t)
    case 'ungroup':
      return plural(
        label,
        'undo.gesture.ungroupOne',
        'undo.gesture.ungroupMany',
        t,
      )
  }
}

/**
 * "Successful undo is announced and shown" — names the gesture that was
 * reversed.
 */
export function describeUndoSuccess(
  label: CanvasUndoLabel,
  t: TFunction = defaultT,
): string {
  return t('undo.undid', { gesture: describeGesture(label, t) })
}

/** The redo counterpart — same gesture vocabulary, reapplied rather than reversed. */
export function describeRedoSuccess(
  label: CanvasUndoLabel,
  t: TFunction = defaultT,
): string {
  return t('undo.redid', { gesture: describeGesture(label, t) })
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
  t: TFunction = defaultT,
): string {
  const noun = describeElementKind(elementKind, t)
  return t(reason === 'missing' ? 'undo.undoMissing' : 'undo.undoChanged', {
    noun,
  })
}

/** The redo counterpart of `describeUndoRefusal`, same non-attribution rule. */
export function describeRedoRefusal(
  elementKind: CanvasElementKind | undefined,
  reason: 'missing' | 'changed',
  t: TFunction = defaultT,
): string {
  const noun = describeElementKind(elementKind, t)
  return t(reason === 'missing' ? 'undo.redoMissing' : 'undo.redoChanged', {
    noun,
  })
}

/** "Exhausted history is announced" — undo/redo with nothing eligible left. */
export const UNDO_EXHAUSTED_MESSAGE = 'Nothing left to undo.'
export const REDO_EXHAUSTED_MESSAGE = 'Nothing left to redo.'
