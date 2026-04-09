// @vitest-environment jsdom
// src/components/navigator/ProjectTree.test.tsx
// TS-06 (R6): Sidebar navigation behavior — project name navigates, chevron expands

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProjectTree } from './ProjectTree'
import type { ReactNode } from 'react'

import { getProjectsWithTree } from '@/routes/api/projects'

// Mock all server functions used by ProjectTree
vi.mock('@/routes/api/projects', () => ({
  getProjectsWithTree: vi.fn(),
  createProjectFn: vi.fn(),
  deleteProjectFn: vi.fn(),
  updateProjectFn: vi.fn(),
  getProjectPageContent: vi.fn(),
}))

vi.mock('@/routes/api/folders', () => ({
  deleteFolderFn: vi.fn(),
  updateFolderFn: vi.fn(),
  createFolderFn: vi.fn(),
}))

vi.mock('@/routes/api/whiteboards', () => ({
  deleteWhiteboardFn: vi.fn(),
  updateWhiteboardFn: vi.fn(),
  createWhiteboardFn: vi.fn(),
  getRecentWhiteboards: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock TanStack Router hooks — ProjectTree uses useNavigate, useParams, useRouterState
const mockNavigate = vi.fn()
let mockPathname = '/'

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({}),
    useRouterState: ({ select }: { select: (s: any) => any }) => {
      return select({ location: { pathname: mockPathname } })
    },
    Link: ({ to, params, children, className, ...rest }: any) => {
      const href = to
        .replace('$projectId', params?.projectId ?? '')
        .replace('$whiteboardId', params?.whiteboardId ?? '')
        .replace('/project/', '/project/')
      return (
        <a href={href} className={className} {...rest}>
          {children}
        </a>
      )
    },
  }
})

const mockProjects = [
  {
    id: 'proj-001',
    name: 'Test Project',
    description: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    folders: [],
    whiteboards: [],
  },
]

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function renderProjectTree() {
  const queryClient = createTestQueryClient()

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }

  return {
    ...render(
      <Wrapper>
        <ProjectTree />
      </Wrapper>,
    ),
    queryClient,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockNavigate.mockReset()
  mockPathname = '/'
  vi.mocked(getProjectsWithTree).mockResolvedValue(mockProjects as any)
})

describe('ProjectTree sidebar navigation behavior', () => {
  describe('TC-06-01: clicking project name navigates to /project/:projectId', () => {
    it('project name renders as a link (anchor) pointing to /project/:projectId', async () => {
      renderProjectTree()

      const projectLink = await screen.findByText('Test Project')
      const anchor = projectLink.closest('a')
      expect(anchor).toBeTruthy()
      expect(anchor!.getAttribute('href')).toContain('proj-001')
    })
  })

  describe('TC-06-02: clicking project name does NOT toggle sidebar tree', () => {
    it('the project name is a Link (not a CollapsibleTrigger), so clicking it does not toggle', async () => {
      renderProjectTree()

      await screen.findByText('Test Project')

      // The chevron button has the collapsible trigger — the Link does not
      // After clicking the link, we expect no open collapsible content
      // The key insight: the Link is separate from the CollapsibleTrigger button
      const projectLink = screen.getByText('Test Project').closest('a')
      expect(projectLink).toBeTruthy()

      // No CollapsibleContent should be open before click
      const openContent = document.querySelector('[data-state="open"]')
      expect(openContent).toBeNull()

      fireEvent.click(projectLink!)

      // Still no open content after clicking the link (not the chevron)
      const openContentAfter = document.querySelector('[data-state="open"]')
      expect(openContentAfter).toBeNull()
    })
  })

  describe('TC-06-03: clicking chevron expands the sidebar tree', () => {
    it('clicking the chevron button opens the collapsible tree', async () => {
      renderProjectTree()

      await screen.findByText('Test Project')

      // Before clicking chevron, collapsible should be closed
      const closedState = document.querySelector('[data-state="closed"]')
      expect(closedState).toBeTruthy()

      // Find the chevron button: it is the button with h-8 w-8 p-0 class
      const allButtons = screen.getAllByRole('button')
      const chevronButton = allButtons.find(
        (btn) =>
          btn.className.includes('h-8') &&
          btn.className.includes('w-8') &&
          !btn.getAttribute('title'),
      )
      expect(chevronButton).toBeTruthy()

      act(() => {
        fireEvent.click(chevronButton!)
      })

      // After clicking chevron, collapsible should be open
      const openState = document.querySelector('[data-state="open"]')
      expect(openState).toBeTruthy()
    })
  })

  describe('TC-06-04: clicking chevron does NOT navigate', () => {
    it('chevron button is a <button>, not inside an <a> element', async () => {
      renderProjectTree()

      await screen.findByText('Test Project')

      const allButtons = screen.getAllByRole('button')
      const chevronButton = allButtons.find(
        (btn) =>
          btn.className.includes('h-8') &&
          btn.className.includes('w-8') &&
          !btn.getAttribute('title'),
      )
      expect(chevronButton).toBeTruthy()
      // Must be a button, not inside an anchor
      expect(chevronButton!.tagName.toLowerCase()).toBe('button')
      expect(chevronButton!.closest('a')).toBeNull()
    })

    it('clicking chevron does not call navigate', async () => {
      renderProjectTree()

      await screen.findByText('Test Project')

      const allButtons = screen.getAllByRole('button')
      const chevronButton = allButtons.find(
        (btn) =>
          btn.className.includes('h-8') &&
          btn.className.includes('w-8') &&
          !btn.getAttribute('title'),
      )

      act(() => {
        fireEvent.click(chevronButton!)
      })

      expect(mockNavigate).not.toHaveBeenCalled()
    })
  })

  describe('TC-06-05: active project highlight when URL matches /project/:projectId', () => {
    it('project link has bg-accent class when current pathname is /project/proj-001', async () => {
      mockPathname = '/project/proj-001'
      renderProjectTree()

      const projectLink = await screen.findByText('Test Project')
      const anchor = projectLink.closest('a')
      expect(anchor).toBeTruthy()
      expect(anchor!.className).toContain('bg-accent')
    })

    it('project link does not have standalone bg-accent when pathname is /', async () => {
      mockPathname = '/'
      renderProjectTree()

      const projectLink = await screen.findByText('Test Project')
      const anchor = projectLink.closest('a')
      expect(anchor).toBeTruthy()
      // When not active, the class string should not contain bg-accent as a full token
      // (hover:bg-accent/50 is fine but bg-accent should not appear as standalone class)
      const classes = anchor!.className.split(' ')
      expect(classes).not.toContain('bg-accent')
    })
  })
})
