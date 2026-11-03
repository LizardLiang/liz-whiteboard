// e2e/i18n.spec.ts
// i18n with browser-language default. Each language case opens its own context
// with an explicit browser `locale`, reusing the logged-in storageState from
// global-setup. The shared config pins the default locale to en-US so other
// specs that assert English text do not depend on the host machine language.
import { expect, test } from '@playwright/test'
import { BASE_URL, STORAGE_STATE } from './fixtures'
import type { Browser } from '@playwright/test'

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
