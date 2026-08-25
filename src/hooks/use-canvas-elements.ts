// src/hooks/use-canvas-elements.ts
// Canvas element mutations and live sync (tactical plan Wave 4, step 13).
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

export interface UseCanvasElementsReturn {
  createElement: (element: CanvasElement) => void
  updateElements: (elements: Array<CanvasElement>) => void
  deleteElements: (ids: Array<string>) => void
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
  const seededRef = useRef(false)
  if (!seededRef.current) {
    seededRef.current = true
    for (const record of initialElements) {
      confirmedRef.current.set(record.id, toEngineElement(record))
    }
  }

  const confirm = useCallback((element: CanvasElement) => {
    confirmedRef.current.set(element.id, element)
  }, [])

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
      setScene((prev) =>
        prev.byId.has(element.id) ? prev : addElement(prev, element),
      )
    }

    const onUpdated = (
      payload: Partial<CanvasElementRecord> & {
        elementId: string
        updatedBy: string
      },
    ) => {
      setScene((prev) => {
        const existing = prev.byId.get(payload.elementId)
        if (!existing) return prev
        // The broadcast speaks the STORAGE vocabulary (positionX/positionY).
        // Spreading it onto an engine element would leave x/y untouched while
        // silently adding two fields the renderer never reads — the element
        // would simply not move. Everything goes through the adapter.
        const merged = toEngineElement({
          id: existing.id,
          boardId,
          kind: existing.kind,
          positionX: payload.positionX ?? existing.x,
          positionY: payload.positionY ?? existing.y,
          width: payload.width ?? existing.width,
          height: payload.height ?? existing.height,
          rotation: existing.rotation,
          zIndex: payload.zIndex ?? existing.zIndex,
          text: payload.text !== undefined ? payload.text : existing.text,
          style: payload.style ?? existing.style,
        } as CanvasElementRecord)
        confirm(merged)
        return updateElement(prev, merged.id, merged)
      })
    }

    const onDeleted = (payload: { elementId: string; deletedBy: string }) => {
      confirmedRef.current.delete(payload.elementId)
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
    (element: CanvasElement) => {
      const temporaryId = element.id
      pendingCreatesRef.current.add(temporaryId)
      emit(
        'element:create',
        toCreateInput(boardId, element),
        settleOnce<CanvasElementRecord>((res) => {
          pendingCreatesRef.current.delete(temporaryId)
          const deletedWhileInFlight =
            pendingDeletesRef.current.delete(temporaryId)

          if (!res.ok || !res.entity) {
            setScene((prev) => removeElement(prev, temporaryId))
            // A create that failed and was then deleted needs no error: the
            // element is gone, which is what the user asked for.
            if (!deletedWhileInFlight) {
              toast.error(res.message ?? 'Failed to create element')
            }
            return
          }

          const persisted = toEngineElement(res.entity)

          if (deletedWhileInFlight) {
            // The user deleted this before the server named it. Now that it
            // has an id, delete it for real — and never put it back on
            // screen, which the reconciliation below would otherwise do.
            confirm(persisted)
            setScene((prev) => removeElements(prev, [temporaryId, persisted.id]))
            emitDeleteRef.current(persisted.id, persisted)
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
            return addElement(removeElement(prev, temporaryId), persisted)
          })
          if (persisted.id !== temporaryId) {
            onElementIdReconciled?.(temporaryId, persisted.id)
          }
        }),
      )
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
    (elements: Array<CanvasElement>) => {
      for (const element of elements) {
        emit(
          'element:update',
          { elementId: element.id, ...toUpdatePatch(element) },
          settleOnce<CanvasElementRecord>((res) => {
            if (!res.ok) {
              // Read the confirmed state HERE, not at emit time. A
              // collaborator broadcast landing in the round-trip window
              // advances `confirmedRef`; a target captured at emit time would
              // roll back past that server-confirmed change, and nothing
              // resyncs it afterwards.
              const confirmed = confirmedRef.current.get(element.id)
              if (confirmed) {
                setScene((prev) =>
                  prev.byId.has(element.id)
                    ? updateElement(prev, element.id, confirmed)
                    : prev,
                )
              }
              toast.error(res.message ?? 'Failed to update element')
              return
            }
            if (res.entity) {
              const persisted = toEngineElement(res.entity)
              confirm(persisted)
              setScene((prev) =>
                prev.byId.has(persisted.id)
                  ? updateElement(prev, persisted.id, persisted)
                  : prev,
              )
            }
          }),
        )
      }
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
    (id: string, restore: CanvasElement) => {
      emit(
        'element:delete',
        { elementId: id },
        settleOnce<unknown>((res) => {
          if (res.ok) {
            confirmedRef.current.delete(id)
            return
          }
          setScene((prev) =>
            prev.byId.has(id) ? prev : addElement(prev, restore),
          )
          toast.error(res.message ?? 'Failed to delete element')
        }),
      )
    },
    [emit, setScene, settleOnce],
  )
  const emitDeleteRef = useRef(emitDelete)
  useEffect(() => {
    emitDeleteRef.current = emitDelete
  })

  const deleteElements = useCallback(
    (ids: Array<string>) => {
      for (const id of ids) {
        const confirmed = confirmedRef.current.get(id)
        if (confirmed) {
          emitDelete(id, confirmed)
          continue
        }
        if (pendingCreatesRef.current.has(id)) {
          // The create is still in flight. Defer rather than drop: the
          // reconciliation in the create ack re-issues this delete against
          // the id the server chose.
          pendingDeletesRef.current.add(id)
          continue
        }
        // Neither confirmed nor in flight — the server has never heard of
        // this id, so emitting would only produce a NOT_FOUND the user would
        // see as a spurious error toast.
      }
      // The caller already removed these from the scene optimistically; this
      // makes the hook own view agree whether or not it did.
      setScene((prev) => removeElements(prev, ids))
    },
    [emitDelete, setScene],
  )

  return { createElement, updateElements, deleteElements }
}
