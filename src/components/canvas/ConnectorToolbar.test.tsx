// src/components/canvas/ConnectorToolbar.test.tsx
// The routing picker (canvas quick-create-handles tactical plan, Wave 5,
// step 14): when it appears, where it anchors, and what it emits.
//
// The anchor assertions compute the expected point with the SAME
// `connectorPath`/`pathMidpoint`/`worldToScreen` the component uses, rather
// than pinning a literal. A literal here would be a second, independent
// derivation of the transform — precisely the W1/W3 shape this feature has
// been avoiding everywhere else — and it would keep passing after the
// geometry changed and the bar drifted off the line.

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  CONNECTOR_TOOLBAR_OFFSET,
  ConnectorToolbar,
  ROUTING_OPTIONS,
  connectorToolbarTarget,
} from './ConnectorToolbar'
import type {
  CanvasConnectorRouting,
  CanvasElement,
} from '@/lib/canvas-engine/scene'
import type { Camera } from '@/lib/canvas-engine/camera'
import { DEFAULT_CAMERA, worldToScreen } from '@/lib/canvas-engine/camera'
import { CONNECTOR_BEND_HIT } from '@/lib/canvas-engine/render'
import {
  DEFAULT_CONNECTOR_ROUTING,
  DEFAULT_ELEMENT_STYLE,
  bounds,
  sceneFrom,
} from '@/lib/canvas-engine/scene'
import {
  connectorPath,
  pathMidpoint,
} from '@/lib/canvas-engine/connector-geometry'

const A_ID = '11111111-1111-4111-8111-111111111111'
const B_ID = '22222222-2222-4222-8222-222222222222'
const CONNECTOR_ID = '33333333-3333-4333-8333-333333333333'

function rect(
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 100,
): CanvasElement {
  return {
    id,
    kind: 'rectangle',
    x,
    y,
    width,
    height,
    rotation: 0,
    zIndex: 0,
    text: null,
    style: { ...DEFAULT_ELEMENT_STYLE },
  }
}

function connector(
  routing: CanvasConnectorRouting = DEFAULT_CONNECTOR_ROUTING,
  overrides: Partial<CanvasElement> = {},
): CanvasElement {
  return {
    id: CONNECTOR_ID,
    kind: 'connector',
    x: 50,
    y: 50,
    width: 1,
    height: 1,
    rotation: 0,
    zIndex: 1,
    text: null,
    style: { ...DEFAULT_ELEMENT_STYLE },
    connector: {
      source: { kind: 'element', elementId: A_ID },
      target: { kind: 'element', elementId: B_ID },
      routing,
    },
    ...overrides,
  }
}

/** A board with two elements 400 world units apart, joined by a connector. */
function board(routing: CanvasConnectorRouting = DEFAULT_CONNECTOR_ROUTING) {
  return sceneFrom([rect(A_ID, 0, 0), rect(B_ID, 400, 0), connector(routing)])
}

function setup(
  overrides: {
    scene?: ReturnType<typeof board>
    selectedIds?: Set<string>
    camera?: Camera
    readOnly?: boolean
  } = {},
) {
  const onRoutingChange = vi.fn()
  const props = {
    scene: overrides.scene ?? board(),
    selectedIds: overrides.selectedIds ?? new Set([CONNECTOR_ID]),
    camera: overrides.camera ?? DEFAULT_CAMERA,
    readOnly: overrides.readOnly ?? false,
    onRoutingChange,
  }
  const view = render(<ConnectorToolbar {...props} />)
  return { view, props, onRoutingChange }
}

/** Where the bar SHOULD sit, derived the same way the component derives it. */
function expectedAnchor(
  scene: ReturnType<typeof board>,
  routing: CanvasConnectorRouting,
  camera: Camera = DEFAULT_CAMERA,
) {
  const path = connectorPath(
    { rect: bounds(scene.byId.get(A_ID)!) },
    { rect: bounds(scene.byId.get(B_ID)!) },
    routing,
  )
  const midpoint = pathMidpoint(path ?? [])
  return worldToScreen(camera, midpoint as { x: number; y: number })
}

describe('connectorToolbarTarget — when the picker exists at all', () => {
  it('resolves the single selected connector', () => {
    expect(
      connectorToolbarTarget(board(), new Set([CONNECTOR_ID]), false)?.id,
    ).toBe(CONNECTOR_ID)
  })

  it('is null for a read-only board', () => {
    // A viewer shown three buttons that silently do nothing (the server
    // re-checks the role on every mutation) is worse than no buttons.
    expect(
      connectorToolbarTarget(board(), new Set([CONNECTOR_ID]), true),
    ).toBeNull()
  })

  it('is null when the selection is an ordinary element', () => {
    expect(connectorToolbarTarget(board(), new Set([A_ID]), false)).toBeNull()
  })

  it('is null for an empty selection', () => {
    expect(connectorToolbarTarget(board(), new Set(), false)).toBeNull()
  })

  it('is null when more than one thing is selected', () => {
    // The bar names ONE connector by sitting on it; over a multi-selection it
    // would be pointing at something the user did not ask about.
    expect(
      connectorToolbarTarget(board(), new Set([CONNECTOR_ID, A_ID]), false),
    ).toBeNull()
  })

  it('is null when the id is not in the scene', () => {
    expect(
      connectorToolbarTarget(board(), new Set(['no-such-id']), false),
    ).toBeNull()
  })
})

describe('rendering', () => {
  it('renders one button per routing, no more and no fewer', () => {
    setup()
    const toolbar = screen.getByRole('toolbar', { name: 'Connector routing' })
    expect(screen.getAllByRole('button', { hidden: false }).length).toBe(
      ROUTING_OPTIONS.length,
    )
    expect(toolbar).toBeTruthy()
  })

  it('renders nothing at all when there is no target', () => {
    const { view } = setup({ selectedIds: new Set([A_ID]) })
    expect(view.container.innerHTML).toBe('')
  })

  it('renders nothing when the connector has no drawable path', () => {
    // Two elements at the same place have no line between them, so the
    // connector is not drawn either — a bar floating over nothing would be
    // pointing at an invisible connector.
    const overlapping = sceneFrom([
      rect(A_ID, 0, 0),
      rect(B_ID, 0, 0),
      connector(),
    ])
    const { view } = setup({ scene: overlapping })
    expect(view.container.innerHTML).toBe('')
  })

  it('renders nothing when an endpoint is missing entirely', () => {
    const orphaned = sceneFrom([rect(A_ID, 0, 0), connector()])
    const { view } = setup({ scene: orphaned })
    expect(view.container.innerHTML).toBe('')
  })

  it('marks exactly the active routing as pressed', () => {
    setup({ scene: board('elbow') })
    expect(
      screen
        .getByRole('button', { name: 'Elbow connector' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      screen
        .getByRole('button', { name: 'Straight connector' })
        .getAttribute('aria-pressed'),
    ).toBe('false')
    expect(
      screen
        .getByRole('button', { name: 'Curved connector' })
        .getAttribute('aria-pressed'),
    ).toBe('false')
  })

  it('gives every button an accessible name and reachable markup', () => {
    setup()
    for (const { label } of ROUTING_OPTIONS) {
      const button = screen.getByRole('button', { name: `${label} connector` })
      // Real buttons, not divs with click handlers — keyboard reachable and
      // announced without any extra tabindex wiring.
      expect(button.tagName).toBe('BUTTON')
      expect(button.getAttribute('type')).toBe('button')
    }
  })
})

describe('anchoring', () => {
  it('sits above the connector midpoint', () => {
    setup()
    const anchor = expectedAnchor(board(), 'straight')
    const toolbar = screen.getByRole('toolbar', { name: 'Connector routing' })
    expect(toolbar.style.left).toBe(`${anchor.x}px`)
    expect(toolbar.style.top).toBe(`${anchor.y - CONNECTOR_TOOLBAR_OFFSET}px`)
    // Centred on the point and entirely above it, done with a transform
    // rather than a measured width (which would be wrong on the first frame).
    expect(toolbar.style.transform).toBe('translate(-50%, -100%)')
  })

  it('re-anchors when the camera pans', () => {
    // It reads the LIVE camera, so pan and zoom move it for free — no
    // listener, no stored screen position to go stale.
    const panned: Camera = { x: -120, y: 40, zoom: 1 }
    setup({ camera: panned })
    const anchor = expectedAnchor(board(), 'straight', panned)
    const toolbar = screen.getByRole('toolbar', { name: 'Connector routing' })
    expect(toolbar.style.left).toBe(`${anchor.x}px`)
  })

  it('re-anchors when the camera zooms', () => {
    const zoomed: Camera = { x: 0, y: 0, zoom: 2 }
    setup({ camera: zoomed })
    const anchor = expectedAnchor(board(), 'straight', zoomed)
    const toolbar = screen.getByRole('toolbar', { name: 'Connector routing' })
    expect(toolbar.style.left).toBe(`${anchor.x}px`)
    // Anchoring in SCREEN space is the point: at 2x the same world midpoint
    // is somewhere else entirely on screen.
    expect(anchor.x).not.toBe(expectedAnchor(board(), 'straight').x)
  })

  it('follows the routing it is describing, not a fixed line', () => {
    // An elbow's midpoint is nowhere near a straight line's. Anchored to the
    // wrong one, the bar would drift off the connector the instant its
    // routing changed — which is the one moment it is guaranteed to be
    // on screen.
    //
    // The two elements are deliberately BOTH offset and differently shaped.
    // Two equal rects — even diagonally placed — put all three midpoints in
    // the same spot: the elbow is symmetric about the centre, and a
    // symmetric cubic passes exactly through the straight line's midpoint
    // (the same property that made a Wave 2 curve assertion measure zero).
    // The first version of this test used equal rects and passed against a
    // hard-coded 'straight' — it proved nothing. The guard below is what
    // keeps that from happening again silently.
    const asymmetric = sceneFrom([
      rect(A_ID, 0, 0, 300, 60),
      rect(B_ID, 500, 220, 60, 300),
      connector('elbow'),
    ])
    expect(expectedAnchor(asymmetric, 'elbow')).not.toEqual(
      expectedAnchor(asymmetric, 'straight'),
    )

    setup({ scene: asymmetric })
    const toolbar = screen.getByRole('toolbar', { name: 'Connector routing' })
    const anchor = expectedAnchor(asymmetric, 'elbow')
    expect(toolbar.style.left).toBe(`${anchor.x}px`)
    expect(toolbar.style.top).toBe(`${anchor.y - CONNECTOR_TOOLBAR_OFFSET}px`)
  })
})

describe('what it emits', () => {
  it('reports the chosen routing and the connector it belongs to', () => {
    const { onRoutingChange } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Curved connector' }))
    expect(onRoutingChange).toHaveBeenCalledTimes(1)
    const [element, routing] = onRoutingChange.mock.calls[0]
    expect((element as CanvasElement).id).toBe(CONNECTOR_ID)
    expect(routing).toBe('curved')
  })

  it('emits for every routing that is not the current one', () => {
    const { onRoutingChange } = setup({ scene: board('elbow') })
    fireEvent.click(screen.getByRole('button', { name: 'Straight connector' }))
    fireEvent.click(screen.getByRole('button', { name: 'Curved connector' }))
    expect(onRoutingChange.mock.calls.map((call) => call[1])).toEqual([
      'straight',
      'curved',
    ])
  })

  it('writes NOTHING when the active routing is re-selected', () => {
    // Otherwise every stray click pushes an undo entry that reverses to
    // itself, and Ctrl+Z appears to do nothing several times in a row.
    const { onRoutingChange } = setup({ scene: board('elbow') })
    fireEvent.click(screen.getByRole('button', { name: 'Elbow connector' }))
    expect(onRoutingChange).not.toHaveBeenCalled()
  })

  it('hands back the connector as it stands BEFORE the change', () => {
    // The caller records this as undo's `before`; a post-change element here
    // would make the inverse a no-op.
    const { onRoutingChange } = setup({ scene: board('elbow') })
    fireEvent.click(screen.getByRole('button', { name: 'Curved connector' }))
    const [element] = onRoutingChange.mock.calls[0]
    expect((element as CanvasElement).connector?.routing).toBe('elbow')
  })
})

describe('the bar keeps clear of the bend grip', () => {
  it('sits far enough above the midpoint that the grip stays pressable', () => {
    // Both affordances are pinned to the connector's own midpoint, and they
    // live in different layers — this bar is DOM, the grip is painted on the
    // canvas underneath. An overlap would therefore look completely correct
    // and simply swallow every press aimed at the grip, which is the same
    // silent class of defect the creation-handle/resize-grip separation is
    // asserted against in render-connectors.test.ts.
    //
    // The grip is `CONNECTOR_BEND_HIT` across and centred on the midpoint, so
    // its top edge is half that above it; this bar's bottom edge is
    // `CONNECTOR_TOOLBAR_OFFSET` above it.
    expect(CONNECTOR_TOOLBAR_OFFSET).toBeGreaterThan(CONNECTOR_BEND_HIT / 2)
  })
})
