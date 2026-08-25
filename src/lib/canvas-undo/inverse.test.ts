// src/lib/canvas-undo/inverse.test.ts
// Unit tests for the pure inverse-operation builder (board-undo tactical
// plan, Wave 2, step 6).

import { describe, expect, it } from 'vitest'
import { buildInverse } from './inverse'
import type { CurrentRevisions } from './inverse'
import type { CanvasElementSnapshot, CanvasUndoEntry } from './undo-stack'
import { DEFAULT_ELEMENT_STYLE } from '@/lib/canvas-engine/scene'

function snapshot(
  id: string,
  over: Partial<CanvasElementSnapshot> = {},
): CanvasElementSnapshot {
  return {
    id,
    boardId: 'board-1',
    kind: 'rectangle',
    positionX: 10,
    positionY: 20,
    width: 100,
    height: 50,
    rotation: 0,
    zIndex: 0,
    text: null,
    style: DEFAULT_ELEMENT_STYLE,
    props: { kind: 'rectangle' },
    ...over,
  }
}

function revisions(
  entries: Record<string, number | undefined>,
): CurrentRevisions {
  return new Map(Object.entries(entries))
}

describe('buildInverse — create -> delete', () => {
  it('produces a conditional delete when the row is unchanged since creation', () => {
    const entry: CanvasUndoEntry = {
      label: { gesture: 'create', elementKind: 'rectangle' },
      operations: [{ kind: 'create', elementId: 'el-1', afterRevision: 1 }],
    }
    const result = buildInverse(entry, revisions({ 'el-1': 1 }))

    expect(result).toEqual({
      status: 'ok',
      writes: [{ kind: 'delete', elementId: 'el-1', expectedRevision: 1 }],
    })
  })

  it('is contested (missing) when the element was already deleted', () => {
    const entry: CanvasUndoEntry = {
      label: { gesture: 'create', elementKind: 'rectangle' },
      operations: [{ kind: 'create', elementId: 'el-1', afterRevision: 1 }],
    }
    const result = buildInverse(entry, revisions({ 'el-1': undefined }))

    expect(result).toEqual({
      status: 'contested',
      members: [{ elementId: 'el-1', reason: 'missing' }],
    })
  })

  it('is contested (changed) when the element was written again since creation', () => {
    const entry: CanvasUndoEntry = {
      label: { gesture: 'create', elementKind: 'rectangle' },
      operations: [{ kind: 'create', elementId: 'el-1', afterRevision: 1 }],
    }
    const result = buildInverse(entry, revisions({ 'el-1': 2 }))

    expect(result).toEqual({
      status: 'contested',
      members: [{ elementId: 'el-1', reason: 'changed' }],
    })
  })
})

describe('buildInverse — update -> update-to-prior', () => {
  it('produces a conditional update restoring the prior fields', () => {
    const before = snapshot('el-1', { positionX: 5, positionY: 5 })
    const entry: CanvasUndoEntry = {
      label: { gesture: 'move', count: 1 },
      operations: [
        { kind: 'update', elementId: 'el-1', before, afterRevision: 2 },
      ],
    }
    const result = buildInverse(entry, revisions({ 'el-1': 2 }))

    expect(result).toEqual({
      status: 'ok',
      writes: [
        {
          kind: 'update',
          elementId: 'el-1',
          expectedRevision: 2,
          patch: {
            positionX: 5,
            positionY: 5,
            width: before.width,
            height: before.height,
            zIndex: before.zIndex,
            text: before.text,
            style: before.style,
            props: before.props,
          },
        },
      ],
    })
  })

  it('is contested (missing) when the element was deleted since the update', () => {
    const entry: CanvasUndoEntry = {
      label: { gesture: 'move', count: 1 },
      operations: [
        {
          kind: 'update',
          elementId: 'el-1',
          before: snapshot('el-1'),
          afterRevision: 2,
        },
      ],
    }
    const result = buildInverse(entry, revisions({ 'el-1': undefined }))

    expect(result).toEqual({
      status: 'contested',
      members: [{ elementId: 'el-1', reason: 'missing' }],
    })
  })

  it('is contested (changed) when a collaborator wrote it again since the update', () => {
    const entry: CanvasUndoEntry = {
      label: { gesture: 'move', count: 1 },
      operations: [
        {
          kind: 'update',
          elementId: 'el-1',
          before: snapshot('el-1'),
          afterRevision: 2,
        },
      ],
    }
    const result = buildInverse(entry, revisions({ 'el-1': 3 }))

    expect(result).toEqual({
      status: 'contested',
      members: [{ elementId: 'el-1', reason: 'changed' }],
    })
  })
})

describe('buildInverse — delete -> create-with-id', () => {
  it('produces a create carrying the original id and every persisted property', () => {
    const before = snapshot('el-1', {
      text: 'hello',
      zIndex: 7,
      style: { ...DEFAULT_ELEMENT_STYLE, fontSize: 24 },
    })
    const entry: CanvasUndoEntry = {
      label: { gesture: 'delete', count: 1 },
      operations: [{ kind: 'delete', elementId: 'el-1', before }],
    }
    const result = buildInverse(entry, revisions({ 'el-1': undefined }))

    expect(result).toEqual({
      status: 'ok',
      writes: [{ kind: 'create', elementId: 'el-1', snapshot: before }],
    })
  })

  it('is contested (changed) when something already occupies the original id', () => {
    const entry: CanvasUndoEntry = {
      label: { gesture: 'delete', count: 1 },
      operations: [
        { kind: 'delete', elementId: 'el-1', before: snapshot('el-1') },
      ],
    }
    const result = buildInverse(entry, revisions({ 'el-1': 1 }))

    expect(result).toEqual({
      status: 'contested',
      members: [{ elementId: 'el-1', reason: 'changed' }],
    })
  })
})

describe('buildInverse — multi-element entries', () => {
  it('applies every member when none is contested', () => {
    const entry: CanvasUndoEntry = {
      label: { gesture: 'move', count: 2 },
      operations: [
        {
          kind: 'update',
          elementId: 'a',
          before: snapshot('a'),
          afterRevision: 2,
        },
        {
          kind: 'update',
          elementId: 'b',
          before: snapshot('b'),
          afterRevision: 3,
        },
      ],
    }
    const result = buildInverse(entry, revisions({ a: 2, b: 3 }))

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') throw new Error('unreachable')
    expect(result.writes.map((w) => w.elementId)).toEqual(['a', 'b'])
  })

  it('is contested if ANY member is contested, and applies nothing — not partially', () => {
    const entry: CanvasUndoEntry = {
      label: { gesture: 'move', count: 2 },
      operations: [
        {
          kind: 'update',
          elementId: 'a',
          before: snapshot('a'),
          afterRevision: 2,
        },
        {
          kind: 'update',
          elementId: 'b',
          before: snapshot('b'),
          afterRevision: 3,
        },
      ],
    }
    // "a" is unchanged (would succeed alone); "b" was written again.
    const result = buildInverse(entry, revisions({ a: 2, b: 9 }))

    expect(result).toEqual({
      status: 'contested',
      members: [{ elementId: 'b', reason: 'changed' }],
    })
    // No partial application: a contested result carries no writes at all.
    expect((result as { writes?: unknown }).writes).toBeUndefined()
  })

  it('reports every contested member, not just the first', () => {
    const entry: CanvasUndoEntry = {
      label: { gesture: 'delete', count: 2 },
      operations: [
        { kind: 'delete', elementId: 'a', before: snapshot('a') },
        { kind: 'delete', elementId: 'b', before: snapshot('b') },
      ],
    }
    // Both ids are now occupied — both contested.
    const result = buildInverse(entry, revisions({ a: 1, b: 1 }))

    expect(result).toEqual({
      status: 'contested',
      members: [
        { elementId: 'a', reason: 'changed' },
        { elementId: 'b', reason: 'changed' },
      ],
    })
  })
})
