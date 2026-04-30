// src/hooks/use-prefers-reduced-motion.test.ts
// REQ-13 reduced-motion tests (AC-13a-c)
// Tests: usePrefersReducedMotion returns correct value based on matchMedia,
//        falls back to false in SSR/test environments without matchMedia.

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePrefersReducedMotion, usePrefersReducedMotionCallback } from './use-prefers-reduced-motion'

// ============================================================================
// REQ-13: Reduced-motion compliance tests
// ============================================================================

describe('usePrefersReducedMotion (REQ-13)', () => {
  const originalMatchMedia = window.matchMedia

  afterEach(() => {
    // Restore original matchMedia
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: originalMatchMedia,
    })
    vi.restoreAllMocks()
  })

  // Helper to mock matchMedia
  function mockMatchMedia(matches: boolean) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn((query: string) => ({
        matches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  }

  // AC-13a: ghost row has reduced-motion variant — hook returns true when OS prefers reduced motion
  it('AC-13a: returns true when OS prefers-reduced-motion: reduce is active', () => {
    mockMatchMedia(true)

    const { result } = renderHook(() => usePrefersReducedMotion())
    expect(result.current).toBe(true)
  })

  // AC-13a: hook returns false when OS does NOT prefer reduced motion
  it('AC-13a: returns false when OS does not prefer reduced motion', () => {
    mockMatchMedia(false)

    const { result } = renderHook(() => usePrefersReducedMotion())
    expect(result.current).toBe(false)
  })

  // AC-13b: InsertionLine transition is none when reduced-motion active (covered separately in TableNode.test)
  // Here we verify the hook returns false as a safe default in environments without matchMedia

  it('AC-13b: falls back to false when matchMedia is not available (SSR/test environment)', () => {
    // Simulate environment without matchMedia
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: undefined,
    })

    const { result } = renderHook(() => usePrefersReducedMotion())
    expect(result.current).toBe(false)
  })

  // AC-13c: auto-scroll velocity is halved (300px/s) — tested via pure function in auto-scroll tests
  // Here we test the callback variant that reads at drag-start time

  it('AC-13c: usePrefersReducedMotionCallback returns a stable function', () => {
    mockMatchMedia(true)

    const { result } = renderHook(() => usePrefersReducedMotionCallback())

    // Should return a function
    expect(typeof result.current).toBe('function')
    // The function should return true (reduced motion active)
    expect(result.current()).toBe(true)
  })

  it('AC-13c: usePrefersReducedMotionCallback returns false when no reduced motion', () => {
    mockMatchMedia(false)

    const { result } = renderHook(() => usePrefersReducedMotionCallback())
    expect(result.current()).toBe(false)
  })

  it('AC-13c: callback falls back to false when matchMedia unavailable', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: undefined,
    })

    const { result } = renderHook(() => usePrefersReducedMotionCallback())
    expect(result.current()).toBe(false)
  })
})
