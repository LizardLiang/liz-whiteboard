import { describe, expect, it } from 'vitest'
import { CARD_EDGE_WIDTH } from './card-style'
import { PRESET_RAMPS } from './colour-ramps'
import {
  FLOW_DOT_RADIUS,
  FLOW_FADE,
  FLOW_LINE_WIDTH,
  renderPersistentScene,
} from './render'
import { DEFAULT_ELEMENT_STYLE, sceneFrom } from './scene'
import type { FlowRender } from './render'
import type { PersistentRenderTarget, RenderPaint } from './render-target'
import type { CanvasElement } from './scene'

function recorder() {
  const log: Array<string> = []
  const paints: Array<{ op: string; paint: RenderPaint }> = []
  const noop = () => {}
  const target: PersistentRenderTarget = {
    measureText: (text) => text.length * 8,
    rect: (_x, _y, _w, _h, _r, paint) => {
      log.push('rect')
      paints.push({ op: 'rect', paint })
    },
    ellipse: (cx, cy, rx, _ry, paint) => {
      log.push(`ellipse@${cx},${cy},r${rx}`)
      paints.push({ op: 'ellipse', paint })
    },
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    cubicTo: noop,
    closePath: noop,
    paintPath: (paint) => {
      log.push('path')
      paints.push({ op: 'path', paint })
    },
    beginText: noop,
    textLine: noop,
    textPiece: noop,
    textDecoration: noop,
    endText: noop,
    beginFade: (alpha) => log.push(`fade ${alpha}`),
    endFade: () => log.push('endFade'),
  }
  return { target, log, paints }
}

function shape(id: string, x: number, role: 'trigger' | 'data' | 'system') {
  return {
    id,
    kind: 'rectangle',
    x,
    y: 0,
    width: 100,
    height: 60,
    rotation: 0,
    zIndex: 0,
    text: null,
    style: { ...DEFAULT_ELEMENT_STYLE, role },
  } as CanvasElement
}

function link(id: string, from: string, to: string): CanvasElement {
  return {
    ...shape(id, 0, 'system'),
    kind: 'connector',
    width: 1,
    height: 1,
    connector: {
      source: { kind: 'element', elementId: from },
      target: { kind: 'element', elementId: to },
      routing: 'straight',
    },
  }
}

// a (0..100) -> b (300..400); c far away and unlinked
const scene = sceneFrom([
  shape('a', 0, 'trigger'),
  {
    ...shape('b', 300, 'data'),
    style: { ...DEFAULT_ELEMENT_STYLE, role: 'data', fill: '#00a2c7' },
  },
  shape('c', 600, 'system'),
  link('ab', 'a', 'b'),
])

function draw(flow: FlowRender | null, style: 'card' | 'classic' = 'card') {
  const rec = recorder()
  renderPersistentScene(
    rec.target,
    scene,
    'dark',
    undefined,
    undefined,
    null,
    undefined,
    null,
    style,
    flow,
  )
  return rec
}

const lit: FlowRender = {
  elements: new Set(['a', 'b']),
  connectors: new Set(['ab']),
  dotPhase: 0.5,
}
const hasDot = (log: Array<string>) =>
  log.some(
    (entry) =>
      entry.startsWith('ellipse@') && entry.endsWith(`r${FLOW_DOT_RADIUS}`),
  )

describe('flow path render', () => {
  it('draws a resting connector in the target ramp colour at the edge width', () => {
    const { paints } = draw(null)
    const line = paints.find((entry) => entry.op === 'path')
    expect(line?.paint.stroke).toBe(PRESET_RAMPS.cyan.dark.line)
    expect(line?.paint.strokeWidth).toBe(CARD_EDGE_WIDTH)
  })

  it('keeps a stored non-default connector stroke at rest', () => {
    const custom = sceneFrom([
      shape('a', 0, 'trigger'),
      shape('b', 300, 'data'),
      {
        ...link('ab', 'a', 'b'),
        style: { ...DEFAULT_ELEMENT_STYLE, stroke: '#ff0000', strokeWidth: 4 },
      },
    ])
    const rec = recorder()
    renderPersistentScene(
      rec.target,
      custom,
      'dark',
      undefined,
      undefined,
      null,
      undefined,
      null,
      'card',
    )
    const line = rec.paints.find((entry) => entry.op === 'path')
    expect(line?.paint.stroke).toBe('#ff0000')
    expect(line?.paint.strokeWidth).toBe(4)
  })

  it('lights an on-path connector in the target ramp colour at the lit width', () => {
    const { paints } = draw(lit)
    const line = paints.find((entry) => entry.op === 'path')
    expect(line?.paint.stroke).toBe(PRESET_RAMPS.cyan.dark.line)
    expect(line?.paint.strokeWidth).toBe(FLOW_LINE_WIDTH)
  })

  it('places a dot on the connector in the target ramp colour', () => {
    const { log, paints } = draw(lit)
    expect(hasDot(log)).toBe(true)
    const dot = paints.find(
      (entry) =>
        entry.op === 'ellipse' &&
        entry.paint.fill === PRESET_RAMPS.cyan.dark.line,
    )
    expect(dot).toBeDefined()
  })

  it('fades only elements outside the path', () => {
    const { log } = draw(lit)
    expect(log.filter((entry) => entry === `fade ${FLOW_FADE}`)).toHaveLength(1)
    expect(log.filter((entry) => entry === 'endFade')).toHaveLength(1)
  })

  it('draws no dot for a null phase and no fade without a path', () => {
    expect(hasDot(draw({ ...lit, dotPhase: null }).log)).toBe(false)
    const empty = draw({
      elements: new Set(),
      connectors: new Set(),
      dotPhase: null,
    })
    expect(empty.log.some((entry) => entry.startsWith('fade'))).toBe(false)
  })

  it('draws dots on off-path connectors only in always mode', () => {
    const off: FlowRender = {
      elements: new Set(),
      connectors: new Set(),
      dotPhase: 0.5,
    }
    expect(hasDot(draw(off).log)).toBe(false)
    expect(hasDot(draw({ ...off, dotsAlways: true }).log)).toBe(true)
  })

  it('leaves classic untouched by any flow input', () => {
    const withFlow = draw(lit, 'classic')
    const without = draw(null, 'classic')
    expect(withFlow.log).toEqual(without.log)
    expect(withFlow.paints).toEqual(without.paints)
  })
})
