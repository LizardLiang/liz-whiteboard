// @vitest-environment jsdom
// src/components/whiteboard/CardinalityMarkerDefs.test.tsx
// Tests that new marker IDs are registered in CardinalityMarkerDefs

import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { CardinalityMarkerDefs } from './CardinalityMarkerDefs'

/**
 * Check that a marker ID is present in the rendered HTML.
 * SVG <marker> elements inside <defs> are in the SVG namespace —
 * querySelector on jsdom may not find them via #id CSS selector, so
 * we fall back to searching the raw innerHTML for the id attribute string.
 */
function hasMarkerId(container: HTMLElement, id: string): boolean {
  // Try CSS querySelector first (works in most jsdom versions)
  const bySelector = container.querySelector(`[id="${id}"]`)
  if (bySelector !== null) return true
  // Fall back to raw innerHTML search for SVG namespace elements
  return container.innerHTML.includes(`id="${id}"`)
}

describe('CardinalityMarkerDefs', () => {
  it('renders without crashing', () => {
    const { container } = render(<CardinalityMarkerDefs />)
    expect(container).toBeTruthy()
  })

  it('registers cardinality-zero-one-left marker', () => {
    const { container } = render(<CardinalityMarkerDefs />)
    expect(hasMarkerId(container, 'cardinality-zero-one-left')).toBe(true)
  })

  it('registers cardinality-zero-one-left-highlight marker', () => {
    const { container } = render(<CardinalityMarkerDefs />)
    expect(hasMarkerId(container, 'cardinality-zero-one-left-highlight')).toBe(
      true,
    )
  })

  it('registers cardinality-zero-many-left marker', () => {
    const { container } = render(<CardinalityMarkerDefs />)
    expect(hasMarkerId(container, 'cardinality-zero-many-left')).toBe(true)
  })

  it('registers cardinality-zero-many-left-highlight marker', () => {
    const { container } = render(<CardinalityMarkerDefs />)
    expect(hasMarkerId(container, 'cardinality-zero-many-left-highlight')).toBe(
      true,
    )
  })

  it('also retains pre-existing cardinality-one-left marker', () => {
    const { container } = render(<CardinalityMarkerDefs />)
    expect(hasMarkerId(container, 'cardinality-one-left')).toBe(true)
  })

  it('also retains pre-existing cardinality-many-left marker', () => {
    const { container } = render(<CardinalityMarkerDefs />)
    expect(hasMarkerId(container, 'cardinality-many-left')).toBe(true)
  })

  it('also retains pre-existing cardinality-one-right marker', () => {
    const { container } = render(<CardinalityMarkerDefs />)
    expect(hasMarkerId(container, 'cardinality-one-right')).toBe(true)
  })

  it('also retains pre-existing cardinality-many-right marker', () => {
    const { container } = render(<CardinalityMarkerDefs />)
    expect(hasMarkerId(container, 'cardinality-many-right')).toBe(true)
  })
})
