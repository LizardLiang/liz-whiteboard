// computeAutoLayout input schema: whiteboardId must be a UUID.
// The server function itself needs a TanStack Start context, so the schema
// it parses with is tested directly.

import { describe, expect, it } from 'vitest'
import { computeAutoLayoutInputSchema } from './server-functions'

describe('computeAutoLayoutInputSchema', () => {
  it('rejects a non-UUID whiteboardId', () => {
    expect(
      computeAutoLayoutInputSchema.safeParse({ whiteboardId: 'not-a-uuid' })
        .success,
    ).toBe(false)
  })

  it('accepts a UUID whiteboardId', () => {
    expect(
      computeAutoLayoutInputSchema.safeParse({
        whiteboardId: '123e4567-e89b-42d3-a456-426614174000',
      }).success,
    ).toBe(true)
  })
})
