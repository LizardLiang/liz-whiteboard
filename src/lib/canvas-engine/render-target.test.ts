import { describe, expect, it } from 'vitest'
import { renderPersistentScene } from './render'
import { sceneFrom } from './scene'
import type {
  CanvasFontSpec,
  PersistentRenderTarget,
  RenderPaint,
  RenderPathCommand,
  RenderTextLine,
} from './render-target'
import type { CanvasElement } from './scene'

class RecordingTarget implements PersistentRenderTarget {
  calls: Array<{ kind: string; payload: unknown }> = []
  private commands: Array<RenderPathCommand> = []
  private lines: Array<RenderTextLine> = []
  private fontSize = 0
  private fontWeight = 'normal'
  private fontStyle = 'normal'
  private color = ''

  measureText(text: string, spec: CanvasFontSpec) {
    return text.length * spec.fontSize * 0.5
  }

  rect(
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    paint: RenderPaint,
  ) {
    this.calls.push({
      kind: 'rect',
      payload: { x, y, width, height, radius, paint },
    })
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, paint: RenderPaint) {
    this.calls.push({ kind: 'ellipse', payload: { cx, cy, rx, ry, paint } })
  }

  beginPath() {
    this.commands = []
  }

  moveTo(x: number, y: number) {
    this.commands.push({ kind: 'move', point: { x, y } })
  }

  lineTo(x: number, y: number) {
    this.commands.push({ kind: 'line', point: { x, y } })
  }

  cubicTo(
    c0x: number,
    c0y: number,
    c1x: number,
    c1y: number,
    x: number,
    y: number,
  ) {
    this.commands.push({
      kind: 'cubic',
      c0: { x: c0x, y: c0y },
      c1: { x: c1x, y: c1y },
      to: { x, y },
    })
  }

  closePath() {
    this.commands.push({ kind: 'close' })
  }

  paintPath(paint: RenderPaint) {
    this.calls.push({
      kind: 'path',
      payload: { commands: this.commands, paint },
    })
  }

  beginText(spec: CanvasFontSpec, color: string) {
    this.lines = []
    this.fontSize = spec.fontSize
    this.fontWeight = spec.fontWeight
    this.fontStyle = spec.fontStyle
    this.color = color
  }

  textLine(text: string, x: number, y: number) {
    this.lines.push({ text, x, y })
  }

  endText() {
    this.calls.push({
      kind: 'text',
      payload: {
        lines: this.lines,
        fontSize: this.fontSize,
        fontWeight: this.fontWeight,
        fontStyle: this.fontStyle,
        color: this.color,
      },
    })
  }

  textPiece(
    text: string,
    x: number,
    y: number,
    spec: CanvasFontSpec,
    color: string,
  ) {
    this.calls.push({
      kind: 'piece',
      payload: { text, x, y, spec, color },
    })
  }

  textDecoration(x: number, y: number, width: number, thickness: number) {
    this.calls.push({
      kind: 'decoration',
      payload: { x, y, width, thickness },
    })
  }
}

const baseStyle = {
  fill: '#fff',
  stroke: '#123456',
  strokeWidth: 2,
  fontSize: 16,
  color: '#0f172a',
  cornerRadius: 8,
  textAlign: 'center' as const,
  verticalAlign: 'middle' as const,
  fontWeight: 'normal' as const,
  fontStyle: 'normal' as const,
  underline: false,
  strikethrough: false,
  textRuns: [],
}

function element(patch: Partial<CanvasElement>): CanvasElement {
  return {
    id: 'shape',
    kind: 'rectangle',
    x: 10,
    y: 20,
    width: 120,
    height: 80,
    rotation: 0,
    zIndex: 1,
    text: 'hello world',
    style: baseStyle,
    ...patch,
  }
}

describe('renderPersistentScene', () => {
  it('returns only the requested editing layout instead of a scene-wide layout map', () => {
    const recorder = new RecordingTarget()
    const scene = sceneFrom([
      element({ id: 'first', text: 'first' }),
      element({ id: 'editing', text: 'edit me' }),
      element({ id: 'last', text: 'last' }),
    ])

    const editingLayout = renderPersistentScene(
      recorder,
      scene,
      'light',
      new Set(),
      'editing',
    )

    expect(editingLayout).toMatchObject({
      lines: [{ text: 'edit me' }],
    })
    expect(editingLayout).not.toBeInstanceOf(Map)
  })

  it('emits exact rectangle paint, wrapped alignment, and theme-resolved text', () => {
    const recorder = new RecordingTarget()
    renderPersistentScene(
      recorder,
      sceneFrom([
        element({
          width: 60,
          text: 'alpha beta',
          style: {
            ...baseStyle,
            textAlign: 'right',
            verticalAlign: 'bottom',
          },
        }),
      ]),
      'dark',
    )

    expect(recorder.calls).toEqual([
      {
        kind: 'rect',
        payload: {
          x: 10,
          y: 20,
          width: 60,
          height: 80,
          radius: 8,
          paint: { fill: '#fff', stroke: '#123456', strokeWidth: 2 },
        },
      },
      {
        kind: 'text',
        payload: {
          lines: [
            { text: 'alpha', x: 22, y: 47.2 },
            { text: ' beta', x: 22, y: 69.6 },
          ],
          fontSize: 16,
          fontWeight: 'normal',
          fontStyle: 'normal',
          color: '#f8fafc',
        },
      },
    ])
  })

  it('hands the label font weight and style to the target', () => {
    const recorder = new RecordingTarget()
    renderPersistentScene(
      recorder,
      sceneFrom([
        element({
          style: { ...baseStyle, fontWeight: 'bold', fontStyle: 'italic' },
        }),
      ]),
      'light',
    )
    expect(recorder.calls.find((call) => call.kind === 'text')).toMatchObject({
      payload: { fontWeight: 'bold', fontStyle: 'italic' },
    })
  })

  it('draws no decoration for plain text', () => {
    const recorder = new RecordingTarget()
    renderPersistentScene(recorder, sceneFrom([element({})]), 'light')
    expect(recorder.calls.some((call) => call.kind === 'decoration')).toBe(
      false,
    )
  })

  it('draws an underline and a strikethrough per wrapped line, spanning that line', () => {
    const recorder = new RecordingTarget()
    renderPersistentScene(
      recorder,
      sceneFrom([
        element({
          width: 60,
          style: { ...baseStyle, underline: true, strikethrough: true },
        }),
      ]),
      'light',
    )
    const text = recorder.calls.find((call) => call.kind === 'text')
    const lines = (text!.payload as { lines: Array<RenderTextLine> }).lines
    const decorations = recorder.calls
      .filter((call) => call.kind === 'decoration')
      .map((call) => call.payload as Record<string, number>)
    expect(lines.length).toBeGreaterThan(1)
    // Two bars per wrapped line (underline, then strikethrough), each as wide
    // as that line's glyphs (the test metric is 8px per character) and
    // starting where that line starts.
    expect(decorations).toHaveLength(lines.length * 2)
    const thickness = 16 / 14
    lines.forEach((line, index) => {
      const [underline, strike] = decorations.slice(index * 2, index * 2 + 2)
      expect(underline).toMatchObject({
        x: line.x,
        width: line.text.length * 8,
        thickness,
      })
      expect(underline.y).toBeCloseTo(line.y + 16 * 0.92)
      expect(strike).toMatchObject({
        x: line.x,
        width: line.text.length * 8,
        thickness,
      })
      expect(strike.y).toBeCloseTo(line.y + 16 * 0.55)
    })
  })

  it('emits a persistent group frame with exact resting and emphasized theme paint', () => {
    const group = element({
      id: 'group',
      kind: 'group',
      text: null,
      group: { childIds: [] },
    })
    const resting = new RecordingTarget()
    const emphasized = new RecordingTarget()

    renderPersistentScene(resting, sceneFrom([group]), 'light')
    renderPersistentScene(
      emphasized,
      sceneFrom([group]),
      'dark',
      new Set(['group']),
    )

    expect(resting.calls).toEqual([
      {
        kind: 'rect',
        payload: {
          x: 10,
          y: 20,
          width: 120,
          height: 80,
          radius: 0,
          paint: { stroke: 'rgba(59, 130, 246, 0.10)', strokeWidth: 1 },
        },
      },
    ])
    expect(emphasized.calls[0]).toMatchObject({
      payload: { paint: { stroke: '#60a5fa', strokeWidth: 1 } },
    })
  })

  it.each([
    ['straight', 'line'],
    ['curved', 'cubic'],
  ] as const)(
    'emits exact %s connector geometry and matching line/head paint',
    (routing, segmentKind) => {
      const recorder = new RecordingTarget()
      renderPersistentScene(
        recorder,
        sceneFrom([
          element({
            kind: 'connector',
            text: null,
            connector: {
              source: { kind: 'point', point: { x: 0, y: 0 } },
              target: { kind: 'point', point: { x: 100, y: 0 } },
              routing,
            },
          }),
        ]),
        'light',
      )

      expect(recorder.calls).toHaveLength(2)
      expect(recorder.calls[0]).toMatchObject({
        kind: 'path',
        payload: {
          commands: [
            { kind: 'move', point: { x: 0, y: 0 } },
            { kind: segmentKind },
          ],
          paint: { stroke: '#123456', strokeWidth: 2 },
        },
      })
      expect(recorder.calls[1]).toMatchObject({
        kind: 'path',
        payload: {
          commands: [
            { kind: 'move' },
            { kind: 'line', point: { x: 100, y: 0 } },
            { kind: 'line' },
          ],
          paint: {
            stroke: '#123456',
            strokeWidth: 2,
            lineJoin: 'round',
            lineCap: 'round',
          },
        },
      })
    },
  )

  it('emits connectors before shapes and keeps text layout above the target boundary', () => {
    const source = element({ id: 'source', x: 0, y: 0, zIndex: 0 })
    const target = element({ id: 'target', x: 300, y: 0, zIndex: 1 })
    const connector = element({
      id: 'connector',
      kind: 'connector',
      zIndex: 99,
      text: null,
      connector: {
        source: { kind: 'element', elementId: source.id },
        target: { kind: 'element', elementId: target.id },
        routing: 'curved',
      },
    })
    const scene = sceneFrom([source, target, connector])
    const recorder = new RecordingTarget()

    renderPersistentScene(recorder, scene, 'light')

    expect(recorder.calls[0].kind).toBe('path')
    expect(recorder.calls.filter((call) => call.kind === 'text')).toHaveLength(
      2,
    )
    expect(recorder.calls.at(-1)?.kind).toBe('text')
  })

  it.each(['rectangle', 'ellipse', 'diamond', 'triangle'] as const)(
    'emits supported %s geometry',
    (kind) => {
      const recorder = new RecordingTarget()
      renderPersistentScene(recorder, sceneFrom([element({ kind })]), 'dark')
      expect(recorder.calls.some((call) => call.kind !== 'text')).toBe(true)
    },
  )

  it('emits elbow bend points and an explicit open arrowhead', () => {
    const source = element({ id: 'source', x: 0, y: 0 })
    const target = element({ id: 'target', x: 300, y: 160 })
    const connector = element({
      id: 'connector',
      kind: 'connector',
      text: null,
      connector: {
        source: { kind: 'element', elementId: source.id },
        target: { kind: 'element', elementId: target.id },
        routing: 'elbow',
      },
    })
    const recorder = new RecordingTarget()
    renderPersistentScene(
      recorder,
      sceneFrom([source, target, connector]),
      'light',
    )

    const connectorPaths = recorder.calls.filter((call) => call.kind === 'path')
    expect(connectorPaths).toHaveLength(2)
    expect(connectorPaths[1].payload).toMatchObject({
      paint: { lineCap: 'round', lineJoin: 'round' },
    })
  })

  it('emits no path for a connector with no visible stroke', () => {
    const connector = element({
      kind: 'connector',
      text: null,
      style: { ...baseStyle, strokeWidth: 0 },
      connector: {
        source: { kind: 'point', point: { x: 0, y: 0 } },
        target: { kind: 'point', point: { x: 100, y: 100 } },
        routing: 'straight',
      },
    })
    const recorder = new RecordingTarget()

    renderPersistentScene(recorder, sceneFrom([connector]), 'light')

    expect(recorder.calls).toEqual([])
  })

  it('draws a run-styled label piece by piece on a shared baseline', () => {
    const recorder = new RecordingTarget()
    renderPersistentScene(
      recorder,
      sceneFrom([
        element({
          width: 200,
          height: 100,
          text: 'abcd',
          style: {
            ...baseStyle,
            textAlign: 'left',
            verticalAlign: 'top',
            textRuns: [
              {
                start: 2,
                end: 4,
                fontSize: 32,
                fontWeight: 'bold',
                underline: true,
                color: '#ef4444',
              },
            ],
          },
        }),
      ]),
      'light',
    )

    const pieces = recorder.calls.filter((call) => call.kind === 'piece')
    // Plain 16px 'ab' is 16 wide; the 32px run is 2 * 16 wide at x = 18 + 16.
    // The 16px piece sits (32 - 16) * 0.8 = 12.8 below the 32px piece's top.
    expect(pieces.map((call) => call.payload)).toEqual([
      {
        text: 'ab',
        x: 18,
        y: 28 + 12.8,
        spec: { fontSize: 16, fontWeight: 'normal', fontStyle: 'normal' },
        color: '#0f172a',
      },
      {
        text: 'cd',
        x: 34,
        y: 28,
        spec: { fontSize: 32, fontWeight: 'bold', fontStyle: 'normal' },
        color: '#ef4444',
      },
    ])
    // Only the run is underlined, at its own font size.
    expect(recorder.calls.filter((call) => call.kind === 'decoration')).toEqual(
      [
        {
          kind: 'decoration',
          payload: { x: 34, y: 28 + 32 * 0.92, width: 32, thickness: 32 / 14 },
        },
      ],
    )
  })
})
