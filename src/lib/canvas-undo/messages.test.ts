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
    const label: CanvasUndoLabel = { gesture: 'create', elementKind: 'rectangle' }
    expect(describeUndoSuccess(label)).toBe('Undid creating a rectangle')
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
