// computeAutoLayout input validation (Zod uuid) — rejects before any DB or auth work.

import { describe, expect, it } from 'vitest'
import { computeAutoLayout } from './server-functions'

describe('computeAutoLayout validator', () => {
  it('rejects a non-UUID whiteboardId', async () => {
    await expect(
      computeAutoLayout({ data: { whiteboardId: 'not-a-uuid' } }),
    ).rejects.toThrow()
  })
})
