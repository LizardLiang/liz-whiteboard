// src/lib/canvas-element-adapter.test.ts
// The storage/engine boundary. These tests exist because the two sides use
// different names for the same numbers — positionX/positionY in SQL, x/y in
// the engine — and a silent swap between them is exactly the defect class
// (W1, W3) this repo has already paid for twice.

import { describe, expect, it } from 'vitest'
import {
  toCreateInput,
  toEngineElement,
  toEngineScene,
  toUpdatePatch,
} from './canvas-element-adapter'
import { DEFAULT_ELEMENT_STYLE } from './canvas-engine/scene'
import type { CanvasElementRecord } from '@/data/models'

function record(
  id: string,
  over: Partial<CanvasElementRecord> = {},
): CanvasElementRecord {
  return {
    id,
    boardId: 'board-1',
    kind: 'rectangle',
    positionX: 10,
    positionY: 20,
    width: 160,
    height: 100,
    rotation: 0,
    zIndex: 0,
    text: null,
    style: DEFAULT_ELEMENT_STYLE,
    props: { kind: 'rectangle' },
    revision: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  }
}

describe('toEngineElement', () => {
  it('maps positionX/positionY onto x/y, not onto each other', () => {
    // Asymmetric values on purpose: with x === y a transposed mapping passes.
    const element = toEngineElement(record('a', { positionX: 7, positionY: 99 }))
    expect(element.x).toBe(7)
    expect(element.y).toBe(99)
  })

  it('carries geometry, text and style through unchanged', () => {
    const element = toEngineElement(
      record('a', {
        width: 300,
        height: 42,
        rotation: 15,
        zIndex: 3,
        text: 'hello',
        style: { ...DEFAULT_ELEMENT_STYLE, fontSize: 24 },
      }),
    )
    expect(element).toEqual({
      id: 'a',
      kind: 'rectangle',
      x: 10,
      y: 20,
      width: 300,
      height: 42,
      rotation: 15,
      zIndex: 3,
      text: 'hello',
      style: { ...DEFAULT_ELEMENT_STYLE, fontSize: 24 },
    })
  })

  it('drops the storage-only fields', () => {
    const element = toEngineElement(record('a'))
    expect(element).not.toHaveProperty('boardId')
    expect(element).not.toHaveProperty('props')
    expect(element).not.toHaveProperty('createdAt')
  })
})

describe('toEngineScene', () => {
  it('builds a z-ordered scene regardless of the order rows arrive in', () => {
    const scene = toEngineScene([
      record('c', { zIndex: 5 }),
      record('a', { zIndex: 1 }),
      record('b', { zIndex: 3 }),
    ])
    expect(scene.elements.map((e) => e.id)).toEqual(['a', 'b', 'c'])
    expect(scene.byId.get('b')?.zIndex).toBe(3)
  })

  it('handles an empty board', () => {
    expect(toEngineScene([]).elements).toEqual([])
  })
})

describe('round trip', () => {
  it('survives record -> engine -> create input with geometry intact', () => {
    const source = record('a', {
      positionX: -1234.5,
      positionY: 6789,
      width: 77,
      height: 88,
      zIndex: 4,
      text: 'round trip',
    })
    const input = toCreateInput('board-2', toEngineElement(source))

    expect(input.boardId).toBe('board-2')
    expect(input.positionX).toBe(-1234.5)
    expect(input.positionY).toBe(6789)
    expect(input.width).toBe(77)
    expect(input.height).toBe(88)
    expect(input.zIndex).toBe(4)
    expect(input.text).toBe('round trip')
  })

  it('derives props.kind from the element kind, so the two can never disagree', () => {
    // The create schema rejects a mismatch; building props here rather than
    // asking the caller for it means the mismatch is unrepresentable.
    const input = toCreateInput('board-2', toEngineElement(record('t', { kind: 'text' })))
    expect(input.kind).toBe('text')
    expect(input.props).toEqual({ kind: 'text' })
  })

  it('omits kind from an update patch, because a kind never changes', () => {
    const patch = toUpdatePatch(toEngineElement(record('a', { positionX: 5 })))
    expect(patch.positionX).toBe(5)
    expect(patch).not.toHaveProperty('kind')
    expect(patch).not.toHaveProperty('props')
  })
})
