// e2e/security-hardening.spec.ts
// Security audit regression coverage. Later batches add their tests here.
//
// Batch 1 — crash-proofing (H1): a malformed percent-encoded path used to
// throw outside any try/catch in server.prod.ts and kill the Bun process.
// The crash is PROD-ONLY: the dev stack is Vite, which never runs
// server.prod.ts's serveStatic. Against dev this test therefore asserts
// survival (the server answers the next request and still serves the login
// page); against the prod build it proves the original crash is gone.
// Unit coverage of the throwing code lives in src/lib/serve-static.test.ts.
import { request as httpRequest } from 'node:http'
import { expect, test } from '@playwright/test'
import { BASE_URL } from './fixtures'

test.use({ storageState: { cookies: [], origins: [] } })

/** Send a raw request line; Playwright's own client would normalise the URL. */
function rawGet(
  path: string,
  headers: Record<string, string> = {},
): Promise<number> {
  const target = new URL(BASE_URL)
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: target.hostname,
        port: target.port,
        path,
        method: 'GET',
        headers,
      },
      (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      },
    )
    req.on('error', reject)
    req.end()
  })
}

test.describe('Server crash-proofing (security batch 1)', () => {
  test('malformed percent-encoded path does not kill the server', async ({
    page,
  }) => {
    const status = await rawGet('/%E0%A4%A')
    expect(status).toBeGreaterThanOrEqual(200)
    expect(status).toBeLessThan(600)

    // The same process must still serve the app.
    await page.goto('/login')
    await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Password' })).toBeVisible()
  })

  test('bad Host header does not kill the server', async ({ page }) => {
    // Node's http client may refuse some Host values itself; either outcome is
    // fine, the assertion is that the server is still up afterwards.
    await rawGet('/', { Host: 'bad host!!' }).catch(() => 0)

    await page.goto('/login')
    await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible()
  })
})
