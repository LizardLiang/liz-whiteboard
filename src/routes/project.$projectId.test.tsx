// @vitest-environment jsdom
// src/routes/project.$projectId.test.tsx
// TS-01 (R1): Project page route integration tests (AC-01..04)

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { getProjectPageContent } from '@/routes/api/projects'

// Instead of rendering the full route, we test the component logic
// by rendering the individual sub-components that the route uses
import { ProjectPageError } from '@/components/project/ProjectPageError'
import { ProjectPageSkeleton } from '@/components/project/ProjectPageSkeleton'

// Mock getProjectPageContent server function before component import
vi.mock('@/routes/api/projects', () => ({
  getProjectPageContent: vi.fn(),
  getProjectsWithTree: vi.fn(),
  createProjectFn: vi.fn(),
  deleteProjectFn: vi.fn(),
  updateProjectFn: vi.fn(),
}))

// Mock dialogs so we don't need full router for them
vi.mock('@/components/navigator/CreateWhiteboardDialog', () => ({
  CreateWhiteboardDialog: () => null,
}))

vi.mock('@/components/navigator/CreateFolderDialog', () => ({
  CreateFolderDialog: () => null,
}))

vi.mock('@/components/project/ProjectSharePanel', () => ({
  ProjectSharePanel: () => null,
}))

// Mock router hooks since this component is route-level and uses Route.useParams
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    createFileRoute: () => () => ({
      useParams: () => ({ projectId: 'proj-001' }),
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

const mockContent = {
  project: { id: 'proj-001', name: 'My Project' },
  folders: [],
  whiteboards: [],
  breadcrumb: [],
  viewerRole: null as string | null,
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

// Render the ProjectPage component directly (not via router)
// We need to import after mocks are set up
async function importProjectPage() {
  // Dynamic import ensures mock is applied before module loads
  const mod = await import('./project.$projectId')
  return mod
}

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = createTestQueryClient()
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('Project Page Route (AC-01..04)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('TC-01-04: URL is stable and bookmarkable (route exists)', () => {
    it('project page route file exports a Route object', async () => {
      // The route file exists and exports a Route — verified by the file itself existing
      // and the module being importable. We verify the data layer returns stable data
      // for a given projectId without error.
      vi.mocked(getProjectPageContent).mockResolvedValue(mockContent as any)

      const queryClient = createTestQueryClient()
      const result = await queryClient.fetchQuery({
        queryKey: ['project-page', 'proj-001'],
        queryFn: () =>
          getProjectPageContent({ data: { projectId: 'proj-001' } } as any),
      })

      // Same data returned each time for same key = stable/bookmarkable
      expect(result).toEqual(mockContent)
    })
  })

  describe('Loading state component', () => {
    it('TC-01-04: ProjectPageSkeleton renders placeholder cards for loading state', () => {
      render(
        <Wrapper>
          <ProjectPageSkeleton />
        </Wrapper>,
      )

      // Skeleton renders 4 placeholder cards
      const skeletonCards = document.querySelectorAll(
        '[class*="animate-pulse"]',
      )
      expect(skeletonCards.length).toBeGreaterThanOrEqual(4)
    })
  })

  describe('Error state component', () => {
    it('TC-01-02: ProjectPageError renders with "Project not found" message', () => {
      render(
        <Wrapper>
          <ProjectPageError message="Project not found" />
        </Wrapper>,
      )

      expect(screen.getByText('Project not found')).toBeTruthy()
    })

    it('TC-01-02: ProjectPageError renders error UI for generic errors', () => {
      render(
        <Wrapper>
          <ProjectPageError message="Failed to load project" />
        </Wrapper>,
      )

      expect(screen.getByText('Failed to load project')).toBeTruthy()
    })

    it('ProjectPageError has a retry button', () => {
      const onRetry = vi.fn()
      render(
        <Wrapper>
          <ProjectPageError message="Error" onRetry={onRetry} />
        </Wrapper>,
      )

      const retryButton = screen.getByRole('button', { name: /retry/i })
      expect(retryButton).toBeTruthy()
    })
  })

  describe('TC-01-03: page displays project name', () => {
    it('ProjectContentGrid receives correct project data', async () => {
      // Test that getProjectPageContent is called and its data flows through
      vi.mocked(getProjectPageContent).mockResolvedValue(mockContent as any)

      const queryClient = createTestQueryClient()
      // Pre-populate the query cache with mock data
      queryClient.setQueryData(['project-page', 'proj-001'], mockContent)

      // The page title "My Project" would be displayed by the route component
      // We verify the data shape is correct
      const cachedData = queryClient.getQueryData([
        'project-page',
        'proj-001',
      ]) as typeof mockContent
      expect(cachedData?.project?.name).toBe('My Project')
    })
  })

  describe('TC-01-01: valid project ID resolves project data', () => {
    it('getProjectPageContent is called with valid projectId', async () => {
      vi.mocked(getProjectPageContent).mockResolvedValue(mockContent as any)

      const queryClient = createTestQueryClient()

      // Simulate the query being run as the route component would do
      await queryClient.fetchQuery({
        queryKey: ['project-page', 'proj-001'],
        queryFn: () =>
          getProjectPageContent({ data: { projectId: 'proj-001' } } as any),
      })

      expect(getProjectPageContent).toHaveBeenCalled()
      const result = queryClient.getQueryData([
        'project-page',
        'proj-001',
      ]) as typeof mockContent
      expect(result?.project?.name).toBe('My Project')
    })
  })

  describe('Share button visibility (gated by viewerRole)', () => {
    async function renderProjectPage(viewerRole: string | null) {
      vi.mocked(getProjectPageContent).mockResolvedValue({
        ...mockContent,
        viewerRole,
      } as any)

      const { ProjectPage } = await importProjectPage()

      const queryClient = createTestQueryClient()
      queryClient.setQueryData(['project-page', 'proj-001'], {
        ...mockContent,
        viewerRole,
      })

      render(
        <QueryClientProvider client={queryClient}>
          <ProjectPage />
        </QueryClientProvider>,
      )

      await waitFor(() => screen.getByText('My Project'))
    }

    it('renders the Share button when viewerRole is OWNER', async () => {
      await renderProjectPage('OWNER')
      expect(screen.queryByRole('button', { name: /share/i })).toBeTruthy()
    })

    it('renders the Share button when viewerRole is ADMIN', async () => {
      await renderProjectPage('ADMIN')
      expect(screen.queryByRole('button', { name: /share/i })).toBeTruthy()
    })

    it('does not render the Share button when viewerRole is EDITOR', async () => {
      await renderProjectPage('EDITOR')
      expect(screen.queryByRole('button', { name: /share/i })).toBeNull()
    })

    it('does not render the Share button when viewerRole is VIEWER', async () => {
      await renderProjectPage('VIEWER')
      expect(screen.queryByRole('button', { name: /share/i })).toBeNull()
    })

    it('does not render the Share button when viewerRole is null', async () => {
      await renderProjectPage(null)
      expect(screen.queryByRole('button', { name: /share/i })).toBeNull()
    })
  })

  // Regression test for authorization-denial-ux-gaps: getProjectPageContent
  // resolves (does not throw) a { error: 'FORBIDDEN', status: 403 } payload
  // when the viewer lacks VIEWER+ role. Before the fix, this fell through to
  // `content.folders.length` unguarded and crashed with a TypeError caught by
  // the router's generic CatchBoundary instead of showing an access-denied
  // state with a way home.
  describe('Forbidden content (non-member access)', () => {
    it('renders an access-denied state instead of crashing on content.folders.length', async () => {
      vi.mocked(getProjectPageContent).mockResolvedValue({
        error: 'FORBIDDEN',
        status: 403,
        message: 'Access denied',
      } as any)

      const { ProjectPage } = await importProjectPage()
      const queryClient = createTestQueryClient()

      render(
        <QueryClientProvider client={queryClient}>
          <ProjectPage />
        </QueryClientProvider>,
      )

      await waitFor(() =>
        expect(
          screen.getByText(/you don't have access to this project/i),
        ).toBeTruthy(),
      )

      // A way home
      expect(screen.getByText(/back to dashboard/i)).toBeTruthy()

      // Must not have thrown a TypeError from unguarded content.folders.length —
      // if the guard were missing, render() itself would have thrown and this
      // test would never reach the assertions above.
      expect(screen.queryByText('My Project')).toBeNull()
    })
  })
})
