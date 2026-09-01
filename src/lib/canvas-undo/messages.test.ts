// src/lib/canvas-undo/messages.test.ts
// Unit tests for the pure undo/redo report wording (board-undo tactical
// plan, Wave 4, step 11).
//
// The spec-delta scenario this guards most directly is "The refusal does not
// claim to know who changed it" — every refusal-message test below asserts
// the string does NOT contain an attribution word, not just that it contains
// the right noun.

import { describe, expect, it } from 'vitest'
import {
  REDO_EXHAUSTED_MESSAGE,
  UNDO_EXHAUSTED_MESSAGE,
  describeRedoRefusal,
  describeRedoSuccess,
  describeUndoRefusal,
  describeUndoSuccess,
} from './messages'
import type { CanvasUndoLabel } from './undo-stack'

const NON_ATTRIBUTION_WORDS = ['another user', 'someone else', 'collaborator']

describe('describeUndoSuccess — names the gesture that was reversed', () => {
  it('names creating a rectangle', () => {
    const label: CanvasUndoLabel = {
      gesture: 'create',
      elementKind: 'rectangle',
    }
    expect(describeUndoSuccess(label)).toBe('Undid creating a rectangle')
  })

  it('says "an" before a vowel, for every kind that starts with one', () => {
    // "creating a ellipse" is what the board said before this existed.
    expect(
      describeUndoSuccess({ gesture: 'create', elementKind: 'ellipse' }),
    ).toBe('Undid creating an ellipse')
    expect(
      describeUndoSuccess({ gesture: 'create', elementKind: 'diamond' }),
    ).toBe('Undid creating a diamond')
    expect(
      describeUndoSuccess({ gesture: 'create', elementKind: 'triangle' }),
    ).toBe('Undid creating a triangle')
    // The generic "element" fallback carried the same defect. It is not
    // asserted here because `create` requires a kind at the type level, so no
    // reachable call produces it — the article helper handles it regardless.
  })

  it('names creating a text element', () => {
    const label: CanvasUndoLabel = { gesture: 'create', elementKind: 'text' }
    expect(describeUndoSuccess(label)).toBe('Undid creating a text element')
  })

  it('names moving a single element in the singular', () => {
    const label: CanvasUndoLabel = { gesture: 'move', count: 1 }
    expect(describeUndoSuccess(label)).toBe('Undid moving an element')
  })

  it('names moving several elements with the count', () => {
    const label: CanvasUndoLabel = { gesture: 'move', count: 3 }
    expect(describeUndoSuccess(label)).toBe('Undid moving 3 elements')
  })

  it('names a resize', () => {
    const label: CanvasUndoLabel = { gesture: 'resize' }
    expect(describeUndoSuccess(label)).toBe('Undid resizing an element')
  })

  it('names a text edit', () => {
    const label: CanvasUndoLabel = { gesture: 'text-edit' }
    expect(describeUndoSuccess(label)).toBe('Undid editing text')
  })

  it('names deleting a single element in the singular', () => {
    const label: CanvasUndoLabel = { gesture: 'delete', count: 1 }
    expect(describeUndoSuccess(label)).toBe('Undid deleting an element')
  })

  it('names deleting several elements with the count', () => {
    const label: CanvasUndoLabel = { gesture: 'delete', count: 2 }
    expect(describeUndoSuccess(label)).toBe('Undid deleting 2 elements')
  })
})

describe('describeRedoSuccess — same gesture vocabulary, reapplied', () => {
  it('uses "Redid", not "Undid"', () => {
    const label: CanvasUndoLabel = { gesture: 'move', count: 1 }
    expect(describeRedoSuccess(label)).toBe('Redid moving an element')
  })
})

describe('describeUndoRefusal — names the element, never who changed it', () => {
  it('names restyling, singular and plural, and never calls it a move', () => {
    // One click can restyle the whole selection, so the count matters: a
    // toast saying "an element" after eight shapes changed colour understates
    // what Ctrl+Z is about to reverse.
    expect(describeUndoSuccess({ gesture: 'style', count: 1 })).toBe(
      'Undid restyling a shape',
    )
    expect(describeUndoSuccess({ gesture: 'style', count: 8 })).toBe(
      'Undid restyling 8 shapes',
    )
    expect(describeRedoSuccess({ gesture: 'style', count: 3 })).toBe(
      'Redid restyling 3 shapes',
    )
  })

  it('names reordering, and never confuses it with restyling', () => {
    // The two share a toolbar and a gesture shape; the toasts must not read
    // alike, or the user cannot tell which of two recent edits Ctrl+Z is
    // about to reverse.
    expect(describeUndoSuccess({ gesture: 'z-order', count: 1 })).toBe(
      'Undid reordering an element',
    )
    expect(describeUndoSuccess({ gesture: 'z-order', count: 4 })).toBe(
      'Undid reordering 4 elements',
    )
    expect(describeRedoSuccess({ gesture: 'z-order', count: 2 })).toBe(
      'Redid reordering 2 elements',
    )
    expect(describeUndoSuccess({ gesture: 'z-order', count: 2 })).not.toBe(
      describeUndoSuccess({ gesture: 'style', count: 2 }),
    )
  })

  it('names a changed rectangle without attributing it', () => {
    const message = describeUndoRefusal('rectangle', 'changed')
    expect(message).toBe(
      "This rectangle changed since your edit, so that change can't be undone.",
    )
    for (const word of NON_ATTRIBUTION_WORDS) {
      expect(message.toLowerCase()).not.toContain(word)
    }
  })

  it('names a changed text element without attributing it', () => {
    const message = describeUndoRefusal('text', 'changed')
    expect(message).toBe(
      "This text element changed since your edit, so that change can't be undone.",
    )
  })

  it('reports a missing element without claiming it changed', () => {
    const message = describeUndoRefusal('rectangle', 'missing')
    expect(message).toBe(
      "This rectangle no longer exists, so that change can't be undone.",
    )
  })

  it('falls back to a generic noun when the kind cannot be resolved', () => {
    expect(describeUndoRefusal(undefined, 'changed')).toBe(
      "This element changed since your edit, so that change can't be undone.",
    )
  })
})

describe('describeRedoRefusal — same non-attribution rule', () => {
  it('names a changed element without attributing it', () => {
    const message = describeRedoRefusal('rectangle', 'changed')
    expect(message).toBe(
      "This rectangle changed since your edit, so that change can't be redone.",
    )
    for (const word of NON_ATTRIBUTION_WORDS) {
      expect(message.toLowerCase()).not.toContain(word)
    }
  })

  it('reports a missing element', () => {
    expect(describeRedoRefusal('text', 'missing')).toBe(
      "This text element no longer exists, so that change can't be redone.",
    )
  })
})

describe('exhaustion messages', () => {
  it('announces undo exhaustion out loud rather than doing nothing silently', () => {
    expect(UNDO_EXHAUSTED_MESSAGE).toBe('Nothing left to undo.')
  })

  it('announces redo exhaustion out loud rather than doing nothing silently', () => {
    expect(REDO_EXHAUSTED_MESSAGE).toBe('Nothing left to redo.')
  })
})

describe('quick-create names both halves of the gesture', () => {
  it('names the element AND the connector when both were created', () => {
    // Both are about to disappear or reappear together, so a message naming
    // only the element leaves the connector's return unexplained.
    const label: CanvasUndoLabel = {
      gesture: 'quick-create',
      elementKind: 'rectangle',
      connected: true,
    }
    expect(describeUndoSuccess(label)).toBe(
      'Undid creating a rectangle and a connector',
    )
    expect(describeRedoSuccess(label)).toBe(
      'Redid creating a rectangle and a connector',
    )
  })

  it('names only the connector when nothing else was created', () => {
    // The drag-onto-an-existing-element case.
    const label: CanvasUndoLabel = {
      gesture: 'quick-create',
      elementKind: null,
      connected: true,
    }
    expect(describeUndoSuccess(label)).toBe('Undid creating a connector')
  })

  it('drops the connector from the wording when its write did not land', () => {
    // Never claim a link that does not exist.
    const label: CanvasUndoLabel = {
      gesture: 'quick-create',
      elementKind: 'text',
      connected: false,
    }
    expect(describeUndoSuccess(label)).toBe('Undid creating a text element')
  })
})

describe('a connector is named as a connector, not as a generic element', () => {
  it('uses the noun in a refusal', () => {
    const message = describeUndoRefusal('connector', 'changed')
    expect(message).toContain('connector')
    for (const word of NON_ATTRIBUTION_WORDS) {
      expect(message).not.toContain(word)
    }
  })
})

describe('a routing change names the shape, not a generic update', () => {
  it('names rerouting in both directions', () => {
    // "Undid updating an element" would leave the user guessing what is
    // about to come back — the endpoints did not move and nothing else about
    // the row changed.
    const label: CanvasUndoLabel = { gesture: 'routing' }
    expect(describeUndoSuccess(label)).toBe('Undid rerouting a connector')
    expect(describeRedoSuccess(label)).toBe('Redid rerouting a connector')
  })

  it('is distinct from the move wording it would otherwise default to', () => {
    // `recordUpdate` defaults a missing gesture to 'move'. Without this arm
    // the picker's own writes would report "Undid moving an element" for a
    // gesture that moved nothing.
    expect(describeUndoSuccess({ gesture: 'routing' })).not.toBe(
      describeUndoSuccess({ gesture: 'move', count: 1 }),
    )
  })
})

describe('moving a connector end reads differently from rerouting one', () => {
  it('names the end moving', () => {
    expect(describeUndoSuccess({ gesture: 'reconnect' })).toBe(
      'Undid moving a connector end',
    )
    expect(describeRedoSuccess({ gesture: 'reconnect' })).toBe(
      'Redid moving a connector end',
    )
  })

  it('is distinct from a routing change', () => {
    // Both are "a connector changed", but one moves an endpoint and the other
    // only reshapes the line between two ends that stayed put.
    expect(describeUndoSuccess({ gesture: 'reconnect' })).not.toBe(
      describeUndoSuccess({ gesture: 'routing' }),
    )
  })
})

describe('bending a connector reads differently from both other connector edits', () => {
  it('names the curve', () => {
    expect(describeUndoSuccess({ gesture: 'bend' })).toBe(
      'Undid bending a connector curve',
    )
    expect(describeRedoSuccess({ gesture: 'bend' })).toBe(
      'Redid bending a connector curve',
    )
  })

  it('is distinct from BOTH a routing change and an endpoint move', () => {
    // Three arms now say "a connector changed", and a user who pressed
    // Ctrl+Z has one line of toast to work out which of their last few edits
    // is coming back. Any two of these reading alike defeats that.
    const bend = describeUndoSuccess({ gesture: 'bend' })
    expect(bend).not.toBe(describeUndoSuccess({ gesture: 'routing' }))
    expect(bend).not.toBe(describeUndoSuccess({ gesture: 'reconnect' }))
  })
})

describe('the copy family', () => {
  it('names a paste, singular and plural', () => {
    expect(describeUndoSuccess({ gesture: 'paste', count: 1 })).toBe(
      'Undid pasting an element',
    )
    expect(describeUndoSuccess({ gesture: 'paste', count: 4 })).toBe(
      'Undid pasting 4 elements',
    )
    expect(describeRedoSuccess({ gesture: 'paste', count: 4 })).toBe(
      'Redid pasting 4 elements',
    )
  })

  it('names a duplicate', () => {
    expect(describeUndoSuccess({ gesture: 'duplicate', count: 1 })).toBe(
      'Undid duplicating an element',
    )
    expect(describeUndoSuccess({ gesture: 'duplicate', count: 3 })).toBe(
      'Undid duplicating 3 elements',
    )
  })

  it('names a cut', () => {
    expect(describeUndoSuccess({ gesture: 'cut', count: 1 })).toBe(
      'Undid cutting an element',
    )
    expect(describeUndoSuccess({ gesture: 'cut', count: 2 })).toBe(
      'Undid cutting 2 elements',
    )
  })

  it('distinguishes a paste from a duplicate', () => {
    // They create identical rows by the same code path, so only the wording
    // can tell the user which gesture is coming back.
    expect(describeUndoSuccess({ gesture: 'paste', count: 2 })).not.toBe(
      describeUndoSuccess({ gesture: 'duplicate', count: 2 }),
    )
  })

  it('distinguishes a cut from a plain delete', () => {
    // Same inverse, but only one of them also filled the clipboard.
    expect(describeUndoSuccess({ gesture: 'cut', count: 2 })).not.toBe(
      describeUndoSuccess({ gesture: 'delete', count: 2 }),
    )
  })

  it('distinguishes all three from creating and quick-creating', () => {
    const wordings = new Set([
      describeUndoSuccess({ gesture: 'paste', count: 1 }),
      describeUndoSuccess({ gesture: 'duplicate', count: 1 }),
      describeUndoSuccess({ gesture: 'cut', count: 1 }),
      describeUndoSuccess({ gesture: 'create', elementKind: 'rectangle' }),
      describeUndoSuccess({
        gesture: 'quick-create',
        elementKind: 'rectangle',
        connected: true,
      }),
    ])
    expect(wordings.size).toBe(5)
  })
})
