// H1 (security batch 1): a malformed request must never throw out of
// serveStatic — an uncaught throw in the async createServer callback kills the
// production process.
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { serveStatic } from './serve-static'

function fakeReq(url: string | undefined, host?: string) {
  return { url, headers: { host } } as any
}
function fakeRes() {
  return { writeHead: vi.fn(), end: vi.fn() } as any
}

describe('serveStatic', () => {
  it('returns false (does not throw) for a malformed percent-encoded path', async () => {
    const res = fakeRes()
    await expect(
      serveStatic(fakeReq('/%E0%A4%A', 'localhost'), res, '/nonexistent'),
    ).resolves.toBe(false)
    expect(res.writeHead).not.toHaveBeenCalled()
  })

  it('does not depend on the Host header (bad or missing Host)', async () => {
    for (const host of ['bad host!!', '', undefined, 'a b:c']) {
      await expect(
        serveStatic(fakeReq('/x.js', host), fakeRes(), '/nonexistent'),
      ).resolves.toBe(false)
    }
  })

  it('serves a real file and keeps working after a malformed request', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'serve-static-'))
    await mkdir(join(dir, 'assets'))
    await writeFile(join(dir, 'assets', 'a.js'), 'console.log(1)')

    await serveStatic(fakeReq('/%E0%A4%A'), fakeRes(), dir)
    const res = fakeRes()
    await expect(
      serveStatic(fakeReq('/assets/a.js', 'h'), res, dir),
    ).resolves.toBe(true)
    expect(res.writeHead.mock.calls[0][0]).toBe(200)
  })

  it('refuses directory traversal', async () => {
    await expect(
      serveStatic(fakeReq('/../etc/passwd'), fakeRes(), '/tmp'),
    ).resolves.toBe(false)
  })
})
