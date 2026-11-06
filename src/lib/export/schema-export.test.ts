// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  buildSchemaExport,
  schemaFileStem,
  schemaToJson,
  schemaToXlsx,
  schemaToXml,
  serializeSchema,
} from './schema-export'
import { columnLetter, crc32, escapeXml, safeSheetName } from './xlsx-writer'

const col = (
  id: string,
  name: string,
  dataType: string,
  order: number,
  extra: Partial<{
    isPrimaryKey: boolean
    isForeignKey: boolean
    isUnique: boolean
    isNullable: boolean
    description: string | null
  }> = {},
) => ({
  id,
  name,
  dataType,
  order,
  isPrimaryKey: false,
  isForeignKey: false,
  isUnique: false,
  isNullable: false,
  description: null,
  ...extra,
})

const nodes = [
  {
    id: 't-orders',
    type: 'table',
    data: {
      table: {
        name: 'orders',
        description: 'customer <orders> & "stuff"',
        // Deliberately out of order: the export sorts by `order`.
        columns: [
          col('c-o-user', 'user_id', 'uuid', 1, {
            isForeignKey: true,
            isNullable: true,
          }),
          col('c-o-id', 'id', 'uuid', 0, { isPrimaryKey: true }),
        ],
      },
    },
  },
  {
    id: 't-users',
    type: 'table',
    data: {
      table: {
        name: 'users',
        description: null,
        columns: [
          col('c-u-id', 'id', 'uuid', 0, { isPrimaryKey: true }),
          col('c-u-email', 'email', 'varchar', 1, {
            isUnique: true,
            description: '登入用電子郵件',
          }),
        ],
      },
    },
  },
  {
    id: 'ref-1',
    type: 'externalTable',
    data: {
      sourceTableName: 'invoices',
      sourceWhiteboardName: 'Billing',
      columns: [{ id: 'c-ref-id', name: 'id' }],
    },
  },
  // Non-table nodes are ignored.
  { id: 'area-1', type: 'area', data: { area: {} } },
]

const rel = (
  sourceTableId: string,
  sourceColumnId: string,
  targetTableId: string,
  targetColumnId: string,
  cardinality: string,
  label: string | null = null,
) => ({
  data: {
    relationship: {
      sourceTableId,
      sourceColumnId,
      targetTableId,
      targetColumnId,
      cardinality,
      label,
    },
  },
})

const edges = [
  rel('t-orders', 'c-o-user', 't-users', 'c-u-id', 'MANY_TO_ONE', 'belongs to'),
  rel('t-orders', 'c-o-id', 'ref-1', 'c-ref-id', 'ONE_TO_ONE'),
  // Stale edge to a table that is not on the board: skipped.
  rel('t-gone', 'c-x', 't-users', 'c-u-id', 'ONE_TO_MANY'),
]

const NOW = new Date('2026-11-06T00:00:00.000Z')

describe('buildSchemaExport', () => {
  const schema = buildSchemaExport(nodes, edges, 'Shop DB', NOW)

  it('exports only table nodes, sorted by name, columns in canvas order', () => {
    expect(schema.tables.map((t) => t.name)).toEqual(['orders', 'users'])
    expect(schema.tables[0].columns.map((c) => c.name)).toEqual([
      'id',
      'user_id',
    ])
    expect(schema.tables[0].columns[1]).toEqual({
      name: 'user_id',
      dataType: 'uuid',
      isPrimaryKey: false,
      isForeignKey: true,
      isUnique: false,
      isNullable: true,
      description: null,
    })
  })

  it('resolves relationship endpoints, marks references, drops stale edges', () => {
    expect(schema.relationships).toEqual([
      {
        cardinality: 'ONE_TO_ONE',
        label: null,
        source: { table: 'orders', column: 'id' },
        target: { table: 'invoices', column: 'id', whiteboard: 'Billing' },
      },
      {
        cardinality: 'MANY_TO_ONE',
        label: 'belongs to',
        source: { table: 'orders', column: 'user_id' },
        target: { table: 'users', column: 'id' },
      },
    ])
  })

  it('carries header metadata', () => {
    expect(schema.format).toBe('liz-whiteboard-schema')
    expect(schema.version).toBe(1)
    expect(schema.whiteboard).toBe('Shop DB')
    expect(schema.exportedAt).toBe('2026-11-06T00:00:00.000Z')
    expect(buildSchemaExport([], [], '  ', NOW).whiteboard).toBe('Untitled')
  })

  it('JSON round-trips to the same model', () => {
    expect(JSON.parse(schemaToJson(schema))).toEqual(schema)
  })

  it('XML is well-formed, escaped, and carries every field', () => {
    const xml = schemaToXml(schema)
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
    const root = doc.documentElement
    expect(root.tagName).toBe('schema')
    expect(root.getAttribute('whiteboard')).toBe('Shop DB')

    const tables = Array.from(root.getElementsByTagName('table'))
    expect(tables.map((t) => t.getAttribute('name'))).toEqual([
      'orders',
      'users',
    ])
    expect(tables[0].querySelector(':scope > description')?.textContent).toBe(
      'customer <orders> & "stuff"',
    )
    const email = tables[1].querySelectorAll('column')[1]
    expect(email.getAttribute('unique')).toBe('true')
    expect(email.getAttribute('primaryKey')).toBe('false')
    expect(email.querySelector('description')?.textContent).toBe(
      '登入用電子郵件',
    )

    const rels = Array.from(root.getElementsByTagName('relationship'))
    expect(rels).toHaveLength(2)
    const target = rels[0].querySelector('target')!
    expect(target.getAttribute('table')).toBe('invoices')
    expect(target.getAttribute('whiteboard')).toBe('Billing')
    expect(rels[0].querySelector('source')!.hasAttribute('whiteboard')).toBe(
      false,
    )
    expect(rels[1].getAttribute('label')).toBe('belongs to')
  })
})

// ── xlsx: read the stored zip back and check every part ──────────────────────

function unzipStored(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder()
  const files = new Map<string, string>()
  let at = 0
  while (view.getUint32(at, true) === 0x04034b50) {
    const method = view.getUint16(at + 8, true)
    const crc = view.getUint32(at + 14, true)
    const size = view.getUint32(at + 18, true)
    const nameLen = view.getUint16(at + 26, true)
    const extraLen = view.getUint16(at + 28, true)
    const name = decoder.decode(bytes.subarray(at + 30, at + 30 + nameLen))
    const start = at + 30 + nameLen + extraLen
    const data = bytes.subarray(start, start + size)
    expect(method).toBe(0)
    expect(crc32(data)).toBe(crc)
    files.set(name, decoder.decode(data))
    at = start + size
  }
  // Central directory follows, then the end record that counts the entries.
  const eocd = bytes.length - 22
  expect(view.getUint32(eocd, true)).toBe(0x06054b50)
  expect(view.getUint16(eocd + 10, true)).toBe(files.size)
  expect(view.getUint32(eocd + 16, true)).toBe(at)
  return files
}

function cellTexts(sheetXml: string): Array<Array<string>> {
  const doc = new DOMParser().parseFromString(sheetXml, 'application/xml')
  expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
  return Array.from(doc.getElementsByTagName('row')).map((row) =>
    Array.from(row.getElementsByTagName('c')).map((c) => {
      if (c.getAttribute('t') === 'b') {
        return c.textContent === '1' ? 'TRUE' : 'FALSE'
      }
      return c.textContent
    }),
  )
}

describe('schemaToXlsx', () => {
  const schema = buildSchemaExport(nodes, edges, 'Shop DB', NOW)
  const files = unzipStored(schemaToXlsx(schema))

  it('contains every required OOXML part, all well-formed', () => {
    expect([...files.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
      'xl/worksheets/sheet3.xml',
    ])
    for (const xml of files.values()) {
      const doc = new DOMParser().parseFromString(xml, 'application/xml')
      expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
    }
    expect(files.get('xl/workbook.xml')).toContain('name="Tables"')
    expect(files.get('xl/workbook.xml')).toContain('name="Columns"')
    expect(files.get('xl/workbook.xml')).toContain('name="Relationships"')
  })

  it('writes the Tables, Columns and Relationships rows', () => {
    expect(cellTexts(files.get('xl/worksheets/sheet1.xml')!)).toEqual([
      ['Table', 'Description', 'Columns'],
      ['orders', 'customer <orders> & "stuff"', '2'],
      // users has no description: the empty cell is omitted.
      ['users', '2'],
    ])
    const columns = cellTexts(files.get('xl/worksheets/sheet2.xml')!)
    expect(columns[0]).toEqual([
      'Table',
      '#',
      'Column',
      'Data type',
      'Primary key',
      'Foreign key',
      'Unique',
      'Nullable',
      'Description',
    ])
    expect(columns[4]).toEqual([
      'users',
      '2',
      'email',
      'varchar',
      'FALSE',
      'FALSE',
      'TRUE',
      'FALSE',
      '登入用電子郵件',
    ])
    // A reference endpoint adds the Source file / Target file columns.
    expect(cellTexts(files.get('xl/worksheets/sheet3.xml')!)).toEqual([
      [
        'Source table',
        'Source column',
        'Source file',
        'Target table',
        'Target column',
        'Target file',
        'Cardinality',
        'Label',
      ],
      ['orders', 'id', 'invoices', 'id', 'Billing', 'ONE_TO_ONE'],
      ['orders', 'user_id', 'users', 'id', 'MANY_TO_ONE', 'belongs to'],
    ])
  })

  it('writes Traditional Chinese sheet names and headers for zh-TW', () => {
    const zh = unzipStored(schemaToXlsx(schema, 'zh-TW'))
    const workbook = zh.get('xl/workbook.xml')!
    expect(workbook).toContain('<sheet name="資料表"')
    expect(workbook).toContain('<sheet name="欄位"')
    expect(workbook).toContain('<sheet name="關聯"')
    // The filter range must name the localized sheet, or Excel repairs it.
    expect(workbook).toContain('&apos;資料表&apos;!$A$1:$C$3')
    expect(cellTexts(zh.get('xl/worksheets/sheet1.xml')!)[0]).toEqual([
      '資料表',
      '說明',
      '欄位數',
    ])
    expect(cellTexts(zh.get('xl/worksheets/sheet2.xml')!)[0]).toEqual([
      '資料表',
      '#',
      '欄位',
      '資料類型',
      '主鍵',
      '外鍵',
      '唯一',
      '可為空',
      '說明',
    ])
    const rels = cellTexts(zh.get('xl/worksheets/sheet3.xml')!)
    expect(rels[0]).toEqual([
      '來源資料表',
      '來源欄位',
      '來源檔案',
      '目標資料表',
      '目標欄位',
      '目標檔案',
      '基數',
      '標籤',
    ])
    // Cell values are not translated.
    expect(rels[2]).toContain('MANY_TO_ONE')
    expect(rels[2]).toContain('belongs to')
  })

  it('omits the file columns when every relationship is local', () => {
    const local = buildSchemaExport(nodes, [edges[0]], 'x', NOW)
    const sheet = unzipStored(schemaToXlsx(local)).get(
      'xl/worksheets/sheet3.xml',
    )!
    expect(cellTexts(sheet)[0]).toEqual([
      'Source table',
      'Source column',
      'Target table',
      'Target column',
      'Cardinality',
      'Label',
    ])
  })

  it('writes a valid workbook for an empty board', () => {
    const empty = unzipStored(schemaToXlsx(buildSchemaExport([], [], 'e', NOW)))
    expect(cellTexts(empty.get('xl/worksheets/sheet1.xml')!)).toEqual([
      ['Table', 'Description', 'Columns'],
    ])
  })
})

describe('helpers', () => {
  it('crc32 matches the IEEE check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('columnLetter', () => {
    expect([0, 25, 26, 51, 701, 702].map(columnLetter)).toEqual([
      'A',
      'Z',
      'AA',
      'AZ',
      'ZZ',
      'AAA',
    ])
  })

  it('escapeXml strips XML-illegal control chars and escapes markup', () => {
    expect(escapeXml('a\u0001b<&>"\'\tc')).toBe(
      'ab&lt;&amp;&gt;&quot;&apos;\tc',
    )
  })

  it('safeSheetName', () => {
    expect(safeSheetName('a[b]:c*d?e/f\\g')).toBe('a_b__c_d_e_f_g')
    expect(safeSheetName('x'.repeat(40))).toHaveLength(31)
    expect(safeSheetName('')).toBe('Sheet')
  })

  it('schemaFileStem keeps Unicode and strips forbidden characters', () => {
    expect(schemaFileStem('訂單 系統')).toBe('訂單 系統-schema')
    expect(schemaFileStem('a/b:c*?')).toBe('a_b_c_-schema')
    expect(schemaFileStem('  ')).toBe('whiteboard-schema')
    expect(schemaFileStem(null)).toBe('whiteboard-schema')
  })

  it('serializeSchema picks name and MIME type per format', () => {
    const schema = buildSchemaExport(nodes, edges, 'Shop DB', NOW)
    expect(
      serializeSchema(schema, { format: 'json', headerLocale: 'en' }),
    ).toMatchObject({
      filename: 'Shop DB-schema.json',
      mime: 'application/json',
    })
    expect(
      serializeSchema(schema, { format: 'xml', headerLocale: 'en' }).filename,
    ).toBe('Shop DB-schema.xml')
    const xlsx = serializeSchema(schema, { format: 'xlsx', headerLocale: 'en' })
    expect(xlsx.filename).toBe('Shop DB-schema.xlsx')
    expect(xlsx.body).toBeInstanceOf(Uint8Array)
  })

  it('headerLocale changes only the Excel headers, never JSON or XML keys', () => {
    const schema = buildSchemaExport(nodes, edges, 'Shop DB', NOW)
    const zh = { headerLocale: 'zh-TW' } as const
    const en = { headerLocale: 'en' } as const
    expect(serializeSchema(schema, { format: 'json', ...zh }).body).toBe(
      serializeSchema(schema, { format: 'json', ...en }).body,
    )
    expect(serializeSchema(schema, { format: 'xml', ...zh }).body).toBe(
      serializeSchema(schema, { format: 'xml', ...en }).body,
    )
  })
})
