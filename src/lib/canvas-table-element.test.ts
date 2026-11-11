// src/lib/canvas-table-element.test.ts
// The table element across the seams between modules: stored props schema,
// the storage <-> engine adapter, clone, hit-test, search, and export.

import { describe, expect, it } from 'vitest'
import {
  fromElementSnapshot,
  toCreateInput,
  toElementSnapshot,
  toEngineElement,
  toUpdatePatch,
} from './canvas-element-adapter'
import {
  canvasExportBounds,
  serializeCanvasSceneSvg,
} from './export/canvas-export'
import type { CanvasElementRecord } from '@/data/models'
import type { CanvasElement } from '@/lib/canvas-engine/scene'
import {
  canvasElementPropsSchema,
  createCanvasElementSchema,
  tableOpSchema,
  updateCanvasElementSchema,
} from '@/data/schema'
import { planClone } from '@/lib/canvas-engine/clone'
import { elementContainsPoint, hitTest } from '@/lib/canvas-engine/hit-test'
import { buildCanvasSearchIndex } from '@/lib/canvas-engine/search-index'
import { DEFAULT_ELEMENT_STYLE, sceneFrom } from '@/lib/canvas-engine/scene'
import {
  TABLE_DEFAULT_STYLE,
  applyTableOp,
  createTable,
  tableSize,
} from '@/lib/canvas-engine/table'

const BOARD_ID = '11111111-1111-4111-8111-111111111111'
const TABLE_ID = '55555555-5555-4555-8555-555555555555'

function makeTable() {
  let n = 0
  const table = createTable(2, 3, () => `id-${++n}`)
  return applyTableOp(table, {
    type: 'setCellText',
    rowId: table.rows[0].id,
    colId: table.cols[1].id,
    text: 'Quarterly plan',
  }).table
}

function tableElement(patch: Partial<CanvasElement> = {}): CanvasElement {
  const table = makeTable()
  return {
    id: TABLE_ID,
    kind: 'table',
    x: 100,
    y: 200,
    ...tableSize(table),
    rotation: 0,
    zIndex: 1,
    text: null,
    style: { ...DEFAULT_ELEMENT_STYLE, ...TABLE_DEFAULT_STYLE },
    table,
    ...patch,
  }
}

function record(element: CanvasElement): CanvasElementRecord {
  const input = toCreateInput(BOARD_ID, element)
  return {
    id: element.id,
    boardId: BOARD_ID,
    kind: 'table',
    positionX: input.positionX,
    positionY: input.positionY,
    width: input.width,
    height: input.height,
    rotation: 0,
    zIndex: element.zIndex,
    text: null,
    style: element.style,
    props: input.props,
    revision: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

describe('table props schema', () => {
  it('accepts a table arm and rejects a mismatched kind', () => {
    const table = makeTable()
    expect(
      canvasElementPropsSchema.safeParse({ kind: 'table', table }).success,
    ).toBe(true)
    const input = toCreateInput(BOARD_ID, tableElement())
    expect(createCanvasElementSchema.safeParse(input).success).toBe(true)
    expect(
      createCanvasElementSchema.safeParse({ ...input, kind: 'rectangle' })
        .success,
    ).toBe(false)
  })

  it('rejects a table over the cell cap and unknown keys', () => {
    let n = 0
    const big = {
      ...createTable(1, 1, () => `x${++n}`),
      rows: Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, height: 40 })),
      cols: Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, width: 40 })),
    }
    expect(
      canvasElementPropsSchema.safeParse({ kind: 'table', table: big }).success,
    ).toBe(false)
    expect(
      canvasElementPropsSchema.safeParse({
        kind: 'table',
        table: { ...makeTable(), extra: 1 },
      }).success,
    ).toBe(false)
  })

  it('validates every table op shape', () => {
    expect(
      tableOpSchema.safeParse({
        type: 'setCellText',
        rowId: 'r',
        colId: 'c',
        text: 'x',
        textRuns: [{ start: 0, end: 1, fontWeight: 'bold' }],
      }).success,
    ).toBe(true)
    expect(
      tableOpSchema.safeParse({ type: 'removeRow', rowId: 'a:b' }).success,
    ).toBe(false)
    expect(tableOpSchema.safeParse({ type: 'bogus' }).success).toBe(false)
  })

  describe('table consistency', () => {
    const parse = (table: unknown) =>
      canvasElementPropsSchema.safeParse({ kind: 'table', table }).success
    const base = () => ({
      rows: [
        { id: 'r1', height: 40 },
        { id: 'r2', height: 40 },
      ],
      cols: [
        { id: 'c1', width: 120 },
        { id: 'c2', width: 120 },
      ],
      cells: { 'r1:c1': { text: 'abc' } } as Record<string, unknown>,
      headerRow: true,
    })

    it('accepts a consistent table', () => {
      expect(parse(base())).toBe(true)
    })

    it('rejects duplicate row ids and duplicate column ids', () => {
      const dupRow = base()
      dupRow.rows[1].id = 'r1'
      expect(parse(dupRow)).toBe(false)
      const dupCol = base()
      dupCol.cols[1].id = 'c1'
      expect(parse(dupCol)).toBe(false)
    })

    it('rejects a cell key naming a row or column the table lacks', () => {
      const ghostRow = base()
      ghostRow.cells['gone:c1'] = { text: 'x' }
      expect(parse(ghostRow)).toBe(false)
      const ghostCol = base()
      ghostCol.cells['r1:gone'] = { text: 'x' }
      expect(parse(ghostCol)).toBe(false)
      const malformed = base()
      malformed.cells['r1'] = { text: 'x' }
      expect(parse(malformed)).toBe(false)
    })

    it('rejects text runs that end past the cell text', () => {
      const table = base()
      table.cells['r1:c1'] = {
        text: 'abc',
        textRuns: [{ start: 0, end: 4, fontWeight: 'bold' }],
      }
      expect(parse(table)).toBe(false)
      table.cells['r1:c1'] = {
        text: 'abc',
        textRuns: [{ start: 0, end: 3, fontWeight: 'bold' }],
      }
      expect(parse(table)).toBe(true)
    })

    it('applies the run check to the ops that carry cells', () => {
      const runs = [{ start: 0, end: 9, fontWeight: 'bold' }]
      expect(
        tableOpSchema.safeParse({
          type: 'setCellText',
          rowId: 'r',
          colId: 'c',
          text: 'abc',
          textRuns: runs,
        }).success,
      ).toBe(false)
      expect(
        tableOpSchema.safeParse({
          type: 'insertRow',
          afterRowId: null,
          row: { id: 'r', height: 40 },
          cells: { c1: { text: 'abc', textRuns: runs } },
        }).success,
      ).toBe(false)
    })
  })
})

describe('adapter', () => {
  it('round-trips a table through a stored row and a snapshot', () => {
    const element = tableElement()
    expect(toEngineElement(record(element))).toEqual(element)
    const snapshot = toElementSnapshot(BOARD_ID, element)
    expect(fromElementSnapshot(snapshot)).toEqual(element)
  })

  it('writes `props` on create but never on a whole-element update', () => {
    const element = tableElement()
    expect(toCreateInput(BOARD_ID, element).props).toMatchObject({
      kind: 'table',
    })
    const patch = toUpdatePatch(element)
    expect('props' in patch).toBe(false)
    expect(updateCanvasElementSchema.safeParse(patch).success).toBe(true)
  })

  it('reads a row with a partial table without throwing', () => {
    const row = record(tableElement())
    const partial = {
      ...row,
      props: { kind: 'table', table: { rows: [{ id: 'r', height: 40 }] } },
    } as unknown as CanvasElementRecord
    const element = toEngineElement(partial)
    expect(element.table?.cols.length).toBeGreaterThan(0)
  })
})

describe('engine seams', () => {
  it('hit-tests a table as its rect', () => {
    const element = tableElement()
    expect(elementContainsPoint(element, { x: 101, y: 201 })).toBe(true)
    expect(elementContainsPoint(element, { x: 99, y: 201 })).toBe(false)
    expect(hitTest(sceneFrom([element]), { x: 150, y: 220 })?.id).toBe(TABLE_ID)
  })

  it('clones a table verbatim under a new element id', () => {
    const element = tableElement()
    const plan = planClone([element], {
      nextId: () => 'copy-id',
      topZIndex: 5,
      offsetIndex: 0,
    })
    const copy = plan.elements[0]
    expect(copy.id).toBe('copy-id')
    expect(copy.table).toEqual(element.table)
    expect(copy.table).not.toBe(element.table)
  })

  it('indexes the joined cell text of a table', () => {
    const index = buildCanvasSearchIndex(sceneFrom([tableElement()]))
    expect(index).toEqual([
      { elementId: TABLE_ID, kind: 'table', text: 'Quarterly plan' },
    ])
  })

  it('exports a table to SVG, cell text included, inside the bounds', () => {
    const element = tableElement()
    const scene = sceneFrom([element])
    const measure = (text: string, spec: { fontSize: number }) =>
      text.length * spec.fontSize * 0.5
    const bounds = canvasExportBounds(scene, measure)
    expect(bounds.x).toBeLessThanOrEqual(element.x)
    expect(bounds.y).toBeLessThanOrEqual(element.y)
    expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(
      element.x + element.width,
    )
    expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(
      element.y + element.height,
    )
    const svg = serializeCanvasSceneSvg({
      scene,
      theme: 'light',
      background: 'transparent',
      backgroundColor: '#ffffff',
      measureText: measure,
    })
    expect(svg).toContain('Quarterly plan')
    expect(svg).toContain('<path')
  })
})
