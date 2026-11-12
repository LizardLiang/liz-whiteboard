// @vitest-environment node
// src/db-bun-runtime.test.ts
// Vitest runs on node:sqlite only; production runs on bun:sqlite. This test
// starts scripts/db-bun-smoke.ts under Bun so `bun run test` also exercises
// the db.ts adapter on the production driver.

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

describe('db.ts adapter under real Bun', () => {
  it('get(), all() and run() keep the adapter shape on bun:sqlite', () => {
    const result = spawnSync('bun', ['scripts/db-bun-smoke.ts'], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 60_000,
    })
    expect(result.error).toBeUndefined()
    expect(`${result.stdout}${result.stderr}`).toContain('db-bun-smoke: ok')
    expect(result.status).toBe(0)
  }, 70_000)
})
