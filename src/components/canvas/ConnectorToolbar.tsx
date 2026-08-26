// src/components/canvas/ConnectorToolbar.tsx
// The routing picker for a selected connector (canvas quick-create-handles
// tactical plan, Wave 5, step 14).
//
// A floating bar over the connector, rather than a panel somewhere else on
// screen: a board can hold many connectors and the control has to say WHICH
// one it is about. Anchoring it to the line itself is the only placement that
// answers that without a label.
//
// Every coordinate here comes from `camera.ts`'s `worldToScreen` and every
// point it is given comes from `connector-geometry.ts`'s `connectorPath` /
// `pathMidpoint`. Nothing in this file computes geometry or a transform of
// its own — that is the structural answer to W1/W3, both of which were a
// second, divergent transform written at a call site.
//
// Because it reads the LIVE camera on every render, it re-anchors on pan and
// zoom for free: `CanvasBoard` re-renders on both, and the midpoint is
// recomputed from the same scene the renderer just drew.

import { CornerDownRight, Minus, Spline } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Camera } from '@/lib/canvas-engine/camera'
import type { CanvasConnectorRouting, CanvasElement, Scene } from '@/lib/canvas-engine/scene'
import { worldToScreen } from '@/lib/canvas-engine/camera'
import { pathMidpoint } from '@/lib/canvas-engine/connector-geometry'
import { connectorPathOf } from '@/lib/canvas-engine/hit-test'
import { Button } from '@/components/ui/button'

/**
 * How far ABOVE the connector's midpoint the bar sits, in screen pixels.
 *
 * Above rather than on: a bar centred on the line would cover the very thing
 * it is describing, and the three routings differ precisely in the shape of
 * the line under it.
 */
export const CONNECTOR_TOOLBAR_OFFSET = 16

interface RoutingOption {
  routing: CanvasConnectorRouting
  label: string
  Icon: LucideIcon
}

/**
 * The three routings, in the order the geometry module defines them.
 *
 * Exported so a test names the same set the UI renders rather than repeating
 * the strings — the union is the source of truth, and a fourth routing added
 * to it should fail a test here rather than silently be unreachable.
 */
export const ROUTING_OPTIONS: ReadonlyArray<RoutingOption> = [
  { routing: 'straight', label: 'Straight', Icon: Minus },
  { routing: 'elbow', label: 'Elbow', Icon: CornerDownRight },
  { routing: 'curved', label: 'Curved', Icon: Spline },
]

/**
 * The connector this toolbar is for, or null.
 *
 * Exported and pure for the same reason `creationHandleTarget` is: the
 * conditions under which the bar appears are a rule, not an incidental
 * arrangement of JSX, and a rule is worth testing on its own.
 *
 * `readOnly` is a condition here rather than the caller's business because
 * forgetting it is the failure that matters: a viewer shown three buttons
 * that silently do nothing (the server re-checks the role on every mutation)
 * is worse than no buttons at all.
 */
export function connectorToolbarTarget(
  scene: Scene,
  selectedIds: ReadonlySet<string>,
  readOnly: boolean,
): CanvasElement | null {
  if (readOnly || selectedIds.size !== 1) return null
  const [id] = [...selectedIds]
  const element = scene.byId.get(id)
  return element?.connector ? element : null
}

export interface ConnectorToolbarProps {
  scene: Scene
  selectedIds: ReadonlySet<string>
  camera: Camera
  readOnly: boolean
  /** Called with the newly chosen routing. Never called for the routing already in effect. */
  onRoutingChange: (element: CanvasElement, routing: CanvasConnectorRouting) => void
}

export function ConnectorToolbar({
  scene,
  selectedIds,
  camera,
  readOnly,
  onRoutingChange,
}: ConnectorToolbarProps) {
  const element = connectorToolbarTarget(scene, selectedIds, readOnly)
  if (!element?.connector) return null

  // The SAME path the renderer strokes, so the bar sits on the line the user
  // is actually looking at — an elbow's midpoint is nowhere near a straight
  // line's, and a bar anchored to the wrong one would drift off the connector
  // the moment its routing changed.
  const path = connectorPathOf(scene, element)
  const midpoint = path ? pathMidpoint(path) : null
  // No path means the connector is not drawable either — a missing endpoint,
  // or two elements overlapping far enough that there is no line between
  // them. A bar floating over nothing would be pointing at an invisible
  // connector.
  if (!midpoint) return null

  const anchor = worldToScreen(camera, midpoint)
  const active = element.connector.routing

  return (
    <div
      className="absolute z-10 flex gap-1 rounded-md border bg-background/90 p-1 shadow-sm backdrop-blur-sm"
      style={{
        left: anchor.x,
        top: anchor.y - CONNECTOR_TOOLBAR_OFFSET,
        // Centred horizontally on the midpoint and sitting entirely above it.
        // Done with a transform rather than by subtracting a measured width,
        // which would need a layout pass and would be wrong on the first
        // frame of every selection.
        transform: 'translate(-50%, -100%)',
      }}
      role="toolbar"
      aria-label="Connector routing"
    >
      {ROUTING_OPTIONS.map(({ routing, label, Icon }) => (
        <Button
          key={routing}
          type="button"
          size="icon"
          variant={routing === active ? 'default' : 'ghost'}
          aria-label={`${label} connector`}
          aria-pressed={routing === active}
          title={`${label} connector`}
          onClick={() => {
            // Re-selecting the current routing writes nothing. Otherwise every
            // stray click would push an undo entry that reverses to itself,
            // and the user's Ctrl+Z would appear to do nothing several times
            // in a row.
            if (routing === active) return
            onRoutingChange(element, routing)
          }}
        >
          <Icon className="h-4 w-4" />
        </Button>
      ))}
    </div>
  )
}
