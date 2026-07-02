// @vitest-environment jsdom
// src/components/whiteboard/WhiteboardAccessDenied.test.tsx
// Unit tests for WhiteboardAccessDenied — shared between the outer
// $whiteboardId.tsx route (isError/isUnauthorized) and ReactFlowWhiteboard's
// own inner query (authorization-denial-ux-gaps plan, step B).

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  RouterContextProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import { WhiteboardAccessDenied } from './WhiteboardAccessDenied'
import type { ReactNode } from 'react'
import { routeTree } from '@/routeTree.gen'

function RouterWrapper({ children }: { children: ReactNode }) {
  const history = createMemoryHistory({ initialEntries: ['/'] })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const router = createRouter({ routeTree, history, context: { queryClient } })
  return (
    <RouterContextProvider router={router}>{children}</RouterContextProvider>
  )
}

describe('WhiteboardAccessDenied', () => {
  it('renders a default access-denied message and a link home', () => {
    render(
      <RouterWrapper>
        <WhiteboardAccessDenied />
      </RouterWrapper>,
    )

    expect(screen.getByText('Access denied')).toBeTruthy()
    expect(
      screen.getByText(/you don't have access to this whiteboard/i),
    ).toBeTruthy()
    const link = screen.getByText(/back to dashboard/i).closest('a')
    expect(link!.getAttribute('href')).toBe('/')
  })

  it('renders a custom message when provided', () => {
    render(
      <RouterWrapper>
        <WhiteboardAccessDenied message="Custom whiteboard denial" />
      </RouterWrapper>,
    )

    expect(screen.getByText('Custom whiteboard denial')).toBeTruthy()
  })
})
