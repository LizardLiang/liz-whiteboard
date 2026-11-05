// src/hooks/use-whiteboard-areas.test.tsx
// The query cache is the single owner of area state: every writer updates it,
// so a remount reads the rects the screen showed.

import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { useWhiteboardAreas } from './use-whiteboard-areas'
import type { ReactNode } from 'react'
import type { Area } from '@/data/models'
import { getWhiteboardAreas } from '@/lib/server-functions'

vi.mock('@/lib/server-functions', () => ({
  getWhiteboardAreas: vi.fn(),
}))
vi.mock('@/lib/i18n/use-t', () => ({ useT: () => (k: string) => k }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const area = (id: string, over: Partial<Area> = {}): Area =>
  ({
    id,
    whiteboardId: 'wb',
    positionX: 0,
    positionY: 0,
    width: 100,
    height: 100,
    ...over,
  }) as Area

describe('useWhiteboardAreas query-cache ownership', () => {
  let client: QueryClient
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
  const params = {
    whiteboardId: 'wb',
    userId: 'me',
    enabled: true,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  }

  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    vi.mocked(getWhiteboardAreas).mockResolvedValue([area('a')] as never)
  })

  it('reflects updateArea in areas and in the cache a remount reads', async () => {
    const first = renderHook(() => useWhiteboardAreas(params), { wrapper })
    await waitFor(() => expect(first.result.current.areas).toHaveLength(1))

    act(() => first.result.current.updateArea('a', { width: 500 }))

    await waitFor(() => expect(first.result.current.areas[0].width).toBe(500))
    expect(client.getQueryData<Array<Area>>(['areas', 'wb'])![0].width).toBe(
      500,
    )

    first.unmount()
    const second = renderHook(() => useWhiteboardAreas(params), { wrapper })
    expect(second.result.current.areas[0].width).toBe(500)
  })

  it('applyAreaBounds writes through to the cache', async () => {
    const { result } = renderHook(() => useWhiteboardAreas(params), {
      wrapper,
    })
    await waitFor(() => expect(result.current.areas).toHaveLength(1))

    act(() =>
      result.current.applyAreaBounds([
        { id: 'a', positionX: 5, positionY: 6, width: 7, height: 8 },
      ]),
    )

    expect(client.getQueryData<Array<Area>>(['areas', 'wb'])![0]).toMatchObject(
      { positionX: 5, positionY: 6, width: 7, height: 8 },
    )
  })

  it('leaves an unauthorized cache entry untouched and returns []', async () => {
    vi.mocked(getWhiteboardAreas).mockResolvedValue({
      error: 'UNAUTHORIZED',
      status: 401,
    } as never)
    const { result } = renderHook(() => useWhiteboardAreas(params), {
      wrapper,
    })
    await waitFor(() =>
      expect(client.getQueryData(['areas', 'wb'])).toBeDefined(),
    )
    act(() => result.current.updateArea('a', { width: 1 }))
    expect(result.current.areas).toEqual([])
    expect(client.getQueryData(['areas', 'wb'])).toEqual({
      error: 'UNAUTHORIZED',
      status: 401,
    })
  })

  it('does not create a cache entry when a write arrives before the first load', () => {
    const { result } = renderHook(
      () => useWhiteboardAreas({ ...params, enabled: false }),
      { wrapper },
    )
    act(() => result.current.updateArea('a', { width: 1 }))
    expect(client.getQueryData(['areas', 'wb'])).toBeUndefined()
    expect(result.current.areas).toEqual([])
  })
})
