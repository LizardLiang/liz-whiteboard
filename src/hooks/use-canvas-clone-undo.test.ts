// src/hooks/use-canvas-clone-undo.test.ts
// `recordClone` — one paste or duplicate is ONE undo entry, however many
// elements it created (canvas copy-paste-duplicate tactical plan, step 3).
//
// Mirrors use-canvas-quick-create-undo.test.ts's harness, including the
// create that RENAMES the row the way the real server does. That rename is
// the entire subject here: the copied connectors' endpoints name client-side
// ids until their elements' acks arrive, and a connector persisted against
// one of those names a row that never existed.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { useCanvasUndo } from './use-canvas-undo'
import type { CanvasElement } from '@/lib/canvas-engine/scene'
import type { CanvasMutationResult } from './use-canvas-elements'
import { UNDO_EXHAUSTED_MESSAGE } from '@/lib/canvas-undo/messages'
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

/** Client-side id -> the id the "server" answers with. */
const SERVER_IDS = new Map<string, string>([
  ['temp-a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
  ['temp-b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
  ['temp-con', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
])

function copy(id: string, patch: Partial<CanvasElement> = {}): CanvasElement {
  return {
    id,
    kind: 'rectangle',
    x: 10,
    y: 10,
    width: 100,
    height: 100,
    rotation: 0,
    zIndex: 0,
    text: null,
    style: { ...DEFAULT_ELEMENT_STYLE },
    ...patch,
  }
}

/** A copied connector, still naming the CLIENT-side ids of its two ends. */
function copiedConnector(from: string, to: string): CanvasElement {
  return copy('temp-con', {
    kind: 'connector',
    width: 1,
    height: 1,
    zIndex: 2,
    connector: {
      source: { kind: 'element', elementId: from },
      target: { kind: 'element', elementId: to },
      routing: DEFAULT_CONNECTOR_ROUTING,
    },
  })
}

function makeMutations({
  failIds = new Set<string>(),
}: { failIds?: ReadonlySet<string> } = {}) {
  const revisions = new Map<string, number>()
  const created: Array<CanvasElement> = []

  const bump = (id: string): number => {
    const next = (revisions.get(id) ?? 0) + 1
    revisions.set(id, next)
    return next
  }

  const createElement = vi.fn(
    (element: CanvasElement): Promise<CanvasMutationResult> => {
      created.push(element)
      if (failIds.has(element.id)) {
        return Promise.resolve({ id: element.id, ok: false })
      }
      const id = SERVER_IDS.get(element.id) ?? element.id
      return Promise.resolve({ id, ok: true, revision: bump(id) })
    },
  )
  const updateElements = vi.fn((elements: Array<CanvasElement>) =>
    Promise.resolve(elements.map((e) => ({ id: e.id, ok: true, revision: bump(e.id) }))),
  )
  const deleteElements = vi.fn((ids: Array<string>) =>
    Promise.resolve(
      ids.map((id) => {
        const revision = revisions.get(id)
        revisions.delete(id)
        return { id, ok: true, revision }
      }),
    ),
  )
  const getRevision = vi.fn((id: string) => revisions.get(id))

  return { createElement, updateElements, deleteElements, getRevision, created }
}

function setup(
  overrides: Partial<Parameters<typeof useCanvasUndo>[0]> = {},
  mutationOptions: { failIds?: ReadonlySet<string> } = {},
) {
  const mutations = makeMutations(mutationOptions)
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

beforeEach(() => {
  vi.clearAllMocks()
})

// ───────────────────────────────────────────────────────────────────────────

describe('the two phases', () => {
  it('writes every element before any connector', async () => {
    const h = setup()
    act(() => {
      h.api.callbacks.onClone?.(
        [copy('temp-a'), copy('temp-b'), copiedConnector('temp-a', 'temp-b')],
        'paste',
      )
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(3))
    expect(h.created.map((element) => element.kind)).toEqual([
      'rectangle',
      'rectangle',
      'connector',
    ])
  })

  it('points the copied connector at the ids the SERVER gave the copies', async () => {
    // The failure this exists to stop: a connector persisted against the
    // client-side ids `planClone` minted names two rows that never existed,
    // so it is never drawn and never found by the delete cascade.
    const h = setup()
    act(() => {
      h.api.callbacks.onClone?.(
        [copy('temp-a'), copy('temp-b'), copiedConnector('temp-a', 'temp-b')],
        'paste',
      )
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(3))

    expect(h.created[2].connector).toEqual({
      source: { kind: 'element', elementId: SERVER_IDS.get('temp-a') },
      target: { kind: 'element', elementId: SERVER_IDS.get('temp-b') },
      routing: DEFAULT_CONNECTOR_ROUTING,
    })
  })

  it('needs no connector phase at all when nothing was joined', async () => {
    const h = setup()
    act(() => {
      h.api.callbacks.onClone?.([copy('temp-a')], 'duplicate')
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))
  })
})

describe('one gesture, one entry', () => {
  it('records a three-element paste as a single undoable entry', async () => {
    const h = setup()
    act(() => {
      h.api.callbacks.onClone?.(
        [copy('temp-a'), copy('temp-b'), copiedConnector('temp-a', 'temp-b')],
        'paste',
      )
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(3))

    act(() => {
      h.api.undo()
    })
    // One Ctrl+Z takes all three away. The inverse issues a delete per
    // operation, so what is asserted is the SET of rows removed by that one
    // command, not the number of calls it took to remove them.
    await waitFor(() =>
      expect(
        h.deleteElements.mock.calls.flatMap((call) => call[0]),
      ).toHaveLength(3),
    )

    // And the history is now empty: a second undo has nothing left to reach,
    // which is what makes those three rows ONE entry rather than three.
    act(() => {
      h.api.undo()
    })
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith(UNDO_EXHAUSTED_MESSAGE),
    )
  })

  it('reports a paste by name, counting everything it created', async () => {
    const h = setup()
    act(() => {
      h.api.callbacks.onClone?.(
        [copy('temp-a'), copy('temp-b'), copiedConnector('temp-a', 'temp-b')],
        'paste',
      )
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(3))
    act(() => {
      h.api.undo()
    })
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Undid pasting 3 elements'),
    )
  })

  it('reports a duplicate by ITS name, not the paste one', async () => {
    const h = setup()
    act(() => {
      h.api.callbacks.onClone?.([copy('temp-a')], 'duplicate')
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(1))
    act(() => {
      h.api.undo()
    })
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Undid duplicating an element'),
    )
  })
})

describe('partial failure', () => {
  it('records only the elements that actually persisted', async () => {
    const h = setup({}, { failIds: new Set(['temp-b']) })
    act(() => {
      h.api.callbacks.onClone?.([copy('temp-a'), copy('temp-b')], 'paste')
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(2))

    act(() => {
      h.api.undo()
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalled())
    // Only `a` is in the entry — undoing must not try to remove a row that
    // was never created.
    expect(h.deleteElements.mock.calls.flatMap((call) => call[0])).toEqual([
      SERVER_IDS.get('temp-a'),
    ])
  })

  it('SKIPS a connector whose element never landed rather than dangling it', async () => {
    const h = setup({}, { failIds: new Set(['temp-b']) })
    act(() => {
      h.api.callbacks.onClone?.(
        [copy('temp-a'), copy('temp-b'), copiedConnector('temp-a', 'temp-b')],
        'paste',
      )
    })
    // Two attempts, not three: the connector was never written at all.
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(2))
    act(() => {
      h.api.undo()
    })
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Undid pasting an element'),
    )
  })

  it('records nothing when no element persisted', async () => {
    const h = setup({}, { failIds: new Set(['temp-a', 'temp-b']) })
    act(() => {
      h.api.callbacks.onClone?.([copy('temp-a'), copy('temp-b')], 'paste')
    })
    await waitFor(() => expect(h.createElement).toHaveBeenCalledTimes(2))
    // An entry claiming rows that are not there would undo into an error.
    act(() => {
      h.api.undo()
    })
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith(UNDO_EXHAUSTED_MESSAGE),
    )
  })
})

describe('authorisation', () => {
  it('records nothing on a read-only board', async () => {
    const h = setup({ readOnly: true })
    act(() => {
      h.api.callbacks.onClone?.([copy('temp-a')], 'paste')
    })
    // No write was issued at all, so there is nothing an entry could point
    // at. Undo itself is separately gated on `readOnly` and returns without
    // even announcing an exhausted history, so the absent write IS the
    // assertion here.
    await waitFor(() => expect(h.createElement).not.toHaveBeenCalled())
    expect(h.deleteElements).not.toHaveBeenCalled()
  })
})

describe('cut', () => {
  it('is recorded under its own name, not as a plain delete', async () => {
    const h = setup()
    act(() => {
      h.api.callbacks.onDelete?.([copy('temp-a')], 'cut')
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalled())
    act(() => {
      h.api.undo()
    })
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Undid cutting an element'),
    )
  })

  it('still reports a plain delete as a delete', async () => {
    // The new argument defaults, so every existing call site is unchanged.
    const h = setup()
    act(() => {
      h.api.callbacks.onDelete?.([copy('temp-a')])
    })
    await waitFor(() => expect(h.deleteElements).toHaveBeenCalled())
    act(() => {
      h.api.undo()
    })
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Undid deleting an element'),
    )
  })
})
