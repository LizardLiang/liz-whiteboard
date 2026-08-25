// src/lib/canvas-engine/scene.ts
// The canvas engine's scene model (tactical plan Wave 1, step 2).
//
// A flat, z-ordered list of elements plus an id index. Flat is a decision,
// not an oversight: groups and frames are real FigJam features and will
// need a tree, but a tree bought before it is needed makes every hit-test,
// every transform and every persistence round-trip more complex for no
// milestone-1 benefit. When grouping arrives, THIS module is the only one
// that has to change — `hit-test.ts` and `render.ts` consume the ordered
// list, not the storage shape.
//
// Every operation returns a NEW scene. Immutability is what lets the React
// layer diff cheaply and what makes a future undo stack trivial (keep the
// previous scene), and it keeps this module pure and trivially testable.
//
// Pure module: no React, no DOM, no database.

/** The element kinds milestone 1 renders. New kinds are added here first. */
export type CanvasElementKind = 'rectangle' | 'text'

/** Styling shared by every element kind. */
export interface CanvasElementStyle {
  fill: string
  stroke: string
  strokeWidth: number
  fontSize: number
  color: string
}

export const DEFAULT_ELEMENT_STYLE: CanvasElementStyle = {
  fill: 'rgba(59, 130, 246, 0.10)',
  stroke: '#3b82f6',
  strokeWidth: 2,
  fontSize: 16,
  color: '#0f172a',
}

/**
 * One element on the board, in WORLD coordinates.
 *
 * `rotation` is stored but not editable in milestone 1 — the field exists
 * so adding rotation later needs no schema change, exactly as the plan's
 * assumption records.
 */
export interface CanvasElement {
  id: string
  kind: CanvasElementKind
  x: number
  y: number
  width: number
  height: number
  rotation: number
  zIndex: number
  text: string | null
  style: CanvasElementStyle
}

/**
 * The scene: elements in ASCENDING z-order (last one paints on top, and is
 * therefore the first hit-test candidate), plus an id index so lookups do
 * not scan.
 */
export interface Scene {
  elements: Array<CanvasElement>
  byId: Map<string, CanvasElement>
}

export const EMPTY_SCENE: Scene = { elements: [], byId: new Map() }

function index(elements: Array<CanvasElement>): Scene {
  return {
    elements,
    byId: new Map(elements.map((element) => [element.id, element])),
  }
}

/** Sort into ascending z-order, breaking ties by id so ordering is stable. */
function ordered(elements: Array<CanvasElement>): Array<CanvasElement> {
  return [...elements].sort(
    (a, b) => a.zIndex - b.zIndex || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

/** Build a scene from unordered elements — the shape a database load produces. */
export function sceneFrom(elements: Array<CanvasElement>): Scene {
  return index(ordered(elements))
}

export function getElement(scene: Scene, id: string): CanvasElement | null {
  return scene.byId.get(id) ?? null
}

/** The z-index a new element should take to land on top of everything. */
export function nextZIndex(scene: Scene): number {
  if (scene.elements.length === 0) return 0
  return scene.elements[scene.elements.length - 1].zIndex + 1
}

export function addElement(scene: Scene, element: CanvasElement): Scene {
  return sceneFrom([...scene.elements, element])
}

/**
 * Patch one element. Returns the SAME scene object when the id is unknown,
 * so a caller can use identity to detect a no-op (and React skips a render)
 * rather than being handed a pointlessly new scene.
 */
export function updateElement(
  scene: Scene,
  id: string,
  patch: Partial<Omit<CanvasElement, 'id'>>,
): Scene {
  const existing = scene.byId.get(id)
  if (!existing) return scene
  return sceneFrom(
    scene.elements.map((element) =>
      element.id === id ? { ...element, ...patch } : element,
    ),
  )
}

export function removeElement(scene: Scene, id: string): Scene {
  if (!scene.byId.has(id)) return scene
  return sceneFrom(scene.elements.filter((element) => element.id !== id))
}

export function removeElements(scene: Scene, ids: Array<string>): Scene {
  const doomed = new Set(ids)
  if (![...doomed].some((id) => scene.byId.has(id))) return scene
  return sceneFrom(scene.elements.filter((element) => !doomed.has(element.id)))
}

/** Move one element to the top of the paint order. */
export function bringToFront(scene: Scene, id: string): Scene {
  const existing = scene.byId.get(id)
  if (!existing) return scene
  return updateElement(scene, id, { zIndex: nextZIndex(scene) })
}

/** An element's axis-aligned world bounds. */
export function bounds(element: CanvasElement): {
  x: number
  y: number
  width: number
  height: number
} {
  return {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
  }
}

/**
 * The union of several elements' bounds — what a multi-selection's
 * transform box is drawn around. Returns null for an empty input rather
 * than a degenerate rect at the origin, which would silently render a
 * selection box nobody selected.
 */
export function boundsOfMany(elements: Array<CanvasElement>): {
  x: number
  y: number
  width: number
  height: number
} | null {
  if (elements.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const element of elements) {
    minX = Math.min(minX, element.x)
    minY = Math.min(minY, element.y)
    maxX = Math.max(maxX, element.x + element.width)
    maxY = Math.max(maxY, element.y + element.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}
