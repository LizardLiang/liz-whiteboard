// src/hooks/use-canvas-undo.test.ts
// Unit tests for the undo/redo command hook (board-undo tactical plan,
// Wave 3, step 9).
//
// The three mutation functions (createElement/updateElements/deleteElements)
// are mocked here — their real acked-rollback behaviour is exercised in
// use-canvas-elements.test.ts. What THIS file proves is the wiring between
// gesture recording, the pure stack/inverse modules, and the commands: one
// entry per gesture, contested-target discard without cascading, the
// read-only gate, and that undo/redo issue the correct calls with the
// correct conditional-write guards.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { useCanvasUndo } from './use-canvas-undo'
import type { CanvasElement } from '@/lib/canvas-engine/scene'
import type { CanvasMutationResult } from './use-canvas-elements'
import type { Camera } from '@/lib/canvas-engine/camera'
import type { WorldRect } from '@/lib/canvas-engine/hit-test'
import { DEFAULT_ELEMENT_STYLE } from '@/lib/canvas-engine/scene'
import { focusOnRect } from '@/lib/canvas-engine/camera-focus'
import { visibleWorldRect } from '@/lib/canvas-engine/camera'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

const BOARD_ID = '11111111-1111-4111-8111-111111111111'
const RECT_ID = '22222222-2222-4222-8222-222222222222'
const RECT_B_ID = '33333333-3333-4333-8333-333333333333'

function makeRect(overrides: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id: RECT_ID,
    kind: 'rectangle',
    x: 10,
    y: 10,
    width: 100,
    height: 100,
    rotation: 0,
    zIndex: 0,
    text: null,
    style: { ...DEFAULT_ELEMENT_STYLE },
    ...overrides,
  }
}

const GROUP_ID = '44444444-4444-4444-8444-444444444444'

function makeGroup(overrides: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id: GROUP_ID,
    kind: 'group',
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    rotation: 0,
    zIndex: -1,
    text: null,
    style: { ...DEFAULT_ELEMENT_STYLE },
    group: { childIds: [RECT_ID, RECT_B_ID] },
    ...overrides,
  }
}

/**
 * A mutation-function harness whose ack outcome is controlled per test.
 *
 * `revisions` auto-INCREMENTS on every accepted write, mirroring the real
 * server (`canvas-element.ts`'s `revision: prior.revision + 1`) — a mock
 * that instead pinned every ack to a CONSTANT made BLOCKER B1 unreachable:
 * every entry's stale `afterRevision` trivially matched the mock's fixed
 * number forever, so a never-refreshed entry could never surface as
 * contested (Hermes review). `highWaterRef` never decreases even across a
 * delete, mirroring the server's `minRevision`-seeded restore (W-C): undoing
 * or redoing a delete does not reset the id back to revision 1.
 *
 * Tests may still reach into `revisions` directly to simulate a COLLABORATOR
 * write this mock did not itself issue (an external actor advancing — or
 * removing — an id's tracked revision).
 */
function makeMutations() {
  const revisions = new Map<string, number>()
  const highWater = new Map<string, number>()

  const bump = (id: string): number => {
    const next = Math.max(highWater.get(id) ?? 0, revisions.get(id) ?? 0) + 1
    highWater.set(id, next)
    revisions.set(id, next)
    return next
  }

  const createElement = vi.fn(
    (
      element: CanvasElement,
      _options?: {
        ephemeral?: boolean
        restoreOriginalId?: boolean
        minRevision?: number
      },
    ): Promise<CanvasMutationResult> =>
      Promise.resolve({ id: element.id, ok: true, revision: bump(element.id) }),
  )
  const updateElements = vi.fn(
    (
      elements: Array<CanvasElement>,
      _options?: unknown,
    ): Promise<Array<CanvasMutationResult>> =>
      Promise.resolve(
        elements.map((e) => ({ id: e.id, ok: true, revision: bump(e.id) })),
      ),
  )
  const deleteElements = vi.fn(
    (
      ids: Array<string>,
      _options?: unknown,
    ): Promise<Array<CanvasMutationResult>> =>
      Promise.resolve(
        ids.map((id) => {
          const revision = revisions.get(id)
          revisions.delete(id)
          return { id, ok: true, revision }
        }),
      ),
  )
  const getRevision = vi.fn((id: string) => revisions.get(id))

  return {
    createElement,
    updateElements,
    deleteElements,
    getRevision,
    revisions,
  }
}

function setup(overrides: Partial<Parameters<typeof useCanvasUndo>[0]> = {}) {
  const mutations = makeMutations()
  const view = renderHook(() =>
    useCanvasUndo({
      boardId: BOARD_ID,
      readOnly: false,
      createElement: mutations.createElement,
      updateElements: mutations.updateElements,
      deleteElements: mutations.deleteElements,
      getRevision: mutations.getRevision,
      ...overrides,
    }),
  )
  return { view, ...mutations, get api() { return view.result.current } }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('recording — one entry per gesture', () => {
  it('records a create entry once the ack carries a revision', async () => {
    const h = setup()
    act(() => {
      h.api.callbacks.onCreate?.(makeRect())
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))
    h.revisions.set(RECT_ID, 1)

    // Undo of an unrecorded stack is a no-op; undo of the just-recorded
    // create must issue a delete.
    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))
    expect(h.deleteElements).toHaveBeenCalledWith(
      [RECT_ID],
      expect.objectContaining({ ephemeral: true }),
    )
  })

  it('does not record a create when the ack refuses', async () => {
    const h = setup()
    h.createElement.mockResolvedValueOnce({ id: RECT_ID, ok: false })
    act(() => {
      h.api.callbacks.onCreate?.(makeRect())
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))

    act(() => {
      h.api.undo()
    })
    // Nothing to undo — no delete should ever be issued.
    expect(h.deleteElements).not.toHaveBeenCalled()
  })

  it('records ONE entry for a multi-element update, not one per element', async () => {
    const h = setup()
    // Both elements already exist at revision 1 (an earlier create this
    // test does not otherwise model) — the forward update below bumps each
    // to 2, matching a real element's second write.
    h.revisions.set(RECT_ID, 1)
    h.revisions.set(RECT_B_ID, 1)
    const a = makeRect({ id: RECT_ID })
    const b = makeRect({ id: RECT_B_ID, x: 200 })
    const beforeA = { ...a }
    const beforeB = { ...b }
    const afterA = { ...a, x: 999 }
    const afterB = { ...b, x: 888 }

    act(() => {
      h.api.callbacks.onUpdate?.([afterA, afterB], [beforeA, beforeB])
    })
    await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(1))

    act(() => {
      h.api.undo()
    })
    // A single undo() COMMAND reverses the whole multi-element gesture as
    // one unit — mirroring the forward path's own accepted "one emit per
    // element" write shape (use-canvas-elements.ts), so this shows up as TWO
    // additional per-element calls (one per restored element), not a
    // separate undo COMMAND per element. The bookkeeping unit is the STACK
    // ENTRY (one, popped once), not the network call.
    await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(3))
    const restoredIds = h.updateElements.mock.calls
      .slice(1)
      .map((call) => call[0][0].id)
    expect(restoredIds.sort()).toEqual([RECT_ID, RECT_B_ID].sort())
  })

  it('restores original geometry on undo of a move', async () => {
    const h = setup()
    // Already exists at revision 1; the forward move below bumps it to 2.
    h.revisions.set(RECT_ID, 1)
    const before = makeRect({ x: 10, y: 10 })
    const after = makeRect({ x: 500, y: 500 })

    act(() => {
      h.api.callbacks.onUpdate?.([after], [before])
    })
    await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(1))

    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(2))
    const [restored, options] = h.updateElements.mock.calls[1]
    expect(restored[0]).toMatchObject({ x: 10, y: 10 })
    expect(options).toMatchObject({
      ephemeral: true,
      expectedRevisions: new Map([[RECT_ID, 2]]),
    })
  })

  it('records the full pre-delete element for restore-with-id on undo', async () => {
    const h = setup()
    const deleted = makeRect({ text: 'hello', zIndex: 7 })
    h.revisions.set(RECT_ID, 3)

    act(() => {
      h.api.callbacks.onDelete?.([deleted])
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))
    // The element no longer exists post-delete.
    h.revisions.delete(RECT_ID)

    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))
    const [restoredElement, options] = h.createElement.mock.calls[0]
    expect(restoredElement).toMatchObject({
      id: RECT_ID,
      text: 'hello',
      zIndex: 7,
    })
    expect(options).toMatchObject({
      ephemeral: true,
      restoreOriginalId: true,
      // The delete ack's pre-delete revision (3), seeding the restore ABOVE
      // it rather than resetting to 1 (Hermes review, W-C, ABA).
      minRevision: 3,
    })
  })
})

describe('recordDelete: group cleanup fold (FR-018 write-time)', () => {
  it("folds a surviving group's childIds patch into the SAME entry as the delete", async () => {
    const h = setup()
    h.revisions.set(RECT_ID, 1)
    h.revisions.set(GROUP_ID, 1)
    const deleted = makeRect({ id: RECT_ID })
    const groupBefore = makeGroup() // childIds: [RECT_ID, RECT_B_ID]
    const groupAfter = makeGroup({ group: { childIds: [RECT_B_ID] } })

    act(() => {
      h.api.callbacks.onDelete?.([deleted], 'delete', [
        { before: groupBefore, after: groupAfter },
      ])
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(1))
    expect(h.updateElements).toHaveBeenCalledWith([groupAfter])
    // The element no longer exists post-delete; the group's write landed at
    // revision 2 (bumped from the seeded 1).
    h.revisions.delete(RECT_ID)

    // ONE undo() command reverses BOTH writes — the deleted element comes
    // back AND the group's original childIds are restored — because they
    // are the SAME entry, not two the user would need two Ctrl+Z for.
    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(2))
    const [restoredRect] = h.createElement.mock.calls[0]
    expect(restoredRect).toMatchObject({ id: RECT_ID })
    const [restoredGroup, options] = h.updateElements.mock.calls[1]
    expect(restoredGroup[0]).toMatchObject({
      id: GROUP_ID,
      group: { childIds: [RECT_ID, RECT_B_ID] },
    })
    expect(options).toMatchObject({
      ephemeral: true,
      expectedRevisions: new Map([[GROUP_ID, 2]]),
    })
  })

  it('needs no third argument for an ordinary delete — issues no group update at all', async () => {
    const h = setup()
    h.revisions.set(RECT_ID, 3)
    act(() => {
      h.api.callbacks.onDelete?.([makeRect()])
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))
    expect(h.updateElements).not.toHaveBeenCalled()
  })

  // Both directions below are Cassandra risk-analysis H-001 / Hermes code
  // review's own required regression coverage: `recordDelete` issues the
  // member delete and the group-cleanup update as two independent,
  // concurrent writes with no reconciliation on partial success. Fixed to
  // the "at minimum" mitigation depth both reviewers explicitly sanction
  // (regression tests + the count-mislabeling fix, rather than the fuller
  // undo()-style compensation) — see implementation-notes.md for the
  // documented scope boundary.
  describe('partial-failure directions (Cassandra H-001)', () => {
    it('direction 1: delete succeeds, group-cleanup update fails — the entry still records, carrying ONLY the delete', async () => {
      const h = setup()
      h.revisions.set(RECT_ID, 1)
      h.revisions.set(GROUP_ID, 1)
      const deleted = makeRect({ id: RECT_ID })
      const groupBefore = makeGroup()
      const groupAfter = makeGroup({ group: { childIds: [RECT_B_ID] } })
      h.updateElements.mockResolvedValueOnce([{ id: GROUP_ID, ok: false }])

      act(() => {
        h.api.callbacks.onDelete?.([deleted], 'delete', [
          { before: groupBefore, after: groupAfter },
        ])
      })
      await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(1))
      h.revisions.delete(RECT_ID)

      // Undo restores the deleted element — the entry recorded despite the
      // update's own failure, correctly labelled as a genuine 1-element
      // delete (not silently dropped, and not double-counted).
      act(() => {
        h.api.undo()
      })
      await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))
      // No SECOND updateElements call from undo — the failed update never
      // joined the entry, so there is nothing of its own to reverse.
      expect(h.updateElements).toHaveBeenCalledTimes(1)
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith('Undid deleting an element'),
      )
    })

    it('direction 2: delete fails, group-cleanup update succeeds — the entry records under an honest label, not "deleting 0 elements"', async () => {
      const h = setup()
      h.revisions.set(RECT_ID, 1)
      h.revisions.set(GROUP_ID, 1)
      const deleted = makeRect({ id: RECT_ID })
      const groupBefore = makeGroup()
      const groupAfter = makeGroup({ group: { childIds: [RECT_B_ID] } })
      h.deleteElements.mockResolvedValueOnce([{ id: RECT_ID, ok: false }])

      act(() => {
        h.api.callbacks.onDelete?.([deleted], 'delete', [
          { before: groupBefore, after: groupAfter },
        ])
      })
      await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(1))

      // The mislabeling this fixes (Cassandra's "compounding case"): zero
      // delete operations landed, but the group's childIds update DID —
      // labelling the entry `{ gesture: 'delete', count: 0 }` would read as
      // a misleading no-op toast for an entry that in fact carries a real
      // group mutation. It is recorded as a generic multi-element update
      // instead, under a name that actually describes what changed.
      act(() => {
        h.api.undo()
      })
      await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(2))
      // No create call — nothing to restore for a delete that never landed.
      expect(h.createElement).not.toHaveBeenCalled()
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith('Undid moving an element'),
      )
    })
  })

  it('M-001 (Cassandra risk-analysis): a move-time membership ADD and a delete-time membership REMOVE on the SAME group both write via a bare updateElements call with no expectedRevisions guard', async () => {
    // Documents the accepted, pre-existing tradeoff Cassandra flagged
    // (MEDIUM, not a blocker): two collaborators' concurrent childIds
    // patches on ONE group are never reconciled against each other —
    // whichever write the server applies SECOND silently overwrites the
    // array wholesale. This is the same convention ordinary `recordUpdate`
    // already carries (no `expectedRevisions` on that call either); this
    // test exists so the tradeoff stays documented and verified rather
    // than merely asserted in prose.
    const h = setup()
    h.revisions.set(GROUP_ID, 1)
    h.revisions.set(RECT_ID, 1)
    h.revisions.set(RECT_B_ID, 1)

    // Collaborator A drags a third element in — an ADD, persisted through
    // `recordUpdate`'s own 'move' gesture path.
    const addedGroup = makeGroup({
      group: { childIds: [RECT_ID, RECT_B_ID, 'new-member'] },
    })
    act(() => {
      h.api.callbacks.onUpdate?.([addedGroup], [makeGroup()], 'move')
    })
    await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(1))

    // Collaborator B deletes an existing member — a REMOVE, computed from
    // B's OWN (stale, pre-A's-write) view of the group, exactly as a real
    // concurrent client would compute it — persisted through
    // `recordDelete`'s group-cleanup patch.
    const removedGroup = makeGroup({ group: { childIds: [RECT_ID] } })
    act(() => {
      h.api.callbacks.onDelete?.([makeRect({ id: RECT_B_ID })], 'delete', [
        { before: makeGroup(), after: removedGroup },
      ])
    })
    await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(2))

    const [addCallElements, addOptions] = h.updateElements.mock.calls[0]
    const [removeCallElements, removeOptions] = h.updateElements.mock.calls[1]
    expect(addCallElements[0].group?.childIds).toEqual([
      RECT_ID,
      RECT_B_ID,
      'new-member',
    ])
    expect(removeCallElements[0].group?.childIds).toEqual([RECT_ID])
    // Neither call carries an `expectedRevisions` guard for the group row
    // — nothing reconciles these two writes against each other server-side;
    // this is the root mechanism M-001 identifies.
    expect(addOptions).toBeUndefined()
    expect(removeOptions).toBeUndefined()
  })
})

describe('afterRevision staleness (Hermes review, BLOCKER B1)', () => {
  it('lets a SECOND, consecutive undo on the SAME element succeed after the first already wrote to it', async () => {
    // create -> update, both on RECT_ID. Undoing the update writes to the
    // element (advancing its revision); undoing the (now stale-recorded)
    // create must still succeed, not read as contested.
    const h = setup()
    act(() => {
      h.api.callbacks.onCreate?.(makeRect())
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))
    // revisions.set(RECT_ID, 1) already happened via the mock's own bump.

    const before = makeRect({ x: 10, y: 10 })
    const after = makeRect({ x: 500, y: 500 })
    act(() => {
      h.api.callbacks.onUpdate?.([after], [before])
    })
    await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(1))

    // UNDO 1: undoes the update, writing `before` back. This is the write
    // that advances RECT_ID's revision past what the CREATE entry recorded.
    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(2))

    // UNDO 2: undoes the create. Without B1's fix, buildInverse compares the
    // create entry's STALE `afterRevision` (1) against the CURRENT revision
    // (3, after undo 1's write) and wrongly reports it contested — zero
    // delete calls. With the fix, `refreshRevision` kept the create entry's
    // `afterRevision` current, so this succeeds.
    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))
    expect(h.deleteElements).toHaveBeenCalledWith(
      [RECT_ID],
      expect.objectContaining({ ephemeral: true }),
    )
  })

  it('keeps an entry valid across undo THEN redo THEN undo again', async () => {
    const h = setup()
    act(() => {
      h.api.callbacks.onCreate?.(makeRect())
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))

    // UNDO: deletes RECT_ID.
    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))

    // REDO: recreates RECT_ID. The mock's high-water mark means this ack's
    // revision (2) is HIGHER than the original create's (1) — mirroring
    // production's W-C fix, where a restore seeds above the deleted row's
    // last revision rather than resetting to 1.
    act(() => {
      h.api.redo()
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(2))

    // UNDO again: re-deletes RECT_ID. Without B1's fix, `popRedoEntry` moved
    // the ORIGINAL entry (still carrying `afterRevision: 1`) back onto the
    // undo stack unchanged, so this comparison would be 1 vs the redo's
    // fresh 2 — wrongly contested, zero further delete calls. With the fix,
    // `redo()`'s own `refreshRevision` call kept it current.
    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(2))
  })

  it('records a correct, independently-undoable entry for a fresh edit made after an earlier edit on the same element was undone', async () => {
    const h = setup()
    act(() => {
      h.api.callbacks.onCreate?.(makeRect())
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))

    const move1Before = makeRect({ x: 10, y: 10 })
    const move1After = makeRect({ x: 500, y: 500 })
    act(() => {
      h.api.callbacks.onUpdate?.([move1After], [move1Before])
    })
    await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(1))

    // Undo move1 — restores (10, 10) and advances the revision.
    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(2))

    // A SECOND, independent edit on the same already-undone-once element.
    const move2Before = makeRect({ x: 10, y: 10 })
    const move2After = makeRect({ x: 700, y: 700 })
    act(() => {
      h.api.callbacks.onUpdate?.([move2After], [move2Before])
    })
    await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(3))

    // Undo move2, then undo the original create — both must succeed. The
    // second of these only succeeds if the CREATE entry's `afterRevision`
    // was kept current through every write above.
    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(4))

    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))
  })
})

describe('redo of a move is not always refused (headed-browser BUG-1)', () => {
  it('reapplies the moved-to position on move -> undo -> redo', async () => {
    const h = setup()
    h.revisions.set(RECT_ID, 1)
    const before = makeRect({ x: 300, y: 300 })
    const after = makeRect({ x: 344, y: 300 })

    act(() => {
      h.api.callbacks.onUpdate?.([after], [before])
    })
    await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(1))

    // UNDO: restores x=300. This write ALSO advances the row's revision
    // (mirroring canvas-element.ts's `revision: prior.revision + 1`) — the
    // exact write whose side effect BUG-1 exposed: nothing but the user's
    // own undo touched this row, yet the entry now sitting in redo must
    // still be redoable.
    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(2))
    expect(h.updateElements.mock.calls[1][0][0]).toMatchObject({ x: 300 })

    // REDO: must reapply x=344, not be refused as "changed since your edit".
    act(() => {
      h.api.redo()
    })
    await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(3))
    const [reapplied, options] = h.updateElements.mock.calls[2]
    expect(reapplied[0]).toMatchObject({ x: 344, y: 300 })
    expect(options).toMatchObject({ ephemeral: true })
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('keeps a move entry valid across move -> undo -> redo -> undo', async () => {
    const h = setup()
    h.revisions.set(RECT_ID, 1)
    const before = makeRect({ x: 300, y: 300 })
    const after = makeRect({ x: 946, y: 300 })

    act(() => {
      h.api.callbacks.onUpdate?.([after], [before])
    })
    await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(1))

    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(2))

    act(() => {
      h.api.redo()
    })
    await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(3))
    expect(h.updateElements.mock.calls[2][0][0]).toMatchObject({ x: 946 })

    // A SECOND undo of the same (now redone) entry must also succeed —
    // proves the redo's own write kept the entry's bookkeeping current too,
    // not just the first undo's.
    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(4))
    expect(h.updateElements.mock.calls[3][0][0]).toMatchObject({ x: 300 })
    expect(toast.warning).not.toHaveBeenCalled()
  })
})

describe('redo of a delete is a conditional write (Hermes review, W-A)', () => {
  it('refuses a redo that would clobber a collaborator edit made after the undo', async () => {
    const h = setup()
    act(() => {
      h.api.callbacks.onDelete?.([makeRect()])
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))

    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))

    // A collaborator edits the restored element after the undo.
    h.revisions.set(RECT_ID, 999)

    act(() => {
      h.api.redo()
    })
    // Two deleteElements calls total: the original onDelete, and this redo.
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(2))
    // The redo's delete call must carry the guard, not fire unconditionally.
    expect(h.deleteElements.mock.calls[1]).toEqual([
      [RECT_ID],
      expect.objectContaining({
        expectedRevisions: new Map([[RECT_ID, 999]]),
      }),
    ])
  })

  it('lets an uncontested redo of a delete through', async () => {
    const h = setup()
    act(() => {
      h.api.callbacks.onDelete?.([makeRect()])
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))

    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))

    act(() => {
      h.api.redo()
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(2))
  })
})

describe('partial multi-element inverse application (Hermes review, finding 1)', () => {
  it('compensates a partially-succeeded undo instead of leaving the board half-reverted', async () => {
    const h = setup()
    // Both elements already exist at revision 1.
    h.revisions.set(RECT_ID, 1)
    h.revisions.set(RECT_B_ID, 1)
    const a = makeRect({ id: RECT_ID })
    const b = makeRect({ id: RECT_B_ID, x: 200 })
    const beforeA = { ...a }
    const beforeB = { ...b }
    const afterA = { ...a, x: 999 }
    const afterB = { ...b, x: 888 }

    act(() => {
      h.api.callbacks.onUpdate?.([afterA, afterB], [beforeA, beforeB])
    })
    // Call #1: the recording batch — both accepted, both bumped to revision 2.
    await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(1))

    // From here on, `updateElements` is called once per element (see the
    // "records ONE entry..." test above for why). Call #2 is undo's inverse
    // write for A (accepted); call #3 is undo's inverse write for B — made
    // to lose a race against a collaborator's own concurrent write, exactly
    // the scenario `buildInverse`'s CLIENT-side all-or-nothing check cannot
    // see coming (it already passed when `undo()` started).
    // Reassigning `mockImplementation` resets what THIS closure counts from
    // zero — the recording call above already happened under the ORIGINAL
    // implementation, so call 1 here is A's undo-inverse write and call 2 is
    // B's, not 2 and 3.
    let call = 0
    h.updateElements.mockImplementation(((
      elements: Array<CanvasElement>,
    ): Promise<Array<CanvasMutationResult>> => {
      call += 1
      if (call === 2) {
        return Promise.resolve(elements.map((e) => ({ id: e.id, ok: false })))
      }
      return Promise.resolve(
        elements.map((e) => {
          const next = (h.revisions.get(e.id) ?? 0) + 1
          h.revisions.set(e.id, next)
          return { id: e.id, ok: true, revision: next }
        }),
      )
      // The original mock's `vi.fn` narrows to a stricter inferred type
      // (`revision: number` required even on failure) than the real
      // `updateElements` signature actually promises — this override
      // matches the real, optional-`revision` contract instead.
    }) as typeof h.updateElements)

    await act(async () => {
      h.api.undo()
      // `undo()`'s internal `.then` is now `async` (it awaits compensation
      // before resolving) — flush it fully within this `act`.
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    // Call #4 is the compensation this fix adds: A's inverse write (call #2)
    // succeeded, so — the whole entry having been refused — its reverted
    // "before" content is written FORWARD again, back to what the user's
    // gesture actually produced. Without this, A would stay parked at its
    // reverted (`x: 10`) position with no redo entry and no way back
    // (`inverse.ts`'s own documented "applied not at all, never partially").
    await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(4))
    const [compensated, compensatedOptions] = h.updateElements.mock.calls[3]
    expect(compensated[0]).toMatchObject({ id: RECT_ID, x: 999 })
    expect(compensatedOptions).toMatchObject({
      ephemeral: true,
      // Guarded, not a blind clobber: A's own just-acked revision (3, from
      // call #2) is what the compensating write's conditional check reads.
      expectedRevisions: new Map([[RECT_ID, 3]]),
    })

    // The user is told the undo did not go through — refusal, not silence.
    expect(toast.warning).toHaveBeenCalledTimes(1)

    // The entry is fully discarded either way (matching the existing
    // contested-refusal behaviour): not on the undo stack (a second undo
    // call has nothing of THIS entry left to reverse) and not on redo.
    act(() => {
      h.api.redo()
    })
    expect(toast.info).toHaveBeenCalledWith(
      expect.stringMatching(/nothing left to redo/i),
    )
  })
})

describe('read-only gate', () => {
  it('never calls a mutation function from a callback while read-only', async () => {
    const h = setup({ readOnly: true })
    act(() => {
      h.api.callbacks.onCreate?.(makeRect())
      h.api.callbacks.onUpdate?.([makeRect()], [makeRect()])
      h.api.callbacks.onDelete?.([makeRect()])
    })
    await Promise.resolve()
    expect(h.createElement).not.toHaveBeenCalled()
    expect(h.updateElements).not.toHaveBeenCalled()
    expect(h.deleteElements).not.toHaveBeenCalled()
  })

  it('undo() and redo() do nothing while read-only', () => {
    const h = setup({ readOnly: true })
    act(() => {
      h.api.undo()
      h.api.redo()
    })
    expect(h.createElement).not.toHaveBeenCalled()
    expect(h.updateElements).not.toHaveBeenCalled()
    expect(h.deleteElements).not.toHaveBeenCalled()
  })
})

describe('contested-target refusal — no cascading', () => {
  it('discards exactly one entry per undo() call without retrying the next automatically', async () => {
    const h = setup()
    // Record two independent creates: RECT_ID then RECT_B_ID.
    act(() => {
      h.api.callbacks.onCreate?.(makeRect({ id: RECT_ID }))
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))
    h.revisions.set(RECT_ID, 1)

    act(() => {
      h.api.callbacks.onCreate?.(makeRect({ id: RECT_B_ID }))
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(2))
    h.revisions.set(RECT_B_ID, 1)

    // The top entry (RECT_B_ID) is now contested: someone else wrote it
    // since — its current revision no longer matches what the create
    // produced.
    h.revisions.set(RECT_B_ID, 5)

    act(() => {
      h.api.undo()
    })
    await Promise.resolve()
    // Contested — discarded WITHOUT issuing any write for it.
    expect(h.deleteElements).not.toHaveBeenCalled()

    // The SECOND undo() call (a separate command/keypress) now reaches the
    // next-most-recent entry (RECT_ID), which is NOT contested.
    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))
    expect(h.deleteElements).toHaveBeenCalledWith(
      [RECT_ID],
      expect.objectContaining({ ephemeral: true }),
    )
  })

  it('drops the entry (no redo, no cascade) when the server itself refuses the conditional write', async () => {
    const h = setup()
    act(() => {
      h.api.callbacks.onCreate?.(makeRect())
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))
    h.revisions.set(RECT_ID, 1)

    // Client-side check passes (revisions match), but the server rejects the
    // conditional delete anyway (e.g. a write raced in after this hook's
    // last known revision).
    h.deleteElements.mockResolvedValueOnce([{ id: RECT_ID, ok: false }])

    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))

    // A second undo() must not retry the SAME entry — it was already popped
    // and discarded — and must not throw.
    act(() => {
      h.api.undo()
    })
    await Promise.resolve()
    expect(h.deleteElements).toHaveBeenCalledTimes(1)
  })
})

describe('redo', () => {
  it('reapplies a create after undo removed it', async () => {
    const h = setup()
    act(() => {
      h.api.callbacks.onCreate?.(makeRect())
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))
    h.revisions.set(RECT_ID, 1)

    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))
    h.revisions.delete(RECT_ID)

    act(() => {
      h.api.redo()
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(2))
    expect(h.createElement.mock.calls[1][0]).toMatchObject({ id: RECT_ID })
    // The undo's delete confirmed the row's last revision was 1 (the
    // create's own afterRevision) — redo seeds its recreate ABOVE that
    // instead of resetting to 1 (Hermes review, W-C, symmetric case).
    expect(h.createElement.mock.calls[1][1]).toMatchObject({
      restoreOriginalId: true,
      minRevision: 1,
    })
  })
})

describe('reporting (board-undo tactical plan, Wave 4, step 11 — "Canvas Undo Reports What It Did")', () => {
  describe('success — names the gesture that was reversed/reapplied', () => {
    it('reports a successful undo and focuses the affected element', async () => {
      const onAffectedElement = vi.fn()
      const h = setup({ onAffectedElement })
      act(() => {
        h.api.callbacks.onCreate?.(makeRect())
      })
      await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))

      act(() => {
        h.api.undo()
      })
      await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith('Undid creating a rectangle'),
      )
      // `null`: undoing a create DELETES the element — nothing exists to
      // bring into view or highlight (headed-browser BUG-2's `rect` contract).
      expect(onAffectedElement).toHaveBeenCalledWith(RECT_ID, null)
    })

    it('reports a successful redo with its own "Redid" wording', async () => {
      const onAffectedElement = vi.fn()
      const h = setup({ onAffectedElement })
      act(() => {
        h.api.callbacks.onCreate?.(makeRect())
      })
      await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))
      h.revisions.set(RECT_ID, 1)

      act(() => {
        h.api.undo()
      })
      await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))
      h.revisions.delete(RECT_ID)
      onAffectedElement.mockClear()

      act(() => {
        h.api.redo()
      })
      await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(2))
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith('Redid creating a rectangle'),
      )
      // The recreated element's rect (makeRect()'s default geometry) — the
      // POST-redo state, not derived from a caller-side scene read.
      expect(onAffectedElement).toHaveBeenCalledWith(RECT_ID, {
        x: 10,
        y: 10,
        width: 100,
        height: 100,
      })
    })

    it('names a resize specifically, distinct from a generic move', async () => {
      const h = setup()
      h.revisions.set(RECT_ID, 1)
      const before = makeRect({ width: 100, height: 100 })
      const after = makeRect({ width: 200, height: 200 })
      act(() => {
        h.api.callbacks.onUpdate?.([after], [before], 'resize')
      })
      await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(1))

      act(() => {
        h.api.undo()
      })
      await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(2))
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith('Undid resizing an element'),
      )
    })

    it('names a text edit specifically', async () => {
      const h = setup()
      h.revisions.set(RECT_ID, 1)
      const before = makeRect({ text: 'old' })
      const after = makeRect({ text: 'new' })
      act(() => {
        h.api.callbacks.onUpdate?.([after], [before], 'text-edit')
      })
      await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(1))

      act(() => {
        h.api.undo()
      })
      await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(2))
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith('Undid editing text'),
      )
    })

    it('names a multi-element move with the count', async () => {
      const h = setup()
      h.revisions.set(RECT_ID, 1)
      h.revisions.set(RECT_B_ID, 1)
      const a = makeRect({ id: RECT_ID })
      const b = makeRect({ id: RECT_B_ID, x: 200 })
      act(() => {
        h.api.callbacks.onUpdate?.(
          [{ ...a, x: 999 }, { ...b, x: 888 }],
          [a, b],
          'move',
        )
      })
      await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(1))

      act(() => {
        h.api.undo()
      })
      await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(3))
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith('Undid moving 2 elements'),
      )
    })
  })

  describe('refusal — names the element, never who changed it', () => {
    it('reports a client-detected contest without attributing it to anyone', async () => {
      const onAffectedElement = vi.fn()
      const h = setup({ onAffectedElement })
      act(() => {
        h.api.callbacks.onCreate?.(makeRect())
      })
      await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))
      // A write lands on the element since the create — the record's
      // afterRevision (1) no longer matches.
      h.revisions.set(RECT_ID, 5)

      act(() => {
        h.api.undo()
      })
      await Promise.resolve()
      expect(h.deleteElements).not.toHaveBeenCalled()
      expect(toast.warning).toHaveBeenCalledWith(
        "This rectangle changed since your edit, so that change can't be undone.",
      )
      const [message] = (toast.warning as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(message.toLowerCase()).not.toMatch(
        /another user|someone else|collaborator/,
      )
      expect(onAffectedElement).toHaveBeenCalledWith(RECT_ID)
    })

    it('reports a missing target without claiming it changed', async () => {
      const h = setup()
      act(() => {
        h.api.callbacks.onCreate?.(makeRect())
      })
      await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))
      // The element is already gone by the time undo runs.
      h.revisions.delete(RECT_ID)

      act(() => {
        h.api.undo()
      })
      await Promise.resolve()
      expect(h.deleteElements).not.toHaveBeenCalled()
      expect(toast.warning).toHaveBeenCalledWith(
        "This rectangle no longer exists, so that change can't be undone.",
      )
    })

    it('reports a server-detected contest (a race lost after the client check passed) the same way', async () => {
      const h = setup()
      act(() => {
        h.api.callbacks.onCreate?.(makeRect())
      })
      await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))
      h.deleteElements.mockResolvedValueOnce([{ id: RECT_ID, ok: false }])

      act(() => {
        h.api.undo()
      })
      await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))
      await waitFor(() =>
        expect(toast.warning).toHaveBeenCalledWith(
          "This rectangle changed since your edit, so that change can't be undone.",
        ),
      )
    })
  })

  describe('exhaustion — announced, not a silent no-op', () => {
    it('tells the user there is nothing left to undo', () => {
      const onAffectedElement = vi.fn()
      const h = setup({ onAffectedElement })
      act(() => {
        h.api.undo()
      })
      expect(toast.info).toHaveBeenCalledWith('Nothing left to undo.')
      expect(onAffectedElement).not.toHaveBeenCalled()
    })

    it('tells the user there is nothing left to redo', () => {
      const onAffectedElement = vi.fn()
      const h = setup({ onAffectedElement })
      act(() => {
        h.api.redo()
      })
      expect(toast.info).toHaveBeenCalledWith('Nothing left to redo.')
      expect(onAffectedElement).not.toHaveBeenCalled()
    })
  })

  describe('read-only — no toast leaks past the authorisation gate', () => {
    it('shows no toast and calls no callback for undo/redo while read-only', () => {
      const onAffectedElement = vi.fn()
      const h = setup({ readOnly: true, onAffectedElement })
      act(() => {
        h.api.undo()
        h.api.redo()
      })
      expect(toast.success).not.toHaveBeenCalled()
      expect(toast.warning).not.toHaveBeenCalled()
      expect(toast.info).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
      expect(onAffectedElement).not.toHaveBeenCalled()
    })
  })
})

describe('camera focus target reflects the POST-write state (headed-browser BUG-2)', () => {
  // A wide viewport and a drag delta bigger than half of it — the mission
  // brief's own decisive case: an element dragged far enough that, once
  // restored, its ORIGINAL position and its PRE-undo (moved-to) position
  // cannot both be in view from the same camera. Panning to the wrong one
  // is exactly what left the user looking at empty canvas.
  const VIEWPORT = { width: 1776.8, height: 1000 }

  it('undo focuses the RESTORED position, not the pre-undo one, and the camera actually brings it into view', async () => {
    const focusCalls: Array<[string, WorldRect | null | undefined]> = []
    const h = setup({
      onAffectedElement: (id, rect) => focusCalls.push([id, rect]),
    })
    h.revisions.set(RECT_ID, 1)
    const before = makeRect({ x: 300, y: 300, width: 100, height: 100 })
    const after = makeRect({ x: 1246, y: 300, width: 100, height: 100 }) // delta 946

    act(() => {
      h.api.callbacks.onUpdate?.([after], [before])
    })
    await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(1))

    // Camera centred on the MOVED (post-drag) element — the restored
    // (pre-drag) position is therefore off-screen to the left, mirroring
    // the bug report's own "element off-screen, 946px drag undone" case.
    const cameraBeforeUndo: Camera = {
      x: after.x + after.width / 2 - VIEWPORT.width / 2,
      y: 0,
      zoom: 1,
    }

    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(focusCalls.length).toBe(1))

    const [id, rect] = focusCalls[0]
    expect(id).toBe(RECT_ID)
    // The bug: this used to be `undefined`, forcing the caller to read a
    // scene ref that had not yet re-rendered from the just-issued write —
    // landing on `after` (x: 1246) instead of `before` (x: 300).
    expect(rect).toMatchObject({ x: 300, y: 300, width: 100, height: 100 })

    const newCamera = focusOnRect(cameraBeforeUndo, VIEWPORT, rect!)
    const visible = visibleWorldRect(newCamera, VIEWPORT)
    expect(rect!.x).toBeGreaterThanOrEqual(visible.x)
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(visible.x + visible.width)
  })

  it('redo focuses the REAPPLIED position, not the pre-redo one', async () => {
    const focusCalls: Array<[string, WorldRect | null | undefined]> = []
    const h = setup({
      onAffectedElement: (id, rect) => focusCalls.push([id, rect]),
    })
    h.revisions.set(RECT_ID, 1)
    const before = makeRect({ x: 300, y: 300, width: 100, height: 100 })
    const after = makeRect({ x: 1246, y: 300, width: 100, height: 100 })

    act(() => {
      h.api.callbacks.onUpdate?.([after], [before])
    })
    await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(1))

    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(2))
    focusCalls.length = 0

    const cameraBeforeRedo: Camera = { x: before.x + before.width / 2 - VIEWPORT.width / 2, y: 0, zoom: 1 }

    act(() => {
      h.api.redo()
    })
    await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(focusCalls.length).toBe(1))

    const [, rect] = focusCalls[0]
    expect(rect).toMatchObject({ x: 1246, y: 300, width: 100, height: 100 })

    const newCamera = focusOnRect(cameraBeforeRedo, VIEWPORT, rect!)
    const visible = visibleWorldRect(newCamera, VIEWPORT)
    expect(rect!.x).toBeGreaterThanOrEqual(visible.x)
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(visible.x + visible.width)
  })

  it('a refused undo passes no rect override — the caller resolves the contested element from its own current state', async () => {
    const focusCalls: Array<[string, WorldRect | null | undefined]> = []
    const h = setup({
      onAffectedElement: (id, rect) => focusCalls.push([id, rect]),
    })
    act(() => {
      h.api.callbacks.onCreate?.(makeRect())
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))
    h.revisions.set(RECT_ID, 5) // a write landed since the create

    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(focusCalls.length).toBe(1))
    expect(focusCalls[0]).toEqual([RECT_ID, undefined])
  })

  it('a refused redo passes no rect override either', async () => {
    const focusCalls: Array<[string, WorldRect | null | undefined]> = []
    const h = setup({
      onAffectedElement: (id, rect) => focusCalls.push([id, rect]),
    })
    act(() => {
      h.api.callbacks.onDelete?.([makeRect()])
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))

    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))
    focusCalls.length = 0
    // The redo's own conditional delete is refused server-side (W-A's guard) —
    // simulated directly, since this mock's default impl does not itself
    // enforce `expectedRevisions`.
    h.deleteElements.mockResolvedValueOnce([{ id: RECT_ID, ok: false }])

    act(() => {
      h.api.redo()
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(focusCalls.length).toBe(1))
    expect(focusCalls[0]).toEqual([RECT_ID, undefined])
  })
})

describe('grouping — recordGroup / recordUngroup (canvas-element-grouping tactical plan, Wave 7)', () => {
  it('records a group entry once the create ack carries a revision, with a create call and no member write', async () => {
    const h = setup()
    act(() => {
      h.api.callbacks.onGroup?.(makeGroup())
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))
    expect(h.createElement.mock.calls[0][0]).toMatchObject({
      id: GROUP_ID,
      kind: 'group',
    })
    // No write to either member — grouping only ever touches the group's
    // own row (Wave 1).
    expect(h.updateElements).not.toHaveBeenCalled()
  })

  it('does not record a group entry when the create ack refuses', async () => {
    const h = setup()
    h.createElement.mockResolvedValueOnce({ id: GROUP_ID, ok: false })
    act(() => {
      h.api.callbacks.onGroup?.(makeGroup())
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))

    act(() => {
      h.api.undo()
    })
    expect(h.deleteElements).not.toHaveBeenCalled()
  })

  it('undo of a group deletes exactly the group row', async () => {
    const h = setup()
    act(() => {
      h.api.callbacks.onGroup?.(makeGroup())
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))
    h.revisions.set(GROUP_ID, 1)

    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))
    expect(h.deleteElements).toHaveBeenCalledWith(
      [GROUP_ID],
      expect.objectContaining({ ephemeral: true }),
    )
  })

  it('reports a successful group with the direct childIds count', async () => {
    const h = setup()
    act(() => {
      h.api.callbacks.onGroup?.(makeGroup())
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))
    h.revisions.set(GROUP_ID, 1)

    act(() => {
      h.api.undo()
    })
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Undid grouping 2 elements'),
    )
  })

  it('records an ungroup entry once the delete ack lands, with a delete call and no member write', async () => {
    const h = setup()
    h.revisions.set(GROUP_ID, 1)
    act(() => {
      h.api.callbacks.onUngroup?.(makeGroup())
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))
    // No options on the FORWARD call — matches `recordDelete`'s own
    // `deleteElements(ids)` shape, no `ephemeral`/`expectedRevisions`.
    expect(h.deleteElements).toHaveBeenCalledWith([GROUP_ID])
    expect(h.updateElements).not.toHaveBeenCalled()
  })

  it('does not record an ungroup entry when the delete ack refuses', async () => {
    const h = setup()
    h.revisions.set(GROUP_ID, 1)
    h.deleteElements.mockResolvedValueOnce([{ id: GROUP_ID, ok: false }])
    act(() => {
      h.api.callbacks.onUngroup?.(makeGroup())
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))

    act(() => {
      h.api.undo()
    })
    expect(h.createElement).not.toHaveBeenCalled()
  })

  it('undo of an ungroup restores the group WITH its original childIds', async () => {
    const h = setup()
    h.revisions.set(GROUP_ID, 3)
    const group = makeGroup()
    act(() => {
      h.api.callbacks.onUngroup?.(group)
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))
    h.revisions.delete(GROUP_ID)

    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))
    const [restored, options] = h.createElement.mock.calls[0]
    expect(restored).toMatchObject({
      id: GROUP_ID,
      group: { childIds: [RECT_ID, RECT_B_ID] },
    })
    expect(options).toMatchObject({
      ephemeral: true,
      restoreOriginalId: true,
      // The pre-delete revision (3), same W-C seeding recordDelete uses.
      minRevision: 3,
    })
  })

  it('reports a successful ungroup with the dissolved childIds count', async () => {
    const h = setup()
    h.revisions.set(GROUP_ID, 1)
    act(() => {
      h.api.callbacks.onUngroup?.(makeGroup())
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))
    h.revisions.delete(GROUP_ID)

    act(() => {
      h.api.undo()
    })
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'Undid ungrouping 2 elements',
      ),
    )
  })

  it('redo reapplies a group creation after undo removed it', async () => {
    const h = setup()
    act(() => {
      h.api.callbacks.onGroup?.(makeGroup())
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))
    h.revisions.set(GROUP_ID, 1)

    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))
    h.revisions.delete(GROUP_ID)

    act(() => {
      h.api.redo()
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(2))
    expect(h.createElement.mock.calls[1][0]).toMatchObject({
      id: GROUP_ID,
      group: { childIds: [RECT_ID, RECT_B_ID] },
    })
  })

  it('redo reapplies an ungroup (re-deletes the group) after undo restored it', async () => {
    const h = setup()
    h.revisions.set(GROUP_ID, 1)
    act(() => {
      h.api.callbacks.onUngroup?.(makeGroup())
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))
    h.revisions.delete(GROUP_ID)

    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))
    h.revisions.set(GROUP_ID, 4)

    act(() => {
      h.api.redo()
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(2))
  })

  it('never calls a mutation function from onGroup/onUngroup while read-only', async () => {
    const h = setup({ readOnly: true })
    act(() => {
      h.api.callbacks.onGroup?.(makeGroup())
      h.api.callbacks.onUngroup?.(makeGroup())
    })
    await Promise.resolve()
    expect(h.createElement).not.toHaveBeenCalled()
    expect(h.deleteElements).not.toHaveBeenCalled()
  })

  // Fix round — Hermes code review BLOCKER 1 & 2: `groupSelection`/
  // `ungroupSelection` (use-canvas-input.ts) now compute a `groupUpdates`
  // patch for every OTHER element the gesture also affects (a prior
  // owner's detach, or a nested group's surviving parent). These prove
  // `recordGroup`/`recordUngroup` fold that patch into the SAME
  // create/delete undo entry, the same shape `recordDelete` already uses.
  describe('groupUpdates fold into the SAME entry', () => {
    const OWNER_ID = '77777777-7777-4777-8777-777777777777'

    function makeOwner(overrides: Partial<CanvasElement> = {}): CanvasElement {
      return {
        id: OWNER_ID,
        kind: 'group',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        zIndex: -2,
        text: null,
        style: { ...DEFAULT_ELEMENT_STYLE },
        group: { childIds: [RECT_ID] },
        ...overrides,
      }
    }

    it('recordGroup persists a detach patch in the SAME entry as the group creation (BLOCKER 2)', async () => {
      const h = setup()
      h.revisions.set(OWNER_ID, 1)
      const newGroup = makeGroup()
      const ownerBefore = makeOwner()
      const ownerAfter = makeOwner({ group: { childIds: [] } })

      act(() => {
        h.api.callbacks.onGroup?.(newGroup, [
          { before: ownerBefore, after: ownerAfter },
        ])
      })
      await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(1))
      expect(h.updateElements).toHaveBeenCalledWith([ownerAfter])
      h.revisions.set(GROUP_ID, 1)

      // ONE undo() reverses BOTH — the new group disappears AND the prior
      // owner's childIds come back — because they are the SAME entry.
      act(() => {
        h.api.undo()
      })
      await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(2))
      const [restoredOwner] = h.updateElements.mock.calls[1]
      expect(restoredOwner[0]).toMatchObject({
        id: OWNER_ID,
        group: { childIds: [RECT_ID] },
      })
    })

    it('recordUngroup persists a parent patch in the SAME entry as the dissolve (BLOCKER 1)', async () => {
      const h = setup()
      h.revisions.set(GROUP_ID, 1)
      h.revisions.set(OWNER_ID, 1)
      const dissolved = makeGroup()
      const parentBefore = makeOwner({ group: { childIds: [GROUP_ID] } })
      const parentAfter = makeOwner({ group: { childIds: [] } })

      act(() => {
        h.api.callbacks.onUngroup?.(dissolved, [
          { before: parentBefore, after: parentAfter },
        ])
      })
      await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(1))
      expect(h.updateElements).toHaveBeenCalledWith([parentAfter])
      h.revisions.delete(GROUP_ID)

      // ONE undo() restores BOTH — the dissolved group comes back AND the
      // parent's childIds are patched back to naming it.
      act(() => {
        h.api.undo()
      })
      await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(2))
      const [restoredParent] = h.updateElements.mock.calls[1]
      expect(restoredParent[0]).toMatchObject({
        id: OWNER_ID,
        group: { childIds: [GROUP_ID] },
      })
    })

    // Both directions below are Hermes code review WARNING 1 / rule
    // proposal 2026-09-02-record-the-writes-that-acked.md's own required
    // regression coverage — the SAME "at minimum" tier `recordDelete`
    // already carries (Cassandra H-001 above): a failed primary write must
    // not silently discard a detach/parent-patch update that DID land
    // server-side.
    describe('partial-failure directions (Hermes code review WARNING 1)', () => {
      it('recordGroup: group creation fails, detach update succeeds — an entry still records, carrying ONLY the update', async () => {
        const h = setup()
        h.createElement.mockResolvedValueOnce({ id: GROUP_ID, ok: false })
        h.revisions.set(OWNER_ID, 1)
        const ownerBefore = makeOwner()
        const ownerAfter = makeOwner({ group: { childIds: [] } })

        act(() => {
          h.api.callbacks.onGroup?.(makeGroup(), [
            { before: ownerBefore, after: ownerAfter },
          ])
        })
        await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))
        await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(1))

        // The detach update DID land server-side — an entry must exist to
        // reverse it, or the user has no toast naming it and no way back.
        act(() => {
          h.api.undo()
        })
        await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(2))
        // No group row was ever created, so undo has nothing to delete.
        expect(h.deleteElements).not.toHaveBeenCalled()
        const [restoredOwner] = h.updateElements.mock.calls[1]
        expect(restoredOwner[0]).toMatchObject({
          id: OWNER_ID,
          group: { childIds: [RECT_ID] },
        })
        await waitFor(() =>
          expect(toast.success).toHaveBeenCalledWith(
            'Undid moving an element',
          ),
        )
      })

      it('recordGroup: both the creation and the update fail — no entry is pushed', async () => {
        const h = setup()
        h.createElement.mockResolvedValueOnce({ id: GROUP_ID, ok: false })
        h.updateElements.mockResolvedValueOnce([{ id: OWNER_ID, ok: false }])
        const ownerBefore = makeOwner()
        const ownerAfter = makeOwner({ group: { childIds: [] } })

        act(() => {
          h.api.callbacks.onGroup?.(makeGroup(), [
            { before: ownerBefore, after: ownerAfter },
          ])
        })
        await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))
        await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(1))

        act(() => {
          h.api.undo()
        })
        expect(h.deleteElements).not.toHaveBeenCalled()
        // No SECOND updateElements call — nothing was recorded to reverse.
        expect(h.updateElements).toHaveBeenCalledTimes(1)
      })

      it('recordUngroup: group delete fails, parent-patch update succeeds — an entry still records, carrying ONLY the update', async () => {
        const h = setup()
        h.deleteElements.mockResolvedValueOnce([{ id: GROUP_ID, ok: false }])
        h.revisions.set(OWNER_ID, 1)
        const parentBefore = makeOwner({ group: { childIds: [GROUP_ID] } })
        const parentAfter = makeOwner({ group: { childIds: [] } })

        act(() => {
          h.api.callbacks.onUngroup?.(makeGroup(), [
            { before: parentBefore, after: parentAfter },
          ])
        })
        await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))
        await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(1))

        // The parent-patch update DID land server-side — an entry must
        // exist to reverse it.
        act(() => {
          h.api.undo()
        })
        await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(2))
        // The group's own delete never landed, so undo has nothing to
        // recreate.
        expect(h.createElement).not.toHaveBeenCalled()
        const [restoredParent] = h.updateElements.mock.calls[1]
        expect(restoredParent[0]).toMatchObject({
          id: OWNER_ID,
          group: { childIds: [GROUP_ID] },
        })
        await waitFor(() =>
          expect(toast.success).toHaveBeenCalledWith(
            'Undid moving an element',
          ),
        )
      })

      it('recordUngroup: both the delete and the update fail — no entry is pushed', async () => {
        const h = setup()
        h.deleteElements.mockResolvedValueOnce([{ id: GROUP_ID, ok: false }])
        h.updateElements.mockResolvedValueOnce([{ id: OWNER_ID, ok: false }])
        const parentBefore = makeOwner({ group: { childIds: [GROUP_ID] } })
        const parentAfter = makeOwner({ group: { childIds: [] } })

        act(() => {
          h.api.callbacks.onUngroup?.(makeGroup(), [
            { before: parentBefore, after: parentAfter },
          ])
        })
        await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))
        await waitFor(() => expect(h.updateElements).toHaveBeenCalledTimes(1))

        act(() => {
          h.api.undo()
        })
        expect(h.createElement).not.toHaveBeenCalled()
        // No SECOND updateElements call — nothing was recorded to reverse.
        expect(h.updateElements).toHaveBeenCalledTimes(1)
      })
    })
  })
})

describe('recordClone remaps a cloned group\'s childIds through the SERVER ids (bug found and fixed during Wave 8 e2e testing)', () => {
  // `planClone` (clone.ts, Wave 4) already remaps a cloned group's
  // `childIds` through its OWN client-side idMap before `onClone` ever
  // fires — the elements handed to `onClone` below are exactly that
  // client-side-consistent shape, matching what `duplicateSelection`
  // actually produces. What this describe block covers is the SEPARATE,
  // SERVER-SIDE remap `recordClone` itself must also do: an ORDINARY
  // `createElement` call never sends the client's own id (see
  // `createElement`'s own header in use-canvas-elements.ts), so the
  // SERVER-assigned id for each cloned member differs from the client id
  // `planClone` used to build the group's `childIds` — persisting the
  // group with those UNREWRITTEN client ids would write a row whose
  // `childIds` name rows that were never created under those ids. This
  // mock's own default `createElement` (`makeMutations`, top of file)
  // ECHOES the client id back as the "server" id, which is exactly why
  // this bug was invisible to every other test in this file — these tests
  // override it to return a GENUINELY different id per element, matching
  // what the real server actually does.
  const GROUP_CLIENT_ID = 'client-group-1'
  const A_CLIENT_ID = 'client-a-1'
  const B_CLIENT_ID = 'client-b-1'

  function serverId(clientId: string): string {
    return `server-${clientId}`
  }

  function makeCloneElements(): Array<CanvasElement> {
    const a = makeRect({ id: A_CLIENT_ID, x: 0, y: 0 })
    const b = makeRect({ id: B_CLIENT_ID, x: 200, y: 0 })
    const group: CanvasElement = {
      ...makeRect({ id: GROUP_CLIENT_ID }),
      kind: 'group',
      group: { childIds: [A_CLIENT_ID, B_CLIENT_ID] },
    }
    // `plain` (non-connector, non-group) elements first in the array,
    // matching `planClone`'s own ordering convention — not load-bearing for
    // `recordClone` itself (it re-filters by kind), but keeps this fixture
    // honest about what a real clone plan looks like.
    return [a, b, group]
  }

  it("persists the cloned group's create with SERVER ids, not the stale client ids", async () => {
    const h = setup()
    h.createElement.mockImplementation((element: CanvasElement) =>
      Promise.resolve({ id: serverId(element.id), ok: true, revision: 1 }),
    )

    act(() => {
      h.api.callbacks.onClone?.(makeCloneElements(), 'duplicate')
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(3))

    const groupCall = h.createElement.mock.calls.find(
      (call) => call[0].kind === 'group',
    )!
    expect(groupCall).toBeDefined()
    const persistedGroup = groupCall[0]
    expect(new Set(persistedGroup.group!.childIds)).toEqual(
      new Set([serverId(A_CLIENT_ID), serverId(B_CLIENT_ID)]),
    )
    // The stale CLIENT ids must never reach the server at all.
    expect(persistedGroup.group!.childIds).not.toContain(A_CLIENT_ID)
    expect(persistedGroup.group!.childIds).not.toContain(B_CLIENT_ID)
  })

  it('records the remapped childIds in the undo entry too, so redo recreates a group that references real rows', async () => {
    const h = setup()
    h.createElement.mockImplementation((element: CanvasElement) =>
      Promise.resolve({ id: serverId(element.id), ok: true, revision: 1 }),
    )

    act(() => {
      h.api.callbacks.onClone?.(makeCloneElements(), 'duplicate')
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(3))
    h.revisions.set(serverId(A_CLIENT_ID), 1)
    h.revisions.set(serverId(B_CLIENT_ID), 1)
    h.revisions.set(serverId(GROUP_CLIENT_ID), 1)

    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(3))
    h.revisions.delete(serverId(A_CLIENT_ID))
    h.revisions.delete(serverId(B_CLIENT_ID))
    h.revisions.delete(serverId(GROUP_CLIENT_ID))

    act(() => {
      h.api.redo()
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(6))
    const redoneGroupCall = h.createElement.mock.calls
      .slice(3)
      .find((call) => call[0].kind === 'group')!
    expect(redoneGroupCall).toBeDefined()
    const redoneGroup = redoneGroupCall[0]
    expect(new Set(redoneGroup.group!.childIds)).toEqual(
      new Set([serverId(A_CLIENT_ID), serverId(B_CLIENT_ID)]),
    )
  })

  it('deep nesting: a cloned group containing another cloned group resolves in multiple passes', async () => {
    const h = setup()
    h.createElement.mockImplementation((element: CanvasElement) =>
      Promise.resolve({ id: serverId(element.id), ok: true, revision: 1 }),
    )

    const INNER_CLIENT_ID = 'client-inner-1'
    const OUTER_CLIENT_ID = 'client-outer-1'
    const a = makeRect({ id: A_CLIENT_ID, x: 0, y: 0 })
    const b = makeRect({ id: B_CLIENT_ID, x: 200, y: 0 })
    const inner: CanvasElement = {
      ...makeRect({ id: INNER_CLIENT_ID }),
      kind: 'group',
      group: { childIds: [A_CLIENT_ID, B_CLIENT_ID] },
    }
    const outer: CanvasElement = {
      ...makeRect({ id: OUTER_CLIENT_ID }),
      kind: 'group',
      group: { childIds: [INNER_CLIENT_ID] },
    }

    act(() => {
      // Order deliberately outer-before-inner in the input array — the fix
      // must not assume the plan hands groups over in dependency order.
      h.api.callbacks.onClone?.([a, b, outer, inner], 'duplicate')
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(4))

    const calls = h.createElement.mock.calls.map((call) => call[0])
    const persistedInner = calls.find((e) => e.id === INNER_CLIENT_ID)!
    const persistedOuter = calls.find((e) => e.id === OUTER_CLIENT_ID)!
    expect(new Set(persistedInner.group!.childIds)).toEqual(
      new Set([serverId(A_CLIENT_ID), serverId(B_CLIENT_ID)]),
    )
    expect(persistedOuter.group!.childIds).toEqual([serverId(INNER_CLIENT_ID)])
  })
})
