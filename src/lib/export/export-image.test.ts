// src/lib/export/export-image.test.ts
// Unit tests for the image export helper (Issue #104).
// Mocks `html-to-image` (jsdom cannot rasterize/vectorize real DOM); uses
// the real `getNodesBounds`/`getViewportForBounds` from `@xyflow/react`
// (pure math, no DOM dependency) so the bounds computation is genuinely
// exercised.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'

const toPngMock = vi.fn()
const toSvgMock = vi.fn()

vi.mock('html-to-image', () => ({
  toPng: (...args: Array<unknown>) => toPngMock(...args),
  toSvg: (...args: Array<unknown>) => toSvgMock(...args),
}))

// eslint-disable-next-line import/first, import/order
import {
  FALLBACK_FILENAME,
  PNG_PIXEL_RATIO,
  computeExportViewport,
  exportDiagramImage,
  sanitizeFilename,
} from './export-image'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeNode(id: string, x: number, y: number): Node {
  return {
    id,
    position: { x, y },
    measured: { width: 200, height: 100 },
    data: {},
  } as unknown as Node
}

const twoNodes = [makeNode('a', 0, 0), makeNode('b', 300, 0)]

function makeViewportEl(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'react-flow__viewport'
  document.body.appendChild(el)
  return el
}

// ---------------------------------------------------------------------------
// sanitizeFilename
// ---------------------------------------------------------------------------

describe('sanitizeFilename', () => {
  it('replaces special characters with underscores', () => {
    expect(sanitizeFilename('My Diagram!!')).toBe('My_Diagram_')
  })

  it('preserves word characters, dots, and hyphens', () => {
    expect(sanitizeFilename('erd-v2.final')).toBe('erd-v2.final')
  })

  it('trims surrounding whitespace before sanitizing', () => {
    expect(sanitizeFilename('  Users  ')).toBe('Users')
  })

  it('falls back to "diagram" for an empty string', () => {
    expect(sanitizeFilename('')).toBe(FALLBACK_FILENAME)
  })

  it('falls back to "diagram" for whitespace-only input', () => {
    expect(sanitizeFilename('   ')).toBe(FALLBACK_FILENAME)
  })

  it('falls back to "diagram" for null', () => {
    expect(sanitizeFilename(null)).toBe(FALLBACK_FILENAME)
  })

  it('falls back to "diagram" for undefined', () => {
    expect(sanitizeFilename(undefined)).toBe(FALLBACK_FILENAME)
  })
})

// ---------------------------------------------------------------------------
// computeExportViewport
// ---------------------------------------------------------------------------

describe('computeExportViewport', () => {
  it('applies 10% padding around the natural bounds', () => {
    const { width, height } = computeExportViewport(twoNodes)
    // bounds: x [0, 500], y [0, 100] -> natural width 500, height 100
    expect(width).toBeCloseTo(500 * 1.2)
    expect(height).toBeCloseTo(100 * 1.2)
  })

  it('clamps the resulting zoom within [0.5, 2]', () => {
    const { viewport } = computeExportViewport(twoNodes)
    expect(viewport.zoom).toBeGreaterThanOrEqual(0.5)
    expect(viewport.zoom).toBeLessThanOrEqual(2)
  })

  it('throws on fully zero bounds (nodes not yet measured)', () => {
    const unmeasured = {
      id: 'z',
      position: { x: 0, y: 0 },
      measured: { width: 0, height: 0 },
      data: {},
    } as unknown as Node
    expect(() => computeExportViewport([unmeasured])).toThrow(
      /not ready to export/i,
    )
  })

  it('guards against a residual single zero dimension', () => {
    // A node with real width but zero height — bounds are not fully zero, so
    // this should still produce a renderable (non-zero) image, not throw.
    const flatNode = {
      id: 'flat',
      position: { x: 0, y: 0 },
      measured: { width: 200, height: 0 },
      data: {},
    } as unknown as Node
    const { width, height } = computeExportViewport([flatNode])
    expect(width).toBeGreaterThan(0)
    expect(height).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// exportDiagramImage — format x background matrix
// ---------------------------------------------------------------------------

describe('exportDiagramImage', () => {
  let clickSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    toPngMock.mockReset().mockResolvedValue('data:image/png;base64,PNG')
    toSvgMock.mockReset().mockResolvedValue('data:image/svg+xml;base64,SVG')
    clickSpy = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(clickSpy)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('PNG + solid: calls toPng with pixelRatio 2 and the theme background color', async () => {
    const viewportEl = makeViewportEl()
    await exportDiagramImage({
      nodes: twoNodes,
      viewportEl,
      format: 'png',
      background: 'solid',
      themeBg: 'rgb(255, 255, 255)',
      filename: 'My Diagram',
    })

    expect(toPngMock).toHaveBeenCalledTimes(1)
    expect(toSvgMock).not.toHaveBeenCalled()
    const [node, options] = toPngMock.mock.calls[0]
    expect(node).toBe(viewportEl)
    expect(options.pixelRatio).toBe(PNG_PIXEL_RATIO)
    expect(options.backgroundColor).toBe('rgb(255, 255, 255)')
    expect(options.style.transform).toMatch(
      /^translate\(-?\d+(\.\d+)?px, -?\d+(\.\d+)?px\) scale\(\d+(\.\d+)?\)$/,
    )
  })

  it('PNG + transparent: backgroundColor is undefined', async () => {
    const viewportEl = makeViewportEl()
    await exportDiagramImage({
      nodes: twoNodes,
      viewportEl,
      format: 'png',
      background: 'transparent',
      themeBg: 'rgb(17, 24, 39)',
      filename: 'My Diagram',
    })

    const [, options] = toPngMock.mock.calls[0]
    expect(options.backgroundColor).toBeUndefined()
  })

  it('SVG + solid: calls toSvg (no pixelRatio) with the theme background color', async () => {
    const viewportEl = makeViewportEl()
    await exportDiagramImage({
      nodes: twoNodes,
      viewportEl,
      format: 'svg',
      background: 'solid',
      themeBg: 'rgb(17, 24, 39)',
      filename: 'My Diagram',
    })

    expect(toSvgMock).toHaveBeenCalledTimes(1)
    expect(toPngMock).not.toHaveBeenCalled()
    const [node, options] = toSvgMock.mock.calls[0]
    expect(node).toBe(viewportEl)
    expect(options.pixelRatio).toBeUndefined()
    expect(options.backgroundColor).toBe('rgb(17, 24, 39)')
  })

  it('SVG + transparent: backgroundColor is undefined', async () => {
    const viewportEl = makeViewportEl()
    await exportDiagramImage({
      nodes: twoNodes,
      viewportEl,
      format: 'svg',
      background: 'transparent',
      themeBg: 'rgb(255, 255, 255)',
      filename: 'My Diagram',
    })

    const [, options] = toSvgMock.mock.calls[0]
    expect(options.backgroundColor).toBeUndefined()
  })

  it('downloads the PNG with a sanitized filename', async () => {
    const viewportEl = makeViewportEl()
    let downloadedName: string | undefined
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadedName = this.download
    })

    await exportDiagramImage({
      nodes: twoNodes,
      viewportEl,
      format: 'png',
      background: 'solid',
      themeBg: 'rgb(255, 255, 255)',
      filename: 'My Diagram!!',
    })

    expect(downloadedName).toBe('My_Diagram_.png')
  })

  it('falls back to "diagram.svg" when filename is empty', async () => {
    const viewportEl = makeViewportEl()
    let downloadedName: string | undefined
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadedName = this.download
    })

    await exportDiagramImage({
      nodes: twoNodes,
      viewportEl,
      format: 'svg',
      background: 'transparent',
      themeBg: 'rgb(255, 255, 255)',
      filename: null,
    })

    expect(downloadedName).toBe(`${FALLBACK_FILENAME}.svg`)
  })
})
