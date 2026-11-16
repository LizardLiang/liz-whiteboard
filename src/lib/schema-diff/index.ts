// src/lib/schema-diff/index.ts
// Compares two board captures (snapshot payloads, or the live board captured
// the same way) and returns what was added, removed and changed. Entities are
// matched by id; field diffs read old -> new. Position, size and edge-path
// fields are tagged `layout` so the view can hide them.

import type { BoardDiff, DiffEntityType, DiffEntry, DiffField } from './types'
import { LAYOUT_FIELDS } from '@/lib/schema-changelog'

export type { BoardDiff, DiffEntityType, DiffEntry, DiffField } from './types'

interface ColumnLike {
  id: string
  name: string
  dataType: string
  isPrimaryKey: boolean
  isForeignKey: boolean
  isUnique: boolean
  isNullable: boolean
  description: string | null
  order: number
}

interface TableLike {
  id: string
  name: string
  description: string | null
  positionX: number | null
  positionY: number | null
  width: number | null
  height: number | null
  columns: Array<ColumnLike>
}

interface RelationshipLike {
  id: string
  sourceTableId: string
  targetTableId: string
  sourceColumnId: string
  targetColumnId: string
  cardinality: string
  label: string | null
  routingPoints?: unknown
}

interface AreaLike {
  id: string
  name: string
  color: string
  positionX: number
  positionY: number
  width: number
  height: number
  memberTableIds: Array<string>
}

/** The part of a snapshot payload (fresh or reloaded) a comparison reads. */
export interface DiffablePayload {
  tables: ReadonlyArray<TableLike>
  relationships: ReadonlyArray<RelationshipLike>
  areas?: ReadonlyArray<AreaLike>
}

const MAX_VALUE_LENGTH = 200

function show(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > MAX_VALUE_LENGTH
    ? `${text.slice(0, MAX_VALUE_LENGTH)}…`
    : text
}

type Row = Record<string, unknown>

/** Row values keyed by field name, ready to compare as display text. */
function toFields(row: Row): Map<string, string | null> {
  return new Map(Object.entries(row).map(([k, v]) => [k, show(v)]))
}

function tag(field: string, before: string | null, after: string | null) {
  return { field, before, after, layout: LAYOUT_FIELDS.includes(field) }
}

/**
 * Fields that show a name resolved from ids (`refs`): they differ only when
 * the ids differ, so renaming a table or column does not ripple into the
 * relationships and areas that point at it.
 */
type Refs = Record<string, string>

function diffRows(
  older: Row,
  newer: Row,
  oldRefs: Refs,
  newRefs: Refs,
): Array<DiffField> {
  const a = toFields(older)
  const b = toFields(newer)
  const keys = [...new Set([...a.keys(), ...b.keys()])]
  return keys
    .filter((k) =>
      k in oldRefs || k in newRefs
        ? (oldRefs[k] ?? null) !== (newRefs[k] ?? null)
        : (a.get(k) ?? null) !== (b.get(k) ?? null),
    )
    .map((k) => tag(k, a.get(k) ?? null, b.get(k) ?? null))
}

/** Non-empty fields of a row on its own, for an added (after) or removed (before) entity. */
function oneSided(row: Row, side: 'before' | 'after'): Array<DiffField> {
  return [...toFields(row)]
    .filter(([, v]) => v !== null)
    .map(([k, v]) =>
      tag(k, side === 'before' ? v : null, side === 'after' ? v : null),
    )
}

interface Side {
  tableName: Map<string, string>
  columnName: Map<string, string>
  columnTable: Map<string, string>
  tableColumns: Map<string, string>
}

function indexSide(payload: DiffablePayload): Side {
  const tableName = new Map<string, string>()
  const columnName = new Map<string, string>()
  const columnTable = new Map<string, string>()
  const tableColumns = new Map<string, string>()
  for (const table of payload.tables) {
    tableName.set(table.id, table.name)
    tableColumns.set(table.id, table.columns.map((c) => c.name).join(', '))
    for (const column of table.columns) {
      columnName.set(column.id, column.name)
      columnTable.set(column.id, table.id)
    }
  }
  return { tableName, columnName, columnTable, tableColumns }
}

function tableRow(table: TableLike): Row {
  return {
    name: table.name,
    description: table.description,
    positionX: table.positionX,
    positionY: table.positionY,
    width: table.width,
    height: table.height,
  }
}

function columnRow(column: ColumnLike): Row {
  return {
    name: column.name,
    dataType: column.dataType,
    isPrimaryKey: column.isPrimaryKey,
    isForeignKey: column.isForeignKey,
    isUnique: column.isUnique,
    isNullable: column.isNullable,
    description: column.description,
    order: column.order,
  }
}

function relationshipRow(rel: RelationshipLike, side: Side): Row {
  return {
    sourceTable: side.tableName.get(rel.sourceTableId) ?? null,
    sourceColumn: side.columnName.get(rel.sourceColumnId) ?? null,
    targetTable: side.tableName.get(rel.targetTableId) ?? null,
    targetColumn: side.columnName.get(rel.targetColumnId) ?? null,
    cardinality: rel.cardinality,
    label: rel.label,
    routingPoints: rel.routingPoints ?? null,
  }
}

function relationshipName(rel: RelationshipLike, side: Side): string {
  if (rel.label) return rel.label
  const end = (tableId: string, columnId: string) =>
    `${side.tableName.get(tableId) ?? '?'}.${side.columnName.get(columnId) ?? '?'}`
  return `${end(rel.sourceTableId, rel.sourceColumnId)} -> ${end(rel.targetTableId, rel.targetColumnId)}`
}

function relationshipRefs(rel: RelationshipLike): Refs {
  return {
    sourceTable: rel.sourceTableId,
    sourceColumn: rel.sourceColumnId,
    targetTable: rel.targetTableId,
    targetColumn: rel.targetColumnId,
  }
}

function areaRefs(area: AreaLike): Refs {
  return { members: [...area.memberTableIds].sort().join(',') }
}

function areaRow(area: AreaLike, side: Side): Row {
  return {
    name: area.name,
    color: area.color,
    positionX: area.positionX,
    positionY: area.positionY,
    width: area.width,
    height: area.height,
    members: area.memberTableIds
      .map((id) => side.tableName.get(id) ?? '?')
      .sort()
      .join(', '),
  }
}

interface Item {
  entityType: DiffEntityType
  id: string
  name: string
  tableName: string | null
  row: Row
  refs: Refs
}

function items(payload: DiffablePayload, side: Side): Map<string, Item> {
  const map = new Map<string, Item>()
  const put = (item: Item) => map.set(`${item.entityType}:${item.id}`, item)
  for (const table of payload.tables) {
    put({
      entityType: 'table',
      id: table.id,
      name: table.name,
      tableName: null,
      row: tableRow(table),
      refs: {},
    })
    for (const column of table.columns) {
      put({
        entityType: 'column',
        id: column.id,
        name: column.name,
        tableName: table.name,
        row: columnRow(column),
        refs: {},
      })
    }
  }
  for (const rel of payload.relationships) {
    put({
      entityType: 'relationship',
      id: rel.id,
      name: relationshipName(rel, side),
      tableName: null,
      row: relationshipRow(rel, side),
      refs: relationshipRefs(rel),
    })
  }
  for (const area of payload.areas ?? []) {
    put({
      entityType: 'area',
      id: area.id,
      name: area.name,
      tableName: null,
      row: areaRow(area, side),
      refs: areaRefs(area),
    })
  }
  return map
}

const TYPE_ORDER: Record<DiffEntityType, number> = {
  table: 0,
  column: 1,
  relationship: 2,
  area: 3,
}

function entry(item: Item, fields: Array<DiffField>): DiffEntry {
  return {
    entityType: item.entityType,
    entityId: item.id,
    name: item.name,
    tableName: item.tableName,
    fields,
  }
}

/** Tables first, columns grouped under their table, then relationships and areas. */
function compareEntries(a: DiffEntry, b: DiffEntry): number {
  const group = (e: DiffEntry) =>
    e.entityType === 'column'
      ? e.tableName
      : e.entityType === 'table'
        ? e.name
        : null
  const ga = group(a) ?? ''
  const gb = group(b) ?? ''
  const typeA = a.entityType === 'column' ? 'table' : a.entityType
  const typeB = b.entityType === 'column' ? 'table' : b.entityType
  return (
    TYPE_ORDER[typeA] - TYPE_ORDER[typeB] ||
    ga.localeCompare(gb) ||
    TYPE_ORDER[a.entityType] - TYPE_ORDER[b.entityType] ||
    a.name.localeCompare(b.name)
  )
}

/**
 * What changed from `older` to `newer`. A column of an added or removed table
 * is folded into that table's entry (a `columns` field) instead of listed on
 * its own.
 */
export function diffBoards(
  older: DiffablePayload,
  newer: DiffablePayload,
): BoardDiff {
  const oldSide = indexSide(older)
  const newSide = indexSide(newer)
  const oldItems = items(older, oldSide)
  const newItems = items(newer, newSide)
  const oldTableIds = new Set(older.tables.map((t) => t.id))
  const newTableIds = new Set(newer.tables.map((t) => t.id))

  const added: Array<DiffEntry> = []
  const removed: Array<DiffEntry> = []
  const changed: Array<DiffEntry> = []

  const columnNames = (side: Side, tableId: string): string =>
    side.tableColumns.get(tableId) ?? ''

  for (const [key, item] of newItems) {
    const before = oldItems.get(key)
    if (!before) {
      if (item.entityType === 'column') {
        const tableId = newSide.columnTable.get(item.id)
        if (tableId && !oldTableIds.has(tableId)) continue
      }
      const fields = oneSided(item.row, 'after')
      if (item.entityType === 'table' && columnNames(newSide, item.id))
        fields.push(tag('columns', null, columnNames(newSide, item.id)))
      added.push(entry(item, fields))
      continue
    }
    const fields = diffRows(before.row, item.row, before.refs, item.refs)
    if (fields.length > 0) changed.push(entry(item, fields))
  }
  for (const [key, item] of oldItems) {
    if (newItems.has(key)) continue
    if (item.entityType === 'column') {
      const tableId = oldSide.columnTable.get(item.id)
      if (tableId && !newTableIds.has(tableId)) continue
    }
    const fields = oneSided(item.row, 'before')
    if (item.entityType === 'table' && columnNames(oldSide, item.id))
      fields.push(tag('columns', columnNames(oldSide, item.id), null))
    removed.push(entry(item, fields))
  }

  return {
    added: added.sort(compareEntries),
    removed: removed.sort(compareEntries),
    changed: changed.sort(compareEntries),
  }
}
