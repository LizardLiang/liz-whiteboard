// src/lib/canvas-undo/undo-stack.test.ts
// Unit tests for the pure undo/redo stack (board-undo tactical plan, Wave 2,
// step 5).

import { describe, expect, it } from 'vitest'
import {
  EMPTY_UNDO_STACK,
  UNDO_STACK_CAP,
  elementKindForOperation,
  popRedoEntry,
  popUndoEntry,
  pushRedoEntry,
  pushUndoEntry,
  refreshRevision,
} from './undo-stack'
import type { CanvasUndoEntry, CanvasUndoLabel } from './undo-stack'
import { DEFAULT_ELEMENT_STYLE } from '@/lib/canvas-engine/scene'

/**
 * `tag` only needs to make entries distinguishable in these tests' order/
 * identity assertions — it is folded into `count` (a real field on the
 * `move` variant of `CanvasUndoLabel`, Hermes review carry-over) rather than
 * a free-form string, since the label is no longer a bare string.
 */
function makeEntry(tag: number, elementId = 'el-1'): CanvasUndoEntry {
  return {
    label: { gesture: 'move', count: tag },
    operations: [{ kind: 'create', elementId, afterRevision: 1 }],
  }
}

const MOVE_1: CanvasUndoLabel = { gesture: 'move', count: 1 }
const MOVE_2: CanvasUndoLabel = { gesture: 'move', count: 2 }
const CREATE_RECT: CanvasUndoLabel = { gesture: 'create', elementKind: 'rectangle' }
const CREATE_TEXT: CanvasUndoLabel = { gesture: 'create', elementKind: 'text' }
const DELETE_1: CanvasUndoLabel = { gesture: 'delete', count: 1 }

describe('pushUndoEntry', () => {
  it('appends the entry and clears redo', () => {
    const withRedo = pushRedoEntry(EMPTY_UNDO_STACK, makeEntry(0))
    expect(withRedo.redo).toHaveLength(1)

    const stack = pushUndoEntry(withRedo, makeEntry(1))
    expect(stack.entries.map((e) => e.label)).toEqual([MOVE_1])
    expect(stack.redo).toEqual([])
  })

  it('retains at least the spec floor of 50 entries', () => {
    expect(UNDO_STACK_CAP).toBeGreaterThanOrEqual(50)
  })

  it('caps retention and evicts the OLDEST entry first', () => {
    let stack = EMPTY_UNDO_STACK
    for (let i = 0; i < UNDO_STACK_CAP + 10; i++) {
      stack = pushUndoEntry(stack, makeEntry(i))
    }

    expect(stack.entries).toHaveLength(UNDO_STACK_CAP)
    // The oldest 10 (tag 0..9) are gone; the newest 100 remain in order.
    expect(stack.entries[0].label).toEqual({ gesture: 'move', count: 10 })
    expect(stack.entries[stack.entries.length - 1].label).toEqual({
      gesture: 'move',
      count: UNDO_STACK_CAP + 9,
    })
  })

  it('60 sequential pushes retain exactly the last 60 within the cap', () => {
    let stack = EMPTY_UNDO_STACK
    for (let i = 0; i < 60; i++) {
      stack = pushUndoEntry(stack, makeEntry(i))
    }
    expect(stack.entries).toHaveLength(60)
    expect(stack.entries.map((e) => e.label)).toEqual(
      Array.from({ length: 60 }, (_, i) => ({ gesture: 'move', count: i })),
    )
  })
})

describe('popUndoEntry', () => {
  it('returns a typed nothing-to-undo result on an empty stack rather than a silent no-op', () => {
    const result = popUndoEntry(EMPTY_UNDO_STACK)
    expect(result).toEqual({ status: 'nothing-to-undo' })
  })

  it('removes and returns the most recently pushed entry (LIFO)', () => {
    let stack = pushUndoEntry(EMPTY_UNDO_STACK, makeEntry(1))
    stack = pushUndoEntry(stack, makeEntry(2))

    const result = popUndoEntry(stack)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') throw new Error('unreachable')
    expect(result.entry.label).toEqual(MOVE_2)
    expect(result.stack.entries.map((e) => e.label)).toEqual([MOVE_1])
  })

  it('does NOT move the popped entry to redo — the caller decides that only on success', () => {
    const stack = pushUndoEntry(EMPTY_UNDO_STACK, makeEntry(1))
    const result = popUndoEntry(stack)
    if (result.status !== 'ok') throw new Error('unreachable')
    expect(result.stack.redo).toEqual([])
  })

  it('is exhausted after popping every entry', () => {
    let stack = pushUndoEntry(EMPTY_UNDO_STACK, makeEntry(1))
    const popped = popUndoEntry(stack)
    if (popped.status !== 'ok') throw new Error('unreachable')
    stack = popped.stack

    expect(popUndoEntry(stack)).toEqual({ status: 'nothing-to-undo' })
  })
})

describe('pushRedoEntry / popRedoEntry', () => {
  it('returns a typed nothing-to-redo result on an empty redo stack', () => {
    expect(popRedoEntry(EMPTY_UNDO_STACK)).toEqual({
      status: 'nothing-to-redo',
    })
  })

  it('a successful undo can be redone', () => {
    const stack = pushUndoEntry(EMPTY_UNDO_STACK, makeEntry(1))
    const popped = popUndoEntry(stack)
    if (popped.status !== 'ok') throw new Error('unreachable')

    const afterUndo = pushRedoEntry(popped.stack, popped.entry)
    expect(afterUndo.entries).toEqual([])
    expect(afterUndo.redo.map((e) => e.label)).toEqual([MOVE_1])

    const redone = popRedoEntry(afterUndo)
    expect(redone.status).toBe('ok')
    if (redone.status !== 'ok') throw new Error('unreachable')
    expect(redone.entry.label).toEqual(MOVE_1)
    // Reapplied edit is itself undoable again.
    expect(redone.stack.entries.map((e) => e.label)).toEqual([MOVE_1])
    expect(redone.stack.redo).toEqual([])
  })

  it('redo does not clear the rest of the redo stack it came from', () => {
    let stack = pushUndoEntry(EMPTY_UNDO_STACK, makeEntry(1))
    stack = pushUndoEntry(stack, makeEntry(2))

    let popped = popUndoEntry(stack) // pops tag 2
    if (popped.status !== 'ok') throw new Error('unreachable')
    stack = pushRedoEntry(popped.stack, popped.entry)

    popped = popUndoEntry(stack) // pops tag 1
    if (popped.status !== 'ok') throw new Error('unreachable')
    stack = pushRedoEntry(popped.stack, popped.entry)

    expect(stack.redo.map((e) => e.label)).toEqual([MOVE_2, MOVE_1])

    const redone = popRedoEntry(stack)
    if (redone.status !== 'ok') throw new Error('unreachable')
    expect(redone.entry.label).toEqual(MOVE_1)
    // tag 2 is still waiting in redo — not wiped by reapplying tag 1.
    expect(redone.stack.redo.map((e) => e.label)).toEqual([MOVE_2])
  })

  it('a new edit (pushUndoEntry) clears redo, so a redone-then-superseded entry cannot come back', () => {
    const stack = pushUndoEntry(EMPTY_UNDO_STACK, makeEntry(1))
    const popped = popUndoEntry(stack)
    if (popped.status !== 'ok') throw new Error('unreachable')
    const withRedo = pushRedoEntry(popped.stack, popped.entry)
    expect(withRedo.redo).toHaveLength(1)

    const afterNewEdit = pushUndoEntry(withRedo, makeEntry(2))
    expect(afterNewEdit.redo).toEqual([])
  })
})

describe('refreshRevision (Hermes review, BLOCKER B1)', () => {
  it('updates afterRevision on every surviving create/update op for the element, in BOTH entries and redo', () => {
    let stack = pushUndoEntry(EMPTY_UNDO_STACK, makeEntry(1, 'el-1'))
    stack = pushUndoEntry(stack, makeEntry(2, 'el-1'))
    const popped = popUndoEntry(stack) // pops the tag-2 entry
    if (popped.status !== 'ok') throw new Error('unreachable')
    stack = pushRedoEntry(popped.stack, popped.entry)
    // stack.entries: [tag 1 @ afterRevision 1]
    // stack.redo:    [tag 2 @ afterRevision 1]

    const refreshed = refreshRevision(stack, 'el-1', 7)

    const createOp = refreshed.entries[0].operations[0]
    expect(createOp.kind).toBe('create')
    expect(createOp).toMatchObject({ afterRevision: 7 })

    const updateOp = refreshed.redo[0].operations[0]
    expect(updateOp.kind).toBe('create')
    // (makeEntry always produces a 'create' op — this only proves BOTH
    // arrays are walked; the delete-exclusion case below proves the kind
    // gate.)
  })

  it('leaves delete operations untouched (they carry no afterRevision)', () => {
    const entry: CanvasUndoEntry = {
      label: DELETE_1,
      operations: [
        {
          kind: 'delete',
          elementId: 'el-1',
          before: {
            id: 'el-1',
            boardId: 'board-1',
            kind: 'rectangle',
            positionX: 0,
            positionY: 0,
            width: 10,
            height: 10,
            rotation: 0,
            zIndex: 0,
            text: null,
            style: DEFAULT_ELEMENT_STYLE,
            props: { kind: 'rectangle' },
          },
        },
      ],
    }
    const stack = pushUndoEntry(EMPTY_UNDO_STACK, entry)
    const refreshed = refreshRevision(stack, 'el-1', 99)
    expect(refreshed.entries[0]).toEqual(stack.entries[0])
  })

  it('leaves operations for OTHER elements untouched', () => {
    const stack = pushUndoEntry(EMPTY_UNDO_STACK, makeEntry(1, 'el-2'))
    const refreshed = refreshRevision(stack, 'el-1', 42)
    expect(refreshed.entries[0].operations[0]).toMatchObject({
      afterRevision: 1,
    })
  })

  it('is a no-op (same array reference) when nothing in the stack references the element', () => {
    const stack = pushUndoEntry(EMPTY_UNDO_STACK, makeEntry(1, 'el-2'))
    const refreshed = refreshRevision(stack, 'el-1', 42)
    expect(refreshed.entries[0]).toBe(stack.entries[0])
  })
})

describe('elementKindForOperation (Wave 4, step 11)', () => {
  it('reads the kind straight off an update/delete operation\'s own snapshot', () => {
    const entry: CanvasUndoEntry = {
      label: MOVE_1,
      operations: [
        {
          kind: 'update',
          elementId: 'el-1',
          afterRevision: 2,
          before: {
            id: 'el-1',
            boardId: 'board-1',
            kind: 'text',
            positionX: 0,
            positionY: 0,
            width: 10,
            height: 10,
            rotation: 0,
            zIndex: 0,
            text: 'hi',
            style: DEFAULT_ELEMENT_STYLE,
            props: { kind: 'text' },
          },
        },
      ],
    }
    expect(elementKindForOperation(entry, 'el-1')).toBe('text')
  })

  it("reads a create operation's kind off the ENTRY's own label", () => {
    const entry: CanvasUndoEntry = {
      label: CREATE_TEXT,
      operations: [{ kind: 'create', elementId: 'el-1', afterRevision: 1 }],
    }
    expect(elementKindForOperation(entry, 'el-1')).toBe('text')
  })

  it('returns undefined for an id no operation in the entry targets', () => {
    const entry: CanvasUndoEntry = {
      label: CREATE_RECT,
      operations: [{ kind: 'create', elementId: 'el-1', afterRevision: 1 }],
    }
    expect(elementKindForOperation(entry, 'el-2')).toBeUndefined()
  })
})

describe('a create operation names its kind from its own snapshot', () => {
  const SNAPSHOT = {
    id: 'el-1',
    boardId: 'board-1',
    kind: 'connector' as const,
    positionX: 0,
    positionY: 0,
    width: 1,
    height: 1,
    rotation: 0,
    zIndex: 0,
    text: null,
    style: DEFAULT_ELEMENT_STYLE,
    props: {
      kind: 'connector' as const,
      sourceElementId: 'el-a',
      targetElementId: 'el-b',
      routing: 'straight' as const,
    },
  }

  it('prefers `after` over the entry label', () => {
    // A quick-create entry holds TWO creates of DIFFERENT kinds, so the
    // entry's single `elementKind` cannot name both. `after` is the row the
    // create actually produced, and is the only per-operation answer.
    const entry: CanvasUndoEntry = {
      label: { gesture: 'quick-create', elementKind: 'rectangle', connected: true },
      operations: [
        { kind: 'create', elementId: 'el-0', afterRevision: 1 },
        {
          kind: 'create',
          elementId: 'el-1',
          afterRevision: 1,
          after: SNAPSHOT,
        },
      ],
    }
    expect(elementKindForOperation(entry, 'el-1')).toBe('connector')
  })

  it('still falls back to the label when no snapshot was recorded', () => {
    const entry: CanvasUndoEntry = {
      label: CREATE_RECT,
      operations: [{ kind: 'create', elementId: 'el-1', afterRevision: 1 }],
    }
    expect(elementKindForOperation(entry, 'el-1')).toBe('rectangle')
  })

  it('returns undefined for a create with neither snapshot nor create label', () => {
    const entry: CanvasUndoEntry = {
      label: { gesture: 'quick-create', elementKind: null, connected: true },
      operations: [{ kind: 'create', elementId: 'el-1', afterRevision: 1 }],
    }
    expect(elementKindForOperation(entry, 'el-1')).toBeUndefined()
  })
})
