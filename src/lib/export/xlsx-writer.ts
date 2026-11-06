// src/lib/export/xlsx-writer.ts
//
// Minimal Office Open XML (.xlsx) writer for the schema export. An .xlsx file
// is a zip archive of a few XML parts. This module writes those parts and
// packs them into a zip with the STORE method (no compression), so it needs
// no third-party library. The output opens in Excel, LibreOffice, Numbers and
// Google Sheets.
//
// Supported cell values: string (inline string), number, boolean, null/empty.
// Each sheet gets a bold header row, a frozen first row, an auto-filter over
// the data range, and fixed column widths.

/** One cell value. `null` and `undefined` write an empty cell. */
export type XlsxCell = string | number | boolean | null | undefined

export interface XlsxSheet {
  /** Sheet tab name. Excel limits it to 31 characters without []:*?/\ */
  name: string
  /** First row. Written in bold, frozen, and used as the filter row. */
  header: Array<string>
  rows: Array<Array<XlsxCell>>
  /** Optional column widths in characters, one per header column. */
  widths?: Array<number>
}

/** Excel rejects a cell string longer than this. */
const MAX_CELL_CHARS = 32767

/** Remove characters that XML 1.0 does not allow, then escape markup. */
export function escapeXml(value: string): string {
  return (
    value
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  )
}

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function columnLetter(index: number): string {
  let n = index + 1
  let letters = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    letters = String.fromCharCode(65 + rem) + letters
    n = Math.floor((n - 1) / 26)
  }
  return letters
}

/** Make a name Excel accepts as a sheet tab name. */
export function safeSheetName(name: string): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, '_').slice(0, 31)
  return cleaned.length > 0 ? cleaned : 'Sheet'
}

function cellXml(ref: string, value: XlsxCell, style: number): string {
  const s = style ? ` s="${style}"` : ''
  if (value === null || value === undefined || value === '') {
    return style ? `<c r="${ref}"${s}/>` : ''
  }
  if (typeof value === 'boolean') {
    return `<c r="${ref}"${s} t="b"><v>${value ? 1 : 0}</v></c>`
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"${s}><v>${value}</v></c>`
  }
  const text = escapeXml(String(value).slice(0, MAX_CELL_CHARS))
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`
}

function rowXml(rowIndex: number, cells: Array<XlsxCell>, style: number) {
  const r = rowIndex + 1
  const body = cells
    .map((value, col) => cellXml(`${columnLetter(col)}${r}`, value, style))
    .join('')
  return `<row r="${r}">${body}</row>`
}

function sheetXml(sheet: XlsxSheet): string {
  const colCount = sheet.header.length
  const lastRow = sheet.rows.length + 1
  const lastCol = columnLetter(Math.max(colCount, 1) - 1)
  const range = `A1:${lastCol}${lastRow}`
  const cols = sheet.widths
    ? `<cols>${sheet.widths
        .map(
          (w, i) =>
            `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`,
        )
        .join('')}</cols>`
    : ''
  const rows = [
    rowXml(0, sheet.header, 1),
    ...sheet.rows.map((row, i) => rowXml(i + 1, row, 0)),
  ].join('')
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="${range}"/>` +
    '<sheetViews><sheetView workbookViewId="0">' +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '</sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    cols +
    `<sheetData>${rows}</sheetData>` +
    `<autoFilter ref="${range}"/>` +
    '</worksheet>'
  )
}

function workbookParts(sheets: Array<XlsxSheet>): Array<[string, string]> {
  const names = sheets.map((s) => safeSheetName(s.name))
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    names
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('') +
    '</Types>'
  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>'
  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' +
    names
      .map(
        (name, i) =>
          `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
      )
      .join('') +
    '</sheets>' +
    // The auto-filter ranges need a hidden _FilterDatabase name per sheet,
    // or Excel shows the filter buttons but reports a repaired file.
    '<definedNames>' +
    sheets
      .map((sheet, i) => {
        const lastCol = columnLetter(Math.max(sheet.header.length, 1) - 1)
        const quoted = `'${names[i].replace(/'/g, "''")}'`
        return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${escapeXml(
          `${quoted}!$A$1:$${lastCol}$${sheet.rows.length + 1}`,
        )}</definedName>`
      })
      .join('') +
    '</definedNames>' +
    '</workbook>'
  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    names
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join('') +
    `<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>'
  // Style 0 = default, style 1 = bold header with a light grey fill.
  const styles =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>'

  return [
    ['[Content_Types].xml', contentTypes],
    ['_rels/.rels', rootRels],
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', workbookRels],
    ['xl/styles.xml', styles],
    ...sheets.map(
      (sheet, i) =>
        [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet)] as [
          string,
          string,
        ],
    ),
  ]
}

// ── Zip (STORE method) ──────────────────────────────────────────────────────

let crcTable: Uint32Array | null = null

/** Standard CRC-32 (IEEE 802.3), as the zip format requires. */
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Pack files into an uncompressed zip archive. */
export function zipStore(files: Array<[string, Uint8Array]>): Uint8Array {
  const encoder = new TextEncoder()
  // Fixed DOS timestamp (1980-01-01 00:00) keeps the output deterministic.
  const dosTime = 0
  const dosDate = (0 << 9) | (1 << 5) | 1
  const local: Array<Uint8Array> = []
  const central: Array<Uint8Array> = []
  let offset = 0

  for (const [name, data] of files) {
    const nameBytes = encoder.encode(name)
    const crc = crc32(data)

    const header = new Uint8Array(30 + nameBytes.length)
    const h = new DataView(header.buffer)
    h.setUint32(0, 0x04034b50, true) // local file header signature
    h.setUint16(4, 20, true) // version needed
    h.setUint16(6, 0x0800, true) // flags: UTF-8 names
    h.setUint16(8, 0, true) // method: store
    h.setUint16(10, dosTime, true)
    h.setUint16(12, dosDate, true)
    h.setUint32(14, crc, true)
    h.setUint32(18, data.length, true) // compressed size
    h.setUint32(22, data.length, true) // uncompressed size
    h.setUint16(26, nameBytes.length, true)
    h.setUint16(28, 0, true) // extra length
    header.set(nameBytes, 30)

    const entry = new Uint8Array(46 + nameBytes.length)
    const c = new DataView(entry.buffer)
    c.setUint32(0, 0x02014b50, true) // central directory signature
    c.setUint16(4, 20, true) // version made by
    c.setUint16(6, 20, true) // version needed
    c.setUint16(8, 0x0800, true)
    c.setUint16(10, 0, true)
    c.setUint16(12, dosTime, true)
    c.setUint16(14, dosDate, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, data.length, true)
    c.setUint32(24, data.length, true)
    c.setUint16(28, nameBytes.length, true)
    // extra length, comment length, disk number, internal/external attrs = 0
    c.setUint32(42, offset, true) // local header offset
    entry.set(nameBytes, 46)

    local.push(header, data)
    central.push(entry)
    offset += header.length + data.length
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const e = new DataView(end.buffer)
  e.setUint32(0, 0x06054b50, true) // end of central directory signature
  e.setUint16(8, files.length, true) // entries on this disk
  e.setUint16(10, files.length, true) // entries total
  e.setUint32(12, centralSize, true)
  e.setUint32(16, offset, true) // central directory offset

  const parts = [...local, ...central, end]
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** Build a complete .xlsx file from the given sheets. */
export function buildXlsx(sheets: Array<XlsxSheet>): Uint8Array {
  const encoder = new TextEncoder()
  return zipStore(
    workbookParts(sheets).map(([name, xml]) => [name, encoder.encode(xml)]),
  )
}
