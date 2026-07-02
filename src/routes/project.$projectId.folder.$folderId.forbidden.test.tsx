// @vitest-environment jsdom
// src/routes/project.$projectId.folder.$folderId.forbidden.test.tsx
// Regression test for authorization-denial-ux-gaps, step A.3: the folder
// route shares getProjectPageContent's resolved-value FORBIDDEN payload with
// the project root page and had the same unguarded content.folders.length
// crash. Isolated into its own file (rather than extending
// project.$projectId.folder.$folderId.test.tsx) because that file relies on
// the real @tanstack/react-router module for Breadcrumb/Link tests, while
// this test needs createFileRoute mocked to render FolderPage directly —
// mirrors the approach in project.$projectId.test.tsx.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type * as ReactRouterExports from '@tanstack/react-router'

import { getProjectPageContent } from '@/routes/api/projects'

vi.mock('@/routes/api/projects', () => ({
  getProjectPageContent: vi.fn(),
  getProjectsWithTree: vi.fn(),
  createProjectFn: vi.fn(),
  deleteProjectFn: vi.fn(),
  updateProjectFn: vi.fn(),
}))

vi.mock('@/components/navigator/CreateWhiteboardDialog', () => ({
  CreateWhiteboardDialog: () => null,
}))

vi.mock('@/components/navigator/CreateFolderDialog', () => ({
  CreateFolderDialog: () => null,
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterExports>()
  return {
    ...actual,
    createFileRoute: () => () => ({
      useParams: () => ({ projectId: 'proj-001', folderId: 'folder-001' }),
      component: null,
    }),
    Link: ({ to, params, children, className, ...rest }: any) => {
      const href =
        typeof to === 'string'
          ? to
              .replace('$projectId', params?.projectId ?? '')
              .replace('$folderId', params?.folderId ?? '')
          : to
      return (
        <a href={href} className={className} {...rest}>
          {children}
        </a>
      )
    },
  }
})

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

async function importFolderPage() {
  const mod = await import('./project.$projectId.folder.$folderId')
  return mod
}

describe('Folder Page — forbidden content', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders an access-denied state instead of crashing on content.folders.length', async () => {
    vi.mocked(getProjectPageContent).mockResolvedValue({
      error: 'FORBIDDEN',
      status: 403,
      message: 'Access denied',
    } as any)

    const { FolderPage } = (await importFolderPage()) as unknown as {
      FolderPage: () => React.JSX.Element
    }
    const queryClient = createTestQueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <FolderPage />
      </QueryClientProvider>,
    )

    await waitFor(() =>
      expect(
        screen.getByText(/you don't have access to this project/i),
      ).toBeTruthy(),
    )
    expect(screen.getByText(/back to dashboard/i)).toBeTruthy()
  })
})
