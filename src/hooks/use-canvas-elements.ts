// src/hooks/use-canvas-elements.ts
// Canvas element mutations and live sync (tactical plan Wave 4, step 13;
// revision/ephemeral/conditional-write additions, Wave 3, step 8).
//
// Mirrors use-whiteboard-shapes.ts's D-4 pattern: every mutation is ACKED and
// rolled back on failure, never fire-and-forget. The `area:update` /
// `area:delete` precedent in this repo drops failures silently; that half is
// deliberately not copied, exactly as the shapes hook records.
//
// Socket vocabulary is the established per-entity CRUD:
//   element:create  -> element:created
//   element:update  -> element:updated
//   element:delete  -> element:deleted
//
// Persistence happens at gesture END, not per frame. That rule is enforced
// upstream in use-canvas-input.ts, which calls these only on pointerup or
// commit — this hook does no throttling of its own and would happily write 60
// times a second if asked to.
//
// Two deliberate divergences from the shapes hook, both explained at the
// point they happen: incoming broadcasts are not filtered by `userId`, and
// rollback restores the last SERVER-CONFIRMED element rather than a snapshot
// taken at emit time.
//
// Wave 3 additions for canvas undo:
//   - each mutation function now RETURNS a Promise so a caller (the undo
//     hook) can await the acknowledged revision instead of only reacting to
//     scene/toast side effects.
//   - `getRevision(id)` exposes this hook's own revision index, built from
//     the initial load, every ack this hook settles, and every collaborator
//     broadcast — undo needs the CURRENT revision of a target to detect
//     contention, and the engine's own `CanvasElement` (canvas-engine/scene.ts)
//     carries no revision field.
//   - `options.expectedRevisions` threads a per-element conditional-write
//     guard through to `element:update` / `element:delete`'s existing
//     `expectedRevision` field (board-undo tactical plan, Wave 1, step 4).
//     Absent for an ordinary forward edit, which keeps last-write-wins.
//   - `options.ephemeral` documents (it does not itself enforce) that a call
//     was issued by reconciliation or by undo's own inverse machinery rather
//     than a fresh user gesture. Enforcement of "not undoable" is structural,
//     not a runtime branch here: the one existing programmatic write (the
//     deferred delete below, when a delete races an in-flight create) is
//     issued from INSIDE this hook, never through `use-canvas-input`'s
//     onCreate/onUpdate/onDelete callbacks — the sole recording surface a
//     caller like use-canvas-undo.ts wires up — so it is already excluded
//     from recording by construction. The flag exists so that fact is
//     documented at the call site instead of merely true by accident.
//   - `createElement` accepts `options.restoreOriginalId` for undo's
//     restore-a-deleted-element path: when set, the element's OWN `id` (the
//     original server id undo already knows) is sent as `data.id` on
//     `element:create`, through the exact same wire path and server-side
//     `denyMutation` gate as an ordinary create (board-undo tactical plan,
//     Wave 1, step 4's "no privileged undo path" guarantee). Absent, an
//     ordinary draw never sends an id and the server always mints one.
//
// Hermes fix pass (2026-08-25):
//   - W-B: `emitDelete` reads `confirmedRef` fresh in its own ack callback
//     instead of a `restore` snapshot captured at emit time; `onUpdated`
//     merges against `confirmedRef` unconditionally (not gated on the scene
//     still holding the element) so a broadcast landing while a delete is
//     in flight is never silently dropped.
//   - W-C: `emitDelete`'s success resolves the row's pre-delete `revision`
//     (the server's ack already carries it); `createElement` accepts
//     `options.minRevision` alongside `restoreOriginalId`, seeding the
//     restored row's revision above the deleted row's last one server-side
//     — closing an ABA hole where a restore resetting to revision 1 could
//     match a stale undo/redo entry by coincidence.
//
// Wave 4 (reporting):
//   - the generic `toast.error(...)` on a failed create/update/delete is now
//     suppressed when `options.ephemeral` is set. An ephemeral write is
//     always issued BY use-canvas-undo.ts (an inverse, or a redo's
//     reapplication), which owns its own named, non-attributing report for
//     that outcome — showing this hook's generic message too would either
//     duplicate it or, for a plain reconciliation write nobody asked about,
//     surface an error with nothing for the user to act on.

import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import type { Dispatch, SetStateAction } from 'react'
import type { CanvasElement, Scene } from '@/lib/canvas-engine/scene'
import type { CanvasElementRecord } from '@/data/models'
import {
  toCreateInput,
  toEngineElement,
  toUpdatePatch,
} from '@/lib/canvas-element-adapter'
import {
  addElement,
  removeElement,
  removeElements,
  updateElement,
} from '@/lib/canvas-engine/scene'

type Emit = (event: string, data: any, ack?: (res: any) => void) => void
type On = (event: string, handler: (...args: Array<any>) => void) => void
type Off = (event: string, handler: (...args: Array<any>) => void) => void

interface AckResult<T> {
  ok: boolean
  entity?: T
  message?: string
}

/**
 * How long to wait for a server ack before treating the mutation as failed.
 *
 * Socket.IO acks have no timeout of their own: if the connection drops after
 * the emit leaves but before the reply arrives, the callback is simply never
 * invoked — and every rollback in this hook lives in that callback, so the
 * element would stay optimistic forever with no error and no resync.
 *
 * Deliberately scoped to the canvas hook rather than added to the shared
 * `emit`. A timeout that fires on a slow-but-successful server response rolls
 * back a change that DID persist, and imposing that risk on the ER board —
 * whose acked mutations are not this hook and were not reviewed here — is not
 * this change to make.
 */
const ACK_TIMEOUT_MS = 10_000

export interface UseCanvasElementsParams {
  boardId: string
  /** Socket listeners active. False when the board is not connected. */
  enabled: boolean
  /** The board as loaded from the server — the first confirmed state. */
  initialElements: Array<CanvasElementRecord>
  setScene: Dispatch<SetStateAction<Scene>>
  on: On
  off: Off
  emit: Emit
  /**
   * A locally-created element received its real, server-generated id.
   *
   * The element was drawn and rendered before the server ever saw it, so it
   * carried a client-side uuid. The row's id is authoritative, so the caller
   * must remap anything keyed on the old one — the selection, and the text
   * element the user may already be typing into.
   */
  onElementIdReconciled?: (temporaryId: string, persistedId: string) => void
}

/** Per-call options shared by all three mutation functions (Wave 3, step 8). */
export interface CanvasMutationOptions {
  /**
   * Marks a write as issued BY undo/redo's own inverse machinery rather
   * than a fresh user gesture. Two real, if narrow, effects (Hermes review,
   * finding 4 — this used to read as pure documentation with no runtime
   * check):
   *
   *   1. Suppresses this hook's generic `toast.error(...)` on a failed
   *      create/update/delete (see the three `!options?.ephemeral` guards
   *      below) — `use-canvas-undo.ts` owns a named, non-attributing report
   *      for that outcome instead, and showing both would either duplicate
   *      it or surface an error nobody asked about.
   *   2. Documents, but does NOT itself enforce, "not undoable": the one
   *      caller that writes without a fresh gesture (the deferred
   *      create-then-delete race, `emitDeleteRef.current(...)` below) is
   *      issued from INSIDE this hook, never through `use-canvas-input`'s
   *      onCreate/onUpdate/onDelete callbacks — the sole recording surface
   *      `use-canvas-undo.ts` wires up — so it is excluded from recording
   *      STRUCTURALLY, not because this flag branches on anything for that
   *      purpose. See the file header's "Wave 3 additions" note for the
   *      full history.
   */
  ephemeral?: boolean
  /**
   * Per-element conditional-write guard, keyed by element id — undo's
   * contested-target refusal. Absent (or an id missing from the map) keeps
   * an ordinary, unconditional last-write-wins write.
   */
  expectedRevisions?: ReadonlyMap<string, number>
}

/** Result of a single element's create/update attempt. */
export interface CanvasMutationResult {
  id: string
  ok: boolean
  /** The acknowledged revision, present only when `ok` and the server returned the row. */
  revision?: number
}

export interface UseCanvasElementsReturn {
  createElement: (
    element: CanvasElement,
    options?: CanvasMutationOptions & {
      restoreOriginalId?: boolean
      /** Seeds the restored row's revision ABOVE the deleted row's last one (Hermes review, W-C). */
      minRevision?: number
    },
  ) => Promise<CanvasMutationResult>
  updateElements: (
    elements: Array<CanvasElement>,
    options?: CanvasMutationOptions,
  ) => Promise<Array<CanvasMutationResult>>
  deleteElements: (
    ids: Array<string>,
    options?: CanvasMutationOptions,
  ) => Promise<Array<CanvasMutationResult>>
  /** This hook's own revision index — see the file header. */
  getRevision: (id: string) => number | undefined
}

export function useCanvasElements({
  boardId,
  enabled,
  initialElements,
  setScene,
  on,
  off,
  emit,
  onElementIdReconciled,
}: UseCanvasElementsParams): UseCanvasElementsReturn {
  /**
   * The last state the SERVER confirmed for each element — the load, plus
   * every successful ack, plus every collaborator broadcast.
   *
   * This is what a failed mutation rolls back to, and it is not the same as
   * "the element before this emit". The scene IS the drag state here: a drag
   * has already written its final position into the scene by the time the
   * gesture ends and the update is emitted, so a snapshot taken at emit time
   * would be the optimistic value and rolling back to it would be a visible
   * no-op with a toast on top. The shapes hook can snapshot at emit time only
   * because React Flow holds the drag state separately from its `shapes`.
   */
  const confirmedRef = useRef<Map<string, CanvasElement>>(new Map())
  /**
   * This hook's own revision index (Wave 3, step 8) — see the file header.
   * Deliberately separate from `confirmedRef` rather than folding a revision
   * field onto the engine's `CanvasElement`: the engine type is intentionally
   * revision-free (canvas-engine/ has no server concept at all), and undo is
   * the only consumer of this index.
   */
  const revisionsRef = useRef<Map<string, number>>(new Map())
  const seededRef = useRef(false)
  if (!seededRef.current) {
    seededRef.current = true
    for (const record of initialElements) {
      confirmedRef.current.set(record.id, toEngineElement(record))
      revisionsRef.current.set(record.id, record.revision)
    }
  }

  const confirm = useCallback((element: CanvasElement) => {
    confirmedRef.current.set(element.id, element)
  }, [])

  const getRevision = useCallback(
    (id: string) => revisionsRef.current.get(id),
    [],
  )

  /**
   * Wrap an ack handler so it runs exactly once — on the server reply, or on
   * timeout, whichever comes first.
   *
   * The settle-once guard matters in both directions: a late reply arriving
   * after the timeout must not re-apply a mutation already rolled back, and
   * the timeout must not fire after a reply already handled it.
   */
  const settleOnce = useCallback(
    <T,>(handle: (res: AckResult<T>) => void) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        handle({
          ok: false,
          message: 'The server did not respond. Your change was not saved.',
        })
      }, ACK_TIMEOUT_MS)

      return (res: AckResult<T>) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        handle(res)
      }
    },
    [],
  )

  /** Temporary ids whose `element:create` has been emitted but not acked. */
  const pendingCreatesRef = useRef<Set<string>>(new Set())

  /**
   * Temporary ids the user deleted while their create was still in flight.
   *
   * The delete cannot be emitted yet — the server has not named the row — and
   * dropping it leaves an orphan on the server that the create ack then
   * re-adds to the board. It is re-issued against the reconciled id instead.
   */
  const pendingDeletesRef = useRef<Set<string>>(new Set())

  /**
   * Elements the user EDITED while their create was still in flight, keyed by
   * the temporary id, holding the content to write once the row has a real one.
   *
   * The exact counterpart of `pendingDeletesRef` above, and it exists for the
   * same reason: an `element:update` naming a temporary id addresses a row the
   * server has never heard of, so it comes back NOT_FOUND and the user's edit
   * is silently lost behind an error toast they can do nothing about.
   *
   * Only reachable since quick-create began opening the text editor on an
   * element whose create is still in flight (canvas quick-create-handles,
   * Wave 4): every older path either persists at commit (the text tool) or
   * opens no editor at all (the rectangle tool), so no update could ever
   * precede its own create. Found end-to-end — quick-create, type, click away
   * fast, and the text never reached the database.
   */
  const pendingUpdatesRef = useRef(new Map<string, CanvasElement>())

  /**
   * Forward reference to `updateElements`, which is declared below
   * `createElement` but has to be callable from inside its ack. Mirrors
   * `emitDeleteRef`, which exists for exactly the same ordering reason.
   */
  const updateElementsRef = useRef<
    (
      elements: Array<CanvasElement>,
      options?: CanvasMutationOptions,
    ) => Promise<Array<CanvasMutationResult>>
  >(() => Promise.resolve([]))

  // ── live sync from collaborators ─────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return

    const onCreated = (record: CanvasElementRecord & { createdBy: string }) => {
      // NOT filtered by `createdBy === userId`, unlike the shapes hook.
      // `socket.broadcast.emit` already excludes the socket that sent the
      // event, so the only thing a userId filter can still exclude is the
      // SAME user's other tab — which is precisely the two-window case the
      // plan's manual validation asks to verify. Idempotence by id is the
      // guard that is actually needed, and it is the one applied.
      const element = toEngineElement(record)
      confirm(element)
      revisionsRef.current.set(element.id, record.revision)
      setScene((prev) =>
        prev.byId.has(element.id) ? prev : addElement(prev, element),
      )
    }

    const onUpdated = (
      payload: Partial<CanvasElementRecord> & {
        elementId: string
        updatedBy: string
        /** Carried on every broadcast since Wave 1 — see handlers.ts. */
        revision?: number
      },
    ) => {
      // Merge defaults come from `confirmedRef`, NOT from the rendered scene
      // (Hermes review, W-B). An in-flight optimistic delete already removed
      // this element from the scene before any ack or broadcast about it can
      // arrive, so gating the merge on `prev.byId.get(...)` would silently
      // drop every broadcast that lands during that window — this hook's own
      // `confirmedRef` would then never learn of it, and a rollback later
      // reading `confirmedRef` would restore the STALE pre-broadcast value,
      // permanently diverging from the server. `confirmedRef` is not cleared
      // until the delete is actually acked (see `emitDelete`), so it remains
      // a valid merge base throughout that window.
      const base = confirmedRef.current.get(payload.elementId)
      if (!base) return
      // The broadcast speaks the STORAGE vocabulary (positionX/positionY).
      // Spreading it onto an engine element would leave x/y untouched while
      // silently adding two fields the renderer never reads — the element
      // would simply not move. Everything goes through the adapter.
      const merged = toEngineElement({
        id: base.id,
        boardId,
        kind: base.kind,
        positionX: payload.positionX ?? base.x,
        positionY: payload.positionY ?? base.y,
        width: payload.width ?? base.width,
        height: payload.height ?? base.height,
        rotation: base.rotation,
        zIndex: payload.zIndex ?? base.zIndex,
        text: payload.text !== undefined ? payload.text : base.text,
        style: payload.style ?? base.style,
      } as CanvasElementRecord)
      confirm(merged)
      if (payload.revision !== undefined) {
        revisionsRef.current.set(merged.id, payload.revision)
      }
      setScene((prev) =>
        prev.byId.has(merged.id) ? updateElement(prev, merged.id, merged) : prev,
      )
    }

    const onDeleted = (payload: { elementId: string; deletedBy: string }) => {
      confirmedRef.current.delete(payload.elementId)
      revisionsRef.current.delete(payload.elementId)
      setScene((prev) => removeElement(prev, payload.elementId))
    }

    on('element:created', onCreated)
    on('element:updated', onUpdated)
    on('element:deleted', onDeleted)
    return () => {
      off('element:created', onCreated)
      off('element:updated', onUpdated)
      off('element:deleted', onDeleted)
    }
  }, [boardId, confirm, enabled, off, on, setScene])

  // ── create ───────────────────────────────────────────────────────────────
  //
  // The element is already on screen with a client-side id when this runs.
  // The server generates its own id, so success is a RECONCILIATION (swap the
  // temporary element for the persisted row) and failure is a rollback
  // (remove it). Sending the client id instead would mean trusting a
  // client-controlled primary key, which nothing else in this schema does.
  const createElement = useCallback(
    (
      element: CanvasElement,
      options?: CanvasMutationOptions & {
        restoreOriginalId?: boolean
        /**
         * Seeds the restored row's revision ABOVE the deleted row's last one
         * (Hermes review, W-C) — only meaningful, and only honoured
         * server-side, alongside `restoreOriginalId`.
         */
        minRevision?: number
      },
    ): Promise<CanvasMutationResult> => {
      const temporaryId = element.id
      pendingCreatesRef.current.add(temporaryId)
      // `restoreOriginalId` is undo's restore-a-deleted-element path (Wave 1,
      // step 4): the element's own `id` — already the ORIGINAL server id undo
      // is restoring — is sent through unchanged. An ordinary draw never sets
      // this, so `toCreateInput` never emits an `id` for one, and the server
      // always mints a fresh one (see toCreateInput's own header).
      const payload = options?.restoreOriginalId
        ? {
            ...toCreateInput(boardId, element),
            id: element.id,
            ...(options.minRevision !== undefined
              ? { minRevision: options.minRevision }
              : {}),
          }
        : toCreateInput(boardId, element)
      return new Promise<CanvasMutationResult>((resolve) => {
        emit(
          'element:create',
          payload,
          settleOnce<CanvasElementRecord>((res) => {
            pendingCreatesRef.current.delete(temporaryId)
            const deletedWhileInFlight =
              pendingDeletesRef.current.delete(temporaryId)

            if (!res.ok || !res.entity) {
              setScene((prev) => removeElement(prev, temporaryId))
              // A create that failed and was then deleted needs no error: the
              // element is gone, which is what the user asked for. Nor does
              // an EPHEMERAL create (undo's restore-a-deleted-element path) —
              // use-canvas-undo.ts owns that reporting with a named,
              // non-attributing message (board-undo tactical plan, Wave 4,
              // step 11); this generic one would either duplicate it or, for
              // a plain reconciliation write, surface an error the user never
              // asked about and cannot act on.
              if (!deletedWhileInFlight && !options?.ephemeral) {
                toast.error(res.message ?? 'Failed to create element')
              }
              resolve({ id: temporaryId, ok: false })
              return
            }

            const persisted = toEngineElement(res.entity)
            revisionsRef.current.set(persisted.id, res.entity.revision)

            if (deletedWhileInFlight) {
              // The user deleted this before the server named it. Now that it
              // has an id, delete it for real — and never put it back on
              // screen, which the reconciliation below would otherwise do.
              // This delete is issued ephemerally: no user gesture initiated
              // IT specifically, it is a continuation of the delete that
              // already ran (or will run) through the recording surface, so
              // it must not become a SECOND undo entry. Resolving `ok: false`
              // here means the ORIGINAL create is not recorded as undoable
              // either — nothing about this element ever stably existed for
              // another observer to have seen (Remote And Derived Canvas
              // Writes Are Not Undoable's "reconciling optimistic state"
              // scenario).
              confirm(persisted)
              setScene((prev) => removeElements(prev, [temporaryId, persisted.id]))
              emitDeleteRef.current(persisted.id, { ephemeral: true })
              resolve({ id: temporaryId, ok: false })
              return
            }

            confirm(persisted)
            setScene((prev) => {
              if (prev.byId.has(persisted.id)) {
                return removeElement(prev, temporaryId)
              }
              if (!prev.byId.has(temporaryId)) {
                return addElement(prev, persisted)
              }
              // Anything TYPED between the emit above and this ack is a user
              // edit the server could not have known about, and swapping the
              // server's row straight in would silently discard it.
              //
              // Only reachable since quick-create began opening the text
              // editor on an element whose create is still in flight (canvas
              // quick-create-handles, Wave 4): every older path either
              // persists at commit (the text tool) or opens no editor at all
              // (the rectangle tool), so nothing could diverge mid-round-trip.
              // Caught end-to-end — the first characters of a fast typist
              // vanished, with the rest saving normally.
              //
              // Safe to prefer the local value: `createCanvasElement` writes
              // back exactly the `text` it was given, so a difference here is
              // never the server having decided something, only the user
              // having typed since. `commitEditing` persists it moments later.
              const local = prev.byId.get(temporaryId)
              const reconciled =
                local && local.text !== persisted.text
                  ? { ...persisted, text: local.text }
                  : persisted
              return addElement(removeElement(prev, temporaryId), reconciled)
            })
            if (persisted.id !== temporaryId) {
              onElementIdReconciled?.(temporaryId, persisted.id)
            }
            // Re-issue whatever was edited while this create was in flight,
            // now that the row has an id the server recognises (see
            // `pendingUpdatesRef`). Issued EPHEMERALLY: no new gesture
            // happened, this is the continuation of one already recorded, so
            // it must not become a second undo entry — the same reasoning the
            // deferred delete immediately above follows.
            const deferred = pendingUpdatesRef.current.get(temporaryId)
            if (deferred) {
              pendingUpdatesRef.current.delete(temporaryId)
              void updateElementsRef.current(
                [{ ...deferred, id: persisted.id }],
                { ephemeral: true },
              )
            }
            resolve({
              id: persisted.id,
              ok: true,
              revision: res.entity.revision,
            })
          }),
        )
      })
    },
    [boardId, confirm, emit, onElementIdReconciled, setScene, settleOnce],
  )

  // ── update ───────────────────────────────────────────────────────────────
  //
  // One emit per element. A multi-select drag therefore produces N writes at
  // gesture end, not one — acceptable at milestone-1 selection sizes, and
  // recorded as debt rather than pretended away: a batched `element:update`
  // would need its own handler, its own partial-failure semantics and its own
  // rollback shape.
  const updateElements = useCallback(
    (
      elements: Array<CanvasElement>,
      options?: CanvasMutationOptions,
    ): Promise<Array<CanvasMutationResult>> => {
      const results = elements.map(
        (element) =>
          new Promise<CanvasMutationResult>((resolve) => {
            if (pendingCreatesRef.current.has(element.id)) {
              // The create is still in flight, so this id names nothing the
              // server can update. Deferred rather than dropped — the create
              // ack re-issues it against the id the server chose, exactly as
              // `deleteElements` already does for the same race.
              //
              // Resolves `ok: false` for the same reason that path does:
              // nothing about this element has stably existed for another
              // observer yet, so this leg is not separately undoable. The
              // create's own undo entry already covers the element and
              // everything typed into it — one Ctrl+Z removes both.
              pendingUpdatesRef.current.set(element.id, element)
              resolve({ id: element.id, ok: false })
              return
            }
            const expectedRevision = options?.expectedRevisions?.get(
              element.id,
            )
            emit(
              'element:update',
              {
                elementId: element.id,
                ...(expectedRevision !== undefined ? { expectedRevision } : {}),
                ...toUpdatePatch(element),
              },
              settleOnce<CanvasElementRecord>((res) => {
                if (!res.ok) {
                  // Read the confirmed state HERE, not at emit time. A
                  // collaborator broadcast landing in the round-trip window
                  // advances `confirmedRef`; a target captured at emit time
                  // would roll back past that server-confirmed change, and
                  // nothing resyncs it afterwards.
                  const confirmed = confirmedRef.current.get(element.id)
                  if (confirmed) {
                    setScene((prev) =>
                      prev.byId.has(element.id)
                        ? updateElement(prev, element.id, confirmed)
                        : prev,
                    )
                  }
                  // Suppressed for an ephemeral write (undo/redo's own
                  // inverse) — see the matching comment in `createElement`'s
                  // failure branch above; use-canvas-undo.ts owns that
                  // report instead.
                  if (!options?.ephemeral) {
                    toast.error(res.message ?? 'Failed to update element')
                  }
                  resolve({ id: element.id, ok: false })
                  return
                }
                if (res.entity) {
                  const persisted = toEngineElement(res.entity)
                  confirm(persisted)
                  revisionsRef.current.set(persisted.id, res.entity.revision)
                  setScene((prev) =>
                    prev.byId.has(persisted.id)
                      ? updateElement(prev, persisted.id, persisted)
                      : prev,
                  )
                  resolve({
                    id: element.id,
                    ok: true,
                    revision: res.entity.revision,
                  })
                  return
                }
                resolve({ id: element.id, ok: true })
              }),
            )
          }),
      )
      return Promise.all(results)
    },
    [confirm, emit, setScene, settleOnce],
  )

  // ── delete ───────────────────────────────────────────────────────────────

  /**
   * Emit one delete and restore the element if the server refuses.
   *
   * Shared by the direct path and the deferred path (a delete that raced
   * ahead of its create ack), so a deletion cannot end up without rollback
   * merely because it took the second route.
   */
  const emitDelete = useCallback(
    (
      id: string,
      options?: CanvasMutationOptions,
    ): Promise<CanvasMutationResult> => {
      const expectedRevision = options?.expectedRevisions?.get(id)
      return new Promise((resolve) => {
        emit(
          'element:delete',
          {
            elementId: id,
            ...(expectedRevision !== undefined ? { expectedRevision } : {}),
          },
          settleOnce<{ revision?: number }>((res) => {
            if (res.ok) {
              confirmedRef.current.delete(id)
              revisionsRef.current.delete(id)
              // The ack's `entity.revision` is the row's LAST (pre-delete)
              // revision — the server has no row left to read a fresh one
              // from. Undo's restore path (createElement's `minRevision`)
              // uses this to seed the restored row's revision ABOVE it,
              // closing the ABA hole where a restore resetting to 1 lets a
              // stale entry match a fresh row's revision by coincidence
              // (Hermes review, W-C).
              resolve({ id, ok: true, revision: res.entity?.revision })
              return
            }
            // Read the confirmed state HERE, not at emit time (Hermes
            // review, W-B) — the identical fix `updateElements` already
            // carries above. A collaborator broadcast landing in the
            // round-trip window advances `confirmedRef` (see `onUpdated`,
            // fixed alongside this to stay reachable even while the element
            // is optimistically removed from the scene); a restore target
            // captured at emit time would revert PAST that change and
            // nothing resyncs it afterwards. Undo makes this the EXPECTED
            // path (`REVISION_MISMATCH`), not a rare edge case.
            const confirmed = confirmedRef.current.get(id)
            setScene((prev) => {
              if (prev.byId.has(id)) return prev
              return confirmed ? addElement(prev, confirmed) : prev
            })
            // Suppressed for an ephemeral write — see the matching comment
            // in `createElement`'s failure branch above.
            if (!options?.ephemeral) {
              toast.error(res.message ?? 'Failed to delete element')
            }
            resolve({ id, ok: false })
          }),
        )
      })
    },
    [emit, setScene, settleOnce],
  )
  const emitDeleteRef = useRef(emitDelete)
  useEffect(() => {
    emitDeleteRef.current = emitDelete
  })

  // Same forward-reference trick, for the same reason: `createElement` is
  // defined ABOVE `updateElements` but has to re-issue a deferred update from
  // inside its own ack (see `pendingUpdatesRef`).
  useEffect(() => {
    updateElementsRef.current = updateElements
  })

  const deleteElements = useCallback(
    (
      ids: Array<string>,
      options?: CanvasMutationOptions,
    ): Promise<Array<CanvasMutationResult>> => {
      const results = ids.map((id) => {
        // Only decides WHETHER to emit at all (a known, confirmed element)
        // — the value itself is no longer threaded through to the rollback;
        // `emitDelete` re-reads `confirmedRef` fresh in its own ack handler.
        if (confirmedRef.current.has(id)) {
          return emitDelete(id, options)
        }
        if (pendingCreatesRef.current.has(id)) {
          // The create is still in flight. Defer rather than drop: the
          // reconciliation in the create ack re-issues this delete against
          // the id the server chose. Nothing about this element has stably
          // existed for another observer yet, so THIS leg resolves `ok:
          // false` — it is not itself undoable (see createElement's
          // `deletedWhileInFlight` branch, which issues the real delete
          // ephemerally once the id is known).
          pendingDeletesRef.current.add(id)
          return Promise.resolve({ id, ok: false })
        }
        // Neither confirmed nor in flight — the server has never heard of
        // this id, so emitting would only produce a NOT_FOUND the user would
        // see as a spurious error toast.
        return Promise.resolve({ id, ok: false })
      })
      // The caller already removed these from the scene optimistically; this
      // makes the hook's own view agree whether or not it did.
      setScene((prev) => removeElements(prev, ids))
      return Promise.all(results)
    },
    [emitDelete, setScene],
  )

  return { createElement, updateElements, deleteElements, getRevision }
}
