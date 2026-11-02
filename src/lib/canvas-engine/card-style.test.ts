import { describe, expect, it } from 'vitest'
import {
  CARD,
  CARD_ACCENT_BORDER_WIDTH,
  CARD_EDGE_WIDTH,
  CARD_RADIUS,
  CARD_TOP_ROW,
  cardConnectorPaint,
  cardShapePaint,
  cardTextStyle,
  cardTopRowHeight,
  contrastRatio,
  parseCssColor,
  relativeLuminance,
  tintedSurface,
} from './card-style'
import {
  fittedTextHeight,
  layoutElementText,
  renderPersistentScene,
  textFrame,
  textOriginY,
} from './render'
import { DEFAULT_ELEMENT_STYLE, sceneFrom } from './scene'
import type { CardLook } from './card-style'
import type {
  CanvasFontSpec,
  PersistentRenderTarget,
  RenderPaint,
} from './render-target'
import type { CanvasElement, CanvasElementStyle } from './scene'

const LOOK: CardLook = { diagramStyle: 'card', theme: 'dark' }

function el(
  patch: Omit<Partial<CanvasElement>, 'style'> & {
    style?: Partial<CanvasElementStyle>
  } = {},
): CanvasElement {
  const { style, ...rest } = patch
  return {
    id: 'a',
    kind: 'rectangle',
    x: 10,
    y: 20,
    width: 200,
    height: 100,
    rotation: 0,
    zIndex: 0,
    text: null,
    ...rest,
    style: { ...DEFAULT_ELEMENT_STYLE, ...style },
  }
}

describe('parseCssColor', () => {
  it('reads hex in 3, 4, 6 and 8 digit forms', () => {
    expect(parseCssColor('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseCssColor('#0f08')).toEqual({ r: 0, g: 255, b: 0 })
    expect(parseCssColor('#3b82f6')).toEqual({ r: 59, g: 130, b: 246 })
    expect(parseCssColor('#3b82f680')).toEqual({ r: 59, g: 130, b: 246 })
  })

  it('reads rgb() and rgba() and drops alpha', () => {
    expect(parseCssColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3 })
    expect(parseCssColor('rgba(59, 130, 246, 0.10)')).toEqual({
      r: 59,
      g: 130,
      b: 246,
    })
  })

  it('rejects anything it cannot read', () => {
    expect(parseCssColor('tomato')).toBeNull()
    expect(parseCssColor('#12')).toBeNull()
    expect(parseCssColor('rgb(1, 2)')).toBeNull()
    expect(parseCssColor('hsl(10, 10%, 10%)')).toBeNull()
  })
})

describe('fill tint', () => {
  it('gives the plain surface for the default fill', () => {
    expect(tintedSurface(DEFAULT_ELEMENT_STYLE.fill, 'dark')).toBe(
      CARD.dark.surface,
    )
  })

  it('mixes a swatch at 14% over the surface', () => {
    // r: 22 + (255 - 22) * 0.14 = 55; g: 26 * 0.86 = 22; b: 35 * 0.86 = 30.
    const tint = tintedSurface('#ff0000', 'dark')
    expect(tint).toBe('#37161e')
    expect(tint).not.toBe(CARD.dark.surface)
  })

  it('gives the plain surface for an unparseable colour', () => {
    expect(tintedSurface('tomato', 'light')).toBe(CARD.light.surface)
  })

  it('keeps a transparent body for fill none', () => {
    const { paint } = cardShapePaint(el({ style: { fill: 'none' } }), 'dark')
    expect(paint.fill).toBeUndefined()
    expect(paint.shadow).toBeUndefined()
  })
})

describe('cardShapePaint', () => {
  it('paints a plain surface, hairline border and shadow by default', () => {
    const { paint, radius } = cardShapePaint(el(), 'dark')
    expect(paint).toMatchObject({
      fill: CARD.dark.surface,
      stroke: CARD.dark.border,
      strokeWidth: 1,
      shadow: CARD.dark.shadow,
    })
    expect(paint.dash).toBeUndefined()
    expect(radius).toBe(CARD_RADIUS)
  })

  it('keeps an explicit square rectangle square', () => {
    const { radius } = cardShapePaint(
      el({ style: { cornerRadius: 0 } }),
      'light',
    )
    expect(radius).toBe(0)
  })

  it('caps the radius at half the shorter side', () => {
    const { radius } = cardShapePaint(el({ height: 20 }), 'light')
    expect(radius).toBe(10)
  })

  it('auto shadow is on, except for a note', () => {
    expect(cardShapePaint(el(), 'dark').paint.shadow).toBeDefined()
    const note = cardShapePaint(el({ style: { role: 'note' } }), 'dark').paint
    expect(note.shadow).toBeUndefined()
    expect(note.dash).toEqual([6, 4])
  })

  it('on and off force the shadow either way', () => {
    expect(
      cardShapePaint(el({ style: { cardShadow: 'off' } }), 'dark').paint.shadow,
    ).toBeUndefined()
    expect(
      cardShapePaint(el({ style: { role: 'note', cardShadow: 'on' } }), 'dark')
        .paint.shadow,
    ).toBeDefined()
  })

  it('accent border takes the role colour, else the stored stroke', () => {
    const withRole = cardShapePaint(
      el({ style: { cardBorder: 'accent', role: 'system' } }),
      'dark',
    ).paint
    expect(withRole.stroke).toBe(CARD.dark.roles.system)
    expect(withRole.strokeWidth).toBe(CARD_ACCENT_BORDER_WIDTH)

    const noRole = cardShapePaint(
      el({ style: { cardBorder: 'accent', stroke: '#ff00aa' } }),
      'dark',
    ).paint
    expect(noRole.stroke).toBe('#ff00aa')
  })

  it('accent border on an ellipse with no stored role uses the trigger colour', () => {
    const { paint } = cardShapePaint(
      el({ kind: 'ellipse', style: { cardBorder: 'accent' } }),
      'light',
    )
    expect(paint.stroke).toBe(CARD.light.roles.trigger)
  })

  it('draws no stroke when the stroke width is 0', () => {
    const { paint } = cardShapePaint(el({ style: { strokeWidth: 0 } }), 'dark')
    expect(paint.stroke).toBeUndefined()
  })
})

describe('cardConnectorPaint', () => {
  it('turns the default stroke into the neutral edge', () => {
    expect(cardConnectorPaint(DEFAULT_ELEMENT_STYLE, 'dark')).toEqual({
      stroke: CARD.dark.edge,
      strokeWidth: CARD_EDGE_WIDTH,
    })
  })

  it('keeps a stroke the user chose', () => {
    expect(
      cardConnectorPaint(
        { ...DEFAULT_ELEMENT_STYLE, stroke: '#ff0000', strokeWidth: 4 },
        'dark',
      ),
    ).toEqual({ stroke: '#ff0000', strokeWidth: 4 })
  })
})

describe('top row and text frame', () => {
  it('reserves the row for a rectangle with a role or a step', () => {
    expect(cardTopRowHeight(el(), LOOK)).toBe(0)
    expect(cardTopRowHeight(el({ style: { role: 'data' } }), LOOK)).toBe(
      CARD_TOP_ROW,
    )
    expect(cardTopRowHeight(el({ style: { step: '02' } }), LOOK)).toBe(
      CARD_TOP_ROW,
    )
  })

  it('an ellipse derives a trigger chip unless role is none', () => {
    expect(cardTopRowHeight(el({ kind: 'ellipse' }), LOOK)).toBe(CARD_TOP_ROW)
    expect(
      cardTopRowHeight(el({ kind: 'ellipse', style: { role: 'none' } }), LOOK),
    ).toBe(0)
    expect(
      cardTopRowHeight(
        el({ kind: 'ellipse', style: { role: 'none', step: '1' } }),
        LOOK,
      ),
    ).toBe(CARD_TOP_ROW)
  })

  it('diamonds and triangles never get a row', () => {
    for (const kind of ['diamond', 'triangle'] as const) {
      expect(
        cardTopRowHeight(el({ kind, style: { role: 'data' } }), LOOK),
      ).toBe(0)
    }
  })

  it('classic reserves nothing', () => {
    const element = el({ style: { role: 'data', step: '1' } })
    expect(cardTopRowHeight(element, undefined)).toBe(0)
    expect(
      cardTopRowHeight(element, { diagramStyle: 'classic', theme: 'dark' }),
    ).toBe(0)
  })

  it('shifts the frame, origin and fitted height by the same row', () => {
    const element = el({ text: 'Title', style: { role: 'action' } })
    const measure = (value: string) => value.length * 8
    const classicFrame = textFrame(element)
    const cardFrame = textFrame(element, LOOK)
    expect(cardFrame.y - classicFrame.y).toBe(CARD_TOP_ROW)
    expect(cardFrame.maxWidth).toBe(classicFrame.maxWidth)

    const layout = layoutElementText(element, measure, LOOK)
    expect(
      textOriginY(element, layout, LOOK) - textOriginY(element, layout),
    ).toBe(CARD_TOP_ROW)
    expect(
      fittedTextHeight(element, measure, LOOK) -
        fittedTextHeight(element, measure),
    ).toBeGreaterThanOrEqual(CARD_TOP_ROW)
  })
})

describe('cardTextStyle', () => {
  const text = 'Title\nbody line'

  it('bolds the first line and mutes the rest', () => {
    const style = cardTextStyle(el({ text }), LOOK)
    expect(style.textRuns).toEqual([
      { start: 0, end: 5, fontWeight: 'bold' },
      { start: 6, end: text.length, color: CARD.dark.muted },
    ])
  })

  it('lets an explicit run win', () => {
    const style = cardTextStyle(
      el({
        text,
        style: {
          textRuns: [
            { start: 0, end: 5, fontWeight: 'normal', color: '#fbbf24' },
          ],
        },
      }),
      LOOK,
    )
    expect(style.textRuns[0]).toMatchObject({
      start: 0,
      end: 5,
      fontWeight: 'normal',
      color: '#fbbf24',
    })
  })

  it('leaves a user colour alone', () => {
    const style = cardTextStyle(el({ text, style: { color: '#e0f2fe' } }), LOOK)
    expect(style.textRuns).toEqual([{ start: 0, end: 5, fontWeight: 'bold' }])
  })

  it('does nothing for classic, for non-shape kinds or for empty text', () => {
    const plain = el({ text })
    expect(cardTextStyle(plain, undefined)).toBe(plain.style)
    expect(cardTextStyle(el({ kind: 'text', text }), LOOK).textRuns).toEqual([])
    expect(cardTextStyle(el({ text: '' }), LOOK).textRuns).toEqual([])
  })

  it('measures the bold weight in the layout', () => {
    const widths: Array<string> = []
    const measure = (value: string, spec?: CanvasFontSpec) => {
      widths.push(`${spec?.fontWeight ?? 'base'}:${value}`)
      return value.length * 8
    }
    layoutElementText(el({ text: 'Title' }), measure, LOOK)
    expect(widths.some((entry) => entry.startsWith('bold:'))).toBe(true)
  })
})

class Recorder implements PersistentRenderTarget {
  calls: Array<{ kind: string; payload: unknown }> = []
  measureText(text: string, spec: CanvasFontSpec) {
    return text.length * spec.fontSize * 0.5
  }
  rect(
    _x: number,
    _y: number,
    _width: number,
    _height: number,
    radius: number,
    paint: RenderPaint,
  ) {
    this.calls.push({ kind: 'rect', payload: { radius, paint } })
  }
  ellipse(cx: number, cy: number, rx: number, _ry: number, paint: RenderPaint) {
    this.calls.push({ kind: 'ellipse', payload: { cx, cy, rx, paint } })
  }
  beginPath() {}
  moveTo() {}
  lineTo() {}
  cubicTo() {}
  closePath() {}
  paintPath(paint: RenderPaint) {
    this.calls.push({ kind: 'path', payload: { paint } })
  }
  beginText(spec: CanvasFontSpec, color: string) {
    this.calls.push({ kind: 'beginText', payload: { spec, color } })
  }
  textLine(text: string, x: number, y: number) {
    this.calls.push({ kind: 'line', payload: { text, x, y } })
  }
  textPiece(
    text: string,
    _x: number,
    _y: number,
    spec: CanvasFontSpec,
    color: string,
  ) {
    this.calls.push({ kind: 'piece', payload: { text, color, spec } })
  }
  textDecoration() {}
  endText() {}
  beginFade() {}
  endFade() {}
}

describe('card render', () => {
  it('classic paints exactly the stored style (zero diff)', () => {
    const scene = sceneFrom([el({ text: 'Hi' })])
    const classic = new Recorder()
    renderPersistentScene(classic, scene, 'dark')
    const explicit = new Recorder()
    renderPersistentScene(
      explicit,
      scene,
      'dark',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'classic',
    )
    expect(explicit.calls).toEqual(classic.calls)
    expect(classic.calls[0]).toEqual({
      kind: 'rect',
      payload: {
        radius: 8,
        paint: {
          fill: DEFAULT_ELEMENT_STYLE.fill,
          stroke: DEFAULT_ELEMENT_STYLE.stroke,
          strokeWidth: 2,
        },
      },
    })
  })

  it('card paints the surface, shadow and the chip row', () => {
    const rec = new Recorder()
    renderPersistentScene(
      rec,
      sceneFrom([el({ text: 'Hi', style: { role: 'system', step: '02' } })]),
      'light',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'card',
    )
    expect(rec.calls[0]).toMatchObject({
      kind: 'rect',
      payload: { radius: 14, paint: { fill: '#ffffff' } },
    })
    expect(rec.calls[1]).toMatchObject({
      kind: 'ellipse',
      payload: { paint: { fill: CARD.light.roles.system } },
    })
    const lines = rec.calls.filter((call) => call.kind === 'line')
    expect(
      lines.map((call) => (call.payload as { text: string }).text),
    ).toEqual(['系統', '02'])
    // The label is laid out below the chip row, as a bold run.
    expect(rec.calls.some((call) => call.kind === 'piece')).toBe(true)
  })

  it('card connectors use the neutral edge and keep the chevron', () => {
    const scene = sceneFrom([
      el({ id: 'a', x: 0, y: 0, width: 100, height: 100 }),
      el({ id: 'b', x: 300, y: 0, width: 100, height: 100 }),
      el({
        id: 'c',
        kind: 'connector',
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        connector: {
          source: { kind: 'element', elementId: 'a' },
          target: { kind: 'element', elementId: 'b' },
          routing: 'straight',
        },
      }),
    ])
    const rec = new Recorder()
    renderPersistentScene(
      rec,
      scene,
      'dark',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'card',
    )
    const paths = rec.calls.filter((call) => call.kind === 'path')
    expect(paths).toHaveLength(2)
    expect((paths[0].payload as { paint: RenderPaint }).paint).toMatchObject({
      stroke: CARD.dark.edge,
      strokeWidth: CARD_EDGE_WIDTH,
    })
    expect((paths[1].payload as { paint: RenderPaint }).paint).toMatchObject({
      stroke: CARD.dark.edge,
      lineJoin: 'round',
    })
  })
})

describe('contrast guard and neutral fills', () => {
  const REPRO_TEXT = ['#1f2937', '#1d4ed8', '#334155']
  const REPRO_FILLS = ['#ffffff', '#f8fafc', '#eef1f5']
  const text = 'Title\nbody line'
  const DARK: CardLook = { diagramStyle: 'card', theme: 'dark' }
  const LIGHT: CardLook = { diagramStyle: 'card', theme: 'light' }

  it('relativeLuminance and contrastRatio match WCAG', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5)
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0)
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 3)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    expect(contrastRatio('tomato', '#ffffff')).toBeNull()
  })

  it('gives near-white fills the plain surface in both themes', () => {
    for (const fill of [...REPRO_FILLS, '#f1f5f9', 'rgb(250, 250, 250)']) {
      expect(tintedSurface(fill, 'dark')).toBe(CARD.dark.surface)
      expect(tintedSurface(fill, 'light')).toBe(CARD.light.surface)
    }
  })

  it('still tints light blue and the palette swatches (blue is the default fill)', () => {
    expect(tintedSurface('#dbeafe', 'dark')).not.toBe(CARD.dark.surface)
    for (const swatch of [
      'rgba(100, 116, 139, 0.10)',
      'rgba(239, 68, 68, 0.10)',
      'rgba(249, 115, 22, 0.10)',
      'rgba(245, 158, 11, 0.10)',
      'rgba(34, 197, 94, 0.10)',
      'rgba(20, 184, 166, 0.10)',
      'rgba(139, 92, 246, 0.10)',
    ]) {
      expect(tintedSurface(swatch, 'dark')).not.toBe(CARD.dark.surface)
      expect(tintedSurface(swatch, 'light')).not.toBe(CARD.light.surface)
    }
  })

  it('treats REPRO label colours as unset on a dark card', () => {
    for (const color of REPRO_TEXT) {
      for (const fill of [...REPRO_FILLS, '#dbeafe']) {
        const style = cardTextStyle(el({ text, style: { color, fill } }), DARK)
        expect(style.textRuns).toEqual([
          { start: 0, end: 5, fontWeight: 'bold', color: CARD.dark.text },
          { start: 6, end: text.length, color: CARD.dark.muted },
        ])
      }
    }
  })

  it('keeps REPRO label colours that read on a light card', () => {
    for (const color of REPRO_TEXT) {
      const style = cardTextStyle(
        el({ text, style: { color, fill: '#ffffff' } }),
        LIGHT,
      )
      expect(style.textRuns).toEqual([{ start: 0, end: 5, fontWeight: 'bold' }])
    }
  })

  it('replaces a light-theme-unreadable label colour with the theme text', () => {
    const style = cardTextStyle(
      el({ text, style: { color: '#fefefe', fill: '#ffffff' } }),
      LIGHT,
    )
    expect(style.textRuns).toEqual([
      { start: 0, end: 5, fontWeight: 'bold', color: CARD.light.text },
      { start: 6, end: text.length, color: CARD.light.muted },
    ])
  })

  it('drops a low-contrast run colour and keeps a readable one', () => {
    const dropped = cardTextStyle(
      el({
        text,
        style: { textRuns: [{ start: 0, end: 5, color: '#1f2937' }] },
      }),
      DARK,
    )
    expect(dropped.textRuns[0]).toEqual({
      start: 0,
      end: 5,
      fontWeight: 'bold',
    })
    const kept = cardTextStyle(
      el({
        text,
        style: { textRuns: [{ start: 0, end: 5, color: '#fbbf24' }] },
      }),
      DARK,
    )
    expect(kept.textRuns[0]).toMatchObject({ color: '#fbbf24' })
  })

  it('leaves classic untouched', () => {
    const legacy = el({ text, style: { color: '#1f2937', fill: '#f8fafc' } })
    expect(cardTextStyle(legacy, undefined)).toBe(legacy.style)
    expect(
      cardTextStyle(legacy, { diagramStyle: 'classic', theme: 'dark' }),
    ).toBe(legacy.style)
  })
})
