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
import { BASE_URL, STORAGE_STATE } from './fixtures'

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

// Batch 2 — authorization holes.
// M3: the TanStack starter demo routes (unauthenticated todo writes, in-memory
// pushes) must not exist. A removed route falls through to the app's 404.
test.describe('Demo routes are gone (security batch 2, M3)', () => {
  // Signed in, so a 404 proves the route is absent rather than auth-gated
  // (anonymous requests get the global login redirect for any path).
  test.use({ storageState: STORAGE_STATE })

  for (const path of [
    '/demo/start/server-funcs',
    '/demo/api/names',
    '/demo/api/tq-todos',
  ]) {
    test(`GET ${path} is 404`, async ({ request }) => {
      const res = await request.get(path, { failOnStatusCode: false })
      expect(res.status()).toBe(404)
      const body = await res.text()
      expect(body).not.toContain('Start - Server Functions')
    })
  }

  test('the demo page does not render in a browser', async ({ page }) => {
    await page.goto('/demo/start/server-funcs')
    await expect(page.getByText('Start - Server Functions')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add todo' })).toHaveCount(0)
  })
})

// M1: an OAuth client cannot ask /authorize for any audience but the MCP
// resource (RFC 8707). The check runs before client lookup and login, so an
// anonymous request is enough to prove it.
test.describe('OAuth resource allowlist (security batch 2, M1)', () => {
  test('/authorize rejects resource=<collab audience> with invalid_target', async ({
    request,
  }) => {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: 'anything',
      redirect_uri: 'http://127.0.0.1:19999/callback',
      code_challenge: 'x'.repeat(43),
      code_challenge_method: 'S256',
      resource: 'http://localhost:3010',
    })
    const res = await request.get(`/authorize?${params.toString()}`, {
      failOnStatusCode: false,
      maxRedirects: 0,
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_target')
  })
})
