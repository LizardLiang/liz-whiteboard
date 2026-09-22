import { describe, expect, it, vi } from 'vitest'
import {
  canvasExportBounds,
  pngExportDimensions,
  serializeCanvasSceneSvg,
} from './canvas-export'
import type { CanvasElement } from '@/lib/canvas-engine/scene'
import { sceneFrom } from '@/lib/canvas-engine/scene'

const style = {
  fill: '#ffffff',
  stroke: '#2563eb',
  strokeWidth: 4,
  fontSize: 16,
  color: '#0f172a',
  cornerRadius: 8,
  textAlign: 'left' as const,
  verticalAlign: 'top' as const,
}

const measure = (text: string, fontSize: number) => text.length * fontSize * 0.5

function rectangle(patch: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id: 'rect',
    kind: 'rectangle',
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    rotation: 0,
    zIndex: 0,
    text: 'A&B <node>',
    style,
    ...patch,
  }
}

describe('canvas export', () => {
  it('rejects an empty scene', () => {
    expect(() => canvasExportBounds(sceneFrom([]), measure)).toThrow(
      /nothing to export/i,
    )
  })

  it('expands bounds for stroke, arrowheads, groups, and fixed padding', () => {
    const scene = sceneFrom([rectangle()])
    expect(canvasExportBounds(scene, measure)).toEqual({
      x: -4,
      y: 6,
      width: 128,
      height: 78,
    })
  })

  it('applies proportional export padding independently on each axis', () => {
    const scene = sceneFrom([
      rectangle({
        x: 0,
        y: 0,
        width: 1_000,
        height: 10,
        text: null,
        style: { ...style, strokeWidth: 0 },
      }),
    ])

    expect(canvasExportBounds(scene, measure)).toEqual({
      x: -100,
      y: -12,
      width: 1_200,
      height: 34,
    })
  })

  it('includes horizontal and multiline text overflow in the bounds', () => {
    const scene = sceneFrom([
      rectangle({
        kind: 'text',
        x: 10,
        y: 20,
        width: 0,
        height: 0,
        text: 'abcdefghij\nsecond',
        style: { ...style, fontSize: 20 },
      }),
    ])

    expect(canvasExportBounds(scene, measure)).toEqual({
      x: 6,
      y: 16,
      width: 124,
      height: 80,
    })
  })

  it('treats zero-width measured text as drawable', () => {
    const scene = sceneFrom([
      rectangle({
        kind: 'text',
        width: 0,
        height: 0,
        text: '\u200b',
      }),
    ])

    expect(canvasExportBounds(scene, () => 0)).toEqual({
      x: 6,
      y: 16,
      width: 25,
      height: 46.4,
    })
  })

  it('rejects a connector whose zero-width stroke renders nothing', () => {
    const connector = rectangle({
      kind: 'connector',
      text: null,
      style: { ...style, strokeWidth: 0 },
      connector: {
        source: { kind: 'point', point: { x: 0, y: 0 } },
        target: { kind: 'point', point: { x: 100, y: 100 } },
        routing: 'straight',
      },
    })

    expect(() => canvasExportBounds(sceneFrom([connector]), measure)).toThrow(
      /nothing to export/i,
    )
  })

  it('serializes escaped text, viewBox, theme text, and solid background', () => {
    const measureSpy = vi.fn((text: string) => text.length * 8)
    const svg = serializeCanvasSceneSvg({
      scene: sceneFrom([rectangle()]),
      theme: 'dark',
      background: 'solid',
      backgroundColor: '#020617',
      measureText: measureSpy,
    })

    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('fill="#020617"')
    expect(svg).toContain('A&amp;B &lt;node&gt;')
    expect(svg).toContain('viewBox="-4 6 128 78"')
    expect(measureSpy).toHaveBeenCalled()
  })

  it('serializes exact shared shape and connector geometry with matching paint', () => {
    const svg = serializeCanvasSceneSvg({
      scene: sceneFrom([
        rectangle({ text: null }),
        rectangle({
          id: 'connector',
          kind: 'connector',
          text: null,
          connector: {
            source: { kind: 'point', point: { x: 0, y: 0 } },
            target: { kind: 'point', point: { x: 100, y: 0 } },
            routing: 'straight',
          },
        }),
      ]),
      theme: 'light',
      background: 'transparent',
      backgroundColor: '#ffffff',
      measureText: measure,
    })

    expect(svg).toContain(
      '<rect x="10" y="20" width="100" height="50" rx="8" ry="8" fill="#ffffff" stroke="#2563eb" stroke-width="4"/>',
    )
    expect(svg).toContain(
      '<path d="M 0 0 L 100 0" fill="none" stroke="#2563eb" stroke-width="4"/>',
    )
    expect(svg).toContain('stroke-linejoin="round" stroke-linecap="round"')
  })

  it('omits the background rectangle in transparent mode', () => {
    const svg = serializeCanvasSceneSvg({
      scene: sceneFrom([rectangle({ text: null })]),
      theme: 'light',
      background: 'transparent',
      backgroundColor: '#ffffff',
      measureText: (text) => text.length * 8,
    })
    expect(svg).not.toContain('data-export-background')
  })

  it('removes XML-forbidden controls from serialized text', () => {
    const invalidText = `safe${String.fromCharCode(0, 8, 0xd800)}text`
    const svg = serializeCanvasSceneSvg({
      scene: sceneFrom([rectangle({ text: invalidText })]),
      theme: 'light',
      background: 'transparent',
      backgroundColor: '#ffffff',
      measureText: measure,
    })

    expect(svg).toContain('safe')
    expect(svg).toContain('text')
    expect(svg).not.toContain(String.fromCharCode(0))
    expect(svg).not.toContain(String.fromCharCode(8))
    expect(svg).not.toContain(String.fromCharCode(0xd800))
  })

  it('normalizes URL and invalid SVG paints to safe colors', () => {
    const svg = serializeCanvasSceneSvg({
      scene: sceneFrom([
        rectangle({
          style: {
            ...style,
            fill: 'url(https://example.test/fill)',
            stroke: 'url(#stroke)',
            color: 'url(data:text/plain,unsafe)',
          },
        }),
      ]),
      theme: 'light',
      background: 'solid',
      backgroundColor: 'url(#background)',
      measureText: measure,
    })

    expect(svg).not.toContain('url(')
    expect(svg).toContain('fill="#000000" stroke="#000000"')
    expect(svg).toContain('<text fill="#0f172a"')
    expect(svg).toContain('data-export-background="true"')
    expect(svg).toContain('fill="#ffffff"')
  })

  it('guards PNG dimensions and total pixel count before allocation', () => {
    expect(() =>
      pngExportDimensions({ x: 0, y: 0, width: 9_000, height: 10 }),
    ).toThrow(/too large/i)
    expect(() =>
      pngExportDimensions({ x: 0, y: 0, width: 5_000, height: 5_000 }),
    ).toThrow(/too large/i)
    expect(pngExportDimensions({ x: 0, y: 0, width: 100, height: 50 })).toEqual(
      { width: 200, height: 100 },
    )
  })
})
