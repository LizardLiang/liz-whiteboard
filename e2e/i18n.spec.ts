// e2e/i18n.spec.ts
// i18n with browser-language default. Each language case opens its own context
// with an explicit browser `locale`, reusing the logged-in storageState from
// global-setup. The shared config pins the default locale to en-US so other
// specs that assert English text do not depend on the host machine language.
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { BASE_URL, IDS, STORAGE_STATE } from './fixtures'
import type { Browser, Page } from '@playwright/test'

async function openAs(browser: Browser, locale: string) {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    locale,
    storageState: STORAGE_STATE,
    viewport: { width: 1600, height: 1000 },
  })
  const page = await context.newPage()
  return { context, page }
}

test.describe('browser language default', () => {
  test('zh-TW browser: header is Chinese and html lang is set by the server', async ({
    browser,
  }) => {
    const { context, page } = await openAs(browser, 'zh-TW')
    // Server response, before any hydration.
    const html = await (
      await context.request.get('/login', {
        headers: { 'Accept-Language': 'zh-TW,zh;q=0.9' },
      })
    ).text()
    expect(html).toMatch(/<html[^>]*lang="zh-TW"/)

    await page.goto('/')
    await expect(page.getByRole('button', { name: '登出' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW')
    await context.close()
  })

  test('zh-CN browser gets zh-TW text', async ({ browser }) => {
    const { context, page } = await openAs(browser, 'zh-CN')
    await page.goto('/')
    await expect(page.getByRole('button', { name: '登出' })).toBeVisible()
    await context.close()
  })

  test('fr-FR browser gets English', async ({ browser }) => {
    const { context, page } = await openAs(browser, 'fr-FR')
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await context.close()
  })

  test('picker switches language without reload and persists via cookie', async ({
    browser,
  }) => {
    const { context, page } = await openAs(browser, 'en-US')
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()

    // Retry the open: a click before hydration attaches no handler.
    const option = page.getByRole('menuitemradio', { name: '繁體中文' })
    await expect(async () => {
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Language' }).click()
      await expect(option).toBeVisible({ timeout: 1_500 })
    }).toPass({ timeout: 20_000 })
    await option.click()
    await expect(page.getByRole('button', { name: '登出' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW')
    await expect(page).toHaveTitle(/協作式圖表編輯器/)

    const cookies = await context.cookies()
    expect(cookies.find((c) => c.name === 'locale')?.value).toBe('zh-TW')

    await page.reload()
    await expect(page.getByRole('button', { name: '登出' })).toBeVisible()
    await context.close()
  })

  test('locale cookie beats browser language on the server', async ({
    browser,
  }) => {
    const { context, page } = await openAs(browser, 'en-US')
    await context.addCookies([
      { name: 'locale', value: 'zh-TW', url: BASE_URL },
    ])
    await page.goto('/')
    await expect(page.getByRole('button', { name: '登出' })).toBeVisible()
    await context.close()
  })
})

test.describe('phase 2: auth pages', () => {
  test('login page is Chinese for a zh-TW browser, with no session', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: BASE_URL,
      locale: 'zh-TW',
      viewport: { width: 1600, height: 1000 },
    })
    const page = await context.newPage()
    await page.goto('/login')
    await expect(page.getByRole('button', { name: '登入' })).toBeVisible()
    await expect(page.getByText('登入您的帳號')).toBeVisible()
    await expect(page.getByLabel('電子郵件')).toBeVisible()
    await context.close()
  })
})

test.describe('phase 3: navigator and dashboard', () => {
  test('sidebar navigator and project dashboard are Chinese for a zh-TW browser', async ({
    browser,
  }) => {
    const { context, page } = await openAs(browser, 'zh-TW')
    await page.goto('/')
    await expect(page.getByRole('link', { name: '首頁' })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: '專案', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: '所有專案' })).toBeVisible()
    await context.close()
  })
})

test.describe('phase 4: ER whiteboard', () => {
  test('whiteboard toolbar is Chinese for a zh-TW browser', async ({
    browser,
  }) => {
    const { context, page } = await openAs(browser, 'zh-TW')
    await page.goto(`/whiteboard/${IDS.whiteboard}`)
    await expect(page.getByRole('toolbar', { name: '白板工具' })).toBeVisible()
    await expect(page.getByRole('button', { name: '新增資料表' })).toBeVisible()
    await expect(page.getByRole('button', { name: '更多工具' })).toBeVisible()
    await context.close()
  })
})

test.describe('phase 5: canvas board', () => {
  test('canvas toolbar and board style are Chinese for a zh-TW browser', async ({
    browser,
  }) => {
    // seed-canvas.ts reuses members created by seed-stress.ts.
    execFileSync('bun', ['run', 'e2e/seed-stress.ts'], { stdio: 'inherit' })
    execFileSync('bun', ['run', 'e2e/seed-canvas.ts'], { stdio: 'inherit' })
    const { context, page } = await openAs(browser, 'zh-TW')
    await page.goto(`/canvas/${IDS.canvasBoard}`)
    await page.waitForSelector('canvas')
    await expect(page.getByRole('toolbar', { name: '畫布工具' })).toBeVisible()
    await expect(page.getByRole('button', { name: '矩形 (R)' })).toBeVisible()
    await expect(page.getByRole('button', { name: '看板樣式' })).toBeVisible()
    await context.close()
  })
})

test.describe('phase 6: hydration with a server-rendered zh-TW page', () => {
  test('logged-out and logged-in pages hydrate with no React hydration warning', async ({
    browser,
  }) => {
    const hydrationMessages: Array<string> = []
    const watch = (page: Page) => {
      page.on('console', (msg) => {
        if (/hydrat/i.test(msg.text())) hydrationMessages.push(msg.text())
      })
      page.on('pageerror', (err) => {
        if (/hydrat/i.test(err.message)) hydrationMessages.push(err.message)
      })
    }

    const anonymous = await browser.newContext({
      baseURL: BASE_URL,
      locale: 'zh-TW',
      viewport: { width: 1600, height: 1000 },
    })
    const loginPage = await anonymous.newPage()
    watch(loginPage)
    await loginPage.goto('/login')
    await expect(loginPage.getByRole('button', { name: '登入' })).toBeVisible()
    await anonymous.close()

    const { context, page } = await openAs(browser, 'zh-TW')
    watch(page)
    await page.goto('/')
    await expect(page.getByRole('button', { name: '登出' })).toBeVisible()
    await context.close()

    expect(hydrationMessages).toEqual([])
  })
})
