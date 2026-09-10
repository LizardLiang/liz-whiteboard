// src/routes/whiteboard/whiteboard-search-params.test.ts
// The whiteboard route's ?focusTable= search param (LizMeter #83). It carries
// the jump-to-source target of a cross-file reference node, and must never
// stop the board from opening.

import { describe, expect, it } from 'vitest'

import { whiteboardSearchSchema } from './$whiteboardId'

describe('whiteboardSearchSchema', () => {
  it('keeps a well-formed table id', () => {
    const id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
    expect(whiteboardSearchSchema.parse({ focusTable: id })).toEqual({
      focusTable: id,
    })
  })

  it('leaves focusTable undefined when absent', () => {
    expect(whiteboardSearchSchema.parse({})).toEqual({ focusTable: undefined })
  })

  it('drops a malformed id instead of failing the navigation', () => {
    expect(whiteboardSearchSchema.parse({ focusTable: 'not-a-uuid' })).toEqual({
      focusTable: undefined,
    })
  })

  it('drops a non-string value instead of failing the navigation', () => {
    expect(whiteboardSearchSchema.parse({ focusTable: 42 })).toEqual({
      focusTable: undefined,
    })
  })

  it('ignores unrelated params rather than rejecting the URL', () => {
    expect(whiteboardSearchSchema.parse({ somethingElse: 'x' })).toEqual({
      focusTable: undefined,
    })
  })
})
