// src/lib/canvas-board/handlers-table.test.ts
// Tests for `element:table-op` — the channel that keeps two people's cell
// edits on one table. The data layer is a small in-memory store so the
// read-apply-write sequence runs for real.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerCanvasElementHandlers } from './handlers'
import type { CanvasAckResult, CanvasSocket } from './handlers'
import type * as CanvasElementModule from '@/data/canvas-element'
import type { CanvasTable } from '@/lib/canvas-engine/table'
import {
  RevisionMismatchError,
  findCanvasElementById,
  updateCanvasElement,
} from '@/data/canvas-element'
import { requireCanvasBoardRole } from '@/lib/auth/require-role'
import { DEFAULT_ELEMENT_STYLE } from '@/lib/canvas-engine/scene'
import { cellKey, createTable } from '@/lib/canvas-engine/table'

vi.mock('@/data/canvas-element', async () => {
  const actual = await vi.importActual<typeof CanvasElementModule>(
    '@/data/canvas-element',
  )
  return {
    RevisionMismatchError: actual.RevisionMismatchError,
    createCanvasElement: vi.fn(),
    deleteCanvasElement: vi.fn(),
    findCanvasElementById: vi.fn(),
    updateCanvasElement: vi.fn(),
    findCanvasElementsByBoard: vi.fn(),
    nextCanvasZIndex: vi.fn(),
  }
})

vi.mock('@/lib/auth/require-role', () => ({
  requireCanvasBoardRole: vi.fn(),
}))

const BOARD_ID = '11111111-1111-4111-8111-111111111111'
const TABLE_ID = '33333333-3333-4333-8333-333333333333'
const RECT_ID = '44444444-4444-4444-8444-444444444444'

type Ack = (res: any) => void
interface Harness {
  handlers: Record<string, (data: any, cb?: Ack) => Promise<void>>
  broadcast: Array<{ event: string; payload: any }>
}

function makeHarness(): Harness {
  const handlers: Harness['handlers'] = {}
  const broadcast: Harness['broadcast'] = []
  const socket: CanvasSocket = {
    data: { userId: 'u1', sessionExpiresAt: Date.now() + 60_000 },
    on: (event, handler) => {
      handlers[event] = handler as any
    },
    emit: () => {},
    broadcast: { emit: (event, payload) => broadcast.push({ event, payload }) },
    disconnect: () => {},
  }
  registerCanvasElementHandlers(socket, BOARD_ID, 'u1')
  return { handlers, broadcast }
}

let store: Map<string, any>
let seq = 0

function seedTable(table: CanvasTable) {
  store.set(TABLE_ID, {
    id: TABLE_ID,
    boardId: BOARD_ID,
    kind: 'table',
    positionX: 0,
    positionY: 0,
    width: 360,
    height: 120,
    rotation: 0,
    zIndex: 0,
    text: null,
    style: { ...DEFAULT_ELEMENT_STYLE },
    props: { kind: 'table', table },
    revision: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

function call(
  h: Harness,
  event: string,
  data: unknown,
): Promise<Parameters<Ack>[0]> {
  return new Promise((resolve) => {
    void h.handlers[event](data, resolve)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  seq = 0
  store = new Map()
  vi.mocked(requireCanvasBoardRole).mockResolvedValue(false)
  vi.mocked(findCanvasElementById).mockImplementation((id) => {
    const row = store.get(id)
    return Promise.resolve(row ? structuredClone(row) : null)
  })
  vi.mocked(updateCanvasElement).mockImplementation(
    (id, data, expectedRevision) => {
      const row = store.get(id)
      if (expectedRevision !== undefined && row.revision !== expectedRevision) {
        return Promise.reject(
          new RevisionMismatchError(id, row.revision, expectedRevision),
        )
      }
      Object.assign(row, structuredClone(data), { revision: row.revision + 1 })
      return Promise.resolve(structuredClone(row))
    },
  )
})

const table3 = () => createTable(3, 3, () => `id-${++seq}`)

describe('element:table-op', () => {
  it('applies a cell edit to the stored table and broadcasts element:updated', async () => {
    const table = table3()
    seedTable(table)
    const h = makeHarness()
    const res = await call(h, 'element:table-op', {
      elementId: TABLE_ID,
      op: {
        type: 'setCellText',
        rowId: table.rows[0].id,
        colId: table.cols[0].id,
        text: 'hello',
      },
    })
    expect(res.ok).toBe(true)
    expect(res.inverse).toMatchObject({ type: 'setCellText', text: '' })
    const stored = store.get(TABLE_ID).props.table as CanvasTable
    expect(stored.cells[cellKey(table.rows[0].id, table.cols[0].id)].text).toBe(
      'hello',
    )
    expect(h.broadcast).toHaveLength(1)
    expect(h.broadcast[0].event).toBe('element:updated')
    expect(h.broadcast[0].payload).toMatchObject({
      elementId: TABLE_ID,
      revision: 2,
      width: 360,
      height: 120,
    })
  })

  it('keeps both cells when two people edit different cells at once', async () => {
    const table = table3()
    seedTable(table)
    const alice = makeHarness()
    const bob = makeHarness()
    const [a, b] = await Promise.all([
      call(alice, 'element:table-op', {
        elementId: TABLE_ID,
        op: {
          type: 'setCellText',
          rowId: table.rows[0].id,
          colId: table.cols[0].id,
          text: 'alice',
        },
      }),
      call(bob, 'element:table-op', {
        elementId: TABLE_ID,
        op: {
          type: 'setCellText',
          rowId: table.rows[2].id,
          colId: table.cols[2].id,
          text: 'bob',
        },
      }),
    ])
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    const stored = store.get(TABLE_ID).props.table as CanvasTable
    expect(stored.cells[cellKey(table.rows[0].id, table.cols[0].id)].text).toBe(
      'alice',
    )
    expect(stored.cells[cellKey(table.rows[2].id, table.cols[2].id)].text).toBe(
      'bob',
    )
  })

  it('re-reads and re-applies after losing a write race', async () => {
    const table = table3()
    seedTable(table)
    const h = makeHarness()
    const real = vi.mocked(updateCanvasElement).getMockImplementation()!
    let raced = false
    vi.mocked(updateCanvasElement).mockImplementation((...args) => {
      if (!raced) {
        raced = true
        // Another writer lands between this handler's read and its write.
        store.get(TABLE_ID).revision += 1
        store.get(TABLE_ID).props.table.headerRow = false
      }
      return real(...args)
    })
    const res = await call(h, 'element:table-op', {
      elementId: TABLE_ID,
      op: {
        type: 'setCellText',
        rowId: table.rows[0].id,
        colId: table.cols[0].id,
        text: 'x',
      },
    })
    expect(res.ok).toBe(true)
    const stored = store.get(TABLE_ID).props.table as CanvasTable
    // The other writer's change survived and so did this op.
    expect(stored.headerRow).toBe(false)
    expect(stored.cells[cellKey(table.rows[0].id, table.cols[0].id)].text).toBe(
      'x',
    )
  })

  it('denies a viewer', async () => {
    seedTable(table3())
    vi.mocked(requireCanvasBoardRole).mockResolvedValue(true)
    const h = makeHarness()
    const res = await call(h, 'element:table-op', {
      elementId: TABLE_ID,
      op: { type: 'setHeaderRow', on: false },
    })
    expect(res).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(updateCanvasElement).not.toHaveBeenCalled()
  })

  it('refuses an op on a missing row, the last row, and a non-table', async () => {
    const table = createTable(1, 1, () => `id-${++seq}`)
    seedTable(table)
    store.set(RECT_ID, {
      ...store.get(TABLE_ID),
      id: RECT_ID,
      kind: 'rectangle',
      props: { kind: 'rectangle' },
    })
    const h = makeHarness()
    expect(
      await call(h, 'element:table-op', {
        elementId: TABLE_ID,
        op: { type: 'removeRow', rowId: 'nope' },
      }),
    ).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' })
    expect(
      await call(h, 'element:table-op', {
        elementId: TABLE_ID,
        op: { type: 'removeRow', rowId: table.rows[0].id },
      }),
    ).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' })
    expect(
      await call(h, 'element:table-op', {
        elementId: RECT_ID,
        op: { type: 'setHeaderRow', on: false },
      }),
    ).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' })
    expect(updateCanvasElement).not.toHaveBeenCalled()
  })

  it('recomputes width and height when a row is inserted', async () => {
    const table = table3()
    seedTable(table)
    const h = makeHarness()
    await call(h, 'element:table-op', {
      elementId: TABLE_ID,
      op: {
        type: 'insertRow',
        afterRowId: null,
        row: { id: 'new-row', height: 60 },
      },
    })
    expect(store.get(TABLE_ID).height).toBe(180)
  })

  it('moves the table by dx and dy when a resize from a left or top handle sends them', async () => {
    seedTable(table3())
    const h = makeHarness()
    const res = await call(h, 'element:table-op', {
      elementId: TABLE_ID,
      op: { type: 'scaleTable', sx: 0.5, sy: 1, dx: 180 },
    })
    expect(res.ok).toBe(true)
    expect(store.get(TABLE_ID)).toMatchObject({
      positionX: 180,
      positionY: 0,
      width: 180,
      height: 120,
    })
    expect(h.broadcast[0].payload).toMatchObject({
      positionX: 180,
      positionY: 0,
    })
    // The inverse puts the sizes AND the position back.
    expect(res.inverse).toMatchObject({ type: 'setSizes', dx: -180 })
    const undone = await call(h, 'element:table-op', {
      elementId: TABLE_ID,
      op: res.inverse,
    })
    expect(undone.ok).toBe(true)
    expect(store.get(TABLE_ID)).toMatchObject({
      positionX: 0,
      width: 360,
    })
  })

  it('does not touch the position for an op without a shift', async () => {
    seedTable(table3())
    const h = makeHarness()
    await call(h, 'element:table-op', {
      elementId: TABLE_ID,
      op: {
        type: 'resizeCol',
        colId: store.get(TABLE_ID).props.table.cols[0].id,
        width: 200,
      },
    })
    expect(store.get(TABLE_ID).positionX).toBe(0)
    expect(h.broadcast[0].payload).not.toHaveProperty('positionX')
  })

  it('rejects a malformed op payload', async () => {
    seedTable(table3())
    const h = makeHarness()
    expect(
      await call(h, 'element:table-op', {
        elementId: TABLE_ID,
        op: { type: 'nope' },
      }),
    ).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' })
  })
})

describe('element:table-op expect (undo contested check)', () => {
  it('applies the op while the cell still holds the expected text', async () => {
    const table = table3()
    const [row] = table.rows
    const [col] = table.cols
    seedTable({
      ...table,
      cells: { [cellKey(row.id, col.id)]: { text: 'new' } },
    })
    const h = makeHarness()
    const res = await call(h, 'element:table-op', {
      elementId: TABLE_ID,
      op: { type: 'setCellText', rowId: row.id, colId: col.id, text: 'old' },
      expect: [{ rowId: row.id, colId: col.id, text: 'new' }],
    })
    expect(res.ok).toBe(true)
    const stored = store.get(TABLE_ID).props.table as CanvasTable
    expect(stored.cells[cellKey(row.id, col.id)].text).toBe('old')
  })

  it('refuses, and changes nothing, when someone edited the cell since', async () => {
    const table = table3()
    const [row] = table.rows
    const [col] = table.cols
    seedTable({
      ...table,
      cells: { [cellKey(row.id, col.id)]: { text: 'theirs' } },
    })
    const h = makeHarness()
    const res = await call(h, 'element:table-op', {
      elementId: TABLE_ID,
      op: { type: 'setCellText', rowId: row.id, colId: col.id, text: 'old' },
      expect: [{ rowId: row.id, colId: col.id, text: 'new' }],
    })
    expect(res).toMatchObject({ ok: false, code: 'REVISION_MISMATCH' })
    expect(store.get(TABLE_ID).revision).toBe(1)
    expect(h.broadcast).toHaveLength(0)
  })

  it('is not disturbed by an edit to a different cell', async () => {
    const table = table3()
    const [row] = table.rows
    const [colA, colB] = table.cols
    seedTable({
      ...table,
      cells: {
        [cellKey(row.id, colA.id)]: { text: 'mine' },
        [cellKey(row.id, colB.id)]: { text: 'theirs' },
      },
    })
    const h = makeHarness()
    const res = await call(h, 'element:table-op', {
      elementId: TABLE_ID,
      op: { type: 'setCellText', rowId: row.id, colId: colA.id, text: '' },
      expect: [{ rowId: row.id, colId: colA.id, text: 'mine' }],
    })
    expect(res.ok).toBe(true)
    const stored = store.get(TABLE_ID).props.table as CanvasTable
    expect(stored.cells[cellKey(row.id, colB.id)].text).toBe('theirs')
  })
})

describe('element:update on a table', () => {
  it('rejects a props change but allows moving it', async () => {
    const table = table3()
    seedTable(table)
    const h = makeHarness()
    const rejected = await call(h, 'element:update', {
      elementId: TABLE_ID,
      props: { kind: 'table', table },
    })
    expect(rejected).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' })
    expect(updateCanvasElement).not.toHaveBeenCalled()
    const moved = await call(h, 'element:update', {
      elementId: TABLE_ID,
      positionX: 500,
    })
    expect(moved.ok).toBe(true)
  })
})

describe('element:create for a table', () => {
  it('derives width and height from the grid', async () => {
    const { createCanvasElement } = await import('@/data/canvas-element')
    vi.mocked(createCanvasElement).mockImplementation((data: any) =>
      Promise.resolve({ ...data, id: TABLE_ID, revision: 1 }),
    )
    const { nextCanvasZIndex } = await import('@/data/canvas-element')
    vi.mocked(nextCanvasZIndex).mockResolvedValue(1)
    const h = makeHarness()
    const table = createTable(2, 2, () => `id-${++seq}`)
    const res: CanvasAckResult = await call(h, 'element:create', {
      kind: 'table',
      positionX: 0,
      positionY: 0,
      width: 5,
      height: 5,
      props: { kind: 'table', table },
    })
    expect(res.ok).toBe(true)
    expect(vi.mocked(createCanvasElement).mock.calls[0][0]).toMatchObject({
      width: 240,
      height: 80,
    })
  })
})
