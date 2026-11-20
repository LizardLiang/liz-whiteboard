// e2e/security-audit-fixes.spec.ts (separate from security-hardening.spec.ts, which holds batches 1-4)
// End-to-end coverage for the security-hardening batch:
//   1. /token with an unknown https client_id answers invalid_grant (400)
//      WITHOUT resolving the client. Before the fix the server first tried to
//      resolve the client (a CIMD fetch) and answered invalid_client (401).
//      The "no outbound fetch" proof itself is the unit test
//      src/lib/oauth/token-endpoint.test.ts (resolveClient spy): a local
//      listener cannot show it here, because the SSRF guard already refuses
//      private addresses before any connection is made.
//   2. /revoke works for a DCR-registered client: after revoke, the refresh
//      token no longer rotates.
//   3. An out-of-range table or area position over the real Socket.IO
//      namespace is refused and the stored position is unchanged.
//
// Socket.IO note (same prod/dev split as version-history.spec.ts): in dev the
// socket server runs in its own process behind Vite's /socket.io proxy, and
// live broadcasts to other clients cannot be asserted here. This spec talks to
// the namespace directly and asserts the ack plus the persisted value.
import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { io } from 'socket.io-client'
import { BASE_URL, IDS } from './fixtures'
import type { Page } from '@playwright/test'

const REDIRECT_PORT = 39231
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`

function pkce() {
  const verifier = randomBytes(32).toString('base64url')
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  }
}

async function loginCookieHeader(page: Page): Promise<string> {
  const cookies = await page.context().cookies(BASE_URL)
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ')
}

/** Read one column straight from the slot's SQLite file (Node has no bun:sqlite, so shell out to Bun). */
function readDb(table: string, id: string, column: string): number {
  const out = execFileSync(
    'bun',
    [
      '-e',
      `import { Database } from 'bun:sqlite';
const db = new Database(process.env.E2E_DB_PATH ?? 'data/app.db', { readonly: true });
const row = db.query('SELECT "${column}" AS v FROM "${table}" WHERE id = ?').get('${id}');
console.log(row ? String(row.v) : 'MISSING');`,
    ],
    { env: process.env, encoding: 'utf8' },
  )
  return Number(out.trim())
}

test.describe('Security hardening', () => {
  test('/token with an unknown https client_id is invalid_grant, not a client lookup', async ({
    request,
  }) => {
    const res = await request.post(`${BASE_URL}/token`, {
      form: {
        grant_type: 'authorization_code',
        client_id: 'https://unknown-client.invalid/client.json',
        code: 'not-a-real-code',
        redirect_uri: REDIRECT_URI,
        code_verifier: 'v'.repeat(50),
      },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_grant')

    const refresh = await request.post(`${BASE_URL}/token`, {
      form: {
        grant_type: 'refresh_token',
        client_id: 'https://unknown-client.invalid/client.json',
        refresh_token: 'not-a-real-token',
      },
    })
    expect(refresh.status()).toBe(400)
    expect((await refresh.json()).error).toBe('invalid_grant')
  })

  test('/revoke succeeds for a DCR-registered client and kills its refresh token', async ({
    page,
    request,
  }) => {
    const reg = await request.post(`${BASE_URL}/oauth/register`, {
      data: {
        redirect_uris: [REDIRECT_URI],
        client_name: `E2E Hardening ${randomBytes(4).toString('hex')}`,
      },
    })
    expect(reg.status()).toBe(201)
    const clientId = ((await reg.json()) as { client_id: string }).client_id

    const { verifier, challenge } = pkce()
    await page.route(`http://127.0.0.1:${REDIRECT_PORT}/**`, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: 'ok' }),
    )
    const authorize = new URL('/authorize', BASE_URL)
    authorize.searchParams.set('client_id', clientId)
    authorize.searchParams.set('redirect_uri', REDIRECT_URI)
    authorize.searchParams.set('response_type', 'code')
    authorize.searchParams.set('code_challenge', challenge)
    authorize.searchParams.set('code_challenge_method', 'S256')
    authorize.searchParams.set('state', 'e2e-hardening')
    authorize.searchParams.set('scope', 'whiteboard')
    await page.goto(authorize.toString())
    await page.getByRole('button', { name: 'Approve' }).click()
    await page.waitForURL(new RegExp(`^http://127\\.0\\.0\\.1:${REDIRECT_PORT}`))
    const code = new URL(page.url()).searchParams.get('code')
    expect(code).toBeTruthy()

    const tokenRes = await request.post(`${BASE_URL}/token`, {
      form: {
        grant_type: 'authorization_code',
        code: code!,
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      },
    })
    expect(tokenRes.status()).toBe(200)
    const { refresh_token } = (await tokenRes.json()) as {
      refresh_token: string
    }

    const revoke = await request.post(`${BASE_URL}/revoke`, {
      form: { token: refresh_token, client_id: clientId },
    })
    expect(revoke.status()).toBe(200)

    const after = await request.post(`${BASE_URL}/token`, {
      form: {
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token,
      },
    })
    expect(after.status()).toBe(400)
    expect((await after.json()).error).toBe('invalid_grant')
  })

  test('out-of-range table and area positions are refused and not stored', async ({
    page,
  }) => {
    await page.goto(`/whiteboard/${IDS.whiteboard}`)
    const cookie = await loginCookieHeader(page)
    const socket = io(`${BASE_URL}/whiteboard/${IDS.whiteboard}`, {
      extraHeaders: { cookie, origin: BASE_URL },
      transports: ['websocket'],
      reconnection: false,
    })
    await new Promise<void>((resolve, reject) => {
      socket.once('connected', () => resolve())
      socket.once('connect_error', reject)
    })

    const tableBefore = readDb('DiagramTable', IDS.usersTable, 'positionX')
    const areaBefore = readDb('Area', IDS.area, 'positionX')

    const tableAck = await socket.timeout(5000).emitWithAck('table:move', {
      tableId: IDS.usersTable,
      positionX: 1e300,
      positionY: 0,
    })
    expect(tableAck.ok).toBe(false)

    const areaAck = await socket.timeout(5000).emitWithAck('area:move', {
      areaId: IDS.area,
      positionX: 1e300,
      positionY: 0,
      members: [],
    })
    expect(areaAck.ok).toBe(false)
    socket.close()

    expect(readDb('DiagramTable', IDS.usersTable, 'positionX')).toBe(
      tableBefore,
    )
    expect(readDb('Area', IDS.area, 'positionX')).toBe(areaBefore)
  })
})
