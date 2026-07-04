// @vitest-environment jsdom
// src/components/project/ProjectAccessDenied.test.tsx
// Unit tests for ProjectAccessDenied — used by both project.$projectId.tsx
// and project.$projectId.folder.$folderId.tsx when getProjectPageContent
// resolves a FORBIDDEN payload (authorization-denial-ux-gaps plan, step A).

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  RouterContextProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import { ProjectAccessDenied } from './ProjectAccessDenied'
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

describe('ProjectAccessDenied', () => {
  it('renders the default access-denied message when no message prop is given', () => {
    render(
      <RouterWrapper>
        <ProjectAccessDenied />
      </RouterWrapper>,
    )

    expect(
      screen.getByText(/you don't have access to this project/i),
    ).toBeTruthy()
    expect(screen.getByText(/ask a project admin for access/i)).toBeTruthy()
  })

  it('renders a custom message when provided', () => {
    render(
      <RouterWrapper>
        <ProjectAccessDenied message="Custom denial message" />
      </RouterWrapper>,
    )

    expect(screen.getByText('Custom denial message')).toBeTruthy()
  })

  it('renders a link back home', () => {
    render(
      <RouterWrapper>
        <ProjectAccessDenied />
      </RouterWrapper>,
    )

    const link = screen.getByText(/back to dashboard/i).closest('a')
    expect(link).toBeTruthy()
    expect(link!.getAttribute('href')).toBe('/')
  })
})
