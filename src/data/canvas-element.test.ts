// src/data/canvas-element.test.ts
// Integration tests for the canvas board / element data layer (FigJam-style
// canvas engine, milestone 1) against a real in-memory SQLite database
// (DATABASE_URL=:memory:). Mirrors src/data/shape.test.ts's style.

import { beforeEach, describe, expect, it } from 'vitest'

import {
  createCanvasBoard,
  deleteCanvasBoard,
  findCanvasBoardById,
  findCanvasBoardsByProject,
  updateCanvasBoard,
} from './canvas-board'
import {
  createCanvasElement,
  deleteCanvasElement,
  findCanvasElementById,
  findCanvasElementsByBoard,
  nextCanvasZIndex,
  updateCanvasElement,
} from './canvas-element'
import { db } from '@/db'
import { DEFAULT_ELEMENT_STYLE } from '@/lib/canvas-engine/scene'
import { makeProject, resetDb } from '@/test/db-helpers'

async function makeBoard(): Promise<string> {
  const project = makeProject()
  const board = await createCanvasBoard({
    name: 'Canvas',
    projectId: project.id,
  })
  return board.id
}

function baseElement(boardId: string, over: Record<string, unknown> = {}) {
  return {
    boardId,
    kind: 'rectangle' as const,
    positionX: 10,
    positionY: 20,
    width: 160,
    height: 100,
    props: { kind: 'rectangle' as const },
    ...over,
  }
}

beforeEach(() => resetDb())

describe('createCanvasBoard', () => {
  it('creates a board at the project root', async () => {
    const project = makeProject()
    const board = await createCanvasBoard({
      name: 'My Canvas',
      projectId: project.id,
    })

    expect(board.id).toBeTruthy()
    expect(board.name).toBe('My Canvas')
    expect(board.projectId).toBe(project.id)
    expect(board.folderId).toBeNull()
    expect(board.createdAt).toBeInstanceOf(Date)
  })

  it('rejects an empty name', async () => {
    const project = makeProject()
    await expect(
      createCanvasBoard({ name: '', projectId: project.id }),
    ).rejects.toThrow()
  })

  it('finds by id and lists by project', async () => {
    const project = makeProject()
    const board = await createCanvasBoard({
      name: 'A',
      projectId: project.id,
    })

    expect((await findCanvasBoardById(board.id))?.name).toBe('A')
    expect(await findCanvasBoardById('does-not-exist')).toBeNull()
    expect(await findCanvasBoardsByProject(project.id)).toHaveLength(1)
  })
})

describe('updateCanvasBoard', () => {
  it('renames without touching placement', async () => {
    const id = await makeBoard()
    const renamed = await updateCanvasBoard(id, { name: 'Renamed' })
    expect(renamed.name).toBe('Renamed')
    expect(renamed.folderId).toBeNull()
  })

  it('throws for a board that does not exist', async () => {
    await expect(updateCanvasBoard('nope', { name: 'x' })).rejects.toThrow(
      /not found/i,
    )
  })
})

describe('createCanvasElement', () => {
  it('inserts a rectangle and returns it with engine style defaults', async () => {
    const boardId = await makeBoard()
    const element = await createCanvasElement(baseElement(boardId))

    expect(element.id).toBeTruthy()
    expect(element.boardId).toBe(boardId)
    expect(element.kind).toBe('rectangle')
    expect(element.positionX).toBe(10)
    expect(element.positionY).toBe(20)
    expect(element.width).toBe(160)
    // Not settable in milestone 1, but stored so it needs no schema change.
    expect(element.rotation).toBe(0)
    expect(element.zIndex).toBe(0)
    expect(element.text).toBeNull()
    // The row carries no style, so it falls back to the ENGINE's defaults —
    // the same object the renderer would have used. If these two ever drift,
    // a saved element would look different from the one just drawn.
    expect(element.style).toEqual(DEFAULT_ELEMENT_STYLE)
    expect(element.props).toEqual({ kind: 'rectangle' })
    expect(element.createdAt).toBeInstanceOf(Date)
  })

  it('persists a text element with its text and an explicit style', async () => {
    const boardId = await makeBoard()
    const element = await createCanvasElement(
      baseElement(boardId, {
        kind: 'text',
        props: { kind: 'text' },
        text: 'hello 中文',
        style: { ...DEFAULT_ELEMENT_STYLE, fontSize: 24, color: '#ff0000' },
      }),
    )

    expect(element.kind).toBe('text')
    expect(element.text).toBe('hello 中文')
    expect(element.style.fontSize).toBe(24)
    expect(element.style.color).toBe('#ff0000')
  })

  it('rejects a kind that disagrees with props.kind', async () => {
    // The W2 defect: two independently-validated fields describing the same
    // thing. A mismatched row renders as its `kind` with the wrong props.
    const boardId = await makeBoard()
    await expect(
      createCanvasElement(
        baseElement(boardId, { kind: 'text', props: { kind: 'rectangle' } }),
      ),
    ).rejects.toThrow()
  })

  it('rejects an unknown kind, a zero size, and an out-of-bounds coordinate', async () => {
    const boardId = await makeBoard()
    await expect(
      createCanvasElement(
        baseElement(boardId, { kind: 'ellipse', props: { kind: 'ellipse' } }),
      ),
    ).rejects.toThrow()
    await expect(
      createCanvasElement(baseElement(boardId, { width: 0 })),
    ).rejects.toThrow()
    await expect(
      createCanvasElement(baseElement(boardId, { positionX: 1e12 })),
    ).rejects.toThrow()
  })

  it('rejects text past the cap rather than truncating it', async () => {
    const boardId = await makeBoard()
    await expect(
      createCanvasElement(
        baseElement(boardId, {
          kind: 'text',
          props: { kind: 'text' },
          text: 'x'.repeat(10_001),
        }),
      ),
    ).rejects.toThrow()
  })

  it('refuses an element on a board that does not exist', async () => {
    // The FK is what keeps orphan elements out; without it they would be
    // invisible forever and still counted by every board query.
    await expect(
      createCanvasElement(
        baseElement('11111111-1111-4111-8111-111111111111'),
      ),
    ).rejects.toThrow()
  })
})

describe('findCanvasElementsByBoard', () => {
  it('returns elements in paint order, not insertion order', async () => {
    // Hit-testing walks this list in reverse and takes the first match, so an
    // arbitrary order makes "click the thing on top" non-deterministic.
    const boardId = await makeBoard()
    await createCanvasElement(baseElement(boardId, { zIndex: 5 }))
    await createCanvasElement(baseElement(boardId, { zIndex: 1 }))
    await createCanvasElement(baseElement(boardId, { zIndex: 3 }))

    const elements = await findCanvasElementsByBoard(boardId)
    expect(elements.map((e) => e.zIndex)).toEqual([1, 3, 5])
  })

  it('does not leak elements between boards', async () => {
    const a = await makeBoard()
    const b = await makeBoard()
    await createCanvasElement(baseElement(a))

    expect(await findCanvasElementsByBoard(a)).toHaveLength(1)
    expect(await findCanvasElementsByBoard(b)).toHaveLength(0)
  })

  it('returns an empty array for an empty board', async () => {
    expect(await findCanvasElementsByBoard(await makeBoard())).toEqual([])
  })
})

describe('updateCanvasElement', () => {
  it('writes only the fields it was given', async () => {
    const boardId = await makeBoard()
    const created = await createCanvasElement(
      baseElement(boardId, { text: null }),
    )

    const moved = await updateCanvasElement(created.id, {
      positionX: 500,
      positionY: 600,
    })

    expect(moved.positionX).toBe(500)
    expect(moved.positionY).toBe(600)
    // Untouched fields survive.
    expect(moved.width).toBe(created.width)
    expect(moved.height).toBe(created.height)
    expect(moved.kind).toBe('rectangle')
    expect(moved.style).toEqual(created.style)
  })

  it('clears text when explicitly set to null, and keeps it when absent', async () => {
    const boardId = await makeBoard()
    const created = await createCanvasElement(
      baseElement(boardId, {
        kind: 'text',
        props: { kind: 'text' },
        text: 'draft',
      }),
    )

    expect((await updateCanvasElement(created.id, { width: 200 })).text).toBe(
      'draft',
    )
    expect((await updateCanvasElement(created.id, { text: null })).text).toBeNull()
  })

  it('restacks via zIndex', async () => {
    const boardId = await makeBoard()
    const bottom = await createCanvasElement(baseElement(boardId, { zIndex: 0 }))
    await createCanvasElement(baseElement(boardId, { zIndex: 1 }))

    await updateCanvasElement(bottom.id, { zIndex: 9 })
    const elements = await findCanvasElementsByBoard(boardId)
    expect(elements[elements.length - 1].id).toBe(bottom.id)
  })

  it("rejects a props payload for a different kind than the stored row", async () => {
    // `updateCanvasElementSchema` has no `kind`, so the union cannot see what
    // the row actually is — the cross-check has to happen against the prior
    // row the update already reads.
    const boardId = await makeBoard()
    const created = await createCanvasElement(baseElement(boardId))

    await expect(
      updateCanvasElement(created.id, { props: { kind: 'text' } }),
    ).rejects.toThrow(/kind/i)
  })

  it('throws for an element that does not exist', async () => {
    await expect(
      updateCanvasElement('nope', { positionX: 1 }),
    ).rejects.toThrow(/not found/i)
  })

  it('bumps updatedAt', async () => {
    const boardId = await makeBoard()
    const created = await createCanvasElement(baseElement(boardId))
    db.prepare('UPDATE "CanvasElement" SET "updatedAt" = ? WHERE "id" = ?').run(
      created.updatedAt.getTime() - 10_000,
      created.id,
    )

    const updated = await updateCanvasElement(created.id, { width: 200 })
    expect(updated.updatedAt.getTime()).toBeGreaterThan(
      created.updatedAt.getTime() - 10_000,
    )
  })
})

describe('deleteCanvasElement', () => {
  it('removes the row and returns it as it was', async () => {
    const boardId = await makeBoard()
    const created = await createCanvasElement(baseElement(boardId))

    const deleted = await deleteCanvasElement(created.id)
    expect(deleted.id).toBe(created.id)
    expect(await findCanvasElementById(created.id)).toBeNull()
  })

  it('throws for an element that does not exist', async () => {
    await expect(deleteCanvasElement('nope')).rejects.toThrow(/not found/i)
  })
})

describe('board deletion cascade', () => {
  it('takes the board’s elements with it', async () => {
    // ON DELETE CASCADE is the whole reason there is no un-cascaded delete;
    // without it a deleted board leaves rows nothing can ever reach.
    const boardId = await makeBoard()
    const element = await createCanvasElement(baseElement(boardId))

    await deleteCanvasBoard(boardId)

    expect(await findCanvasBoardById(boardId)).toBeNull()
    expect(await findCanvasElementById(element.id)).toBeNull()
  })
})

describe('nextCanvasZIndex', () => {
  it('starts at 0 on an empty board and sits above the current top', async () => {
    const boardId = await makeBoard()
    expect(await nextCanvasZIndex(boardId)).toBe(0)

    await createCanvasElement(baseElement(boardId, { zIndex: 4 }))
    expect(await nextCanvasZIndex(boardId)).toBe(5)
  })

  it('is scoped per board', async () => {
    const a = await makeBoard()
    const b = await makeBoard()
    await createCanvasElement(baseElement(a, { zIndex: 40 }))

    expect(await nextCanvasZIndex(b)).toBe(0)
  })
})
