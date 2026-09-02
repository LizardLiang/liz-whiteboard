// src/hooks/use-canvas-undo.ts
// Owns the canvas board's undo/redo stack (board-undo tactical plan, Wave 3,
// step 9).
//
// This hook is the ENTIRE bridge between the gesture-recording surface
// (use-canvas-input.ts's onCreate/onUpdate/onDelete callbacks, which fire
// once per gesture at commit) and the pure stack/inverse modules
// (src/lib/canvas-undo/undo-stack.ts, src/lib/canvas-undo/inverse.ts). It:
//
//   1. wraps `useCanvasElements`'s three mutation functions into a
//      `CanvasEditCallbacks` object the caller wires straight into
//      `useCanvasInput` — recording an entry once the FORWARD write is
//      acknowledged (never optimistically, since create/update need the
//      server's `revision` before an entry means anything);
//   2. on `undo()`, pops exactly one entry, builds its inverse against the
//      CURRENT revisions this hook can see, and — if not contested — applies
//      that inverse through the SAME ordinary mutation functions (no
//      privileged write path exists for undo, board-undo tactical plan,
//      Wave 1, step 4);
//   3. on `redo()`, reapplies the entry's forward content (carried as an
//      `after` field on the operation itself, NOT an identity-keyed
//      side-table — see "Redo content" below for why — never re-derives it
//      from `buildInverse`, which only ever produces the UNDO direction).
//
// Every write undo/redo issues is marked `ephemeral: true` and is NEVER
// itself passed back through the recording callbacks above — it is issued
// directly against `createElement`/`updateElements`/`deleteElements`, not
// through `useCanvasInput`'s gesture surface, so it cannot re-enter this
// hook's own recording path even by accident.
//
// Redo content (CORRECTED — headed-browser BUG-1): `CanvasUndoOperation`'s
// `create`/`update` variants carry an optional `after` snapshot (undo-
// stack.ts) — the content redo reapplies. This USED to live in a
// `WeakMap<CanvasUndoEntry, ReadonlyMap<elementId, CanvasElement>>` here
// instead, on the assumption that "push/pop never clone an entry" (true of
// Wave 2's push/pop functions alone) made the entry object a stable
// WeakMap key. That assumption broke the moment `refreshRevision` (the
// Hermes-review B1 fix, added AFTER this note was first written) started
// returning a NEW operation/entry object every time it refreshed a
// `create`/`update` operation's `afterRevision` — which happens on every
// successful undo/redo write to that element. The WeakMap lookup in
// `redo()` then silently missed (a different object reference than the one
// `record*` had set), `afterContent` came back `undefined`, and redo of a
// MOVE (or a restored element) was refused with "changed since your edit"
// even though nothing but the user's own undo had touched the row — see
// undo-stack.ts's own `CanvasUndoOperation` doc comment for the full
// explanation. Storing `after` ON the operation instead survives that
// rewrite for free: `refreshRevision`'s spread copies every field it does
// not explicitly overwrite, `after` included.

import { useCallback, useMemo, useReducer, useRef } from 'react'
import { toast } from 'sonner'
import type {
  CanvasEditCallbacks,
  CanvasUpdateGesture,
} from '@/components/canvas/use-canvas-input'
import type {
  CanvasElement,
  ConnectorEndpoint,
} from '@/lib/canvas-engine/scene'
import type { WorldRect } from '@/lib/canvas-engine/hit-test'
import type {
  CanvasMutationOptions,
  CanvasMutationResult,
  UseCanvasElementsReturn,
} from './use-canvas-elements'
import type {
  CanvasElementSnapshot,
  CanvasUndoEntry,
  CanvasUndoLabel,
  CanvasUndoOperation,
  UndoStack,
} from '@/lib/canvas-undo/undo-stack'
import type { InverseWrite } from '@/lib/canvas-undo/inverse'
import {
  fromElementSnapshot as snapshotToEngineElement,
  toElementSnapshot as toSnapshot,
} from '@/lib/canvas-element-adapter'
import {
  EMPTY_UNDO_STACK,
  elementKindForOperation,
  popRedoEntry,
  popUndoEntry,
  pushRedoEntry,
  pushUndoEntry,
  refreshRevision,
} from '@/lib/canvas-undo/undo-stack'
import { buildInverse } from '@/lib/canvas-undo/inverse'
import {
  REDO_EXHAUSTED_MESSAGE,
  UNDO_EXHAUSTED_MESSAGE,
  describeRedoRefusal,
  describeRedoSuccess,
  describeUndoRefusal,
  describeUndoSuccess,
} from '@/lib/canvas-undo/messages'

export interface UseCanvasUndoParams {
  boardId: string
  /** Gates every recording AND every apply — viewers and anonymous share-link visitors get nothing (Canvas Undo Respects Authorisation). */
  readOnly: boolean
  createElement: UseCanvasElementsReturn['createElement']
  updateElements: UseCanvasElementsReturn['updateElements']
  deleteElements: UseCanvasElementsReturn['deleteElements']
  getRevision: UseCanvasElementsReturn['getRevision']
  /**
   * Called with the id of the element a successful undo/redo affected, or a
   * refusal's contested target (board-undo tactical plan, Wave 4, step 12).
   * The caller (CanvasBoard.tsx) is the one place that knows the camera and
   * the viewport, so bringing the element into view and pulsing a highlight
   * both happen there — this hook only reports WHICH element, never how to
   * draw it. Never called on an exhausted history: there is no element to
   * focus ("Exhausted history is announced" has no target).
   *
   * On a SUCCESS, `rect` is ALWAYS supplied (never omitted) and reflects the
   * element's state AFTER this call's write, not before it — the WRITE this
   * hook just issued is the only place that knows the new content
   * authoritatively and immediately; a caller that instead re-read its own
   * rendered scene right after this fires would see whatever the scene held
   * BEFORE this write's `setScene` call had a chance to flush and re-render
   * (headed-browser BUG-2: undo's camera pan landed on the PRE-undo
   * position for exactly this reason). `rect` is `null` when the element no
   * longer exists after this write (undoing a create; redoing a delete) —
   * nothing to focus. On a REFUSAL, `rect` is omitted (`undefined`): this
   * hook never wrote anything, so the caller's own live scene — reflecting
   * whatever the contested element's current state actually is — is the
   * right (and only available) source, exactly as before.
   */
  onAffectedElement?: (elementId: string, rect?: WorldRect | null) => void
}

// No `canUndo`/`canRedo` here (Hermes review, finding 7): this hook used to
// compute and return them, but nothing ever consumed either — this board's
// toolbar has no undo/redo button, and no test asserted on them. Dropped
// rather than wired to a consumer that was not asked for; add them back the
// day a toolbar button needs to grey itself out.
export interface UseCanvasUndoReturn {
  /** Wire straight into `useCanvasInput({ callbacks })` — this IS the recording surface. */
  callbacks: CanvasEditCallbacks
  undo: () => void
  redo: () => void
}

// `toSnapshot`/`snapshotToEngineElement` (imported above, aliased from
// canvas-element-adapter.ts's `toElementSnapshot`/`fromElementSnapshot`) are
// the row<->engine rename this hook needs. They used to be defined here as a
// second, independent copy of that rename — canvas-element-adapter.ts's own
// header says the rename "lives here — and ONLY here" (Hermes review,
// finding 3); this hook now imports it instead of re-deriving it.

/**
 * One copied connector endpoint, repointed at the id the SERVER gave the
 * element the copy names — or null when that element never landed.
 *
 * Null rather than "leave it as it was": the id it currently holds is the
 * client-side one `planClone` minted, and persisting that would name a row
 * that never existed. The caller skips the whole connector instead, which is
 * the only honest outcome when one of the two things it joins is missing.
 *
 * A free endpoint cannot appear here — `planClone` drops any connector that
 * has one, since a free end has no copy to be repointed at — but it is
 * handled rather than asserted away, so a future planner that does hand one
 * over carries it through untouched instead of crashing.
 */
function repointEnd(
  endpoint: ConnectorEndpoint,
  serverIds: ReadonlyMap<string, string>,
): ConnectorEndpoint | null {
  if (endpoint.kind !== 'element') return endpoint
  const persisted = serverIds.get(endpoint.elementId)
  return persisted ? { ...endpoint, elementId: persisted } : null
}

/**
 * Snapshot -> the world rect `focusOnRect`/`isRectVisible` speak
 * (camera-focus.ts). Used to tell the caller EXACTLY where the affected
 * element now sits, rather than leaving it to re-derive that from the
 * rendered scene (headed-browser BUG-2 — see `onAffectedElement`'s own doc
 * comment above for why that read a stale, pre-write position).
 */
function snapshotToWorldRect(snapshot: CanvasElementSnapshot): WorldRect {
  return {
    x: snapshot.positionX,
    y: snapshot.positionY,
    width: snapshot.width,
    height: snapshot.height,
  }
}

const EPHEMERAL: CanvasMutationOptions = { ephemeral: true }

export function useCanvasUndo({
  boardId,
  readOnly,
  createElement,
  updateElements,
  deleteElements,
  getRevision,
  onAffectedElement,
}: UseCanvasUndoParams): UseCanvasUndoReturn {
  const stackRef = useRef<UndoStack>(EMPTY_UNDO_STACK)
  // Pre-delete-revision side-table (Hermes review, W-C) — keyed by the
  // 'delete' `CanvasUndoOperation` object itself. Safe as a WeakMap key
  // because `refreshRevision` (undo-stack.ts) explicitly leaves `delete`
  // operations untouched — it only ever rewrites `create`/`update`
  // operations (the ones carrying `afterRevision`) — so a 'delete'
  // operation's object reference is stable for the entry's entire lifetime,
  // unlike the `create`/`update` case BUG-1 found unstable (see undo-
  // stack.ts's `CanvasUndoOperation` doc comment). Populated in
  // `recordDelete` from the delete ack's `revision` (the row's LAST
  // revision — there is no row left after a delete to read a fresh one
  // from), and consulted when that delete's inverse (a restore) is applied,
  // so the restored row's revision is seeded ABOVE it rather than resetting
  // to 1 — closing an ABA hole where a stale undo/redo entry could match a
  // freshly-restored row's revision by coincidence.
  const lastRevisionBeforeDeleteRef = useRef(
    new WeakMap<CanvasUndoOperation, number>(),
  )
  const [, bumpVersion] = useReducer((n: number) => n + 1, 0)

  const push = useCallback((entry: CanvasUndoEntry) => {
    stackRef.current = pushUndoEntry(stackRef.current, entry)
    bumpVersion()
  }, [])

  // ── recording (forward gestures) ─────────────────────────────────────────

  const recordCreate = useCallback(
    (element: CanvasElement) => {
      if (readOnly) return
      void createElement(element).then((result) => {
        if (!result.ok || result.revision === undefined) return
        // `result.id` is always the ACKNOWLEDGED id here (result.ok is true),
        // which for an ordinary create almost always differs from the
        // client's temporary `element.id` — see createElement's own header.
        const entry: CanvasUndoEntry = {
          label: { gesture: 'create', elementKind: element.kind },
          operations: [
            {
              kind: 'create',
              elementId: result.id,
              afterRevision: result.revision,
              after: toSnapshot(boardId, { ...element, id: result.id }),
            },
          ],
        }
        push(entry)
      })
    },
    [boardId, createElement, push, readOnly],
  )

  /**
   * One creation-handle gesture — up to two elements — as ONE undo entry
   * (canvas quick-create-handles tactical plan, Wave 4, step 11).
   *
   * The two creates are SEQUENTIAL, not concurrent, and that is the whole
   * reason this cannot be two `recordCreate` calls. `createElement` mints the
   * row's id server-side, so the connector's `sourceId`/`targetId` are not
   * knowable until the element's ack arrives: issued in parallel, the
   * connector would be persisted against the client's temporary uuid and name
   * a row that never existed. The endpoints are rewritten from the ack here,
   * once, before the connector is written at all.
   *
   * If the element's create fails there is nothing to connect to and no entry
   * is pushed. If the CONNECTOR's create fails the element is still recorded,
   * alone, with `connected: false` — the element genuinely exists and must
   * stay undoable, and the toast must not claim a link that is not there.
   */
  const recordQuickCreate = useCallback(
    (elements: Array<CanvasElement>) => {
      if (readOnly) return
      const connector = elements.find((element) => element.connector)
      const created = elements.find((element) => !element.connector)
      const endpoints = connector?.connector
      // Bound to a local rather than re-read inside the async body below: a
      // narrowing on `connector.connector` does not survive the closure, and
      // a non-null assertion there would be the kind of claim this file
      // otherwise never makes.
      if (!connector || !endpoints) return

      void (async () => {
        const operations: Array<CanvasUndoOperation> = []
        // The END the connector must point at. Starts as whatever the gesture
        // supplied (an EXISTING element, in the drag-onto-an-element case,
        // whose id is already the server's) and is replaced by the ack below
        // whenever this gesture created the target itself. A quick-create
        // always attaches, so this is never a free end — but it is rebuilt
        // from the union rather than assuming, so a future gesture that does
        // hand over a free end cannot have an id written onto it.
        let targetEnd = endpoints.target

        if (created) {
          const result = await createElement(created)
          if (!result.ok || result.revision === undefined) return
          targetEnd =
            endpoints.target.kind === 'element'
              ? { ...endpoints.target, elementId: result.id }
              : endpoints.target
          operations.push({
            kind: 'create',
            elementId: result.id,
            afterRevision: result.revision,
            after: toSnapshot(boardId, { ...created, id: result.id }),
          })
        }

        const linked: CanvasElement = {
          ...connector,
          connector: { ...endpoints, target: targetEnd },
        }
        const connectorResult = await createElement(linked)
        const connected =
          connectorResult.ok && connectorResult.revision !== undefined
        if (connected) {
          operations.push({
            kind: 'create',
            elementId: connectorResult.id,
            afterRevision: connectorResult.revision as number,
            after: toSnapshot(boardId, {
              ...linked,
              id: connectorResult.id,
            }),
          })
        }

        if (operations.length === 0) return
        push({
          label: {
            gesture: 'quick-create',
            elementKind: created?.kind ?? null,
            connected,
          },
          operations,
        })
      })()
    },
    [boardId, createElement, push, readOnly],
  )

  const recordUpdate = useCallback(
    (
      elements: Array<CanvasElement>,
      before: Array<CanvasElement>,
      // Optional, defaulting to 'move': use-canvas-input.ts's real call
      // sites always supply it, but tests exercising this hook's OWN
      // recording/undo machinery in isolation should not have to pick a
      // gesture that is irrelevant to what they assert — only the Wave 4
      // toast wording reads this.
      gesture: CanvasUpdateGesture = 'move',
    ) => {
      if (readOnly) return
      const beforeById = new Map(before.map((element) => [element.id, element]))
      void updateElements(elements).then((results) => {
        const operations: Array<CanvasUndoOperation> = []
        const resultsById = new Map<string, CanvasMutationResult>(
          results.map((result) => [result.id, result]),
        )
        for (const element of elements) {
          const result = resultsById.get(element.id)
          const prior = beforeById.get(element.id)
          if (!result?.ok || result.revision === undefined || !prior) continue
          operations.push({
            kind: 'update',
            elementId: element.id,
            before: toSnapshot(boardId, prior),
            afterRevision: result.revision,
            after: toSnapshot(boardId, element),
          })
        }
        if (operations.length === 0) return
        // `resize`, `text-edit`, `routing`, `reconnect` and `bend` are always
        // single-element gestures. `move` (a multi-select drag) and `style`
        // (one click restyling the whole selection) can span several, which
        // is why the count lives on exactly those two variants — see
        // CanvasUndoLabel's own header.
        //
        // `bend` belongs with the single-element group and not with `move`
        // for a structural reason, not a stylistic one: its grip is only
        // drawn and only pressable when EXACTLY ONE connector is selected
        // (`use-canvas-input`'s `currentSelection.size === 1` gate), so a
        // multi-element bend is unreachable rather than merely unusual.
        const label: CanvasUndoLabel =
          gesture === 'move' || gesture === 'style' || gesture === 'z-order'
            ? { gesture, count: operations.length }
            : { gesture }
        push({ label, operations })
      })
    },
    [boardId, push, readOnly, updateElements],
  )

  const recordDelete = useCallback(
    (
      elements: Array<CanvasElement>,
      // Defaults to 'delete': every call site but the cut gesture omits it.
      gesture: 'delete' | 'cut' = 'delete',
      // A surviving group's `childIds` patch, folded into this SAME entry
      // (FR-018 write-time scenario, canvas-element-grouping PRD-alignment
      // finding 1) — `deleteSelection`'s own `resolveGroupCleanupUpdates`.
      // Defaults to `[]`: every call site but `deleteSelection` omits it.
      groupUpdates: Array<{ before: CanvasElement; after: CanvasElement }> = [],
    ) => {
      if (readOnly) return
      const ids = elements.map((element) => element.id)
      // Issued CONCURRENTLY, not sequentially: the two id sets are disjoint
      // by construction (`resolveGroupCleanupUpdates` never patches a group
      // that is itself among the doomed ids), so neither write depends on
      // the other's ack.
      void Promise.all([
        deleteElements(ids),
        groupUpdates.length > 0
          ? updateElements(groupUpdates.map((update) => update.after))
          : Promise.resolve([] as Array<CanvasMutationResult>),
      ]).then(([deleteResults, updateResults]) => {
        const resultsById = new Map(
          deleteResults.map((result) => [result.id, result]),
        )
        const operations: Array<CanvasUndoOperation> = []
        for (const element of elements) {
          const result = resultsById.get(element.id)
          if (!result?.ok) continue
          const op: CanvasUndoOperation = {
            kind: 'delete',
            elementId: element.id,
            before: toSnapshot(boardId, element),
          }
          // The ack's revision is the row's LAST (pre-delete) one — see the
          // WeakMap's own header note above.
          if (result.revision !== undefined) {
            lastRevisionBeforeDeleteRef.current.set(op, result.revision)
          }
          operations.push(op)
        }
        // `count` on the label stays the DELETE count only — see
        // messages.ts's "deleting N elements" wording, which would misname
        // the gesture if a group cleanup (a childIds UPDATE, nothing
        // deleted) inflated it.
        const deleteCount = operations.length
        const updateResultsById = new Map(
          updateResults.map((result) => [result.id, result]),
        )
        for (const update of groupUpdates) {
          const result = updateResultsById.get(update.after.id)
          if (!result?.ok || result.revision === undefined) continue
          operations.push({
            kind: 'update',
            elementId: update.after.id,
            before: toSnapshot(boardId, update.before),
            afterRevision: result.revision,
            after: toSnapshot(boardId, update.after),
          })
        }
        if (operations.length === 0) return
        push({
          label: { gesture, count: deleteCount },
          operations,
        })
      })
    },
    [boardId, deleteElements, push, readOnly, updateElements],
  )

  /**
   * One copy gesture — a paste or a duplicate — as ONE undo entry (canvas
   * copy-paste-duplicate tactical plan, step 3).
   *
   * TWO PHASES, for the reason `recordQuickCreate` spells out at length: a
   * connector's endpoints name elements whose SERVER ids do not exist until
   * their own creates have been acknowledged, so a connector written in the
   * same breath as the elements it joins would be persisted against
   * client-side ids and name rows that never existed. The elements go first,
   * their acks build the id map, and only then are the connectors written.
   *
   * The elements' creates are issued CONCURRENTLY, unlike quick-create's
   * single sequential pair. They do not depend on one another — only the
   * connectors depend on them — so a twelve-element paste costs one
   * round-trip's latency rather than twelve.
   *
   * Records only what actually persisted: an element whose create failed is
   * not in the entry, and if nothing persisted at all no entry is pushed.
   * Same rule as `recordQuickCreate` — an entry claiming rows that are not
   * there would undo into an error.
   */
  const recordClone = useCallback(
    (elements: Array<CanvasElement>, source: 'paste' | 'duplicate') => {
      if (readOnly) return
      // THREE categories, not two — `planClone` guarantees the plain/
      // connector split by order, but filtering rather than slicing keeps
      // every category independent, and a group needs its OWN category
      // (canvas-element-grouping tactical plan, bug found and fixed during
      // Wave 8 e2e testing — see `groups`' own handling below for why).
      const plain = elements.filter(
        (element) => !element.connector && !element.group,
      )
      const groups = elements.filter((element) => element.group)
      const connectors = elements.filter((element) => element.connector)

      void (async () => {
        const operations: Array<CanvasUndoOperation> = []
        // Client-side id → the id the server gave it. Also what the
        // connectors' endpoints AND the groups' own `childIds` are
        // rewritten through below.
        const serverIds = new Map<string, string>()

        const results = await Promise.all(
          plain.map(async (element) => ({
            element,
            result: await createElement(element),
          })),
        )
        for (const { element, result } of results) {
          if (!result.ok || result.revision === undefined) continue
          serverIds.set(element.id, result.id)
          operations.push({
            kind: 'create',
            elementId: result.id,
            afterRevision: result.revision,
            after: toSnapshot(boardId, { ...element, id: result.id }),
          })
        }

        // Groups, remapped and created ONLY after every id they could
        // possibly reference is known — never inside the SAME concurrent
        // batch as their own members (which is what `plain` above is,
        // exactly why a group cannot be `plain`). A cloned group's
        // `childIds` (rewritten client-side by `planClone`'s own idMap,
        // Wave 4) name the CLIENT-SIDE temporary ids `duplicateSelection`
        // minted, not the SERVER-assigned ids `createElement` returns for
        // an ORDINARY create (`toCreateInput` never sends a client id, so
        // the server always mints an independent one — see
        // `createElement`'s own header). Persisting the group with those
        // stale ids unrewritten would write a row whose `childIds` name
        // rows that were never actually created under those ids — a
        // dangling reference invisible until a RELOAD (or a second client)
        // reads it back, which is exactly how this was found: the unit
        // suite's mocked `createElement` echoes the client id back as the
        // "server" id, so client-id == server-id there and the bug never
        // showed; only a real server round trip, with a GENUINELY
        // different id, exposes it.
        //
        // Multi-pass rather than one: a cloned group may contain another
        // cloned group (nesting), whose OWN server id is not yet known on
        // the first pass either. Each pass creates every group whose FULL
        // `childIds` are already resolvable in `serverIds`; repeats until a
        // pass makes no further progress (bounded by nesting depth, which
        // `groupDescendants`'s own cycle guard, scene.ts, already keeps
        // finite).
        let remainingGroups = groups
        for (
          let pass = 0;
          pass <= elements.length && remainingGroups.length > 0;
          pass += 1
        ) {
          const ready = remainingGroups.filter((element) =>
            element.group!.childIds.every((childId) => serverIds.has(childId)),
          )
          if (ready.length === 0) break // a childId whose own create failed — see below
          remainingGroups = remainingGroups.filter(
            (element) => !ready.includes(element),
          )
          const groupResults = await Promise.all(
            ready.map(async (element) => {
              const remappedChildIds = element.group!.childIds.map(
                (childId) => serverIds.get(childId)!,
              )
              return {
                element,
                remappedChildIds,
                result: await createElement({
                  ...element,
                  group: { childIds: remappedChildIds },
                }),
              }
            }),
          )
          for (const { element, remappedChildIds, result } of groupResults) {
            if (!result.ok || result.revision === undefined) continue
            serverIds.set(element.id, result.id)
            operations.push({
              kind: 'create',
              elementId: result.id,
              afterRevision: result.revision,
              after: toSnapshot(boardId, {
                ...element,
                id: result.id,
                group: { childIds: remappedChildIds },
              }),
            })
          }
        }
        // Any group left in `remainingGroups` here named a childId whose
        // own create never landed (failed, or — for a nested group — a
        // child group that itself never landed) — dropped rather than
        // persisted with an unresolvable reference, the same "records only
        // what actually persisted" rule this function's own header already
        // documents for `plain`/`connectors`.

        for (const connector of connectors) {
          const ends = connector.connector
          if (!ends) continue
          // Both ends were in the copied selection — `planClone` drops any
          // connector where that is not true — so both must have landed for
          // this connector to be worth writing. If either element's create
          // failed, the connector has nothing to join and is skipped rather
          // than persisted with a dangling end.
          const fromEnd = repointEnd(ends.source, serverIds)
          const toEnd = repointEnd(ends.target, serverIds)
          if (!fromEnd || !toEnd) continue
          const linked: CanvasElement = {
            ...connector,
            connector: { ...ends, source: fromEnd, target: toEnd },
          }
          const result = await createElement(linked)
          if (!result.ok || result.revision === undefined) continue
          operations.push({
            kind: 'create',
            elementId: result.id,
            afterRevision: result.revision,
            after: toSnapshot(boardId, { ...linked, id: result.id }),
          })
        }

        if (operations.length === 0) return
        push({
          label: { gesture: source, count: operations.length },
          operations,
        })
      })()
    },
    [boardId, createElement, push, readOnly],
  )

  /**
   * One group-creation gesture (canvas-element-grouping tactical plan, Wave
   * 7) — a thin wrapper mirroring `recordCreate`'s shape exactly: one
   * `createElement` call, one `kind: 'create'` operation on ack. No writes
   * to any member — grouping only ever touches the new group row's own
   * `childIds` (canvas-engine/scene.ts's `group?` field), so this needs
   * nothing `recordCreate` does not already have.
   *
   * `count` on the label is the group's OWN `childIds.length` at creation —
   * the direct members bound, not a transitively-expanded subtree — mirroring
   * `move`/`z-order`'s "how many elements does this number describe"
   * convention for a gesture whose single write still affects several
   * elements' grouping state.
   */
  const recordGroup = useCallback(
    (groupElement: CanvasElement) => {
      if (readOnly) return
      void createElement(groupElement).then((result) => {
        if (!result.ok || result.revision === undefined) return
        const entry: CanvasUndoEntry = {
          label: {
            gesture: 'group',
            count: groupElement.group?.childIds.length ?? 0,
          },
          operations: [
            {
              kind: 'create',
              elementId: result.id,
              afterRevision: result.revision,
              after: toSnapshot(boardId, { ...groupElement, id: result.id }),
            },
          ],
        }
        push(entry)
      })
    },
    [boardId, createElement, push, readOnly],
  )

  /**
   * Dissolve-a-group-only gesture — mirrors `recordDelete`'s single-element
   * shape: one `deleteElements` call, one `kind: 'delete'` operation on ack.
   * Members need no write here either: dissolving a group only removes the
   * group's own row, and its members were never touched by grouping in the
   * first place (Wave 1), so they are already independent the instant it is
   * gone.
   *
   * Deliberately NOT `recordDelete` itself, even though both end in one
   * `deleteElements` call: that function's label is always `{ gesture:
   * 'delete' | 'cut' }`, and reusing it here would make an intentional,
   * one-level dissolve read in the undo toast exactly like a cascade delete
   * of a whole subtree (Wave 4's `deleteSelection`) — two very different
   * gestures a user needs to tell apart when Ctrl+Z asks what is coming
   * back.
   */
  const recordUngroup = useCallback(
    (groupElement: CanvasElement) => {
      if (readOnly) return
      void deleteElements([groupElement.id]).then((results) => {
        const result = results[0]
        if (!result.ok) return
        const entry: CanvasUndoEntry = {
          label: {
            gesture: 'ungroup',
            count: groupElement.group?.childIds.length ?? 0,
          },
          operations: [
            {
              kind: 'delete',
              elementId: groupElement.id,
              before: toSnapshot(boardId, groupElement),
            },
          ],
        }
        if (result.revision !== undefined) {
          lastRevisionBeforeDeleteRef.current.set(
            entry.operations[0],
            result.revision,
          )
        }
        push(entry)
      })
    },
    [boardId, deleteElements, push, readOnly],
  )

  const callbacks = useMemo<CanvasEditCallbacks>(
    () => ({
      onCreate: recordCreate,
      onQuickCreate: recordQuickCreate,
      onClone: recordClone,
      onUpdate: recordUpdate,
      onDelete: recordDelete,
      onGroup: recordGroup,
      onUngroup: recordUngroup,
    }),
    [
      recordClone,
      recordCreate,
      recordDelete,
      recordGroup,
      recordQuickCreate,
      recordUngroup,
      recordUpdate,
    ],
  )

  // ── applying (undo) ──────────────────────────────────────────────────────

  /** The outcome of one inverse write, enough to refresh the stack's own bookkeeping (Hermes review, BLOCKER B1 / W-C). */
  interface InverseWriteResult {
    ok: boolean
    elementId: string
    /** Present only on a successful create/update — see `refreshRevision`'s own header. Absent for delete: no row survives to carry one. */
    revision?: number
  }

  const applyInverseWrite = useCallback(
    async (
      write: InverseWrite,
      opsById: Map<string, CanvasUndoOperation>,
    ): Promise<InverseWriteResult> => {
      switch (write.kind) {
        case 'create': {
          const element = snapshotToEngineElement(write.snapshot)
          // The pre-delete revision this SAME entry's `recordDelete` stored
          // for this operation (Hermes review, W-C) — seeds the restored
          // row's revision ABOVE it rather than resetting to 1. `op` is the
          // ORIGINAL 'delete' operation (the inverse of a delete IS a
          // create), looked up by the same object reference the WeakMap was
          // keyed on at record time.
          const op = opsById.get(write.elementId)
          const minRevision =
            op?.kind === 'delete'
              ? lastRevisionBeforeDeleteRef.current.get(op)
              : undefined
          const res = await createElement(element, {
            ...EPHEMERAL,
            restoreOriginalId: true,
            minRevision,
          })
          return {
            ok: res.ok,
            elementId: write.elementId,
            revision: res.revision,
          }
        }
        case 'update': {
          const op = opsById.get(write.elementId)
          if (!op || op.kind !== 'update') {
            return { ok: false, elementId: write.elementId }
          }
          // Built from the recorded `before` SNAPSHOT (full geometry/kind/
          // rotation) — `inverse.ts`'s `InverseWrite` carries no payload for
          // `update` (Hermes review, finding 8: it used to, as an unread
          // `patch` field, a second copy of `before`'s content that nothing
          // in production ever consulted). The snapshot is what
          // `updateElements` needs to construct a valid engine element in
          // one step; `write.expectedRevision` (below) is still the value
          // that actually came from `buildInverse`.
          const element = snapshotToEngineElement(op.before)
          const results = await updateElements([element], {
            ...EPHEMERAL,
            expectedRevisions: new Map([
              [write.elementId, write.expectedRevision],
            ]),
          })
          const result = results[0]
          return {
            ok: result.ok,
            elementId: write.elementId,
            revision: result.revision,
          }
        }
        case 'delete': {
          const results = await deleteElements([write.elementId], {
            ...EPHEMERAL,
            expectedRevisions: new Map([
              [write.elementId, write.expectedRevision],
            ]),
          })
          const ok = results[0]?.ok ?? false
          // A successful conditional delete confirms the row's LAST revision
          // was exactly `write.expectedRevision` (that is what the server
          // just matched before removing it). Recorded against the ORIGINAL
          // 'create'/'update' operation this write is the inverse of, so
          // that IF this entry is later redone — recreating the row this
          // delete just removed — the redo can seed its revision ABOVE this
          // one instead of resetting to 1 (Hermes review, W-C, same ABA
          // hole, symmetric case: undo-then-redo rather than delete-then-
          // undo).
          if (ok) {
            const op = opsById.get(write.elementId)
            if (op) {
              lastRevisionBeforeDeleteRef.current.set(
                op,
                write.expectedRevision,
              )
            }
          }
          return { ok, elementId: write.elementId }
        }
      }
    },
    [createElement, deleteElements, updateElements],
  )

  /**
   * Reapply one entry OPERATION's FORWARD content — the gesture's own
   * result, `op.after` for create/update, an unconditional-on-id delete for
   * `delete` (which needs no content, only the id). This is `redo()`'s
   * entire per-operation write logic, extracted (Hermes review, finding 6:
   * `applyInverseWrite` above and redo's own inline `switch` used to be two
   * near-identical blocks with the same options wiring, free to drift — one
   * forgetting a guard is exactly how a bug enters here).
   *
   * Also `undo()`'s COMPENSATION path (Hermes review, finding 1): when a
   * multi-element inverse partially succeeds — some member writes accepted,
   * one refused — the member(s) that DID write now hold the "before"
   * content, violating `inverse.ts`'s own "applied not at all, never
   * partially" contract. Reapplying THIS function against exactly those
   * members' original operations is the correct compensating action: for a
   * `create` operation (whose inverse write was a `delete` that just
   * succeeded), it re-creates the element; for `update`, it writes `after`
   * back; for `delete`, it re-deletes the element the inverse `create` just
   * restored. Each call reads `getRevision(op.elementId)` for its own
   * conditional-write guard, which by the time undo's compensation runs
   * already reflects the inverse write's own just-acked revision — so the
   * compensating write is itself a correctly-guarded conditional write, not
   * a blind clobber.
   */
  const applyForwardWrite = useCallback(
    async (op: CanvasUndoOperation): Promise<InverseWriteResult> => {
      switch (op.kind) {
        case 'create': {
          // `op.after` — see undo-stack.ts's `CanvasUndoOperation` doc
          // comment (BUG-1 fix): carried as DATA on the operation itself
          // so it survives `refreshRevision`'s spread-based rewrite,
          // unlike the identity-keyed side-table this used to read from.
          if (!op.after) return { ok: false, elementId: op.elementId }
          const content = snapshotToEngineElement(op.after)
          // Symmetric to `applyInverseWrite`'s own 'create' case (Hermes
          // review, W-C): this reapplies a create that undo's own delete
          // just removed, so the SAME pre-delete-revision side-table
          // applies here too — seeded by `applyInverseWrite`'s 'delete'
          // case when THIS entry (or, for a compensation, this SAME write)
          // was undone.
          const minRevision = lastRevisionBeforeDeleteRef.current.get(op)
          const res = await createElement(content, {
            ...EPHEMERAL,
            restoreOriginalId: true,
            minRevision,
          })
          return { ok: res.ok, elementId: op.elementId, revision: res.revision }
        }
        case 'update': {
          if (!op.after) return { ok: false, elementId: op.elementId }
          const content = snapshotToEngineElement(op.after)
          const currentRevision = getRevision(op.elementId)
          const results = await updateElements([content], {
            ...EPHEMERAL,
            ...(currentRevision !== undefined
              ? {
                  expectedRevisions: new Map([[op.elementId, currentRevision]]),
                }
              : {}),
          })
          const result = results[0]
          return {
            ok: result.ok,
            elementId: op.elementId,
            revision: result.revision,
          }
        }
        case 'delete': {
          // Guarded exactly like the 'update' case immediately above
          // (Hermes review, W-A): an unconditional write here would
          // silently destroy a collaborator's edit made since. `getRevision`
          // reads WHATEVER this hook currently believes the row's revision
          // is — its own acks and every collaborator broadcast keep it
          // fresh — so a write that lands after a concurrent edit is
          // refused server-side (REVISION_MISMATCH) instead of clobbering
          // it.
          const currentRevision = getRevision(op.elementId)
          const results = await deleteElements([op.elementId], {
            ...EPHEMERAL,
            ...(currentRevision !== undefined
              ? {
                  expectedRevisions: new Map([[op.elementId, currentRevision]]),
                }
              : {}),
          })
          const result = results[0]
          // Keep the pre-delete-revision side-table current across repeated
          // undo/redo cycles (or an undo/compensation pair) on the SAME
          // operation (Hermes review, W-C): a FUTURE restore of this same
          // operation must seed above THIS delete's revision, not a stale
          // one captured earlier.
          if (result.ok && result.revision !== undefined) {
            lastRevisionBeforeDeleteRef.current.set(op, result.revision)
          }
          return { ok: result.ok, elementId: op.elementId }
        }
      }
    },
    [createElement, deleteElements, getRevision, updateElements],
  )

  const undo = useCallback(() => {
    if (readOnly) return
    const popped = popUndoEntry(stackRef.current)
    if (popped.status === 'nothing-to-undo') {
      // "Reaching the cap is not silent" / "No own edits remain" — an
      // exhausted history is announced, not a command that appears to do
      // nothing.
      toast.info(UNDO_EXHAUSTED_MESSAGE)
      return
    }

    // Popped unconditionally, BEFORE the write is attempted: exactly one
    // entry is consumed per call, whether the inverse succeeds, is contested,
    // or fails server-side — never a cascade to the next entry within this
    // one call ("One command is one attempt").
    stackRef.current = popped.stack
    bumpVersion()

    const revisions = new Map(
      popped.entry.operations.map((op) => [
        op.elementId,
        getRevision(op.elementId),
      ]),
    )
    const inverse = buildInverse(popped.entry, revisions)
    if (inverse.status === 'contested') {
      // Discarded, per "Canvas Undo Refuses A Contested Element" — the entry
      // is already gone from the stack above and is not pushed to redo.
      // Named by the FIRST contested member: `buildInverse` only returns
      // `status: 'contested'` when `members` is non-empty, and the
      // spec-delta's own scenario wording is singular ("the message names
      // the element") — this codebase's milestone-1 selections are small
      // enough that "the first one" and "the one that matters" coincide in
      // practice.
      const first = inverse.members[0]
      toast.warning(
        describeUndoRefusal(
          elementKindForOperation(popped.entry, first.elementId),
          first.reason,
        ),
      )
      onAffectedElement?.(first.elementId)
      return
    }

    const opsById = new Map(
      popped.entry.operations.map((op) => [op.elementId, op]),
    )
    void Promise.all(
      inverse.writes.map((write) => applyInverseWrite(write, opsById)),
    ).then(async (results) => {
      const allOk = results.length > 0 && results.every((r) => r.ok)
      // Every write's revision, refreshed at the end regardless of outcome
      // — see the loop below. Compensation (added below, for a partial
      // failure) can OVERWRITE an entry here with a later, truer revision
      // for the same element, which is why this is a Map keyed by
      // elementId rather than a flat array concatenation.
      const revisionUpdates = new Map<string, number>()
      for (const result of results) {
        if (result.ok && result.revision !== undefined) {
          revisionUpdates.set(result.elementId, result.revision)
        }
      }

      if (allOk) {
        stackRef.current = pushRedoEntry(stackRef.current, popped.entry)
        toast.success(describeUndoSuccess(popped.entry.label))
        // An entry always has at least one operation (recordCreate/
        // recordUpdate/recordDelete never push an empty one) — the first is
        // the "primary" element to focus for a multi-element entry.
        //
        // The rect passed is the RESTORED (post-undo) position — headed-
        // browser BUG-2: this must NOT be derived by the caller reading its
        // own scene right after this call, because that scene has not yet
        // re-rendered from the `setScene` this same write just issued. A
        // 'create' operation's undo DELETES the element (nothing to focus);
        // an 'update'/'delete' operation's undo writes `before` back, which
        // is exactly the element's new state.
        const primary = popped.entry.operations[0]
        const restoredRect: WorldRect | null =
          primary.kind === 'create' ? null : snapshotToWorldRect(primary.before)
        onAffectedElement?.(primary.elementId, restoredRect)
      } else {
        // Partial-application guard (Hermes review, finding 1): a
        // multi-element inverse is checked all-or-nothing client-side
        // (`buildInverse`, above) but applied as N independent, individually
        // conditional server writes — the client-side check can pass and one
        // member STILL lose a race against a collaborator's own concurrent
        // write. Left as-is, any member whose write DID land would stay
        // reverted to `before` while the rest of the entry (and the entry
        // itself, discarded either way below) was not — a half-reverted
        // board with no way back, contradicting `inverse.ts`'s own
        // documented "applied not at all, never partially" and the
        // spec-delta's "one reversal" for a multi-element gesture.
        //
        // Compensated here by reapplying the FORWARD content — via the SAME
        // shared per-operation write function `redo()` uses
        // (`applyForwardWrite`) — for exactly the member(s) whose inverse
        // write succeeded. Net effect: either every member reverted (the
        // `allOk` branch above) or NONE remain reverted, restoring the
        // "never partially" contract's OUTCOME even though the underlying
        // writes are still N independent round-trips (the N+1-round-trips
        // debt itself is out of scope — see use-canvas-elements.ts's own
        // "acceptable at milestone-1 selection sizes" note).
        const succeededOps = results
          .filter((r) => r.ok)
          .map((r) => opsById.get(r.elementId))
          .filter((op): op is CanvasUndoOperation => Boolean(op))

        if (succeededOps.length > 0) {
          const compensationResults = await Promise.all(
            succeededOps.map(applyForwardWrite),
          )
          for (const result of compensationResults) {
            if (result.ok && result.revision !== undefined) {
              // The compensating write is the FINAL, authoritative state for
              // this element — overwrites whatever the (now-reverted, then
              // re-forward-written) inverse write recorded above.
              revisionUpdates.set(result.elementId, result.revision)
            }
          }
          const compensationFailed = compensationResults.find((r) => !r.ok)
          if (compensationFailed) {
            // The rare double-failure: a THIRD write (the compensation
            // itself) also lost a race — e.g. a second collaborator edit
            // landing in the brief window between the inverse write and the
            // compensating one. Nothing left this hook can safely retry
            // automatically without risking clobbering whatever THAT edit
            // did; logged for diagnosis rather than silently swallowed. The
            // refusal toast below is still shown either way — the user
            // learns their undo did not go through, which remains true.
            console.error(
              'Canvas undo: partial-failure compensation could not fully ' +
                'restore element',
              compensationFailed.elementId,
              '— it may be left in an inconsistent state; a collaborator' +
                ' likely edited it again during the retry window.',
            )
          }
        }

        // A write that fails after passing this hook's own (client-side, and
        // therefore possibly stale) contest check is a race lost against the
        // server's OWN conditional check — the entry is simply dropped, same
        // as a client-detected contest, and reported the same way: named,
        // not attributed. `use-canvas-elements.ts` suppresses its OWN
        // generic error toast for this write (it is `ephemeral`), so this is
        // the only report the user sees.
        const failed = results.find((r) => !r.ok)
        if (failed) {
          toast.warning(
            describeUndoRefusal(
              elementKindForOperation(popped.entry, failed.elementId),
              'changed',
            ),
          )
          onAffectedElement?.(failed.elementId)
        }
      }
      // Refresh EVERY successful write's target, regardless of whether the
      // whole multi-element entry above was pushed to redo (Hermes review,
      // BLOCKER B1): the row's revision genuinely advanced server-side for
      // that element, and any OTHER stack entry (in `entries` OR `redo`)
      // still referencing it — an earlier create for the same element, or
      // this very entry once it lands in redo — must not judge a later undo
      // against the STALE revision it was originally recorded with. Without
      // this, the user's own undo makes their NEXT undo of the same element
      // look contested.
      for (const [elementId, revision] of revisionUpdates) {
        stackRef.current = refreshRevision(
          stackRef.current,
          elementId,
          revision,
        )
      }
      bumpVersion()
    })
  }, [
    applyForwardWrite,
    applyInverseWrite,
    getRevision,
    onAffectedElement,
    readOnly,
  ])

  // ── applying (redo) ──────────────────────────────────────────────────────

  const redo = useCallback(() => {
    if (readOnly) return
    const popped = popRedoEntry(stackRef.current)
    if (popped.status === 'nothing-to-redo') {
      toast.info(REDO_EXHAUSTED_MESSAGE)
      return
    }

    // `popRedoEntry` moves the entry back onto the undo stack as PART OF
    // popping it (see undo-stack.ts) — unconditionally, matching that
    // module's own documented asymmetry with `popUndoEntry` (which does NOT
    // auto-push to redo; only a caller-confirmed success does). Redo here is
    // therefore best-effort: if the reapplication below fails, the entry is
    // already back on the undo stack, consistent with the Wave-2-verified
    // module's own contract rather than a new invariant invented here.
    stackRef.current = popped.stack
    bumpVersion()

    // `applyForwardWrite` (defined above `undo`) is this loop's entire body
    // — shared with `undo()`'s partial-failure compensation path (Hermes
    // review, findings 1 and 6).
    void Promise.all(popped.entry.operations.map(applyForwardWrite)).then(
      (results) => {
        const allOk = results.length > 0 && results.every((r) => r.ok)
        if (allOk) {
          toast.success(describeRedoSuccess(popped.entry.label))
          // Symmetric to `undo()`'s own fix above (headed-browser BUG-2):
          // the rect passed is the REAPPLIED (post-redo) position, read
          // from the operation's own `after` snapshot — the write's own
          // known content, not a caller re-read of a not-yet-re-rendered
          // scene. A 'delete' operation's redo re-deletes the element
          // (nothing to focus).
          const primary = popped.entry.operations[0]
          const reappliedRect: WorldRect | null =
            primary.kind === 'delete' || !primary.after
              ? null
              : snapshotToWorldRect(primary.after)
          onAffectedElement?.(primary.elementId, reappliedRect)
        } else {
          // Same reasoning as `undo()`'s own failure branch: a write
          // refused after passing this hook's client-side check is
          // reported the same way undo reports a contest — named, not
          // attributed — and `use-canvas-elements.ts` suppresses its
          // generic error toast for this (`ephemeral`) write, so this is
          // the only report shown.
          const failed = results.find((r) => !r.ok)
          if (failed) {
            toast.warning(
              describeRedoRefusal(
                elementKindForOperation(popped.entry, failed.elementId),
                'changed',
              ),
            )
            onAffectedElement?.(failed.elementId)
          }
        }
        // Same staleness fix as `undo()` above (Hermes review, BLOCKER B1):
        // this reapplied entry sits BACK on the undo stack the moment it
        // was popped from redo (see `popRedoEntry`'s own contract), so
        // refreshing its own `afterRevision` — and any OTHER surviving
        // entry for the same element — is what keeps the NEXT undo from
        // reading a write this redo() itself just made as a contest.
        for (const result of results) {
          if (result.ok && result.revision !== undefined) {
            stackRef.current = refreshRevision(
              stackRef.current,
              result.elementId,
              result.revision,
            )
          }
        }
        bumpVersion()
      },
    )
  }, [applyForwardWrite, onAffectedElement, readOnly])

  return {
    callbacks,
    undo,
    redo,
  }
}
