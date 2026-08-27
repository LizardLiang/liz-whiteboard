// src/lib/canvas-element-adapter.ts
// The one place the stored canvas row and the engine's scene value meet.
//
// `CanvasElementRecord` (src/data/models.ts) uses positionX/positionY, matching
// every other table in the schema. The engine's `CanvasElement`
// (src/lib/canvas-engine/scene.ts) uses x/y in world space and knows nothing
// about storage. Neither should learn the other's vocabulary, so the rename
// lives here — and ONLY here.
//
// This file sits OUTSIDE src/lib/canvas-engine/ on purpose: that directory has
// no imports at all, which is what lets it be unit-tested without a browser or
// a database. Putting a data-layer import inside it would quietly end that.

import { sceneFrom } from './canvas-engine/scene'
import { ANCHOR_ATTACH } from './canvas-engine/connector-geometry'
import type {
  CanvasConnector,
  CanvasElement,
  ConnectorAnchor,
  ConnectorAttach,
  ConnectorEndpoint,
  CanvasElementKind as EngineKind,
  CanvasConnectorRouting as EngineRouting,
  Scene,
} from './canvas-engine/scene'
import type { CanvasElementRecord } from '@/data/models'
import type {
  CanvasElementProps,
  CanvasElementStyle,
  CreateCanvasElement,
  CanvasElementKind as StoredKind,
  CanvasConnectorRouting as StoredRouting,
  UpdateCanvasElement,
} from '@/data/schema'

/**
 * Compile-time proof that the two kind vocabularies have not drifted.
 *
 * The engine declares its kinds and the Zod schema declares them again — they
 * cannot share one declaration without the pure engine importing Zod. If a
 * kind is ever added to one side only, this line stops compiling, which is
 * strictly better than a row that validates and then renders as nothing.
 */
type Mutual<TLeft, TRight> = [TLeft] extends [TRight]
  ? [TRight] extends [TLeft]
    ? true
    : never
  : never
const _kindsAgree: Mutual<EngineKind, StoredKind> = true
void _kindsAgree
/** The same drift guard for the connector routing vocabulary. */
const _routingsAgree: Mutual<EngineRouting, StoredRouting> = true
void _routingsAgree

/** The stored side of a connector's payload, for the guard below. */
type StoredConnectorProps = Extract<CanvasElementProps, { kind: 'connector' }>

/**
 * The same drift guard, aimed at the ONE property of `curvature` that matters:
 * that it is still OPTIONAL on both sides.
 *
 * Not a vocabulary check like the two above — there is no union here, only a
 * number. It is a backward-compatibility check. Make the Zod field required
 * and the stored type narrows to `number` while the engine's stays `number |
 * undefined`, this line stops compiling, and the change is caught here instead
 * of in production as "every connector created before today fails validation
 * the moment it is touched" — which is precisely the failure both field
 * comments describe and neither could prevent on its own.
 */
const _curvaturesAgree: Mutual<
  CanvasConnector['curvature'],
  StoredConnectorProps['curvature']
> = true
void _curvaturesAgree

/**
 * The engine's `connector` field for a stored row, or `undefined`.
 *
 * `props` is the storage vocabulary (`sourceElementId`/`targetElementId`) and
 * the engine's is shorter (`sourceId`/`targetId`) — the same
 * one-place-only rename rule this file's header states for positionX/positionY
 * applies to it. Dispatching on `props.kind` rather than the row's top-level
 * `kind` is safe because the two are cross-validated at the schema (the W2
 * refine), and it is what gives TypeScript the narrowing.
 *
 * NULL AND UNDEFINED ARE ACCEPTED, and this is not defensive padding.
 * `CanvasElementRecord` types `props` as always present, but the column is
 * `"props" JSONB` — NULLABLE (schema-sql.ts) — so the type is optimistic
 * about what the database can actually hand back. Two live paths produce a
 * row without it: this project's own raw-SQL e2e seed scripts, which write
 * columns by name and can omit it, and a collaborator broadcast whose payload
 * was built from a partial row. That is the same shape of bug as board-undo's
 * `minRevision`, where a seed-written row sitting at a column default made a
 * legitimate value get rejected. A missing props means "no connector here",
 * which is right for every rectangle and text row and is the same
 * draws-nothing end state an unresolvable connector already has.
 */
function toEngineConnector(
  props: CanvasElementProps | null | undefined,
): CanvasElement['connector'] {
  if (!props || props.kind !== 'connector') return undefined
  const source = toEngineEndpoint(
    props.sourceElementId,
    props.sourceAttach ?? legacyAttach(props.sourceAnchor),
    props.sourcePoint,
  )
  const target = toEngineEndpoint(
    props.targetElementId,
    props.targetAttach ?? legacyAttach(props.targetAnchor),
    props.targetPoint,
  )
  // A row where an end is NEITHER attached nor free is malformed — the schema
  // refuses to write one. Reading it back as "no connector" rather than
  // throwing keeps one bad row from taking the whole board load down with it,
  // and lands it in the same draws-nothing state an unresolvable endpoint
  // already has.
  if (!source || !target) return undefined
  // Spread-guarded, exactly like `attach` in `toEngineEndpoint` below: a row
  // with no curvature must leave the KEY absent rather than set it to
  // undefined. `toStrictEqual` in the round-trip tests distinguishes the two,
  // and so does the engine's own "absent means no hand-applied bow" reading.
  //
  // `!== undefined` and NOT a truthiness check: a stored 0 is a real,
  // deliberate value — a connector the user bent and then straightened again
  // — and `curvature ? ... : {}` would silently drop it on every read.
  return {
    source,
    target,
    routing: props.routing,
    ...(props.curvature !== undefined ? { curvature: props.curvature } : {}),
  }
}

/**
 * One stored end -> the engine's union.
 *
 * The flat storage shape can express states the union cannot (both set,
 * neither set); this is the boundary that refuses them. `null` out means the
 * row was malformed, not that the end is free — a free end has a point.
 */
function toEngineEndpoint(
  elementId: string | null,
  attach: ConnectorAttach | undefined,
  point: { x: number; y: number } | undefined,
): ConnectorEndpoint | null {
  if (elementId !== null) {
    // Spread-guarded rather than assigned unconditionally: an absent
    // attachment must leave the KEY absent, not set it to undefined.
    // `toStrictEqual` in the round-trip tests distinguishes the two, and so
    // does the geometry's fallback, which asks whether it is truthy.
    return { kind: 'element', elementId, ...(attach ? { attach } : {}) }
  }
  if (point) return { kind: 'point', point: { x: point.x, y: point.y } }
  return null
}

/**
 * The stored `props` for an engine element — the inverse of
 * `toEngineConnector`.
 *
 * Every non-connector kind's props are still fully derivable from `kind`
 * (they are empty objects, by design — see schema.ts). A connector's are not,
 * which is why this function exists at all rather than the `{ kind }` literal
 * that used to be written inline at each call site.
 *
 * Throws for a connector element with no `connector` field. That pairing is a
 * programming error, not user input, and the alternative — silently writing a
 * rectangle's props under a connector's kind — persists a row that fails the
 * schema's own cross-validation on the way back in.
 */
function toStoredProps(element: CanvasElement): CanvasElementProps {
  if (element.kind !== 'connector') return { kind: element.kind }
  if (!element.connector) {
    throw new Error(
      `Connector element ${element.id} has no connector endpoints`,
    )
  }
  const { source, target, routing, curvature } = element.connector
  // Written out explicitly rather than through a keyed helper: computed keys
  // erase the union's own field types, and this object has to satisfy the
  // schema's exactly-one-of invariant by CONSTRUCTION — an attached end never
  // carries a point key, a free end never carries an anchor.
  return {
    kind: 'connector',
    sourceElementId: source.kind === 'element' ? source.elementId : null,
    targetElementId: target.kind === 'element' ? target.elementId : null,
    ...(source.kind === 'element' && source.attach
      ? { sourceAttach: source.attach }
      : {}),
    ...(target.kind === 'element' && target.attach
      ? { targetAttach: target.attach }
      : {}),
    ...(source.kind === 'point'
      ? { sourcePoint: { x: source.point.x, y: source.point.y } }
      : {}),
    ...(target.kind === 'point'
      ? { targetPoint: { x: target.point.x, y: target.point.y } }
      : {}),
    routing,
    // Spread-guarded and `!== undefined`-tested, mirroring the read side
    // above for the same two reasons: an un-bowed connector writes NO
    // `curvature` key (a row that never had one must not gain a null on its
    // next save), and a deliberate 0 is a value, not an absence.
    ...(curvature !== undefined ? { curvature } : {}),
  }
}

/**
 * A connector written before attachments were continuous carries one of the
 * four SIDES instead. Read as that side's midpoint, which is exactly where it
 * has always been drawn — so an old row keeps its appearance and simply
 * becomes draggable like any other.
 */
function legacyAttach(
  anchor: ConnectorAnchor | undefined,
): ConnectorAttach | undefined {
  return anchor ? ANCHOR_ATTACH[anchor] : undefined
}

/** Storage row -> engine element. The only positionX/positionY -> x/y rename. */
export function toEngineElement(record: CanvasElementRecord): CanvasElement {
  const connector = toEngineConnector(record.props)
  return {
    id: record.id,
    kind: record.kind,
    x: record.positionX,
    y: record.positionY,
    width: record.width,
    height: record.height,
    rotation: record.rotation,
    zIndex: record.zIndex,
    text: record.text,
    style: record.style,
    // Spread rather than `connector: undefined` so a rectangle's element has
    // no `connector` KEY at all, not a key holding undefined — `toStrictEqual`
    // in the existing tests distinguishes the two.
    ...(connector ? { connector } : {}),
  }
}

/**
 * A whole board's rows as a scene.
 *
 * `sceneFrom` re-sorts into z-order rather than trusting the query's ORDER BY.
 * That is not redundant: the same scene is also built from optimistic local
 * state that never went near SQL.
 */
export function toEngineScene(records: Array<CanvasElementRecord>): Scene {
  return sceneFrom(records.map(toEngineElement))
}

/** Engine element -> create payload, for persisting something drawn locally. */
export function toCreateInput(
  boardId: string,
  element: CanvasElement,
): CreateCanvasElement {
  return {
    boardId,
    kind: element.kind,
    positionX: element.x,
    positionY: element.y,
    width: element.width,
    height: element.height,
    zIndex: element.zIndex,
    text: element.text,
    style: element.style,
    props: toStoredProps(element),
  }
}

/**
 * Engine element -> update payload.
 *
 * Sends the element's full geometry and style rather than a diff. Persistence
 * happens on gesture END, not per frame, so the payload size is irrelevant
 * and "what the client believes the element is now" is the least ambiguous
 * thing to write. `kind` is absent because an element's kind never changes.
 */
export function toUpdatePatch(element: CanvasElement): UpdateCanvasElement {
  return {
    positionX: element.x,
    positionY: element.y,
    width: element.width,
    height: element.height,
    zIndex: element.zIndex,
    text: element.text,
    style: element.style,
    // Included for the same reason everything else here is: this payload is
    // "what the client believes the element is now", not a diff. It also
    // carries the ONLY editable props any kind has — a connector's `routing`
    // — so without it a routing change would have no way to reach storage.
    props: toStoredProps(element),
  }
}

/**
 * A full, row-shaped snapshot of one element — everything canvas-undo needs
 * to write it back exactly as it was, without a second database read.
 * Row vocabulary (positionX/positionY, not the engine's x/y) because this is
 * what the create/update write payloads speak.
 *
 * Lives here, not in src/lib/canvas-undo/, because it is still the SAME
 * positionX/positionY <-> x/y rename this file's header says lives in
 * exactly one place — canvas-undo previously kept a second, independent copy
 * of this conversion (`toSnapshot`/`snapshotToEngineElement` in
 * use-canvas-undo.ts), which is exactly the drift risk the single-transform-
 * pair rule (camera.ts) exists to prevent for coordinates (Hermes review,
 * finding 3). `boardId` is the one field beyond `CanvasElement`'s own that a
 * snapshot needs — the engine element carries no board reference — which is
 * why this is a distinct type from `CanvasElement` rather than a reuse of it.
 */
export interface CanvasElementSnapshot {
  id: string
  boardId: string
  kind: EngineKind
  positionX: number
  positionY: number
  width: number
  height: number
  rotation: number
  zIndex: number
  text: string | null
  style: CanvasElementStyle
  props: CanvasElementProps
}

/** Engine element -> the row-shaped snapshot canvas-undo persists (undo's record/restore path). */
export function toElementSnapshot(
  boardId: string,
  element: CanvasElement,
): CanvasElementSnapshot {
  return {
    id: element.id,
    boardId,
    kind: element.kind,
    positionX: element.x,
    positionY: element.y,
    width: element.width,
    height: element.height,
    rotation: element.rotation,
    zIndex: element.zIndex,
    text: element.text,
    style: element.style,
    // `rectangle` and `text` carry an empty props object, derivable from
    // `kind` alone — but a CONNECTOR's props hold its two endpoints and its
    // routing, and a snapshot that dropped them would restore a connector
    // joining nothing. This is precisely why `toStoredProps` exists instead
    // of the `{ kind: element.kind }` literal that used to be written here.
    props: toStoredProps(element),
  }
}

/** The inverse of `toElementSnapshot` — reapplies a captured snapshot (undo's create-with-id write, or a redo reapplication) as an engine element. */
export function fromElementSnapshot(
  snapshot: CanvasElementSnapshot,
): CanvasElement {
  const connector = toEngineConnector(snapshot.props)
  return {
    id: snapshot.id,
    kind: snapshot.kind,
    x: snapshot.positionX,
    y: snapshot.positionY,
    width: snapshot.width,
    height: snapshot.height,
    rotation: snapshot.rotation,
    zIndex: snapshot.zIndex,
    text: snapshot.text,
    style: snapshot.style,
    // The half of the round-trip that is easy to forget: `toElementSnapshot`
    // above writes the endpoints into `props`, and without reading them back
    // here an undone connector delete would restore a connector with no ends
    // — present in the scene, drawable by nothing, deletable only by id.
    ...(connector ? { connector } : {}),
  }
}
