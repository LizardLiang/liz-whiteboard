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
//   3. on `redo()`, reapplies the entry's forward content (kept in a
//      WeakMap side-table keyed by entry identity — see "Redo content"
//      below — never re-derives it from `buildInverse`, which only ever
//      produces the UNDO direction).
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
import type { CanvasElement } from '@/lib/canvas-engine/scene'
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

export interface UseCanvasUndoReturn {
  /** Wire straight into `useCanvasInput({ callbacks })` — this IS the recording surface. */
  callbacks: CanvasEditCallbacks
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

/** Engine element -> the row-vocabulary snapshot the pure modules speak. */
function toSnapshot(
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
    // canvas-element-adapter.ts's `toCreateInput`) — `props` exists on the
    // stored row purely as the kind-dispatch point documented in schema.ts,
    // not as editable content, so it is always fully derivable from `kind`.
    props: { kind: element.kind },
  }
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

/** Snapshot -> engine element, for a `create` inverse write (delete's undo) or a create redo. */
function snapshotToEngineElement(snapshot: CanvasElementSnapshot): CanvasElement {
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
        // `resize` and `text-edit` are always single-element gestures — only
        // `move` can span several (a multi-select drag), hence the count
        // living on that variant alone (see CanvasUndoLabel's own header).
        const label: CanvasUndoLabel =
          gesture === 'move'
            ? { gesture: 'move', count: operations.length }
            : { gesture }
        push({ label, operations })
      })
    },
    [boardId, push, readOnly, updateElements],
  )

  const recordDelete = useCallback(
    (elements: Array<CanvasElement>) => {
      if (readOnly) return
      const ids = elements.map((element) => element.id)
      void deleteElements(ids).then((results) => {
        const resultsById = new Map(
          results.map((result) => [result.id, result]),
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
        if (operations.length === 0) return
        push({
          label: { gesture: 'delete', count: operations.length },
          operations,
        })
      })
    },
    [boardId, deleteElements, push, readOnly],
  )

  const callbacks = useMemo<CanvasEditCallbacks>(
    () => ({
      onCreate: recordCreate,
      onUpdate: recordUpdate,
      onDelete: recordDelete,
    }),
    [recordCreate, recordDelete, recordUpdate],
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
          return { ok: res.ok, elementId: write.elementId, revision: res.revision }
        }
        case 'update': {
          const op = opsById.get(write.elementId)
          if (!op || op.kind !== 'update') {
            return { ok: false, elementId: write.elementId }
          }
          // Built from the recorded `before` SNAPSHOT (full geometry/kind/
          // rotation) rather than `write.patch` (which deliberately omits
          // id/kind/rotation — see inverse.ts's `CanvasElementInversePatch`
          // comment): the snapshot is a strict superset carrying everything
          // `updateElements` needs to construct a valid engine element in one
          // step. `write.expectedRevision` (below) is still the value that
          // actually came from `buildInverse` — only the WHAT-to-write side
          // takes the shortcut, not the contested-target guard.
          const element = snapshotToEngineElement(op.before)
          const results = await updateElements([element], {
            ...EPHEMERAL,
            expectedRevisions: new Map([[write.elementId, write.expectedRevision]]),
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
            expectedRevisions: new Map([[write.elementId, write.expectedRevision]]),
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
              lastRevisionBeforeDeleteRef.current.set(op, write.expectedRevision)
            }
          }
          return { ok, elementId: write.elementId }
        }
      }
    },
    [createElement, deleteElements, updateElements],
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
      popped.entry.operations.map((op) => [op.elementId, getRevision(op.elementId)]),
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
    ).then((results) => {
      const allOk = results.length > 0 && results.every((r) => r.ok)
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
    })
  }, [applyInverseWrite, getRevision, onAffectedElement, readOnly])

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

    void Promise.all(
      popped.entry.operations.map(async (op): Promise<InverseWriteResult> => {
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
            // case when THIS entry was undone.
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
            // (Hermes review, W-A): an unconditional redo of a delete would
            // silently destroy a collaborator's edit made between the undo
            // and this redo, with no refusal. `getRevision` here reads
            // WHATEVER this hook currently believes the row's revision is —
            // its own acks and every collaborator broadcast keep it fresh —
            // so a write that lands after a concurrent edit is refused
            // server-side (REVISION_MISMATCH) instead of clobbering it.
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
            // Keep the pre-delete-revision side-table current across
            // repeated undo/redo cycles on the SAME 'delete' entry (Hermes
            // review, W-C): if this element was edited again between an
            // earlier restore and this re-delete, a FUTURE undo restoring it
            // once more must seed above THIS delete's revision, not the
            // stale one captured the first time this entry was ever undone.
            if (result.ok && result.revision !== undefined) {
              lastRevisionBeforeDeleteRef.current.set(op, result.revision)
            }
            return { ok: result.ok, elementId: op.elementId }
          }
        }
      }),
    ).then((results) => {
      const allOk = results.length > 0 && results.every((r) => r.ok)
      if (allOk) {
        toast.success(describeRedoSuccess(popped.entry.label))
        // Symmetric to `undo()`'s own fix above (headed-browser BUG-2): the
        // rect passed is the REAPPLIED (post-redo) position, read from the
        // operation's own `after` snapshot — the write's own known content,
        // not a caller re-read of a not-yet-re-rendered scene. A 'delete'
        // operation's redo re-deletes the element (nothing to focus).
        const primary = popped.entry.operations[0]
        const reappliedRect: WorldRect | null =
          primary.kind === 'delete' || !primary.after
            ? null
            : snapshotToWorldRect(primary.after)
        onAffectedElement?.(primary.elementId, reappliedRect)
      } else {
        // Same reasoning as `undo()`'s own failure branch: a write refused
        // after passing this hook's client-side check is reported the same
        // way undo reports a contest — named, not attributed — and
        // `use-canvas-elements.ts` suppresses its generic error toast for
        // this (`ephemeral`) write, so this is the only report shown.
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
      // this reapplied entry sits BACK on the undo stack the moment it was
      // popped from redo (see `popRedoEntry`'s own contract), so refreshing
      // its own `afterRevision` — and any OTHER surviving entry for the same
      // element — is what keeps the NEXT undo from reading a write this
      // redo() itself just made as a contest.
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
    })
  }, [
    createElement,
    deleteElements,
    getRevision,
    onAffectedElement,
    readOnly,
    updateElements,
  ])

  return {
    callbacks,
    undo,
    redo,
    canUndo: stackRef.current.entries.length > 0,
    canRedo: stackRef.current.redo.length > 0,
  }
}
