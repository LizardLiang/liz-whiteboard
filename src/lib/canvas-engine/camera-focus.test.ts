// src/lib/canvas-engine/camera-focus.test.ts
// Unit tests for the camera-focus helper (board-undo tactical plan, Wave 4,
// step 12).

import { describe, expect, it } from 'vitest'
import { focusOnRect, isRectVisible } from './camera-focus'
import { worldToScreen } from './camera'
import type { Camera } from './camera'

const VIEWPORT = { width: 800, height: 600 }

describe('isRectVisible', () => {
  it('is true for a rect fully inside the current view', () => {
    const camera: Camera = { x: 0, y: 0, zoom: 1 }
    expect(isRectVisible(camera, VIEWPORT, { x: 10, y: 10, width: 50, height: 50 })).toBe(true)
  })

  it('is false for a rect entirely outside the current view', () => {
    const camera: Camera = { x: 0, y: 0, zoom: 1 }
    expect(
      isRectVisible(camera, VIEWPORT, { x: 5000, y: 5000, width: 50, height: 50 }),
    ).toBe(false)
  })

  it('is false for a rect only partially inside the current view', () => {
    const camera: Camera = { x: 0, y: 0, zoom: 1 }
    // Straddles the right edge of an 800-wide viewport at zoom 1.
    expect(
      isRectVisible(camera, VIEWPORT, { x: 780, y: 10, width: 50, height: 50 }),
    ).toBe(false)
  })

  it('accounts for zoom', () => {
    // At zoom 0.1 the visible world rect is 8000x6000 — this element is
    // inside it even though its world coordinate looks far away.
    const camera: Camera = { x: 0, y: 0, zoom: 0.1 }
    expect(
      isRectVisible(camera, VIEWPORT, { x: 5000, y: 4000, width: 50, height: 50 }),
    ).toBe(true)
  })
})

describe('focusOnRect', () => {
  it('returns the SAME camera reference when the rect is already fully visible', () => {
    const camera: Camera = { x: 0, y: 0, zoom: 1 }
    const rect = { x: 10, y: 10, width: 50, height: 50 }
    expect(focusOnRect(camera, VIEWPORT, rect)).toBe(camera)
  })

  it('pans (never zooms) an off-screen rect to the viewport centre', () => {
    const camera: Camera = { x: 0, y: 0, zoom: 1 }
    const rect = { x: 5000, y: 4000, width: 100, height: 100 }
    const next = focusOnRect(camera, VIEWPORT, rect)

    expect(next.zoom).toBe(camera.zoom)
    expect(next).not.toBe(camera)

    // The rect's centre now lands exactly on the viewport's screen centre.
    const rectCenter = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    const screen = worldToScreen(next, rectCenter)
    expect(screen.x).toBeCloseTo(VIEWPORT.width / 2, 9)
    expect(screen.y).toBeCloseTo(VIEWPORT.height / 2, 9)
  })

  it('centres correctly at a non-1 zoom too', () => {
    const camera: Camera = { x: 100, y: -50, zoom: 2 }
    const rect = { x: -900, y: 900, width: 40, height: 40 }
    const next = focusOnRect(camera, VIEWPORT, rect)

    expect(next.zoom).toBe(2)
    const rectCenter = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    const screen = worldToScreen(next, rectCenter)
    expect(screen.x).toBeCloseTo(VIEWPORT.width / 2, 9)
    expect(screen.y).toBeCloseTo(VIEWPORT.height / 2, 9)
  })

  it('the newly-centred rect is fully visible', () => {
    const camera: Camera = { x: 0, y: 0, zoom: 1 }
    const rect = { x: 5000, y: 4000, width: 100, height: 100 }
    const next = focusOnRect(camera, VIEWPORT, rect)
    expect(isRectVisible(next, VIEWPORT, rect)).toBe(true)
  })
})
