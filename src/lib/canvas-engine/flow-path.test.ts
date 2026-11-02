import { describe, expect, it } from 'vitest'
import { flowPath, pointAlongPath } from './flow-path'
import { DEFAULT_ELEMENT_STYLE, sceneFrom } from './scene'
import type { CanvasElement, ConnectorEndpoint } from './scene'

function shape(id: string): CanvasElement {
  return {
    id,
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    rotation: 0,
    zIndex: 0,
    text: null,
    style: { ...DEFAULT_ELEMENT_STYLE },
  }
}

const at = (elementId: string): ConnectorEndpoint => ({
  kind: 'element',
  elementId,
})
const free: ConnectorEndpoint = { kind: 'point', point: { x: 500, y: 500 } }

function link(
  id: string,
  source: ConnectorEndpoint,
  target: ConnectorEndpoint,
): CanvasElement {
  return {
    ...shape(id),
    kind: 'connector',
    width: 1,
    height: 1,
    connector: { source, target, routing: 'straight' },
  }
}

const sorted = (set: Set<string>) => [...set].sort()

describe('flowPath', () => {
  const chain = sceneFrom([
    shape('a'),
    shape('b'),
    shape('c'),
    link('ab', at('a'), at('b')),
    link('bc', at('b'), at('c')),
  ])

  it('walks upstream and downstream along a chain', () => {
    const path = flowPath(chain, 'b')
    expect(sorted(path.elements)).toEqual(['a', 'b', 'c'])
    expect(sorted(path.connectors)).toEqual(['ab', 'bc'])
  })

  it('walks from either end of a chain', () => {
    expect(sorted(flowPath(chain, 'c').elements)).toEqual(['a', 'b', 'c'])
    expect(flowPath(chain, 'a').connectors.size).toBe(2)
  })

  it('leaves a sibling branch off the path', () => {
    const scene = sceneFrom([
      shape('a'),
      shape('b'),
      shape('c'),
      shape('d'),
      link('ab', at('a'), at('b')),
      link('bc', at('b'), at('c')),
      link('ad', at('a'), at('d')),
    ])
    const path = flowPath(scene, 'b')
    expect(sorted(path.elements)).toEqual(['a', 'b', 'c'])
    expect(path.connectors.has('ad')).toBe(false)
  })

  it('ends on a cycle instead of looping', () => {
    const scene = sceneFrom([
      shape('a'),
      shape('b'),
      link('ab', at('a'), at('b')),
      link('ba', at('b'), at('a')),
    ])
    const path = flowPath(scene, 'a')
    expect(sorted(path.elements)).toEqual(['a', 'b'])
    expect(sorted(path.connectors)).toEqual(['ab', 'ba'])
  })

  it('includes a connector with a free end without walking past it', () => {
    const scene = sceneFrom([
      shape('a'),
      link('out', at('a'), free),
      link('in', free, at('a')),
    ])
    const path = flowPath(scene, 'a')
    expect(sorted(path.elements)).toEqual(['a'])
    expect(sorted(path.connectors)).toEqual(['in', 'out'])
  })

  it('gives an empty path for a missing id or a connector id', () => {
    expect(flowPath(chain, 'nope').elements.size).toBe(0)
    expect(flowPath(chain, 'ab').connectors.size).toBe(0)
  })

  it('ignores a connector whose far element is gone', () => {
    const scene = sceneFrom([shape('a'), link('ax', at('a'), at('gone'))])
    const path = flowPath(scene, 'a')
    expect(sorted(path.elements)).toEqual(['a'])
    expect(sorted(path.connectors)).toEqual(['ax'])
  })
})

describe('pointAlongPath', () => {
  const path = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ]
  it('finds a point by length across segments', () => {
    expect(pointAlongPath(path, 0)).toEqual({ x: 0, y: 0 })
    expect(pointAlongPath(path, 0.25)).toEqual({ x: 5, y: 0 })
    expect(pointAlongPath(path, 0.75)).toEqual({ x: 10, y: 5 })
    expect(pointAlongPath(path, 1)).toEqual({ x: 10, y: 10 })
  })
  it('clamps t and rejects empty paths', () => {
    expect(pointAlongPath(path, 4)).toEqual({ x: 10, y: 10 })
    expect(pointAlongPath([{ x: 1, y: 1 }], 0.5)).toBeNull()
    expect(
      pointAlongPath(
        [
          { x: 1, y: 1 },
          { x: 1, y: 1 },
        ],
        0.5,
      ),
    ).toBeNull()
  })
})
