// e2e/schema-export.spec.ts
// End-to-end coverage for "Export schema" on the ER whiteboard: More tools →
// Export schema → pick Excel / JSON / XML → the browser downloads a file
// that holds the board's tables, columns and relationships.
//
// Seeded by e2e/seed-schema-export.ts (dedicated project, so no other spec
// can change the board under this one). Auth comes from global-setup
// (storageState). The export runs fully in the browser, so it behaves the
// same in the dev server and the production build.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { BASE_URL, IDS, clickMoreTool, waitForMenusClosed } from './fixtures'
import { tableNode } from './canvas-helpers'
import type { Download, Page } from '@playwright/test'

const BOARD_URL = `/whiteboard/${IDS.schemaExpBoard}`
const EMPTY_BOARD_URL = `/whiteboard/${IDS.schemaExpEmptyBoard}`

test.beforeEach(() => {
  execFileSync('bun', ['run', 'e2e/seed-schema-export.ts'], {
    stdio: 'inherit',
  })
})

async function downloadBytes(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream()
  const chunks: Array<Buffer> = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

/** Read an uncompressed (STORE) zip — the format the .xlsx writer emits. */
function unzipStored(bytes: Buffer): Map<string, string> {
  const files = new Map<string, string>()
  let at = 0
  while (bytes.readUInt32LE(at) === 0x04034b50) {
    expect(bytes.readUInt16LE(at + 8)).toBe(0) // STORE
    const size = bytes.readUInt32LE(at + 18)
    const nameLen = bytes.readUInt16LE(at + 26)
    const extraLen = bytes.readUInt16LE(at + 28)
    const name = bytes.toString('utf8', at + 30, at + 30 + nameLen)
    const start = at + 30 + nameLen + extraLen
    files.set(name, bytes.toString('utf8', start, start + size))
    at = start + size
  }
  return files
}

async function openBoard(page: Page) {
  await page.goto(BOARD_URL)
  await expect(
    page.getByRole('heading', { name: 'Schema Export ERD' }),
  ).toBeVisible()
  await expect(tableNode(page, 'customers').first()).toBeVisible()
  await expect(tableNode(page, 'orders').first()).toBeVisible()
}

async function exportAs(
  page: Page,
  option: 'Excel (.xlsx)' | 'JSON (.json)' | 'XML (.xml)',
  headerLanguage?: 'English' | '繁體中文',
): Promise<Download> {
  await clickMoreTool(page, /Export schema/)
  const dialog = page.getByRole('dialog', { name: 'Export Schema' })
  await expect(dialog).toBeVisible()
  const languageSelect = dialog.getByRole('combobox', {
    name: 'Header language',
  })
  // Excel is the default; pick another format through the Select.
  if (option !== 'Excel (.xlsx)') {
    await dialog.getByRole('combobox', { name: 'Format' }).click()
    await page.getByRole('option', { name: option }).click()
    // JSON / XML keys always stay English: no language choice is offered.
    await expect(languageSelect).toBeHidden()
  } else {
    // Follows the UI language (English here) until the user picks one.
    await expect(languageSelect).toHaveText('English')
    if (headerLanguage) {
      await languageSelect.click()
      await page.getByRole('option', { name: headerLanguage }).click()
      await expect(languageSelect).toHaveText(headerLanguage)
    }
  }
  await expect(dialog.getByRole('combobox', { name: 'Format' })).toHaveText(
    option,
  )
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Export' }).click()
  const download = await downloadPromise
  // The dialog closes after a successful export.
  await expect(dialog).toBeHidden()
  return download
}

test.describe('Export schema (Excel / JSON / XML)', () => {
  test('JSON holds every table, column flag, and relationship', async ({
    page,
  }) => {
    await openBoard(page)
    const download = await exportAs(page, 'JSON (.json)')
    expect(download.suggestedFilename()).toBe('Schema Export ERD-schema.json')

    const schema = JSON.parse((await downloadBytes(download)).toString('utf8'))
    expect(schema).toMatchObject({
      format: 'liz-whiteboard-schema',
      version: 1,
      whiteboard: 'Schema Export ERD',
    })
    expect(Number.isNaN(Date.parse(schema.exportedAt))).toBe(false)
    expect(schema.tables).toEqual([
      {
        name: 'customers',
        description: 'VIP & <gold> "tier"',
        columns: [
          {
            name: 'id',
            dataType: 'uuid',
            isPrimaryKey: true,
            isForeignKey: false,
            isUnique: false,
            isNullable: false,
            description: null,
          },
          {
            name: 'email',
            dataType: 'varchar',
            isPrimaryKey: false,
            isForeignKey: false,
            isUnique: true,
            isNullable: true,
            description: '登入用電子郵件',
          },
        ],
      },
      {
        name: 'orders',
        description: null,
        columns: [
          {
            name: 'id',
            dataType: 'uuid',
            isPrimaryKey: true,
            isForeignKey: false,
            isUnique: false,
            isNullable: false,
            description: null,
          },
          {
            name: 'customer_id',
            dataType: 'uuid',
            isPrimaryKey: false,
            isForeignKey: true,
            isUnique: false,
            isNullable: false,
            description: null,
          },
        ],
      },
    ])
    expect(schema.relationships).toEqual([
      {
        cardinality: 'MANY_TO_ONE',
        label: 'placed by',
        source: { table: 'orders', column: 'customer_id' },
        target: { table: 'customers', column: 'id' },
      },
    ])
  })

  test('XML is escaped and carries the same structure', async ({ page }) => {
    await openBoard(page)
    const download = await exportAs(page, 'XML (.xml)')
    expect(download.suggestedFilename()).toBe('Schema Export ERD-schema.xml')

    const xml = (await downloadBytes(download)).toString('utf8')
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(xml).toContain(
      '<description>VIP &amp; &lt;gold&gt; &quot;tier&quot;</description>',
    )
    expect(xml).toContain(
      '<column name="email" dataType="varchar" primaryKey="false" foreignKey="false" unique="true" nullable="true">',
    )
    expect(xml).toContain('<description>登入用電子郵件</description>')
    expect(xml).toContain(
      '<relationship cardinality="MANY_TO_ONE" label="placed by">',
    )
    expect(xml).toContain('<source table="orders" column="customer_id"/>')
    expect(xml).toContain('<target table="customers" column="id"/>')

    // Well-formed: the browser's own XML parser accepts it.
    const parseErrors = await page.evaluate(
      (text) =>
        new DOMParser()
          .parseFromString(text, 'application/xml')
          .getElementsByTagName('parsererror').length,
      xml,
    )
    expect(parseErrors).toBe(0)
  })

  test('Excel (default format) downloads a workbook with three sheets', async ({
    page,
  }) => {
    await openBoard(page)
    const download = await exportAs(page, 'Excel (.xlsx)')
    expect(download.suggestedFilename()).toBe('Schema Export ERD-schema.xlsx')

    const bytes = await downloadBytes(download)
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK')
    const files = unzipStored(bytes)
    expect(files.has('[Content_Types].xml')).toBe(true)
    const workbook = files.get('xl/workbook.xml') ?? ''
    expect(workbook).toContain('<sheet name="Tables"')
    expect(workbook).toContain('<sheet name="Columns"')
    expect(workbook).toContain('<sheet name="Relationships"')

    const tables = files.get('xl/worksheets/sheet1.xml') ?? ''
    expect(tables).toContain('>Description<')
    expect(tables).toContain('>customers<')
    expect(tables).toContain('>VIP &amp; &lt;gold&gt; &quot;tier&quot;<')
    const columns = files.get('xl/worksheets/sheet2.xml') ?? ''
    expect(columns).toContain('>customer_id<')
    expect(columns).toContain('>登入用電子郵件<')
    const relationships = files.get('xl/worksheets/sheet3.xml') ?? ''
    expect(relationships).toContain('>MANY_TO_ONE<')
    expect(relationships).toContain('>placed by<')
  })

  test('Excel headers in Traditional Chinese when the user picks 繁體中文', async ({
    page,
  }) => {
    await openBoard(page)
    const download = await exportAs(page, 'Excel (.xlsx)', '繁體中文')
    const files = unzipStored(await downloadBytes(download))

    const workbook = files.get('xl/workbook.xml') ?? ''
    expect(workbook).toContain('<sheet name="資料表"')
    expect(workbook).toContain('<sheet name="欄位"')
    expect(workbook).toContain('<sheet name="關聯"')
    const tables = files.get('xl/worksheets/sheet1.xml') ?? ''
    expect(tables).toContain('>說明<')
    expect(tables).not.toContain('>Description<')
    const columns = files.get('xl/worksheets/sheet2.xml') ?? ''
    for (const header of ['資料類型', '主鍵', '外鍵', '唯一', '可為空']) {
      expect(columns).toContain(`>${header}<`)
    }
    // Cell values stay as entered.
    const relationships = files.get('xl/worksheets/sheet3.xml') ?? ''
    expect(relationships).toContain('>基數<')
    expect(relationships).toContain('>MANY_TO_ONE<')
    expect(relationships).toContain('>placed by<')
  })

  test('header language defaults to the UI language (zh-TW)', async ({
    page,
  }) => {
    await page
      .context()
      .addCookies([{ name: 'locale', value: 'zh-TW', url: BASE_URL }])
    await page.goto(BOARD_URL)
    await expect(tableNode(page, 'customers').first()).toBeVisible()
    // clickMoreTool matches the English "More tools" label; in zh-TW the
    // button is labelled in Chinese, so open it by its test id.
    await waitForMenusClosed(page)
    await page.getByTestId('more-tools-trigger').click()
    await page.getByRole('menuitem', { name: /匯出結構/ }).click()
    const dialog = page.getByRole('dialog', { name: '匯出結構' })
    await expect(dialog.getByRole('combobox', { name: '標題語言' })).toHaveText(
      '繁體中文',
    )
    const downloadPromise = page.waitForEvent('download')
    await dialog.getByRole('button', { name: '匯出' }).click()
    const files = unzipStored(await downloadBytes(await downloadPromise))
    expect(files.get('xl/workbook.xml')).toContain('<sheet name="資料表"')
  })

  test('Cancel closes the dialog without a download', async ({ page }) => {
    await openBoard(page)
    let downloads = 0
    page.on('download', () => downloads++)
    await clickMoreTool(page, /Export schema/)
    const dialog = page.getByRole('dialog', { name: 'Export Schema' })
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    expect(downloads).toBe(0)
  })

  test('the menu item is disabled on a board with no tables', async ({
    page,
  }) => {
    await page.goto(EMPTY_BOARD_URL)
    await expect(
      page.getByRole('heading', { name: 'Schema Export Empty' }),
    ).toBeVisible()
    await waitForMenusClosed(page)
    await page.getByRole('button', { name: 'More tools' }).click()
    const item = page.getByRole('menuitem', { name: /Export schema/ })
    await expect(item).toBeVisible()
    await expect(item).toHaveAttribute('aria-disabled', 'true')
    await expect(item).toHaveAttribute('title', 'Add a table to export')
    await page.keyboard.press('Escape')
  })
})
