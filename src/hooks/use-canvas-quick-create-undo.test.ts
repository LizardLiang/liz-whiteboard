// src/hooks/use-canvas-quick-create-undo.test.ts
// `recordQuickCreate` — one creation-handle gesture is ONE undo entry (canvas
// quick-create-handles tactical plan, Wave 4, step 11).
//
// Mirrors use-canvas-undo.test.ts's harness deliberately, including its
// auto-incrementing revision mock: a mock that pins every ack to a constant
// makes the whole B1 class of staleness bug unreachable, so every undo test
// written against one is worthless. This file keeps that property and adds
// one of its own — `createElement` here RENAMES the row the way the real
// server does, because the id the connector must point at is the entire
// reason these two writes are sequential rather than concurrent.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useCanvasUndo } from './use-canvas-undo'
import type { CanvasElement } from '@/lib/canvas-engine/scene'
import type { CanvasMutationResult } from './use-canvas-elements'
import {
  DEFAULT_CONNECTOR_ROUTING,
  DEFAULT_ELEMENT_STYLE,
} from '@/lib/canvas-engine/scene'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

const BOARD_ID = '11111111-1111-4111-8111-111111111111'
const SOURCE_ID = '22222222-2222-4222-8222-222222222222'
const TEMP_ELEMENT_ID = '33333333-3333-4333-8333-333333333333'
const TEMP_CONNECTOR_ID = '44444444-4444-4444-8444-444444444444'

function makeRect(overrides: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id: TEMP_ELEMENT_ID,
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

function makeConnector(targetId: string): CanvasElement {
  return {
    id: TEMP_CONNECTOR_ID,
    kind: 'connector',
    x: 60,
    y: 60,
    width: 1,
    height: 1,
    rotation: 0,
    zIndex: 1,
    text: null,
    style: { ...DEFAULT_ELEMENT_STYLE },
    connector: {
      source: { kind: 'element', elementId: SOURCE_ID },
      target: { kind: 'element', elementId: targetId },
      routing: DEFAULT_CONNECTOR_ROUTING,
    },
  }
}

/**
 * The mutation harness, with the real server's two defining behaviours:
 * revisions that increment on every accepted write, and a create that mints
 * its OWN id rather than honouring the client's.
 */
function makeMutations() {
  const revisions = new Map<string, number>()
  const highWater = new Map<string, number>()
  /** Every element handed to `createElement`, in call order. */
  const created: Array<CanvasElement> = []
  const serverIds = new Map<string, string>([
    [TEMP_ELEMENT_ID, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    [TEMP_CONNECTOR_ID, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
  ])

  const bump = (id: string): number => {
    const next = Math.max(highWater.get(id) ?? 0, revisions.get(id) ?? 0) + 1
    highWater.set(id, next)
    revisions.set(id, next)
    return next
  }

  const createElement = vi.fn(
    (
      element: CanvasElement,
      options?: { restoreOriginalId?: boolean },
    ): Promise<CanvasMutationResult> => {
      created.push(element)
      // `restoreOriginalId` is undo's restore path — the id is kept then, and
      // renamed on an ordinary create, exactly as the server does.
      const id = options?.restoreOriginalId
        ? element.id
        : (serverIds.get(element.id) ?? element.id)
      return Promise.resolve({ id, ok: true, revision: bump(id) })
    },
  )
  const updateElements = vi.fn((elements: Array<CanvasElement>) =>
    Promise.resolve(elements.map((e) => ({ id: e.id, ok: true, revision: bump(e.id) }))),
  )
  const deleteElements = vi.fn(
    (ids: Array<string>): Promise<Array<CanvasMutationResult>> =>
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
    created,
    serverIds,
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
  return {
    view,
    ...mutations,
    get api() {
      return view.result.current
    },
  }
}

const ELEMENT_SERVER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CONNECTOR_SERVER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('recordQuickCreate persists both halves in the right order', () => {
  it('writes the element FIRST and points the connector at the id it got back', async () => {
    // The whole reason this cannot be two `onCreate` calls: the server mints
    // the row's id, so a connector written concurrently would be persisted
    // against a temporary uuid and name a row that never existed.
    const h = setup()
    act(() => {
      h.api.callbacks.onQuickCreate?.([
        makeRect(),
        makeConnector(TEMP_ELEMENT_ID),
      ])
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(2))

    expect(h.created[0].kind).toBe('rectangle')
    expect(h.created[1].kind).toBe('connector')
    expect(h.created[1].connector).toEqual({
        source: { kind: 'element', elementId: SOURCE_ID },
        target: { kind: 'element', elementId: ELEMENT_SERVER_ID },
        routing: DEFAULT_CONNECTOR_ROUTING,
      })
  })

  it('leaves an EXISTING target id untouched', async () => {
    // The drag-onto-an-element case: nothing was created, so the endpoint is
    // already the server's own id and must not be rewritten.
    const h = setup()
    act(() => {
      h.api.callbacks.onQuickCreate?.([makeConnector(SOURCE_ID)])
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))
    expect(h.created[0].connector?.target).toEqual({
      kind: 'element',
      elementId: SOURCE_ID,
    })
  })
})

describe('one gesture is one undo entry', () => {
  it('undo removes BOTH the element and the connector', async () => {
    const h = setup()
    act(() => {
      h.api.callbacks.onQuickCreate?.([
        makeRect(),
        makeConnector(TEMP_ELEMENT_ID),
      ])
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(2))

    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(2))

    const deleted = h.deleteElements.mock.calls.flatMap((call) => call[0])
    expect(deleted.sort()).toEqual(
      [ELEMENT_SERVER_ID, CONNECTOR_SERVER_ID].sort(),
    )
  })

  it('takes exactly ONE undo, never two', async () => {
    // Two entries would mean a second Ctrl+Z, and in between the board shows
    // a connector hanging off an element that no longer exists.
    const h = setup()
    act(() => {
      h.api.callbacks.onQuickCreate?.([
        makeRect(),
        makeConnector(TEMP_ELEMENT_ID),
      ])
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(2))

    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(2))
    h.deleteElements.mockClear()

    act(() => {
      h.api.undo()
    })
    // The stack is empty; a second undo must not find another entry.
    expect(h.deleteElements).not.toHaveBeenCalled()
  })

  it('redo re-creates both, each with its ORIGINAL id', async () => {
    // `restoreOriginalId` — a redo that let the server mint fresh ids would
    // resurrect the pair with the connector still pointing at the ids from
    // the first life.
    const h = setup()
    act(() => {
      h.api.callbacks.onQuickCreate?.([
        makeRect(),
        makeConnector(TEMP_ELEMENT_ID),
      ])
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(2))
    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(2))
    h.createElement.mockClear()

    act(() => {
      h.api.redo()
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(2))

    const restored = h.createElement.mock.calls.map((call) => call[0])
    expect(restored.map((element) => element.id).sort()).toEqual(
      [ELEMENT_SERVER_ID, CONNECTOR_SERVER_ID].sort(),
    )
    for (const call of h.createElement.mock.calls) {
      expect(call[1]).toEqual(
        expect.objectContaining({ restoreOriginalId: true, ephemeral: true }),
      )
    }
    // The connector's endpoints survive the round trip intact.
    const connector = restored.find((element) => element.kind === 'connector')
    expect(connector?.connector).toEqual({
        source: { kind: 'element', elementId: SOURCE_ID },
        target: { kind: 'element', elementId: ELEMENT_SERVER_ID },
        routing: DEFAULT_CONNECTOR_ROUTING,
      })
  })
})

describe('partial and refused writes', () => {
  it('records nothing when the ELEMENT create fails', async () => {
    // There is nothing to connect to — writing the connector anyway would
    // persist a row with an endpoint that does not exist.
    const h = setup()
    h.createElement.mockResolvedValueOnce({ id: TEMP_ELEMENT_ID, ok: false })
    act(() => {
      h.api.callbacks.onQuickCreate?.([
        makeRect(),
        makeConnector(TEMP_ELEMENT_ID),
      ])
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))

    act(() => {
      h.api.undo()
    })
    expect(h.deleteElements).not.toHaveBeenCalled()
  })

  it('still records the element when only the CONNECTOR create fails', async () => {
    // The element genuinely exists and must stay undoable on its own.
    const h = setup()
    h.createElement
      .mockResolvedValueOnce({
        id: ELEMENT_SERVER_ID,
        ok: true,
        revision: 1,
      })
      .mockResolvedValueOnce({ id: TEMP_CONNECTOR_ID, ok: false })
    act(() => {
      h.api.callbacks.onQuickCreate?.([
        makeRect(),
        makeConnector(TEMP_ELEMENT_ID),
      ])
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(2))
    h.revisions.set(ELEMENT_SERVER_ID, 1)

    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))
    expect(h.deleteElements.mock.calls[0][0]).toEqual([ELEMENT_SERVER_ID])
  })

  it('records nothing on a read-only board', async () => {
    // Viewers and anonymous share-link visitors get no recording AND no
    // write — the same gate every other callback here obeys.
    const h = setup({ readOnly: true })
    act(() => {
      h.api.callbacks.onQuickCreate?.([
        makeRect(),
        makeConnector(TEMP_ELEMENT_ID),
      ])
    })
    expect(h.createElement).not.toHaveBeenCalled()
  })

  it('ignores a call carrying no connector at all', async () => {
    // Not producible by the gesture, which always makes exactly one. Guarded
    // because the alternative is a create with no entry and no explanation.
    const h = setup()
    act(() => {
      h.api.callbacks.onQuickCreate?.([makeRect()])
    })
    expect(h.createElement).not.toHaveBeenCalled()
  })
})

describe('the delete cascade is one entry, and one undo restores all of it', () => {
  // `use-canvas-input.ts`'s `deleteSelection` expands the selection with
  // `withAttachedConnectors` and emits ONE `onDelete` carrying the element
  // and its connectors together. What this file proves is the other half:
  // that the undo hook turns that single call into a single entry whose
  // inverse restores every row, each with its ORIGINAL id — a connector
  // restored under a fresh id would come back pointing at nothing.
  const ELEMENT: CanvasElement = {
    ...makeRect({ id: ELEMENT_SERVER_ID }),
  }
  const CONNECTOR: CanvasElement = {
    ...makeConnector(ELEMENT_SERVER_ID),
    id: CONNECTOR_SERVER_ID,
  }

  it('restores both rows from one undo', async () => {
    const h = setup()
    // Seed the revisions the way a live board would have: both rows exist and
    // have been written at least once before the delete.
    h.revisions.set(ELEMENT_SERVER_ID, 1)
    h.revisions.set(CONNECTOR_SERVER_ID, 1)

    act(() => {
      h.api.callbacks.onDelete?.([ELEMENT, CONNECTOR])
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))
    expect(h.deleteElements.mock.calls[0][0].sort()).toEqual(
      [ELEMENT_SERVER_ID, CONNECTOR_SERVER_ID].sort(),
    )

    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(2))

    const restored = h.createElement.mock.calls.map((call) => call[0])
    expect(restored.map((element) => element.id).sort()).toEqual(
      [ELEMENT_SERVER_ID, CONNECTOR_SERVER_ID].sort(),
    )
    for (const call of h.createElement.mock.calls) {
      expect(call[1]).toEqual(
        expect.objectContaining({ restoreOriginalId: true, ephemeral: true }),
      )
    }
  })

  it('brings the connector back still joined to its endpoint', async () => {
    // The failure this guards is silent: a restored connector whose props
    // lost their endpoints is an undrawable, unselectable row — it looks
    // exactly like the undo having done nothing.
    const h = setup()
    h.revisions.set(ELEMENT_SERVER_ID, 1)
    h.revisions.set(CONNECTOR_SERVER_ID, 1)

    act(() => {
      h.api.callbacks.onDelete?.([ELEMENT, CONNECTOR])
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))
    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(2))

    const connector = h.createElement.mock.calls
      .map((call) => call[0])
      .find((element) => element.kind === 'connector')
    expect(connector?.connector).toEqual({
        source: { kind: 'element', elementId: SOURCE_ID },
        target: { kind: 'element', elementId: ELEMENT_SERVER_ID },
        routing: DEFAULT_CONNECTOR_ROUTING,
      })
  })

  it('takes ONE undo, not one per deleted row', async () => {
    const h = setup()
    h.revisions.set(ELEMENT_SERVER_ID, 1)
    h.revisions.set(CONNECTOR_SERVER_ID, 1)

    act(() => {
      h.api.callbacks.onDelete?.([ELEMENT, CONNECTOR])
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))
    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(2))
    h.createElement.mockClear()

    act(() => {
      h.api.undo()
    })
    expect(h.createElement).not.toHaveBeenCalled()
  })

  it('seeds each restored row ABOVE the revision it was deleted at', async () => {
    // The ABA hole (Hermes W-C): a row restored at revision 1 could
    // coincidentally match a stale entry's `afterRevision` and make a later
    // undo act on the wrong version. The mock's `bump` never decreases, which
    // is what lets this be asserted at all — a mock pinning every ack to a
    // constant would make it unobservable.
    const h = setup()
    h.revisions.set(ELEMENT_SERVER_ID, 7)
    h.revisions.set(CONNECTOR_SERVER_ID, 4)

    act(() => {
      h.api.callbacks.onDelete?.([ELEMENT, CONNECTOR])
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalledTimes(1))
    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(2))

    const minRevisions = new Map(
      h.createElement.mock.calls.map((call) => [
        call[0].id,
        (call[1] as { minRevision?: number } | undefined)?.minRevision,
      ]),
    )
    expect(minRevisions.get(ELEMENT_SERVER_ID)).toBe(7)
    expect(minRevisions.get(CONNECTOR_SERVER_ID)).toBe(4)
  })
})
