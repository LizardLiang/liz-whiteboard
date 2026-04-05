// @vitest-environment jsdom
// src/components/project/Breadcrumb.test.tsx
// TS-08: Breadcrumb unit tests (R8 — P1)

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  RouterContextProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router'
import { Breadcrumb } from './Breadcrumb'
import type { ReactNode } from 'react'
import { routeTree } from '@/routeTree.gen'
import { QueryClient } from '@tanstack/react-query'

function RouterWrapper({ children }: { children: ReactNode }) {
  const history = createMemoryHistory({ initialEntries: ['/'] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createRouter({ routeTree, history, context: { queryClient } })
  return (
    <RouterContextProvider router={router}>{children}</RouterContextProvider>
  )
}

type BreadcrumbItem = { id: string; name: string; type: 'project' | 'folder' }

function renderBreadcrumb(items: Array<BreadcrumbItem>, projectId: string) {
  return render(
    <RouterWrapper>
      <Breadcrumb items={items} projectId={projectId} />
    </RouterWrapper>,
  )
}

describe('Breadcrumb', () => {
  it('TC-08-01: renders nothing when items array is empty (breadcrumb absent on root)', () => {
    const { container } = renderBreadcrumb([], 'proj-001')
    // Breadcrumb returns null for empty items — no nav element
    expect(container.querySelector('nav')).toBeNull()
  })

  it('TC-08-02: renders two segments for one level of nesting (project + folder)', () => {
    const items: Array<BreadcrumbItem> = [
      { id: 'proj-001', name: 'My Project', type: 'project' },
      { id: 'folder-001', name: 'Alpha Folder', type: 'folder' },
    ]
    renderBreadcrumb(items, 'proj-001')

    expect(screen.getByText('My Project')).toBeTruthy()
    expect(screen.getByText('Alpha Folder')).toBeTruthy()
  })

  it('TC-08-03: renders full path for two levels of nesting (three segments)', () => {
    const items: Array<BreadcrumbItem> = [
      { id: 'proj-001', name: 'My Project', type: 'project' },
      { id: 'folder-001', name: 'Parent Folder', type: 'folder' },
      { id: 'folder-002', name: 'Child Folder', type: 'folder' },
    ]
    renderBreadcrumb(items, 'proj-001')

    expect(screen.getByText('My Project')).toBeTruthy()
    expect(screen.getByText('Parent Folder')).toBeTruthy()
    expect(screen.getByText('Child Folder')).toBeTruthy()
  })

  it('TC-08-04: project name segment renders as a clickable link to /project/:projectId', () => {
    const items: Array<BreadcrumbItem> = [
      { id: 'proj-001', name: 'My Project', type: 'project' },
      { id: 'folder-001', name: 'Alpha Folder', type: 'folder' },
    ]
    renderBreadcrumb(items, 'proj-001')

    const projectLink = screen.getByText('My Project').closest('a')
    expect(projectLink).toBeTruthy()
    expect(projectLink!.getAttribute('href')).toContain('proj-001')
  })

  it('TC-08-05: non-last folder segment renders as a link to the folder URL', () => {
    const items: Array<BreadcrumbItem> = [
      { id: 'proj-001', name: 'My Project', type: 'project' },
      { id: 'folder-001', name: 'Parent Folder', type: 'folder' },
      { id: 'folder-002', name: 'Child Folder', type: 'folder' },
    ]
    renderBreadcrumb(items, 'proj-001')

    // Parent Folder (non-last) should be a link containing folder-001 in href
    const parentFolderLink = screen.getByText('Parent Folder').closest('a')
    expect(parentFolderLink).toBeTruthy()
    expect(parentFolderLink!.getAttribute('href')).toContain('folder-001')
  })

  it('last item renders as plain text (current location), not a link', () => {
    const items: Array<BreadcrumbItem> = [
      { id: 'proj-001', name: 'My Project', type: 'project' },
      { id: 'folder-001', name: 'Alpha Folder', type: 'folder' },
    ]
    renderBreadcrumb(items, 'proj-001')

    const lastItem = screen.getByText('Alpha Folder')
    // Last item should NOT be wrapped in an anchor
    expect(lastItem.closest('a')).toBeNull()
  })

  it('renders a nav element when items are present', () => {
    const items: Array<BreadcrumbItem> = [
      { id: 'proj-001', name: 'My Project', type: 'project' },
      { id: 'folder-001', name: 'Alpha Folder', type: 'folder' },
    ]
    const { container } = renderBreadcrumb(items, 'proj-001')
    expect(container.querySelector('nav')).toBeTruthy()
  })
})
