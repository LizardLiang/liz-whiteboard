// src/data/table-reference.test.ts
// Integration tests for the cross-file table reference data layer (LizMeter #83)
// against a real in-memory SQLite database. Mirrors src/data/shape.test.ts's style.

import { beforeEach, describe, expect, it } from 'vitest'

import {
  createTableReference,
  deleteTableReference,
  isTableReference,
  listTableReferences,
  resolveTableReferences,
  updateTableReference,
} from './table-reference'
import { db, genId, nowMs } from '@/db'
import {
  makeColumn,
  makeProject,
  makeTable,
  makeWhiteboard,
  resetDb,
} from '@/test/db-helpers'

/**
 * One project, two whiteboards: `local` is where the reference node lives,
 * `source` holds the real table it points at.
 */
function makeTwoFileProject() {
  const project = makeProject()
  const local = makeWhiteboard({ projectId: project.id, name: 'Local' })
  const source = makeWhiteboard({ projectId: project.id, name: 'Billing' })
  const sourceTable = makeTable({ whiteboardId: source.id, name: 'orders' })
  const idCol = makeColumn({
    tableId: sourceTable.id,
    name: 'id',
    isPrimaryKey: true,
    order: 0,
  })
  const otherCol = makeColumn({
    tableId: sourceTable.id,
    name: 'customer_id',
    order: 1,
  })
  return { project, local, source, sourceTable, idCol, otherCol }
}

/** Draw a relationship from a local table column to a reference stub column. */
function makeRelationship(opts: {
  whiteboardId: string
  sourceTableId: string
  targetTableId: string
  sourceColumnId: string
  targetColumnId: string
}): { id: string } {
  const id = genId()
  const ts = nowMs()
  db.prepare(
    'INSERT INTO "Relationship" ("id","whiteboardId","sourceTableId","targetTableId","sourceColumnId","targetColumnId","cardinality","label","routingPoints","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    id,
    opts.whiteboardId,
    opts.sourceTableId,
    opts.targetTableId,
    opts.sourceColumnId,
    opts.targetColumnId,
    'ONE_TO_MANY',
    null,
    null,
    ts,
    ts,
  )
  return { id }
}

function countRelationships(whiteboardId: string): number {
  const row = db
    .prepare(
      'SELECT COUNT(*) AS n FROM "Relationship" WHERE "whiteboardId" = ?',
    )
    .get(whiteboardId) as { n: number }
  return Number(row.n)
}

beforeEach(() => resetDb())

describe('createTableReference', () => {
  it('creates a DiagramTable row carrying its source ids plus a stub column', async () => {
    const { local, source, sourceTable, idCol } = makeTwoFileProject()

    const ref = await createTableReference({
      whiteboardId: local.id,
      sourceWhiteboardId: source.id,
      sourceTableId: sourceTable.id,
      sourceColumnIds: [idCol.id],
      positionX: 120,
      positionY: 80,
    })

    expect(ref.table.whiteboardId).toBe(local.id)
    expect(ref.table.sourceWhiteboardId).toBe(source.id)
    expect(ref.table.sourceTableId).toBe(sourceTable.id)
    expect(ref.table.positionX).toBe(120)
    expect(ref.columns).toHaveLength(1)
    expect(ref.columns[0].name).toBe('id')
    expect(ref.columns[0].sourceColumnId).toBe(idCol.id)
    expect(ref.columns[0].isPrimaryKey).toBe(true)
  })

  it('copies the source column dataType onto the stub so the node can render it', async () => {
    const { local, source, sourceTable, otherCol } = makeTwoFileProject()

    const ref = await createTableReference({
      whiteboardId: local.id,
      sourceWhiteboardId: source.id,
      sourceTableId: sourceTable.id,
      sourceColumnIds: [otherCol.id],
    })

    expect(ref.columns[0].dataType).toBe('string')
  })

  it('de-duplicates the stored name when a local table already owns it', async () => {
    const { local, source, sourceTable, idCol } = makeTwoFileProject()
    makeTable({ whiteboardId: local.id, name: 'orders' })

    const ref = await createTableReference({
      whiteboardId: local.id,
      sourceWhiteboardId: source.id,
      sourceTableId: sourceTable.id,
      sourceColumnIds: [idCol.id],
    })

    expect(ref.table.name).not.toBe('orders')
    expect(ref.table.name).toContain('orders')
  })

  it('rejects a source whiteboard in a different project', async () => {
    const { local } = makeTwoFileProject()
    const otherProject = makeProject({ name: 'Other' })
    const foreign = makeWhiteboard({ projectId: otherProject.id })
    const foreignTable = makeTable({ whiteboardId: foreign.id })
    const foreignCol = makeColumn({ tableId: foreignTable.id })

    await expect(
      createTableReference({
        whiteboardId: local.id,
        sourceWhiteboardId: foreign.id,
        sourceTableId: foreignTable.id,
        sourceColumnIds: [foreignCol.id],
      }),
    ).rejects.toThrow(/same project/i)
  })

  it('rejects a reference to a table on the same whiteboard', async () => {
    const { local } = makeTwoFileProject()
    const localTable = makeTable({ whiteboardId: local.id, name: 'invoices' })
    const localCol = makeColumn({ tableId: localTable.id })

    await expect(
      createTableReference({
        whiteboardId: local.id,
        sourceWhiteboardId: local.id,
        sourceTableId: localTable.id,
        sourceColumnIds: [localCol.id],
      }),
    ).rejects.toThrow(/same whiteboard/i)
  })

  it('rejects a column that does not belong to the source table', async () => {
    const { local, source, sourceTable } = makeTwoFileProject()
    const strayTable = makeTable({ whiteboardId: source.id, name: 'stray' })
    const strayCol = makeColumn({ tableId: strayTable.id })

    await expect(
      createTableReference({
        whiteboardId: local.id,
        sourceWhiteboardId: source.id,
        sourceTableId: sourceTable.id,
        sourceColumnIds: [strayCol.id],
      }),
    ).rejects.toThrow(/does not belong/i)
  })

  it('leaves no partial row behind when the column step fails', async () => {
    const { local, source, sourceTable } = makeTwoFileProject()
    const strayTable = makeTable({ whiteboardId: source.id, name: 'stray' })
    const strayCol = makeColumn({ tableId: strayTable.id })

    await expect(
      createTableReference({
        whiteboardId: local.id,
        sourceWhiteboardId: source.id,
        sourceTableId: sourceTable.id,
        sourceColumnIds: [strayCol.id],
      }),
    ).rejects.toThrow()

    expect(await listTableReferences(local.id)).toHaveLength(0)
  })
})

describe('listTableReferences / isTableReference', () => {
  it('returns references but not ordinary tables', async () => {
    const { local, source, sourceTable, idCol } = makeTwoFileProject()
    makeTable({ whiteboardId: local.id, name: 'invoices' })

    const ref = await createTableReference({
      whiteboardId: local.id,
      sourceWhiteboardId: source.id,
      sourceTableId: sourceTable.id,
      sourceColumnIds: [idCol.id],
    })

    const refs = await listTableReferences(local.id)
    expect(refs).toHaveLength(1)
    expect(refs[0].table.id).toBe(ref.table.id)
    expect(isTableReference(refs[0].table)).toBe(true)
  })
})

describe('resolveTableReferences', () => {
  it('repaints from the source after the source table is renamed', async () => {
    const { local, source, sourceTable, idCol } = makeTwoFileProject()
    await createTableReference({
      whiteboardId: local.id,
      sourceWhiteboardId: source.id,
      sourceTableId: sourceTable.id,
      sourceColumnIds: [idCol.id],
    })

    db.prepare('UPDATE "DiagramTable" SET "name" = ? WHERE "id" = ?').run(
      'purchase_orders',
      sourceTable.id,
    )

    const [resolved] = await resolveTableReferences(local.id)
    expect(resolved.missing).toBe(false)
    expect(resolved.sourceTableName).toBe('purchase_orders')
    expect(resolved.sourceWhiteboardName).toBe('Billing')
    expect(resolved.columns[0].name).toBe('id')
  })

  it('reports the new column name after the source column is renamed', async () => {
    const { local, source, sourceTable, idCol } = makeTwoFileProject()
    await createTableReference({
      whiteboardId: local.id,
      sourceWhiteboardId: source.id,
      sourceTableId: sourceTable.id,
      sourceColumnIds: [idCol.id],
    })

    db.prepare('UPDATE "Column" SET "name" = ? WHERE "id" = ?').run(
      'order_id',
      idCol.id,
    )

    const [resolved] = await resolveTableReferences(local.id)
    expect(resolved.columns[0].name).toBe('order_id')
    expect(resolved.columns[0].missing).toBe(false)
  })

  it('marks the reference missing when the source table is deleted, keeping its edges', async () => {
    const { local, source, sourceTable, idCol } = makeTwoFileProject()
    const ref = await createTableReference({
      whiteboardId: local.id,
      sourceWhiteboardId: source.id,
      sourceTableId: sourceTable.id,
      sourceColumnIds: [idCol.id],
    })
    const localTable = makeTable({ whiteboardId: local.id, name: 'invoices' })
    const localCol = makeColumn({ tableId: localTable.id })
    makeRelationship({
      whiteboardId: local.id,
      sourceTableId: localTable.id,
      targetTableId: ref.table.id,
      sourceColumnId: localCol.id,
      targetColumnId: ref.columns[0].id,
    })

    db.prepare('DELETE FROM "DiagramTable" WHERE "id" = ?').run(sourceTable.id)

    const [resolved] = await resolveTableReferences(local.id)
    expect(resolved.missing).toBe(true)
    // The stub name survives as the last-known fallback.
    expect(resolved.sourceTableName).toBe('orders')
    expect(countRelationships(local.id)).toBe(1)
  })

  it('marks the reference missing when the whole source file is deleted', async () => {
    const { local, source, sourceTable, idCol } = makeTwoFileProject()
    await createTableReference({
      whiteboardId: local.id,
      sourceWhiteboardId: source.id,
      sourceTableId: sourceTable.id,
      sourceColumnIds: [idCol.id],
    })

    db.prepare('DELETE FROM "Whiteboard" WHERE "id" = ?').run(source.id)

    const [resolved] = await resolveTableReferences(local.id)
    expect(resolved.missing).toBe(true)
    expect(await listTableReferences(local.id)).toHaveLength(1)
  })

  it('marks only the vanished column missing when the table survives', async () => {
    const { local, source, sourceTable, idCol, otherCol } = makeTwoFileProject()
    await createTableReference({
      whiteboardId: local.id,
      sourceWhiteboardId: source.id,
      sourceTableId: sourceTable.id,
      sourceColumnIds: [idCol.id, otherCol.id],
    })

    db.prepare('DELETE FROM "Column" WHERE "id" = ?').run(otherCol.id)

    const [resolved] = await resolveTableReferences(local.id)
    expect(resolved.missing).toBe(false)
    const byName = Object.fromEntries(
      resolved.columns.map((c) => [c.name, c.missing]),
    )
    expect(byName['id']).toBe(false)
    expect(byName['customer_id']).toBe(true)
  })
})

describe('updateTableReference', () => {
  it('re-targets to another table and reports the relationships it deleted', async () => {
    const { local, source, sourceTable, idCol } = makeTwoFileProject()
    const ref = await createTableReference({
      whiteboardId: local.id,
      sourceWhiteboardId: source.id,
      sourceTableId: sourceTable.id,
      sourceColumnIds: [idCol.id],
    })
    const localTable = makeTable({ whiteboardId: local.id, name: 'invoices' })
    const localCol = makeColumn({ tableId: localTable.id })
    makeRelationship({
      whiteboardId: local.id,
      sourceTableId: localTable.id,
      targetTableId: ref.table.id,
      sourceColumnId: localCol.id,
      targetColumnId: ref.columns[0].id,
    })

    const nextTable = makeTable({ whiteboardId: source.id, name: 'payments' })
    const nextCol = makeColumn({ tableId: nextTable.id, name: 'id' })

    const result = await updateTableReference(ref.table.id, {
      sourceTableId: nextTable.id,
      sourceColumnIds: [nextCol.id],
    })

    expect(result.deletedRelationships).toBe(1)
    expect(result.reference.table.sourceTableId).toBe(nextTable.id)
    expect(result.reference.columns[0].sourceColumnId).toBe(nextCol.id)
    expect(countRelationships(local.id)).toBe(0)
  })

  it('keeps a relationship whose picked column survives the change', async () => {
    const { local, source, sourceTable, idCol, otherCol } = makeTwoFileProject()
    const ref = await createTableReference({
      whiteboardId: local.id,
      sourceWhiteboardId: source.id,
      sourceTableId: sourceTable.id,
      sourceColumnIds: [idCol.id, otherCol.id],
    })
    const localTable = makeTable({ whiteboardId: local.id, name: 'invoices' })
    const localCol = makeColumn({ tableId: localTable.id })
    const keptStub = ref.columns.find((c) => c.sourceColumnId === idCol.id)!
    makeRelationship({
      whiteboardId: local.id,
      sourceTableId: localTable.id,
      targetTableId: ref.table.id,
      sourceColumnId: localCol.id,
      targetColumnId: keptStub.id,
    })

    const result = await updateTableReference(ref.table.id, {
      sourceColumnIds: [idCol.id],
    })

    expect(result.deletedRelationships).toBe(0)
    expect(result.reference.columns).toHaveLength(1)
    expect(countRelationships(local.id)).toBe(1)
  })

  it('refuses to re-target an ordinary table', async () => {
    const { local } = makeTwoFileProject()
    const plain = makeTable({ whiteboardId: local.id, name: 'invoices' })

    await expect(
      updateTableReference(plain.id, { sourceColumnIds: [] }),
    ).rejects.toThrow(/not a table reference/i)
  })

  it('rejects a re-target that leaves the project', async () => {
    const { local, source, sourceTable, idCol } = makeTwoFileProject()
    const ref = await createTableReference({
      whiteboardId: local.id,
      sourceWhiteboardId: source.id,
      sourceTableId: sourceTable.id,
      sourceColumnIds: [idCol.id],
    })
    const otherProject = makeProject({ name: 'Other' })
    const foreign = makeWhiteboard({ projectId: otherProject.id })
    const foreignTable = makeTable({ whiteboardId: foreign.id })
    const foreignCol = makeColumn({ tableId: foreignTable.id })

    await expect(
      updateTableReference(ref.table.id, {
        sourceWhiteboardId: foreign.id,
        sourceTableId: foreignTable.id,
        sourceColumnIds: [foreignCol.id],
      }),
    ).rejects.toThrow(/same project/i)
  })
})

describe('deleteTableReference', () => {
  it('removes the reference and cascades its relationships', async () => {
    const { local, source, sourceTable, idCol } = makeTwoFileProject()
    const ref = await createTableReference({
      whiteboardId: local.id,
      sourceWhiteboardId: source.id,
      sourceTableId: sourceTable.id,
      sourceColumnIds: [idCol.id],
    })
    const localTable = makeTable({ whiteboardId: local.id, name: 'invoices' })
    const localCol = makeColumn({ tableId: localTable.id })
    makeRelationship({
      whiteboardId: local.id,
      sourceTableId: localTable.id,
      targetTableId: ref.table.id,
      sourceColumnId: localCol.id,
      targetColumnId: ref.columns[0].id,
    })

    await deleteTableReference(ref.table.id)

    expect(await listTableReferences(local.id)).toHaveLength(0)
    expect(countRelationships(local.id)).toBe(0)
  })

  it('refuses to delete an ordinary table', async () => {
    const { local } = makeTwoFileProject()
    const plain = makeTable({ whiteboardId: local.id, name: 'invoices' })

    await expect(deleteTableReference(plain.id)).rejects.toThrow(
      /not a table reference/i,
    )
  })
})
