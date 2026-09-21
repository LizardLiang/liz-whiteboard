import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { IDS } from './fixtures'
import type { Download, Page } from '@playwright/test'

const BOARD_URL = `/canvas/${IDS.canvasSearchBoard}`

test.beforeAll(() => {
  execFileSync('bun', ['run', 'e2e/seed-stress.ts'], { stdio: 'inherit' })
})

test.beforeEach(() => {
  execFileSync('bun', ['run', 'e2e/seed-canvas-export.ts'], {
    stdio: 'inherit',
  })
})

async function openExportDialog(page: Page) {
  await page.goto(BOARD_URL)
  await page.waitForSelector('canvas')
  await page.getByRole('button', { name: 'Export canvas as image' }).click()
  await expect(page.getByRole('dialog')).toContainText('Export as Image')
}

async function downloadBytes(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream()
  const chunks: Array<Buffer> = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

test('downloads a solid light-theme PNG of the complete scene', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('theme', 'light'))
  await openExportDialog(page)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /^export$/i }).click()
  const download = await downloadPromise
  const png = await downloadBytes(download)

  expect(download.suggestedFilename()).toBe('E2E_Canvas_Search.png')
  expect(png.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  )
  expect(png.readUInt32BE(16)).toBeGreaterThan(1000)
  expect(png.readUInt32BE(20)).toBeGreaterThan(500)
  await expect(page.getByText('Canvas exported')).toBeVisible()
})

test('downloads a transparent dark-theme SVG with shapes, text, and connector paths', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('theme', 'dark'))
  await openExportDialog(page)
  await page.getByRole('combobox', { name: 'Format' }).click()
  await page.getByRole('option', { name: 'SVG' }).click()
  await page.getByRole('switch', { name: 'Transparent background' }).click()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /^export$/i }).click()
  const download = await downloadPromise
  const svg = (await downloadBytes(download)).toString('utf8')

  expect(download.suggestedFilename()).toBe('E2E_Canvas_Search.svg')
  expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
  expect(svg).toContain('<rect')
  expect(svg).toContain('<ellipse')
  expect(svg).toContain('<text')
  expect(svg).toContain('alpha note')
  expect(svg).toContain('<path')
  expect(svg).toContain('#f8fafc')
  expect(svg).not.toContain('data-export-background')

  const parsed = await page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
    return {
      root: doc.documentElement.localName,
      errors: doc.querySelectorAll('parsererror').length,
    }
  }, svg)
  expect(parsed).toEqual({ root: 'svg', errors: 0 })
})
