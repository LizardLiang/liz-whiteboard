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
  RevisionMismatchError,
  createCanvasElement,
  deleteCanvasElement,
  findCanvasElementById,
  findCanvasElementsByBoard,
  nextCanvasZIndex,
  updateCanvasElement,
} from './canvas-element'
import { canvasElementStyleSchema } from '@/data/schema'
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

  it('reads a row written before corner radius existed as a square one', () => {
    // The migration claim in `canvasElementStyleSchema`, asserted rather than
    // trusted: `cornerRadius` is a `.default()`, so every style JSON already
    // in the column parses with the key simply absent. There is no ALTER to
    // run because the whole style is one JSON value.
    const legacy = {
      fill: 'rgba(59, 130, 246, 0.10)',
      stroke: '#3b82f6',
      strokeWidth: 2,
      fontSize: 16,
      color: '#0f172a',
    }
    const parsed = canvasElementStyleSchema.parse(legacy)
    expect(parsed.cornerRadius).toBe(0)
    expect(parsed).toEqual(DEFAULT_ELEMENT_STYLE)
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
    // `hexagon` is deliberately a kind the engine does NOT have. This case
    // used to use `ellipse`, which stopped proving anything the moment
    // ellipses became real — pick a fresh non-kind if hexagons are ever added.
    await expect(
      createCanvasElement(
        baseElement(boardId, { kind: 'hexagon', props: { kind: 'hexagon' } }),
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
      createCanvasElement(baseElement('11111111-1111-4111-8111-111111111111')),
    ).rejects.toThrow()
  })

  it('starts every new row at revision 1', async () => {
    // A wall-clock timestamp cannot tell two same-millisecond writes apart;
    // `revision` is the token undo compares instead.
    const boardId = await makeBoard()
    const element = await createCanvasElement(baseElement(boardId))
    expect(element.revision).toBe(1)
  })

  it('seeds a restored row above minRevision instead of resetting to 1 (Hermes review, W-C, ABA)', async () => {
    // Without this, every restore starts back at revision 1 — a stale
    // undo/redo entry recorded against the ORIGINAL row (which may have been
    // updated several times before being deleted) can then match a RESTORED
    // row's revision by coincidence and apply against content it never
    // actually saw.
    const boardId = await makeBoard()
    const element = await createCanvasElement(
      baseElement(boardId, { id: '55555555-5555-4555-8555-555555555555', minRevision: 4 }),
    )
    expect(element.revision).toBe(5)
  })

  it('still starts at revision 1 when minRevision is absent (ordinary create, restore-only field)', async () => {
    const boardId = await makeBoard()
    const element = await createCanvasElement(baseElement(boardId))
    expect(element.revision).toBe(1)
  })

  it('accepts minRevision 0 — a row created and never subsequently updated legitimately holds revision 0', async () => {
    // A real, reachable bug (not a theoretical boundary): this project's own
    // e2e seed scripts (e2e/seed-canvas.ts) write CanvasElement rows via raw
    // SQL with no `revision` column, so the schema's own `DEFAULT 0` applies
    // — the seeded row's revision is genuinely 0. Deleting that row and
    // undoing the delete sends its actual pre-delete revision, 0, straight
    // through as `minRevision`. The schema field used to be `.positive()`
    // (>0), which rejected 0 with a VALIDATION_ERROR that the undo hook's
    // generic-refusal fallback then reported as a false "changed since your
    // edit" — found by canvas-undo.spec.ts's own "undo a delete" e2e case
    // (board-undo tactical plan, Wave 5), not by inspection.
    const boardId = await makeBoard()
    const element = await createCanvasElement(
      baseElement(boardId, {
        id: '66666666-6666-4666-8666-666666666666',
        minRevision: 0,
      }),
    )
    expect(element.revision).toBe(1)
  })

  it('accepts an explicit, validated id and creates the row under it', async () => {
    // The only caller of this is undo restoring a deleted element under the
    // identifier every other client still has cached.
    const boardId = await makeBoard()
    const explicitId = '44444444-4444-4444-8444-444444444444'
    const element = await createCanvasElement(
      baseElement(boardId, { id: explicitId }),
    )
    expect(element.id).toBe(explicitId)
    expect(await findCanvasElementById(explicitId)).not.toBeNull()
  })

  it('rejects a non-uuid explicit id rather than silently generating one', async () => {
    // `id` is validated exactly like every other field — not a second,
    // laxer write path.
    const boardId = await makeBoard()
    await expect(
      createCanvasElement(baseElement(boardId, { id: 'not-a-uuid' })),
    ).rejects.toThrow()
  })

  it('fails rather than overwrite when the explicit id already exists', async () => {
    const boardId = await makeBoard()
    const explicitId = '55555555-5555-4555-8555-555555555555'
    await createCanvasElement(baseElement(boardId, { id: explicitId }))
    await expect(
      createCanvasElement(baseElement(boardId, { id: explicitId })),
    ).rejects.toThrow()
  })

  it('does not leak the raw SQLite constraint text on an id collision (Hermes review, finding 2)', async () => {
    // A second board's editor guessing another board's element id would
    // otherwise learn "it exists" from the raw `UNIQUE constraint failed:
    // CanvasElement.id` text alone — the exact existence oracle
    // `ELEMENT_REFUSED` (handlers.ts) already closes for update/delete. The
    // collision case above only asserts SOME rejection; this one pins the
    // message so a regression here fails loudly.
    const boardId = await makeBoard()
    const otherBoardId = await makeBoard()
    const explicitId = '66666666-6666-4666-8666-666666666666'
    await createCanvasElement(baseElement(boardId, { id: explicitId }))

    let caught: unknown
    try {
      await createCanvasElement(baseElement(otherBoardId, { id: explicitId }))
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(Error)
    const message = (caught as Error).message
    expect(message).toBe('Failed to create canvas element')
    expect(message).not.toMatch(/UNIQUE/i)
    expect(message).not.toMatch(/CanvasElement/)
    expect(message).not.toMatch(/constraint/i)
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
    expect(
      (await updateCanvasElement(created.id, { text: null })).text,
    ).toBeNull()
  })

  it('restacks via zIndex', async () => {
    const boardId = await makeBoard()
    const bottom = await createCanvasElement(
      baseElement(boardId, { zIndex: 0 }),
    )
    await createCanvasElement(baseElement(boardId, { zIndex: 1 }))

    await updateCanvasElement(bottom.id, { zIndex: 9 })
    const elements = await findCanvasElementsByBoard(boardId)
    expect(elements[elements.length - 1].id).toBe(bottom.id)
  })

  it('rejects a props payload for a different kind than the stored row', async () => {
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
    await expect(updateCanvasElement('nope', { positionX: 1 })).rejects.toThrow(
      /not found/i,
    )
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

  it('increments revision by exactly one per write, reusing the prior-row read', async () => {
    const boardId = await makeBoard()
    const created = await createCanvasElement(baseElement(boardId))
    expect(created.revision).toBe(1)

    const first = await updateCanvasElement(created.id, { width: 200 })
    expect(first.revision).toBe(2)

    const second = await updateCanvasElement(created.id, { width: 300 })
    expect(second.revision).toBe(3)
  })

  it('applies the write when expectedRevision matches the current row', async () => {
    const boardId = await makeBoard()
    const created = await createCanvasElement(baseElement(boardId))

    const updated = await updateCanvasElement(
      created.id,
      { width: 250 },
      created.revision,
    )
    expect(updated.width).toBe(250)
    expect(updated.revision).toBe(2)
  })

  it('refuses with a typed RevisionMismatchError and writes nothing on a stale expectedRevision', async () => {
    const boardId = await makeBoard()
    const created = await createCanvasElement(baseElement(boardId))
    // Someone else writes first, advancing the row to revision 2.
    await updateCanvasElement(created.id, { width: 999 })

    await expect(
      updateCanvasElement(created.id, { width: 111 }, created.revision),
    ).rejects.toBeInstanceOf(RevisionMismatchError)

    // The contested write must not have landed.
    const unchanged = await findCanvasElementById(created.id)
    expect(unchanged?.width).toBe(999)
    expect(unchanged?.revision).toBe(2)
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

  it('deletes when expectedRevision matches the current row', async () => {
    const boardId = await makeBoard()
    const created = await createCanvasElement(baseElement(boardId))

    const deleted = await deleteCanvasElement(created.id, created.revision)
    expect(deleted.id).toBe(created.id)
    expect(await findCanvasElementById(created.id)).toBeNull()
  })

  it('refuses with a typed RevisionMismatchError and deletes nothing on a stale expectedRevision', async () => {
    const boardId = await makeBoard()
    const created = await createCanvasElement(baseElement(boardId))
    // Someone else writes first, advancing the row to revision 2.
    await updateCanvasElement(created.id, { width: 999 })

    await expect(
      deleteCanvasElement(created.id, created.revision),
    ).rejects.toBeInstanceOf(RevisionMismatchError)

    // The contested delete must not have landed.
    expect(await findCanvasElementById(created.id)).not.toBeNull()
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

  it('clamps at the schema max instead of returning a value the schema will then reject (Hermes review, suggestion)', async () => {
    // One element already sitting at the schema's own ceiling would
    // otherwise make `MAX(zIndex) + 1` return 1_000_001 — a value
    // `canvasZIndexSchema` (schema.ts) rejects, bricking `element:create` on
    // this board with no way to recover (reachable in one message via
    // create-with-id, per the mission brief).
    const boardId = await makeBoard()
    await createCanvasElement(baseElement(boardId, { zIndex: 1_000_000 }))

    expect(await nextCanvasZIndex(boardId)).toBe(1_000_000)
  })
})
