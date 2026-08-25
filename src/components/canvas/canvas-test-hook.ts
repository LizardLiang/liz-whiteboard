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
import type { Camera } from '@/lib/canvas-engine/camera'
import type { CanvasElement, Scene } from '@/lib/canvas-engine/scene'
import type { CanvasTool } from './use-canvas-input'

/** The shape a spec sees at `window.__canvasEngine`. */
export interface CanvasEngineTestHook {
  boardId: string
  /** Elements in ascending z-order — the same order the renderer paints in. */
  elements: Array<CanvasElement>
  camera: Camera
  selectedIds: Array<string>
  /** Id of the element currently being typed into, or null. */
  editingElementId: string | null
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
  selectedIds: ReadonlySet<string>
  editingElementId: string | null
  tool: CanvasTool
  readOnly: boolean
}

export function useCanvasTestHook({
  boardId,
  scene,
  camera,
  selectedIds,
  editingElementId,
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

    const published: CanvasEngineTestHook = {
      boardId,
      // A plain array copy, not the live scene: a spec that mutated it must
      // not be able to corrupt the board it is asserting on.
      elements: scene.elements.map((element) => ({ ...element })),
      camera: { ...camera },
      selectedIds: [...selectedIds],
      editingElementId,
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
  }, [
    boardId,
    camera,
    editingElementId,
    readOnly,
    scene,
    selectedIds,
    tool,
  ])
}
