import { describe, expect, it } from 'vitest'
import { CARD } from './card-style'
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
  shape('b', 300, 'data'),
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
  it('lights an on-path connector in the source role colour at the lit width', () => {
    const { paints } = draw(lit)
    const line = paints.find((entry) => entry.op === 'path')
    expect(line?.paint.stroke).toBe(CARD.dark.roles.trigger)
    expect(line?.paint.strokeWidth).toBe(FLOW_LINE_WIDTH)
  })

  it('places a dot on the connector in the target role colour', () => {
    const { log, paints } = draw(lit)
    expect(hasDot(log)).toBe(true)
    const dot = paints.find(
      (entry) =>
        entry.op === 'ellipse' && entry.paint.fill === CARD.dark.roles.data,
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
