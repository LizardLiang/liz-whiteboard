// src/components/canvas/canvas-test-hook.ts
// The `window.__canvasEngine` end-to-end test hook (tactical plan Wave 5,
// step 16).
//
// Canvas content is invisible to DOM selectors: there are no nodes, no
// data-testid attributes, nothing for Playwright to query. Without this hook
// an e2e spec could only assert on pixels, which tells you something was
// painted but never WHAT. This publishes the engine's own state — the scene
// and the camera — so a spec can assert an element's id, kind, geometry and
// text directly.
//
// It is NOT shipped to users. The publish is gated on `import.meta.env.DEV`,
// which Vite statically replaces with `false` in a production build, leaving
// the body unreachable and dead-code-eliminated. `VITE_E2E_HOOKS=1` is the
// escape hatch for running the suite against a production-style build.
// Verified empirically against `bun run build` — see the Wave 5 notes; the
// string `__canvasEngine` appears nowhere in the client bundle.

import { useEffect } from 'react'
import type { Camera, Point } from '@/lib/canvas-engine/camera'
import type { CanvasElement, Scene } from '@/lib/canvas-engine/scene'
import type {
  ConnectorEnd,
  CreationHandleDirection,
  RenderSelection,
  ScreenRect,
} from '@/lib/canvas-engine/render'
import type { CanvasTool } from './use-canvas-input'
import {
  connectorBendRect,
  connectorEndpointRects,
  creationHandleRects,
  creationHandleTarget,
} from '@/lib/canvas-engine/render'
import { connectorPathOf } from '@/lib/canvas-engine/hit-test'
import { bounds } from '@/lib/canvas-engine/scene'

/** The shape a spec sees at `window.__canvasEngine`. */
export interface CanvasEngineTestHook {
  boardId: string
  /**
   * Elements in ascending z-order — the same order the renderer paints in.
   *
   * A connector carries its `connector` field like any other property, so a
   * spec reads its endpoints and routing straight off the element rather than
   * needing a second published collection.
   */
  elements: Array<CanvasElement>
  camera: Camera
  selectedIds: Array<string>
  /** Id of the element currently being typed into, or null. */
  editingElementId: string | null
  /**
   * The element that OWNS the hover, or null (canvas quick-create-handles,
   * Wave 6, step 18).
   *
   * Not "the element the pointer is over", which is what this used to say:
   * hover survives while the pointer travels within the creation handles'
   * reach of the element, so a handle shown on hover can actually be pressed
   * (`withinCreationHandleReach`). The pointer is frequently outside the
   * element whose id this reports.
   */
  hoveredId: string | null
  /**
   * The element currently showing creation handles, or null.
   *
   * Published SEPARATELY from `hoveredId` and `selectedIds` because it is
   * neither: the handles appear on a single selection OR on hover, and are
   * suppressed outright mid-edit, mid-marquee, mid-draw and mid-drag. A spec
   * that recomputed that rule from the other two fields would be asserting
   * its own copy of it rather than the renderer's.
   */
  creationHandleTargetId: string | null
  /**
   * The four creation-handle HIT rectangles, in canvas-relative screen pixels,
   * or null when no element is showing handles.
   *
   * Published so a spec clicks exactly what the renderer drew — the same
   * export-what-you-draw contract `creationHandleRects` exists for. A spec
   * that instead added its own offset to an element's edge would drift the
   * day a constant changed, and would fail as "the click did nothing" with no
   * hint as to why.
   */
  creationHandles: Record<CreationHandleDirection, ScreenRect> | null
  /**
   * The two endpoint grips of the single selected connector, in canvas-relative
   * screen pixels, or null when no connector is selected.
   *
   * Published for the same reason `creationHandles` is: a spec must press the
   * rectangles the renderer drew. Deriving an endpoint's screen position in the
   * spec would mean re-deriving the whole path — anchored ends sit on edge
   * midpoints, unanchored ones wherever the centre ray crosses, free ones at
   * their own point — which is three chances to drift from what was painted.
   */
  connectorEndpoints: Record<ConnectorEnd, ScreenRect> | null
  /**
   * The BEND grip of the single selected connector, in canvas-relative screen
   * pixels, or null when no `curved` connector is selected.
   *
   * Published for the same reason `connectorEndpoints` is, and it is even less
   * optional here: a curve's midpoint is not a point a spec can derive at all
   * without reimplementing the routing, the tension clamp and the curvature
   * arithmetic together — three chances to drift from what was painted, in a
   * place where drifting fails as "the drag did nothing".
   *
   * Null for `straight` and `elbow` even when one IS selected, matching the
   * renderer: those routings have no bow, so there is no grip to click and a
   * spec asserting otherwise would be asserting a bug.
   */
  connectorBend: ScreenRect | null
  /**
   * The WORLD-SPACE polyline the renderer drew for the single selected
   * connector, or null when none is selected.
   *
   * World, not screen, unlike every other geometry field here: the grips are
   * published so a spec can press them, and a press needs page pixels, but
   * this is published so a spec can measure the LINE'S SHAPE, and a shape
   * assertion has no business being scaled by the camera.
   *
   * It exists because a whole class of connector faults is invisible to the
   * grips. A curve that folded into a cusp — shooting backwards past its own
   * endpoint and curling round it — moved neither end and moved the bend grip
   * barely at all, so an endpoint-and-bend spec passed while the board drew a
   * loop. Re-deriving the path in the spec instead would break the
   * export-what-you-draw rule the other fields exist for, and here the whole
   * point is to assert on what the renderer actually painted.
   */
  connectorPath: Array<Point> | null
  tool: CanvasTool
  readOnly: boolean
}

declare global {
  interface Window {
    __canvasEngine?: CanvasEngineTestHook
  }
}

interface UseCanvasTestHookArgs {
  boardId: string
  scene: Scene
  camera: Camera
  /**
   * The SAME object handed to `drawScene`, not a reassembled copy.
   *
   * `selectedIds` and `editingElementId` used to be separate arguments and are
   * now derived from this instead: they were a second copy of two fields this
   * object already carries, free to disagree with what the renderer actually
   * used. Taking the renderer's own input is also what lets the hook resolve
   * the creation-handle target through `creationHandleTarget` rather than
   * reimplementing its suppression rules.
   */
  selection: RenderSelection
  tool: CanvasTool
  readOnly: boolean
}

export function useCanvasTestHook({
  boardId,
  scene,
  camera,
  selection,
  tool,
  readOnly,
}: UseCanvasTestHookArgs): void {
  useEffect(() => {
    // Both halves are compile-time constants in a production build, so this
    // early return folds to `if (true) return` and everything below it is
    // eliminated. Keep the condition inline — hoisting it into a module-level
    // `const ENABLED` makes the elimination depend on the minifier instead of
    // on the replacement.
    if (!import.meta.env.DEV && import.meta.env.VITE_E2E_HOOKS !== '1') return

    // Resolved with the renderer's OWN functions, inside the DEV gate, so a
    // production build pays nothing for it — and so what a spec clicks is by
    // construction what was drawn.
    const handleTarget = creationHandleTarget(scene, selection)
    // Only for a SINGLE selected connector — which is exactly when the
    // renderer draws them, and exactly when input will accept a press on one.
    const selectedOnly =
      selection.ids.size === 1
        ? (scene.byId.get([...selection.ids][0]) ?? null)
        : null
    const connectorPath = selectedOnly?.connector
      ? connectorPathOf(scene, selectedOnly)
      : null
    const connectorGrips = selectedOnly?.connector
      ? connectorEndpointRects(camera, connectorPath)
      : null
    // Gated on `curved` HERE rather than left to the spec, so the published
    // state answers the same question the renderer and the press handler both
    // answer — a spec that saw a rect for a straight connector would be
    // clicking an affordance that was never drawn.
    const connectorBend =
      selectedOnly?.connector?.routing === 'curved'
        ? connectorBendRect(camera, connectorPath)
        : null

    const published: CanvasEngineTestHook = {
      boardId,
      // A plain array copy, not the live scene: a spec that mutated it must
      // not be able to corrupt the board it is asserting on.
      elements: scene.elements.map((element) => ({ ...element })),
      camera: { ...camera },
      selectedIds: [...selection.ids],
      editingElementId: selection.editing?.elementId ?? null,
      hoveredId: selection.hoveredId ?? null,
      creationHandleTargetId: handleTarget?.id ?? null,
      creationHandles: handleTarget
        ? creationHandleRects(camera, bounds(handleTarget))
        : null,
      connectorEndpoints: connectorGrips,
      connectorBend,
      // Already a fresh array of fresh points — `connectorPathOf` recomputes
      // it from the current bounds every call and shares nothing with the
      // scene — so unlike `elements` it needs no defensive copy to satisfy
      // "a spec cannot corrupt the board it is measuring".
      connectorPath,
      tool,
      readOnly,
    }
    window.__canvasEngine = published

    return () => {
      // Only clear our own publication. Two boards never coexist today, but a
      // stale hook outliving its board would make a spec assert on a
      // different one and look like a data bug.
      if (window.__canvasEngine === published) delete window.__canvasEngine
    }
  }, [boardId, camera, readOnly, scene, selection, tool])
}
