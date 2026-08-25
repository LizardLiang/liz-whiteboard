// src/lib/auth/socket-handshake.test.ts
// Tests for the shared socket session-expiry primitive (Hermes review, W6).
//
// `isSocketSessionExpired` is a cross-namespace auth primitive: both
// `/whiteboard/:id` and `/canvas/:boardId` gate every mutation on it. Its
// whole job is to fail CLOSED, and the original implementation
// (`Date.now() > socket.data.sessionExpiresAt`) failed OPEN on a missing
// expiry, because `Date.now() > undefined` is `false`.
//
// `authenticateSocketHandshake` itself is not tested here — see the note at
// the bottom of this file for why that gap is recorded rather than papered
// over.

import { describe, expect, it } from 'vitest'
import { isSocketSessionExpired } from './socket-handshake'

describe('isSocketSessionExpired', () => {
  it('is false for an expiry in the future', () => {
    expect(
      isSocketSessionExpired({ data: { sessionExpiresAt: Date.now() + 60_000 } }),
    ).toBe(false)
  })

  it('is true for an expiry in the past', () => {
    expect(
      isSocketSessionExpired({ data: { sessionExpiresAt: Date.now() - 1 } }),
    ).toBe(true)
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a numeric string', '9999999999999'],
    ['NaN', Number.NaN],
    ['an object', {}],
  ])('fails CLOSED when the expiry is %s', (_label, value) => {
    // Every one of these makes `Date.now() > value` false, so the previous
    // implementation treated a socket with no usable expiry as having a
    // VALID session. Unreachable through today's middleware, which always
    // sets a number — but a future namespace that forgets to run the
    // middleware must be denied, not admitted.
    expect(isSocketSessionExpired({ data: { sessionExpiresAt: value } })).toBe(
      true,
    )
  })

  it('fails CLOSED when the socket carries no data at all', () => {
    expect(isSocketSessionExpired({ data: {} })).toBe(true)
  })
})

// NOT COVERED HERE: `authenticateSocketHandshake`. `src/server/socket.test.ts`
// exercises a REIMPLEMENTATION of that middleware rather than the real
// function — a suite that stays green when the copy and the source disagree.
// Extracting the middleware into this module made a real test possible;
// writing one was out of scope for the review round that created this file,
// and it is recorded as debt in the implementation notes rather than implied
// to be covered.
