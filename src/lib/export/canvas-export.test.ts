import { describe, expect, it, vi } from 'vitest'
import { sceneFrom } from '@/lib/canvas-engine/scene'
import {
  canvasExportBounds,
  serializeCanvasSceneSvg,
} from './canvas-export'
import type { CanvasElement } from '@/lib/canvas-engine/scene'

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
    expect(() => canvasExportBounds(sceneFrom([]))).toThrow(/nothing to export/i)
  })

  it('expands bounds for stroke, arrowheads, groups, and fixed padding', () => {
    const scene = sceneFrom([rectangle()])
    expect(canvasExportBounds(scene)).toEqual({
      x: -4,
      y: 6,
      width: 128,
      height: 78,
    })
  })

  it('serializes escaped text, viewBox, theme text, and solid background', () => {
    const measure = vi.fn((text: string) => text.length * 8)
    const svg = serializeCanvasSceneSvg({
      scene: sceneFrom([rectangle()]),
      theme: 'dark',
      background: 'solid',
      backgroundColor: '#020617',
      measureText: measure,
    })

    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('fill="#020617"')
    expect(svg).toContain('A&amp;B &lt;node&gt;')
    expect(svg).toContain('viewBox="-4 6 128 78"')
    expect(measure).toHaveBeenCalled()
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
})
