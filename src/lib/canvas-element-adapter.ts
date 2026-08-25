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
import type {
  CanvasElement,
  CanvasElementKind as EngineKind,
  Scene,
} from './canvas-engine/scene'
import type { CanvasElementRecord } from '@/data/models'
import type {
  CanvasElementProps,
  CanvasElementStyle,
  CreateCanvasElement,
  CanvasElementKind as StoredKind,
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

/** Storage row -> engine element. The only positionX/positionY -> x/y rename. */
export function toEngineElement(record: CanvasElementRecord): CanvasElement {
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
    props: { kind: element.kind },
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
    // Both milestone-1 kinds carry an empty props object (see
    // `toCreateInput` above) — `props` exists on the stored row purely as
    // the kind-dispatch point documented in schema.ts, not as editable
    // content, so it is always fully derivable from `kind`.
    props: { kind: element.kind },
  }
}

/** The inverse of `toElementSnapshot` — reapplies a captured snapshot (undo's create-with-id write, or a redo reapplication) as an engine element. */
export function fromElementSnapshot(
  snapshot: CanvasElementSnapshot,
): CanvasElement {
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
  }
}
