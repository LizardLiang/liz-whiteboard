// src/lib/auth/errors.test.ts
// Unit tests for src/lib/auth/errors.ts type guards + classifyQueryFailure.
//
// classifyQueryFailure was extracted (Hermes review, authorization-denial-ux-gaps
// follow-up) so the FORBIDDEN-vs-generic-failure split used by
// ReactFlowWhiteboard.tsx and $whiteboardId.tsx is real, shared, testable
// code rather than duplicated inline checks. Rendering the full
// ReactFlowWhiteboard component to exercise its !whiteboardData branch is
// impractical given that file's established test pattern (useQuery/most
// hooks are globally mocked, and the outer data-fetching component is never
// rendered — see ReactFlowWhiteboard.test.tsx), so this is the direct,
// real-code test path Hermes asked for.

import { describe, expect, it } from 'vitest'
import {
  classifyQueryFailure,
  isForbiddenError,
  isThrownForbiddenError,
  isUnauthorizedError,
} from './errors'

class ForbiddenErrorLike extends Error {
  status = 403
  errorCode = 'FORBIDDEN'
  constructor(message = 'You do not have access to this resource.') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

describe('isThrownForbiddenError', () => {
  it('returns true for an error with status 403 and errorCode FORBIDDEN', () => {
    expect(isThrownForbiddenError(new ForbiddenErrorLike())).toBe(true)
  })

  it('returns true for a plain Error matching the default ForbiddenError message (defense in depth)', () => {
    expect(
      isThrownForbiddenError(
        new Error('You do not have access to this resource.'),
      ),
    ).toBe(true)
  })

  it('returns false for a generic Error', () => {
    expect(isThrownForbiddenError(new Error('Network request failed'))).toBe(
      false,
    )
  })

  it('returns false for a 500-shaped error without status/errorCode', () => {
    expect(isThrownForbiddenError(new Error('Internal Server Error'))).toBe(
      false,
    )
  })

  it('returns false for non-Error values', () => {
    expect(isThrownForbiddenError(null)).toBe(false)
    expect(isThrownForbiddenError(undefined)).toBe(false)
    expect(isThrownForbiddenError('error string')).toBe(false)
    expect(
      isThrownForbiddenError({ status: 403, errorCode: 'FORBIDDEN' }),
    ).toBe(false)
  })
})

describe('classifyQueryFailure', () => {
  // Resolved-value FORBIDDEN shape (getProjectPageContent, getProject, etc.)
  it('classifies a resolved-value FORBIDDEN payload (data) as forbidden', () => {
    expect(
      classifyQueryFailure({
        data: { error: 'FORBIDDEN', status: 403, message: 'Access denied' },
      }),
    ).toBe('forbidden')
  })

  it('classifies a resolved-value UNAUTHORIZED payload (data) as generic — not the same as FORBIDDEN', () => {
    expect(
      classifyQueryFailure({ data: { error: 'UNAUTHORIZED', status: 401 } }),
    ).toBe('generic')
  })

  // Thrown ForbiddenError shape (getWhiteboardWithDiagram, etc.)
  it('classifies a thrown ForbiddenError (error) as forbidden', () => {
    expect(classifyQueryFailure({ error: new ForbiddenErrorLike() })).toBe(
      'forbidden',
    )
  })

  it('classifies a generic thrown Error (error) as generic — network/500/not-found', () => {
    expect(classifyQueryFailure({ error: new Error('fetch failed') })).toBe(
      'generic',
    )
  })

  it('classifies no data and no error as generic (e.g. still-pending state guarded elsewhere)', () => {
    expect(classifyQueryFailure({})).toBe('generic')
  })

  it('prefers the data classification over error when both happen to be present', () => {
    expect(
      classifyQueryFailure({
        data: { error: 'FORBIDDEN', status: 403, message: 'Access denied' },
        error: new Error('should not matter'),
      }),
    ).toBe('forbidden')
  })
})

describe('isForbiddenError / isUnauthorizedError (existing guards, sanity)', () => {
  it('isForbiddenError recognizes the FORBIDDEN shape', () => {
    expect(
      isForbiddenError({ error: 'FORBIDDEN', status: 403, message: 'x' }),
    ).toBe(true)
  })

  it('isUnauthorizedError recognizes the UNAUTHORIZED shape', () => {
    expect(isUnauthorizedError({ error: 'UNAUTHORIZED', status: 401 })).toBe(
      true,
    )
  })

  it("the two guards do not cross-match each other's shape", () => {
    expect(isForbiddenError({ error: 'UNAUTHORIZED', status: 401 })).toBe(false)
    expect(
      isUnauthorizedError({ error: 'FORBIDDEN', status: 403, message: 'x' }),
    ).toBe(false)
  })
})
