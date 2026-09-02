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

// The ONE import in this module, and type-only: `camera.ts` is a leaf that
// imports nothing itself, so this cannot create a cycle and costs the engine's
// no-dependency property nothing at runtime. A free connector endpoint needs a
// point, and re-declaring the shape locally would be a second `Point`.
import type { Point } from './camera'

/** The element kinds the engine renders. New kinds are added here first. */
export type CanvasElementKind =
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'triangle'
  | 'text'
  | 'connector'
  | 'group'

/**
 * The SHAPE kinds: four ways of drawing one world rect.
 *
 * They are identical in every respect the rest of the engine cares about —
 * same bounds, same resize grips, same text frame, same connector attachment
 * rules, same quick-create behaviour — and differ in exactly two places:
 * `render.ts` traces a different outline inside the rect, and `hit-test.ts`
 * asks a different containment question about it. Nothing else may branch on
 * which shape kind an element is.
 *
 * This union exists so that "a shape, as opposed to text or a connector" is
 * one name rather than a `||` chain that grows every time a kind is added and
 * that some call site inevitably forgets to extend.
 */
export type CanvasShapeKind = 'rectangle' | 'ellipse' | 'diamond' | 'triangle'

/**
 * Every shape kind, in the order the toolbar offers them. Exported as data,
 * not just a type, because the tool palette and the shape-tool mapping in
 * `use-canvas-input.ts` both need to enumerate them at runtime.
 */
export const CANVAS_SHAPE_KINDS: ReadonlyArray<CanvasShapeKind> = [
  'rectangle',
  'ellipse',
  'diamond',
  'triangle',
]

/** Is this kind one of the shapes — i.e. not text and not a connector? */
export function isCanvasShapeKind(
  kind: CanvasElementKind,
): kind is CanvasShapeKind {
  return (CANVAS_SHAPE_KINDS as ReadonlyArray<string>).includes(kind)
}

/**
 * How a connector is drawn between its endpoints — FigJam's three line types.
 *
 * Declared here rather than imported from `src/data/schema.ts` because this
 * directory imports nothing: that is what lets the engine be unit-tested with
 * no browser and no database. `canvas-element-adapter.ts` carries the
 * compile-time proof that this and the Zod enum have not drifted, exactly as
 * it already does for `CanvasElementKind`.
 */
export type CanvasConnectorRouting = 'straight' | 'elbow' | 'curved'

/**
 * Which SIDE of an element a connector is tied to.
 *
 * The four sides the creation handles sit on, and the canonical declaration of
 * that vocabulary: `quick-create.ts`'s `QuickCreateDirection` and `render.ts`'s
 * `CreationHandleDirection` are both aliases of this. The handle you drag FROM
 * becomes the connector's `sourceAnchor`, so one union covering both is not a
 * coincidence — they are the same thing seen at two moments.
 */
export type ConnectorAnchor = 'top' | 'right' | 'bottom' | 'left'

/**
 * WHERE on an element's border a connector end is tied, as a fraction of the
 * element's own box: `{ x: 0, y: 0 }` is its top-left corner, `{ x: 1, y: 0.5 }`
 * the middle of its right edge, `{ x: 0.25, y: 1 }` a quarter along its bottom.
 *
 * NORMALISED, not a world offset, so the attachment survives a resize: an end
 * tied a third of the way down a box stays a third of the way down when the box
 * grows. A stored world point would slide off the shape entirely.
 *
 * At least one component is always 0 or 1 — the point lies ON the border, never
 * inside — which is what lets `attachSide` recover which edge it is on for the
 * elbow and curve normals.
 */
export interface ConnectorAttach {
  x: number
  y: number
}

/**
 * A connector's endpoints and line type.
 *
 * Note what is NOT here: any point, path or bounding box. A connector's
 * geometry is derived from its two endpoint elements' live bounds on every
 * frame (`connector-geometry.ts`), so there is nothing to keep in sync and
 * nothing that can go stale behind a collaborator's move. The element's own
 * `x`/`y`/`width`/`height` are a placeholder the storage columns demand and
 * that nothing reads — see `createCanvasElementSchema`'s note.
 */
export interface CanvasConnector {
  /**
   * The two ends. Each is EITHER tied to an element's edge OR a free point in
   * space — see `ConnectorEndpoint`.
   *
   * An attached end carries no geometry of its own: the line is re-derived
   * from that element's CURRENT bounds every frame, which is what makes a
   * connector follow a move or a resize with no edit of its own. Only a FREE
   * end stores a coordinate, because nothing else knows where it is.
   */
  source: ConnectorEndpoint
  target: ConnectorEndpoint
  routing: CanvasConnectorRouting
  /**
   * HOW FAR the line is bowed by hand: the signed perpendicular offset of the
   * curve's midpoint from the straight chord between its two ends, as a
   * FRACTION of that chord's length. `0.25` on a 400-unit chord puts the
   * middle of the line 100 units off to one side.
   *
   * A fraction and not a world distance, and that is what the whole field is
   * built around. It is what makes the drag map 1:1 — a pointer moved one
   * world unit off the line moves the curve's middle by exactly one world
   * unit — while staying zoom-invariant, because nothing here is measured in
   * screen pixels. It is also what keeps the bow PROPORTIONAL when the two
   * shapes are pulled apart: a stored world offset would flatten into a
   * near-straight line as the gap grew, which is not what the user drew.
   *
   * SIGN: positive is the LEFT-hand side of the source -> target direction as
   * seen on screen, so a connector running left to right bows UP at positive
   * curvature. Pinned in `chordNormal` (connector-geometry.ts) and read from
   * nowhere else.
   *
   * MEASURED ON TOP of whatever bow the routing already produces, not from
   * the chord absolutely. An anchored curve's midpoint is already off the
   * chord by `(3/8)·tension·(n0 + n1)` before anyone touches it, so an
   * absolute measure could not also satisfy the rule below. Relative, both
   * hold at once.
   *
   * OPTIONAL, and it has to stay that way for the reason `attach` above does:
   * every connector written before bending existed carries none. Absent and 0
   * are the same thing and both reproduce the pre-curvature path exactly —
   * `curvedPath` skips the arithmetic entirely at 0 rather than adding a zero
   * offset, so "exactly" means the same floating-point values, not merely the
   * same to within an epsilon.
   *
   * `curved` ONLY. `straight` and `elbow` ignore it — a straight line with a
   * bend is not straight and a bent elbow is not orthogonal — and the value
   * survives a round trip through those routings rather than being cleared,
   * so flipping a bowed connector to elbow and back returns the bow.
   */
  curvature?: number
}

/**
 * One END of a connector: tied to an element's edge, or floating free.
 *
 * A DISCRIMINATED UNION rather than a nullable id beside an optional point,
 * because "attached" and "free" are the whole vocabulary here and the two
 * halves are mutually exclusive. Written as nullable fields, `{ elementId:
 * null, point: undefined }` would be constructible and would sail through
 * every call site as a lookup that quietly returns nothing — the silent-
 * failure class this feature has already produced twice. As a union, every
 * reader is forced by the compiler to say what it does with a free end.
 *
 * `attach` stays optional on the attached arm for the reason it always has:
 * connectors written before attachment existed carry none, and the geometry
 * falls back to a centre-derived border point per end.
 */
export type ConnectorEndpoint =
  | { kind: 'element'; elementId: string; attach?: ConnectorAttach }
  | { kind: 'point'; point: Point }

/** The element an endpoint is tied to, or null when it floats free. */
export function endpointElementId(endpoint: ConnectorEndpoint): string | null {
  return endpoint.kind === 'element' ? endpoint.elementId : null
}

/** An attached endpoint for `elementId`, optionally at a specific spot on its border. */
export function attachedEndpoint(
  elementId: string,
  attach?: ConnectorAttach,
): ConnectorEndpoint {
  return { kind: 'element', elementId, ...(attach ? { attach } : {}) }
}

/** A free endpoint at a fixed world point. */
export function freeEndpoint(point: Point): ConnectorEndpoint {
  return { kind: 'point', point: { x: point.x, y: point.y } }
}

/**
 * How an element's text sits across its box, line by line.
 *
 * Applied PER WRAPPED LINE, not to the block: three lines of different widths
 * centred as a block would each keep their own ragged left edge, which is not
 * what anyone means by "centre this text".
 */
export type CanvasTextAlign = 'left' | 'center' | 'right'

/** How an element's text block sits down its box. */
export type CanvasVerticalAlign = 'top' | 'middle' | 'bottom'

/** Styling shared by every element kind. */
export interface CanvasElementStyle {
  fill: string
  stroke: string
  strokeWidth: number
  fontSize: number
  color: string
  /**
   * Corner rounding in WORLD units. Only `rectangle` draws it — every other
   * kind traces its own path and has no corners to round — but it lives here
   * rather than in `canvasElementPropsSchema` because that schema is a
   * discriminated union per kind and this one is a `strictObject` shared by
   * all of them: a per-kind field would mean a second style object to merge,
   * snapshot and diff for one number.
   *
   * Stored in WORLD units, like `strokeWidth`, so a rounded rectangle keeps
   * its proportions through a zoom. It is clamped to half the shorter side at
   * DRAW time rather than on write (`effectiveCornerRadius`), so resizing a
   * rounded shape small and large again gives back the radius the user chose
   * instead of the one that happened to fit at its smallest.
   */
  cornerRadius: number
  /**
   * Where the text sits across the element's box, per wrapped line.
   *
   * Lives on the shared style rather than per kind for the same reason
   * `cornerRadius` does — and it applies more widely than that one does, since
   * every kind that can hold text (all four shapes AND `text`) draws it
   * through the same branch of `drawElement`.
   */
  textAlign: CanvasTextAlign
  /** Where the text block sits down the element's box. */
  verticalAlign: CanvasVerticalAlign
}

export const DEFAULT_ELEMENT_STYLE: CanvasElementStyle = {
  fill: 'rgba(59, 130, 246, 0.10)',
  stroke: '#3b82f6',
  strokeWidth: 2,
  fontSize: 16,
  color: '#0f172a',
  // Rounded by default. A square-cornered rectangle is the odd one out on a
  // board whose other kinds are an ellipse, a diamond and a triangle, and this
  // is the value a shape is drawn with before anyone has styled it.
  //
  // 8 rather than a larger radius because it has to read as a rectangle at
  // every zoom: the clamp in `effectiveCornerRadius` takes over once the shape
  // is smaller than twice this, so a small shape degrades to a stadium rather
  // than to something ambiguous.
  //
  // It must stay one of `CANVAS_CORNER_RADII`, or a never-styled rectangle
  // shows no active button in the toolbar's Corner row —
  // `canvas-style-palette.test.ts` pins that, the same drift guard the blue
  // swatch has against `fill`/`stroke`.
  //
  // This is ALSO the schema default (`canvasElementStyleSchema`), so a stored
  // row that predates corner radius — one whose style JSON has no
  // `cornerRadius` key, or no style at all — parses as rounded rather than
  // square. That is deliberate: those rows never expressed a preference, and
  // leaving them square would mean two different "unstyled" appearances on the
  // same board. A row that stored `cornerRadius: 0` explicitly stays square,
  // because that one did express a preference.
  cornerRadius: 8,
  // Top-left, which is EXACTLY what `render.ts` drew before this setting
  // existed — it hardcoded `ctx.textAlign = 'left'` and `textBaseline = 'top'`
  // and laid every line out from the frame's origin. That equality is the
  // whole zero-visual-diff guarantee: these two are also the schema defaults
  // (`canvasElementStyleSchema`), so every row written before alignment
  // existed parses to the appearance it already had on screen.
  //
  // Note this is the OPPOSITE choice from `cornerRadius` above, and for the
  // opposite reason. Rounding changed unstyled shapes deliberately, because
  // leaving them square would have made two different "unstyled" looks. Here
  // there is nothing to unify — every existing element is already top-left,
  // and any other default would silently re-lay-out every board on this board
  // kind the first time it was opened.
  textAlign: 'left',
  verticalAlign: 'top',
}

/**
 * The corner radius a rectangle is actually drawn and hit-tested with.
 *
 * Clamped to half the shorter side: beyond that the two arcs on an edge
 * overlap, and `ctx.roundRect` and a containment test would each resolve the
 * overlap their own way — the exact divergence between "what was drawn" and
 * "what is clickable" that `traceShapePath` and `elementContainsPoint` exist
 * to keep impossible.
 *
 * Non-rectangles get 0 whatever they store, so a rectangle restyled and then
 * replaced by an ellipse cannot leave a radius quietly affecting anything.
 */
export function effectiveCornerRadius(element: CanvasElement): number {
  if (element.kind !== 'rectangle') return 0
  const radius = element.style.cornerRadius
  if (!Number.isFinite(radius) || radius <= 0) return 0
  return Math.min(
    radius,
    Math.abs(element.width) / 2,
    Math.abs(element.height) / 2,
  )
}

/**
 * Routing a newly created connector starts in.
 *
 * `straight` because it is the only routing that is unambiguous at every
 * relative position of two elements — an elbow has to pick a corner and a
 * curve has to pick a bulge direction, and both look deliberate when the user
 * chose them and look like a bug when they did not. The routing picker
 * (tactical plan, Wave 5) is how the other two are reached.
 *
 * Lives beside `DEFAULT_ELEMENT_STYLE` because it is the same kind of value:
 * what an element looks like the instant it is created, before anyone has
 * styled it.
 */
export const DEFAULT_CONNECTOR_ROUTING: CanvasConnectorRouting = 'straight'

/**
 * A group's membership: the ids of its DIRECT members only.
 *
 * A member id may itself name another group element, which is how nesting
 * happens (canvas-element-grouping tactical plan, Wave 1) — there is no
 * separate "nested group" vocabulary, a group is just an element that can
 * appear in another group's `childIds`.
 *
 * Membership lives ONLY here, on the group. No member element carries a
 * back-reference to its group, so creating, ungrouping or editing membership
 * is always a write to the group element alone, never to its members — this
 * is what keeps move/delete/duplicate/undo simple (decisions.md, "Where does
 * group membership live").
 */
export interface CanvasGroup {
  childIds: Array<string>
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
  /**
   * Present exactly when `kind === 'connector'`, absent otherwise.
   *
   * Optional rather than a discriminated union on `kind` deliberately: every
   * consumer in this engine — hit-test, render, the scene mutators — treats
   * elements uniformly and reaches for the rare kind-specific field only in
   * the one branch that needs it. Turning `CanvasElement` into a union would
   * push a narrowing step into all of them for a single field.
   */
  connector?: CanvasConnector
  /**
   * Present exactly when `kind === 'group'`, absent otherwise. Mirrors
   * `connector` above for the same reason: uniform element handling
   * everywhere except the one branch that needs the kind-specific field.
   *
   * The group's OWN `x`/`y`/`width`/`height` above are its frame — explicit,
   * stored, and never derived from `childIds` after creation (PRD FR-003).
   */
  group?: CanvasGroup
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

/**
 * Drop every group `childId` that names no element in THIS SAME list
 * (FR-018's load-time repair scenario, canvas-element-grouping PRD-alignment
 * finding 1). `toEngineGroup`/`toEngineElement` (canvas-element-adapter.ts)
 * convert ONE row at a time and have no view of the rest of the board, so
 * they cannot cross-check a `childId` against what else exists — this
 * function is for a caller that DOES see every element at once.
 *
 * Mirrors `toEngineConnector`'s own precedent: an unresolvable reference is
 * silently dropped, never a hard load failure — a hand-edited or
 * partially-migrated board still loads, just with the dangling id gone.
 *
 * Returns the SAME array when nothing needed repair, and leaves every
 * unaffected element's own object identity untouched — only a group that
 * actually lost a childId gets a new object, matching `updateElement`'s
 * "same reference means nothing changed" contract elsewhere in this module.
 *
 * CALLED ONLY AT A GENUINE WHOLE-BOARD LOAD (`toEngineScene`,
 * canvas-element-adapter.ts) — deliberately NOT wired into `sceneFrom`
 * itself, even though `sceneFrom` is the one function every scene-rebuilding
 * mutator in this module already funnels through. `sceneFrom` also rebuilds
 * the scene from a PARTIAL, still-in-flight element list mid-gesture — e.g.
 * undoing a whole-group cascade delete recreates the group and its members
 * as INDEPENDENT, CONCURRENT creates, and if the group's own `addElement`
 * lands before a member's, `sceneFrom` would see a childId that does not
 * (yet) resolve and permanently strip it, with nothing left to add it back
 * once the member's own create lands moments later (found via an e2e
 * regression on exactly this cascade-undo path; see scene.test.ts's own
 * "does not run against a partial, in-flight element list" case). A load's
 * record list, by contrast, is already the server's fully-settled state —
 * there is no "moments later" for anything still missing to arrive.
 */
export function repairGroupMembership(
  elements: Array<CanvasElement>,
): Array<CanvasElement> {
  const ids = new Set(elements.map((element) => element.id))
  const repaired = elements.map((element) => {
    if (!element.group) return element
    const childIds = element.group.childIds.filter((childId) =>
      ids.has(childId),
    )
    if (childIds.length === element.group.childIds.length) return element
    return { ...element, group: { childIds } }
  })
  // Compared by identity rather than tracked with a flag set inside the
  // callback (mirrors `remapConnectorEndpoints`'s own idiom below): the
  // callback above returns the SAME object for every element it did not
  // repair, so a differing reference is exactly "this one changed".
  const changed = repaired.some((element, i) => element !== elements[i])
  return changed ? repaired : elements
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

/**
 * Every connector with `elementId` at either end.
 *
 * This is what makes a delete cascade: a connector whose endpoint is gone can
 * never be drawn again (`connectorPath` needs both rects), so it would sit in
 * the board as an invisible, unselectable row forever. Callers must delete
 * these in the SAME gesture as the element itself so one undo restores them
 * all — see the tactical plan's "Deleting An Endpoint Deletes Its Connectors".
 *
 * Lives here because the scene module owns relationships between elements;
 * putting it in the input hook would give the two delete sites
 * (`deleteSelection` and `commitEditing`'s empty-text branch) two chances to
 * disagree about what "attached" means.
 *
 * A linear scan, matching `hit-test.ts`'s: the same element-count ceiling
 * applies, and an endpoint index belongs behind this signature if it is ever
 * needed, with no caller changing.
 */
export function connectorsTouching(
  scene: Scene,
  elementId: string,
): Array<CanvasElement> {
  return scene.elements.filter(
    (element) =>
      element.connector !== undefined &&
      // A FREE end is attached to nothing, so it can never make a connector
      // "touch" an element — `endpointElementId` returns null for it, which
      // never equals a real id.
      (endpointElementId(element.connector.source) === elementId ||
        endpointElementId(element.connector.target) === elementId),
  )
}

/**
 * The ids of `elementIds` plus every connector attached to any of them —
 * the full set a delete has to remove.
 *
 * Deduplicated, because one connector between two elements that are BOTH
 * being deleted is reached twice; deleting it twice would record two undo
 * operations for one row, and the second's inverse would restore a row the
 * first had already restored.
 */
export function withAttachedConnectors(
  scene: Scene,
  elementIds: ReadonlyArray<string>,
): Array<string> {
  const doomed = new Set(elementIds)
  for (const id of elementIds) {
    for (const connector of connectorsTouching(scene, id)) {
      doomed.add(connector.id)
    }
  }
  return [...doomed]
}

/**
 * The group whose `childIds` directly contains `elementId`, or null.
 *
 * O(groups), a linear scan — the same scan discipline `connectorsTouching`
 * already uses for the structurally identical "what element references this
 * one" question. An index belongs behind this signature if it is ever
 * needed, with no caller changing (canvas-element-grouping tactical plan,
 * Wave 1).
 */
export function groupOwning(
  scene: Scene,
  elementId: string,
): CanvasElement | null {
  for (const element of scene.elements) {
    if (element.group?.childIds.includes(elementId)) return element
  }
  return null
}

/**
 * Walks `groupOwning` repeatedly to the top of the nesting chain. Returns
 * null when `elementId` is not a member of anything — including when
 * `elementId` names a group that is itself not nested inside another one.
 *
 * Guarded against a cycle (a malformed/hand-edited row whose `childIds`
 * loops back to an ancestor): a bounded walk, at most one hop per element on
 * the board, so a cycle terminates instead of looping forever. Cheap
 * insurance rather than a currently-known reachable bug.
 */
export function outermostGroup(
  scene: Scene,
  elementId: string,
): CanvasElement | null {
  let current: CanvasElement | null = null
  let cursor = elementId
  for (let hops = 0; hops <= scene.elements.length; hops++) {
    const owner = groupOwning(scene, cursor)
    if (!owner) return current
    current = owner
    cursor = owner.id
  }
  return current
}

/**
 * Every id transitively reachable through `groupId`'s nested `childIds` — a
 * BFS over the membership tree, recursing into any child that is itself a
 * group. The direct parallel of `connectorsTouching`/`withAttachedConnectors`
 * for group relationships.
 *
 * Cycle-safe: a visited-set guard means a `childIds` loop stops instead of
 * hanging the tab, and an id already seen is simply not re-descended into.
 */
export function groupDescendants(
  scene: Scene,
  groupId: string,
): Array<string> {
  const descendants: Array<string> = []
  const visited = new Set<string>([groupId])
  const queue: Array<string> = [groupId]
  while (queue.length > 0) {
    const id = queue.shift()!
    const element = scene.byId.get(id)
    if (!element?.group) continue
    for (const childId of element.group.childIds) {
      if (visited.has(childId)) continue
      visited.add(childId)
      descendants.push(childId)
      queue.push(childId)
    }
  }
  return descendants
}

/**
 * `ids` plus every descendant of any group among them, deduplicated — the
 * expanded set move/delete/duplicate/z-order all operate on so a group
 * transform reaches its whole subtree. Direct parallel to
 * `withAttachedConnectors`.
 */
export function withGroupMembers(
  scene: Scene,
  ids: ReadonlyArray<string>,
): Array<string> {
  const expanded = new Set(ids)
  for (const id of ids) {
    const element = scene.byId.get(id)
    if (!element?.group) continue
    for (const descendantId of groupDescendants(scene, id)) {
      expanded.add(descendantId)
    }
  }
  return [...expanded]
}

/**
 * Every id in `ids` that is NOT a descendant (via `groupDescendants`) of
 * another id also in `ids` — `withGroupMembers`'s inverse-shaped sibling: it
 * COLLAPSES a set that may double-list a group and one of its own members
 * down to the group alone, rather than expanding a group out to its members.
 * An id that IS such a descendant is moving/binding WITH that other id, not
 * independently, and must not also be evaluated on its own.
 *
 * Moved here from `use-canvas-input.ts` (Hermes code review, Minor Issue):
 * `canGroupSelection` (SelectionToolbar.tsx) needs the SAME collapse
 * `groupSelection` itself applies, so the Group button's enabled state
 * cannot promise an action the gesture then silently no-ops on. Shared by
 * `resolveMembershipUpdates`'s top-level filter and `groupSelection`'s own
 * descendant filter too.
 *
 * O(ids^2) `groupDescendants` calls in the worst case (Cassandra/Hermes
 * Minor Issue) — cheap in the common case, since `groupDescendants`
 * short-circuits for a non-group id, and this only runs once per gesture
 * end (or once per toolbar render), not per frame.
 */
export function topLevelIds(
  scene: Scene,
  ids: ReadonlyArray<string>,
): Array<string> {
  const descendantsByOther = new Map(
    ids.map((other) => [other, new Set(groupDescendants(scene, other))]),
  )
  return ids.filter(
    (id) =>
      !ids.some(
        (other) => other !== id && descendantsByOther.get(other)!.has(id),
      ),
  )
}

/**
 * One endpoint, repointed if it names `from`. Returns the SAME object when it
 * does not, so the caller can detect "nothing changed" by identity.
 *
 * A free endpoint is returned untouched: it names no element, so there is
 * nothing for a rename to reach.
 */
function remapEndpoint(
  endpoint: ConnectorEndpoint,
  from: string,
  to: string,
): ConnectorEndpoint {
  if (endpoint.kind !== 'element' || endpoint.elementId !== from)
    return endpoint
  return { ...endpoint, elementId: to }
}

/**
 * Point every connector endpoint naming `from` at `to` instead.
 *
 * Needed because an element created optimistically carries a client-side
 * uuid the server replaces with its own (`useCanvasElements`'s create
 * reconciliation). A quick-create draws its connector against that temporary
 * id, so without this the connector's `sourceId`/`targetId` names a row that
 * no longer exists the moment the ack lands: `connectorPath` can resolve
 * neither endpoint, the connector silently stops being drawn, and
 * `connectorsTouching` stops finding it — so a later delete of the element
 * would leave it behind instead of cascading.
 *
 * Returns the SAME scene object when nothing referenced `from`, matching
 * `updateElement`'s identity contract so React can skip the render.
 */
export function remapConnectorEndpoints(
  scene: Scene,
  from: string,
  to: string,
): Scene {
  const elements = scene.elements.map((element) => {
    const connector = element.connector
    if (!connector) return element
    const source = remapEndpoint(connector.source, from, to)
    const target = remapEndpoint(connector.target, from, to)
    if (source === connector.source && target === connector.target) {
      return element
    }
    return { ...element, connector: { ...connector, source, target } }
  })
  // Compared by identity rather than tracked with a flag set inside the
  // callback: the callback above returns the SAME object for every element it
  // did not rewrite, so a differing reference is exactly "this one changed".
  const changed = elements.some((element, i) => element !== scene.elements[i])
  return changed ? sceneFrom(elements) : scene
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
