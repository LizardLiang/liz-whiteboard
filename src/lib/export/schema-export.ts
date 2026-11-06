// src/lib/export/schema-export.ts
//
// Export the schema of an ER whiteboard — its tables, columns and
// relationships — as an Excel workbook (.xlsx), JSON, or XML file.
//
// The export reads the board as React Flow currently holds it (the same
// source the DDL export uses), so it matches what the user sees, including
// edits that other collaborators made in this session. Only real table
// nodes become tables. A cross-file reference node is not a table of this
// board: a relationship that ends on one names the referenced table and the
// file it lives in instead.

import { buildXlsx, escapeXml } from './xlsx-writer'
import type { XlsxSheet } from './xlsx-writer'
import type { Locale } from '@/lib/i18n/resolve-locale'
import { translate } from '@/lib/i18n/translate'

export type SchemaExportFormat = 'xlsx' | 'json' | 'xml'

export const SCHEMA_EXPORT_FORMATS: ReadonlyArray<SchemaExportFormat> = [
  'xlsx',
  'json',
  'xml',
]

export interface SchemaExportOptions {
  format: SchemaExportFormat
  /** Language of the Excel sheet names and header row. JSON and XML keys
   * are a machine-readable contract and always stay English. */
  headerLocale: Locale
}

export interface SchemaExportColumn {
  name: string
  dataType: string
  isPrimaryKey: boolean
  isForeignKey: boolean
  isUnique: boolean
  isNullable: boolean
  description: string | null
}

export interface SchemaExportTable {
  name: string
  description: string | null
  columns: Array<SchemaExportColumn>
}

export interface SchemaExportEndpoint {
  table: string
  column: string
  /** Set only when the endpoint is a table in another file (a reference). */
  whiteboard?: string | null
}

export interface SchemaExportRelationship {
  cardinality: string
  label: string | null
  source: SchemaExportEndpoint
  target: SchemaExportEndpoint
}

export interface SchemaExport {
  format: 'liz-whiteboard-schema'
  version: 1
  whiteboard: string
  exportedAt: string
  tables: Array<SchemaExportTable>
  relationships: Array<SchemaExportRelationship>
}

// Structural input types: only the fields this module reads. React Flow's
// full node/edge types satisfy them, and unit tests can pass plain objects.

interface InputColumn {
  id: string
  name: string
  dataType: string
  isPrimaryKey: boolean
  isForeignKey: boolean
  isUnique?: boolean
  isNullable?: boolean
  description?: string | null
  order?: number
}

interface InputNode {
  id: string
  type?: string
  data: Record<string, unknown>
}

interface InputEdge {
  data?: {
    relationship?: {
      sourceTableId: string
      targetTableId: string
      sourceColumnId: string
      targetColumnId: string
      cardinality: string
      label?: string | null
      sourceColumn?: { name: string } | null
      targetColumn?: { name: string } | null
    }
  }
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
  a.name.localeCompare(b.name)

/**
 * Build the export model from the board's React Flow nodes and edges.
 * Tables are sorted by name and columns keep their on-canvas order, so two
 * exports of an unchanged board are identical apart from `exportedAt`.
 */
export function buildSchemaExport(
  nodes: ReadonlyArray<InputNode>,
  edges: ReadonlyArray<InputEdge>,
  whiteboardName: string | null | undefined,
  now: Date = new Date(),
): SchemaExport {
  const tableNames = new Map<string, string>()
  const columnNames = new Map<string, string>()
  const externalFiles = new Map<string, string | null>()
  const tables: Array<SchemaExportTable> = []

  for (const node of nodes) {
    if (node.type === 'table') {
      const table = node.data.table as
        | {
            name: string
            description: string | null
            columns: Array<InputColumn>
          }
        | undefined
      if (!table) continue
      tableNames.set(node.id, table.name)
      const columns = [...table.columns].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0),
      )
      for (const col of columns) columnNames.set(col.id, col.name)
      tables.push({
        name: table.name,
        description: table.description || null,
        columns: columns.map((col) => ({
          name: col.name,
          dataType: col.dataType,
          isPrimaryKey: col.isPrimaryKey,
          isForeignKey: col.isForeignKey,
          isUnique: col.isUnique ?? false,
          isNullable: col.isNullable ?? false,
          description: col.description || null,
        })),
      })
    } else if (node.type === 'externalTable') {
      const data = node.data as {
        sourceTableName: string
        sourceWhiteboardName: string | null
        columns: Array<{ id: string; name: string }>
      }
      tableNames.set(node.id, data.sourceTableName)
      externalFiles.set(node.id, data.sourceWhiteboardName)
      for (const col of data.columns) columnNames.set(col.id, col.name)
    }
  }

  const endpoint = (
    tableId: string,
    columnId: string,
    fallbackColumn: string | undefined,
  ): SchemaExportEndpoint | null => {
    const table = tableNames.get(tableId)
    if (table === undefined) return null
    const result: SchemaExportEndpoint = {
      table,
      column: columnNames.get(columnId) ?? fallbackColumn ?? '',
    }
    if (externalFiles.has(tableId)) {
      result.whiteboard = externalFiles.get(tableId) ?? null
    }
    return result
  }

  const relationships: Array<SchemaExportRelationship> = []
  for (const edge of edges) {
    const rel = edge.data?.relationship
    if (!rel) continue
    const source = endpoint(
      rel.sourceTableId,
      rel.sourceColumnId,
      rel.sourceColumn?.name,
    )
    const target = endpoint(
      rel.targetTableId,
      rel.targetColumnId,
      rel.targetColumn?.name,
    )
    // An edge whose table is not on the board is stale; skip it rather
    // than export a row that names no table.
    if (!source || !target) continue
    relationships.push({
      cardinality: rel.cardinality,
      label: rel.label || null,
      source,
      target,
    })
  }

  const key = (r: SchemaExportRelationship) =>
    [r.source.table, r.source.column, r.target.table, r.target.column].join(
      '\u0000',
    )
  relationships.sort((a, b) => key(a).localeCompare(key(b)))
  tables.sort(byName)

  return {
    format: 'liz-whiteboard-schema',
    version: 1,
    whiteboard: whiteboardName?.trim() || 'Untitled',
    exportedAt: now.toISOString(),
    tables,
    relationships,
  }
}

// ── Serializers ─────────────────────────────────────────────────────────────

export function schemaToJson(schema: SchemaExport): string {
  return JSON.stringify(schema, null, 2) + '\n'
}

const attr = (name: string, value: string | boolean) =>
  ` ${name}="${escapeXml(String(value))}"`

export function schemaToXml(schema: SchemaExport): string {
  const lines: Array<string> = ['<?xml version="1.0" encoding="UTF-8"?>']
  lines.push(
    `<schema${attr('format', schema.format)}${attr('version', String(schema.version))}${attr('whiteboard', schema.whiteboard)}${attr('exportedAt', schema.exportedAt)}>`,
  )
  lines.push('  <tables>')
  for (const table of schema.tables) {
    lines.push(`    <table${attr('name', table.name)}>`)
    if (table.description) {
      lines.push(
        `      <description>${escapeXml(table.description)}</description>`,
      )
    }
    lines.push('      <columns>')
    for (const col of table.columns) {
      const open =
        `        <column${attr('name', col.name)}${attr('dataType', col.dataType)}` +
        `${attr('primaryKey', col.isPrimaryKey)}${attr('foreignKey', col.isForeignKey)}` +
        `${attr('unique', col.isUnique)}${attr('nullable', col.isNullable)}`
      if (col.description) {
        lines.push(`${open}>`)
        lines.push(
          `          <description>${escapeXml(col.description)}</description>`,
        )
        lines.push('        </column>')
      } else {
        lines.push(`${open}/>`)
      }
    }
    lines.push('      </columns>')
    lines.push('    </table>')
  }
  lines.push('  </tables>')
  lines.push('  <relationships>')
  const endpointXml = (tag: string, e: SchemaExportEndpoint) =>
    `      <${tag}${attr('table', e.table)}${attr('column', e.column)}${
      e.whiteboard !== undefined ? attr('whiteboard', e.whiteboard ?? '') : ''
    }/>`
  for (const rel of schema.relationships) {
    lines.push(
      `    <relationship${attr('cardinality', rel.cardinality)}${
        rel.label ? attr('label', rel.label) : ''
      }>`,
    )
    lines.push(endpointXml('source', rel.source))
    lines.push(endpointXml('target', rel.target))
    lines.push('    </relationship>')
  }
  lines.push('  </relationships>')
  lines.push('</schema>')
  return lines.join('\n') + '\n'
}

/**
 * Excel workbook with three sheets: Tables, Columns, Relationships.
 *
 * `headerLocale` sets the language of the sheet names and the header row
 * only. Cell values stay as stored (cardinality stays `MANY_TO_ONE`), and
 * Excel shows the TRUE/FALSE cells in its own UI language.
 */
export function schemaToXlsx(
  schema: SchemaExport,
  headerLocale: Locale = 'en',
): Uint8Array {
  const h = (key: string) =>
    translate(headerLocale, `whiteboard.exportSchema.sheet.${key}`)
  const tables: XlsxSheet = {
    name: h('tables'),
    header: [h('table'), h('description'), h('columnCount')],
    widths: [28, 60, 10],
    rows: schema.tables.map((t) => [t.name, t.description, t.columns.length]),
  }
  const columns: XlsxSheet = {
    name: h('columns'),
    header: [
      h('table'),
      '#',
      h('column'),
      h('dataType'),
      h('primaryKey'),
      h('foreignKey'),
      h('unique'),
      h('nullable'),
      h('description'),
    ],
    widths: [28, 6, 28, 16, 12, 12, 10, 10, 60],
    rows: schema.tables.flatMap((t) =>
      t.columns.map((c, i) => [
        t.name,
        i + 1,
        c.name,
        c.dataType,
        c.isPrimaryKey,
        c.isForeignKey,
        c.isUnique,
        c.isNullable,
        c.description,
      ]),
    ),
  }
  // The file columns appear only when a relationship reaches into another
  // file, so the common single-file case stays six columns wide.
  const hasExternal = schema.relationships.some(
    (r) =>
      r.source.whiteboard !== undefined || r.target.whiteboard !== undefined,
  )
  const relationships: XlsxSheet = {
    name: h('relationships'),
    header: [
      h('sourceTable'),
      h('sourceColumn'),
      ...(hasExternal ? [h('sourceFile')] : []),
      h('targetTable'),
      h('targetColumn'),
      ...(hasExternal ? [h('targetFile')] : []),
      h('cardinality'),
      h('label'),
    ],
    widths: [
      24,
      24,
      ...(hasExternal ? [20] : []),
      24,
      24,
      ...(hasExternal ? [20] : []),
      30,
      30,
    ],
    rows: schema.relationships.map((r) => [
      r.source.table,
      r.source.column,
      ...(hasExternal ? [r.source.whiteboard ?? null] : []),
      r.target.table,
      r.target.column,
      ...(hasExternal ? [r.target.whiteboard ?? null] : []),
      r.cardinality,
      r.label,
    ]),
  }
  return buildXlsx([tables, columns, relationships])
}

// ── Download ────────────────────────────────────────────────────────────────

const MIME: Record<SchemaExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  json: 'application/json',
  xml: 'application/xml',
}

/**
 * Turn a whiteboard name into a file name stem. Keeps non-ASCII letters (a
 * board named in Chinese keeps its name) and removes only the characters
 * that Windows, macOS or Linux reject in a file name.
 */
export function schemaFileStem(name: string | null | undefined): string {
  const cleaned = (name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '_')
    .trim()
    .replace(/^\.+|\.+$/g, '')
  return `${cleaned.length > 0 ? cleaned : 'whiteboard'}-schema`
}

/** Serialize the schema in one format; returns the file body and its name. */
export function serializeSchema(
  schema: SchemaExport,
  { format, headerLocale }: SchemaExportOptions,
): { body: string | Uint8Array; filename: string; mime: string } {
  const stem = schemaFileStem(schema.whiteboard)
  const body =
    format === 'xlsx'
      ? schemaToXlsx(schema, headerLocale)
      : format === 'json'
        ? schemaToJson(schema)
        : schemaToXml(schema)
  return { body, filename: `${stem}.${format}`, mime: MIME[format] }
}

/** Serialize the schema and start a browser download. */
export function downloadSchema(
  schema: SchemaExport,
  options: SchemaExportOptions,
): string {
  const { body, filename, mime } = serializeSchema(schema, options)
  const blob = new Blob([body as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoke on the next task: some browsers start the download after click()
  // returns and fail if the URL is already gone.
  setTimeout(() => URL.revokeObjectURL(url), 0)
  return filename
}
