import { describe, expect, it } from 'vitest'
import {
  canvasExportBounds,
  serializeCanvasSceneSvg,
} from '../export/canvas-export'
import { CanvasRenderTarget } from './render-target'
import { DEFAULT_ELEMENT_STYLE, sceneFrom } from './scene'
import type { CanvasElement } from './scene'

function fakeCtx(scale = 1) {
  const log: Array<string> = []
  const ctx: Record<string, unknown> = {
    getTransform: () => ({ a: scale }),
    beginPath: () => log.push('beginPath'),
    moveTo: () => {},
    lineTo: () => {},
    arcTo: () => {},
    closePath: () => {},
    fill: () => log.push(`fill shadowBlur=${ctx.shadowBlur}`),
    stroke: () =>
      log.push(`stroke shadowBlur=${ctx.shadowBlur} dash=${dash.join(',')}`),
    setLineDash: (value: Array<number>) => {
      dash = value
    },
  }
  let dash: Array<number> = []
  return { ctx: ctx as unknown as CanvasRenderingContext2D, raw: ctx, log }
}

describe('CanvasRenderTarget shadow and dash', () => {
  it('scales the shadow by the zoom and clears it before the stroke', () => {
    const { ctx, raw, log } = fakeCtx(2)
    new CanvasRenderTarget(ctx).rect(0, 0, 50, 50, 8, {
      fill: '#fff',
      stroke: '#000',
      strokeWidth: 1,
      shadow: { color: 'rgba(0,0,0,0.5)', blur: 10, offsetY: 4 },
    })
    expect(log).toContain('fill shadowBlur=20')
    expect(log).toContain('stroke shadowBlur=0 dash=')
    expect(raw.shadowOffsetY).toBe(0)
  })

  it('sets the dash for the stroke and resets it', () => {
    const { ctx, log } = fakeCtx()
    new CanvasRenderTarget(ctx).rect(0, 0, 50, 50, 8, {
      stroke: '#000',
      strokeWidth: 1,
      dash: [6, 4],
    })
    expect(log).toContain('stroke shadowBlur=undefined dash=6,4')
  })

  it('paints without a shadow when none is given', () => {
    const { ctx, raw } = fakeCtx()
    new CanvasRenderTarget(ctx).rect(0, 0, 50, 50, 8, { fill: '#fff' })
    expect(raw.shadowBlur).toBeUndefined()
  })
})

function card(patch: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id: 'a',
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 160,
    height: 80,
    rotation: 0,
    zIndex: 0,
    text: 'Title',
    style: { ...DEFAULT_ELEMENT_STYLE },
    ...patch,
  }
}

function svg(
  elements: Array<CanvasElement>,
  diagramStyle?: 'card' | 'classic',
) {
  return serializeCanvasSceneSvg({
    scene: sceneFrom(elements),
    theme: 'light',
    background: 'transparent',
    backgroundColor: '#ffffff',
    measureText: (text) => text.length * 8,
    diagramStyle,
  })
}

describe('SVG export of the card look', () => {
  it('emits one shared drop-shadow filter for several cards', () => {
    const out = svg([card(), card({ id: 'b', x: 300 })], 'card')
    expect(out.match(/<filter /g)).toHaveLength(1)
    expect(out).toContain('feDropShadow')
    expect(out.match(/filter="url\(#card-shadow-1\)"/g)).toHaveLength(2)
  })

  it('emits a dash array for a note and no filter', () => {
    const out = svg(
      [card({ style: { ...DEFAULT_ELEMENT_STYLE, role: 'note' } })],
      'card',
    )
    expect(out).toContain('stroke-dasharray="6 4"')
    expect(out).not.toContain('<filter')
  })

  it('classic export has no defs, filter or dash', () => {
    const out = svg([card()])
    expect(out).not.toContain('<defs>')
    expect(out).not.toContain('filter=')
    expect(out).not.toContain('stroke-dasharray')
    expect(out).toContain(`fill="${DEFAULT_ELEMENT_STYLE.fill}"`)
  })
})

describe('export bounds under the card look', () => {
  it('grows to hold the card shadow', () => {
    const scene = sceneFrom([card()])
    const classic = canvasExportBounds(scene, (text) => text.length * 8)
    const withCard = canvasExportBounds(scene, (text) => text.length * 8, {
      diagramStyle: 'card',
      theme: 'light',
    })
    expect(withCard.width).toBeGreaterThan(classic.width)
  })
})
