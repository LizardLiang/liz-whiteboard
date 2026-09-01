// src/lib/canvas-engine/camera.test.ts
// The camera is the engine's single screen<->world authority, so these
// tests are the guard against the W1/W3 bug class (screen and world
// coordinates mixed at a call site). The round-trip property below is the
// one that matters most: if it ever fails, every gesture in the engine
// lands in the wrong place.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CAMERA,
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  panByScreenDelta,
  screenToWorld,
  visibleWorldRect,
  worldToScreen,
  zoomAt,
} from './camera'
import type { Camera } from './camera'

const CAMERAS: Array<[string, Camera]> = [
  ['identity', DEFAULT_CAMERA],
  ['panned', { x: 320, y: -140, zoom: 1 }],
  ['zoomed in', { x: 0, y: 0, zoom: 2 }],
  ['zoomed out', { x: -50, y: 75, zoom: 0.25 }],
  ['panned and zoomed', { x: 1234.5, y: -987.25, zoom: 1.75 }],
]

const POINTS = [
  { x: 0, y: 0 },
  { x: 1, y: -1 },
  { x: 640, y: 360 },
  { x: -2500, y: 4100 },
  { x: 0.5, y: 0.25 },
]

describe('camera round-trip', () => {
  it.each(CAMERAS)(
    'screenToWorld then worldToScreen returns the original point (%s)',
    (_label, camera) => {
      for (const point of POINTS) {
        const back = worldToScreen(camera, screenToWorld(camera, point))
        expect(back.x).toBeCloseTo(point.x, 9)
        expect(back.y).toBeCloseTo(point.y, 9)
      }
    },
  )

  it.each(CAMERAS)(
    'worldToScreen then screenToWorld returns the original point (%s)',
    (_label, camera) => {
      for (const point of POINTS) {
        const back = screenToWorld(camera, worldToScreen(camera, point))
        expect(back.x).toBeCloseTo(point.x, 9)
        expect(back.y).toBeCloseTo(point.y, 9)
      }
    },
  )
})

describe('screenToWorld / worldToScreen', () => {
  it('places the camera origin at the viewport top-left', () => {
    const camera: Camera = { x: 100, y: 200, zoom: 1 }
    expect(worldToScreen(camera, { x: 100, y: 200 })).toEqual({ x: 0, y: 0 })
    expect(screenToWorld(camera, { x: 0, y: 0 })).toEqual({ x: 100, y: 200 })
  })

  it('scales distances by zoom', () => {
    const camera: Camera = { x: 0, y: 0, zoom: 2 }
    // 50 world units right of the origin is 100 screen px at 2x.
    expect(worldToScreen(camera, { x: 50, y: 0 }).x).toBe(100)
    expect(screenToWorld(camera, { x: 100, y: 0 }).x).toBe(50)
  })
})

describe('zoomAt', () => {
  it.each(CAMERAS)('keeps the anchor point pinned (%s)', (_label, camera) => {
    const anchor = { x: 400, y: 300 }
    const worldUnderAnchorBefore = screenToWorld(camera, anchor)
    for (const factor of [1.1, 0.9, 2, 0.5]) {
      const next = zoomAt(camera, anchor, factor)
      const worldUnderAnchorAfter = screenToWorld(next, anchor)
      expect(worldUnderAnchorAfter.x).toBeCloseTo(worldUnderAnchorBefore.x, 6)
      expect(worldUnderAnchorAfter.y).toBeCloseTo(worldUnderAnchorBefore.y, 6)
    }
  })

  it('keeps the anchor pinned even when the zoom clamps', () => {
    // Deliberately overshoot both limits: the pin must hold for the CLAMPED
    // zoom, which it only does if clamping happens before solving for the pan.
    const anchor = { x: 123, y: 456 }
    for (const [camera, factor] of [
      [{ x: 10, y: 20, zoom: 1.9 }, 100],
      [{ x: 10, y: 20, zoom: 0.15 }, 0.001],
    ] as Array<[Camera, number]>) {
      const before = screenToWorld(camera, anchor)
      const next = zoomAt(camera, anchor, factor)
      const after = screenToWorld(next, anchor)
      expect(after.x).toBeCloseTo(before.x, 6)
      expect(after.y).toBeCloseTo(before.y, 6)
      expect(next.zoom).toBeGreaterThanOrEqual(MIN_ZOOM)
      expect(next.zoom).toBeLessThanOrEqual(MAX_ZOOM)
    }
  })

  it('does not mutate the camera it was given', () => {
    const camera: Camera = { x: 5, y: 6, zoom: 1 }
    zoomAt(camera, { x: 0, y: 0 }, 2)
    expect(camera).toEqual({ x: 5, y: 6, zoom: 1 })
  })
})

describe('clampZoom', () => {
  it('holds the documented limits', () => {
    expect(clampZoom(999)).toBe(MAX_ZOOM)
    expect(clampZoom(0)).toBe(MIN_ZOOM)
    expect(clampZoom(-3)).toBe(MIN_ZOOM)
    expect(clampZoom(1)).toBe(1)
  })

  it('never returns a non-finite zoom', () => {
    // A NaN zoom would propagate into every transform and blank the canvas
    // with no error — the same silent-NaN trap shape-geometry guards against.
    expect(clampZoom(Number.NaN)).toBe(1)
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(MAX_ZOOM)
  })
})

describe('panByScreenDelta', () => {
  it('moves the world under the pointer one-for-one at any zoom', () => {
    for (const zoom of [0.25, 1, 2]) {
      const camera: Camera = { x: 0, y: 0, zoom }
      const worldPointBefore = screenToWorld(camera, { x: 100, y: 100 })
      // Drag right/down by 40 screen px: the same world point should now be
      // under a screen position 40px right/down.
      const next = panByScreenDelta(camera, { x: 40, y: 40 })
      const screenAfter = worldToScreen(next, worldPointBefore)
      expect(screenAfter.x).toBeCloseTo(140, 6)
      expect(screenAfter.y).toBeCloseTo(140, 6)
    }
  })

  it('leaves zoom untouched', () => {
    expect(panByScreenDelta({ x: 0, y: 0, zoom: 1.5 }, { x: 9, y: 9 }).zoom).toBe(
      1.5,
    )
  })
})

describe('visibleWorldRect', () => {
  it('covers exactly the viewport in world units', () => {
    const camera: Camera = { x: 100, y: 50, zoom: 2 }
    const rect = visibleWorldRect(camera, { width: 800, height: 600 })
    expect(rect).toEqual({ x: 100, y: 50, width: 400, height: 300 })
    // Its corners must map back to the viewport's corners.
    const topLeft = worldToScreen(camera, { x: rect.x, y: rect.y })
    const bottomRight = worldToScreen(camera, {
      x: rect.x + rect.width,
      y: rect.y + rect.height,
    })
    expect(topLeft).toEqual({ x: 0, y: 0 })
    expect(bottomRight.x).toBeCloseTo(800, 6)
    expect(bottomRight.y).toBeCloseTo(600, 6)
  })

  it('shows more world as you zoom out', () => {
    const wide = visibleWorldRect(
      { x: 0, y: 0, zoom: 0.5 },
      { width: 800, height: 600 },
    )
    const tight = visibleWorldRect(
      { x: 0, y: 0, zoom: 2 },
      { width: 800, height: 600 },
    )
    expect(wide.width).toBeGreaterThan(tight.width)
  })
})
