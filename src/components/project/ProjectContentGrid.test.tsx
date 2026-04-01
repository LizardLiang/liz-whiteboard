// @vitest-environment jsdom
// src/components/project/ProjectContentGrid.test.tsx
// TS-02 (R2) + TS-04 (R4): ProjectContentGrid unit tests

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  RouterContextProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router'
import { ProjectContentGrid } from './ProjectContentGrid'
import type { ReactNode } from 'react'
import { routeTree } from '@/routeTree.gen'

function createTestRouter() {
  const history = createMemoryHistory({ initialEntries: ['/'] })
  return createRouter({ routeTree, history })
}

function RouterWrapper({ children }: { children: ReactNode }) {
  const router = createTestRouter()
  return (
    <RouterContextProvider router={router}>{children}</RouterContextProvider>
  )
}

function renderGrid(props: Parameters<typeof ProjectContentGrid>[0]) {
  return render(
    <RouterWrapper>
      <ProjectContentGrid {...props} />
    </RouterWrapper>,
  )
}

const PROJECT_ID = 'proj-001'

const makeFolders = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `folder-${i + 1}`,
    name: `Folder ${i + 1}`,
    createdAt: new Date('2026-01-01'),
  }))

const makeWhiteboards = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `wb-${i + 1}`,
    name: `Whiteboard ${i + 1}`,
    updatedAt: new Date('2026-03-30'),
    _count: { tables: i + 1 },
  }))

describe('ProjectContentGrid', () => {
  describe('TC-02-01: folder cards rendered', () => {
    it('renders 2 folder cards when folders array has 2 entries', () => {
      renderGrid({
        projectId: PROJECT_ID,
        folders: makeFolders(2),
        whiteboards: [],
      })

      expect(screen.getByText('Folder 1')).toBeTruthy()
      expect(screen.getByText('Folder 2')).toBeTruthy()
    })
  })

  describe('TC-02-02: whiteboard cards rendered', () => {
    it('renders 3 whiteboard cards when whiteboards array has 3 entries', () => {
      renderGrid({
        projectId: PROJECT_ID,
        folders: [],
        whiteboards: makeWhiteboards(3),
      })

      expect(screen.getByText('Whiteboard 1')).toBeTruthy()
      expect(screen.getByText('Whiteboard 2')).toBeTruthy()
      expect(screen.getByText('Whiteboard 3')).toBeTruthy()
    })
  })

  describe('TC-02-03: whiteboard card shows name, date, and table count', () => {
    it('shows whiteboard name and table count', () => {
      renderGrid({
        projectId: PROJECT_ID,
        folders: [],
        whiteboards: [
          {
            id: 'wb-001',
            name: 'Schema Design',
            updatedAt: new Date('2026-03-30'),
            _count: { tables: 5 },
          },
        ],
      })

      expect(screen.getByText('Schema Design')).toBeTruthy()
      expect(screen.getByText(/5 tables/)).toBeTruthy()
    })
  })

  describe('TC-02-04: folders appear before whiteboards in DOM order', () => {
    it('renders all folder links before any whiteboard links', () => {
      renderGrid({
        projectId: PROJECT_ID,
        folders: makeFolders(2),
        whiteboards: makeWhiteboards(2),
      })

      const allLinks = document.querySelectorAll('a')
      const linkTexts = Array.from(allLinks).map(
        (a) => a.textContent?.trim() ?? '',
      )
      const folderIndices = linkTexts
        .map((t, i) => (t.includes('Folder') ? i : -1))
        .filter((i) => i !== -1)
      const wbIndices = linkTexts
        .map((t, i) => (t.includes('Whiteboard') ? i : -1))
        .filter((i) => i !== -1)

      expect(folderIndices.length).toBe(2)
      expect(wbIndices.length).toBe(2)
      // All folder link indices should be less than all whiteboard link indices
      expect(Math.max(...folderIndices)).toBeLessThan(Math.min(...wbIndices))
    })
  })

  describe('TC-02-05: empty grid when both arrays are empty', () => {
    it('renders the grid container with no child cards when everything is empty', () => {
      const { container } = renderGrid({
        projectId: PROJECT_ID,
        folders: [],
        whiteboards: [],
      })

      // No links rendered when there are no folders or whiteboards
      const links = container.querySelectorAll('a')
      expect(links.length).toBe(0)
    })
  })

  describe('TC-02-06: folder card shows folder name', () => {
    it('shows folder name text', () => {
      renderGrid({
        projectId: PROJECT_ID,
        folders: [
          { id: 'folder-001', name: 'Core Models', createdAt: new Date() },
        ],
        whiteboards: [],
      })

      expect(screen.getByText('Core Models')).toBeTruthy()
    })
  })

  describe('TC-02-07: whiteboard card shows "0 tables" when count is zero', () => {
    it('displays "0 tables" for whiteboard with no tables', () => {
      renderGrid({
        projectId: PROJECT_ID,
        folders: [],
        whiteboards: [
          {
            id: 'wb-empty',
            name: 'Empty Board',
            updatedAt: new Date(),
            _count: { tables: 0 },
          },
        ],
      })

      expect(screen.getByText('0 tables')).toBeTruthy()
    })
  })

  describe('singular "table" vs plural "tables"', () => {
    it('shows "1 table" (singular) for exactly one table', () => {
      renderGrid({
        projectId: PROJECT_ID,
        folders: [],
        whiteboards: [
          {
            id: 'wb-one',
            name: 'One Table Board',
            updatedAt: new Date(),
            _count: { tables: 1 },
          },
        ],
      })

      expect(screen.getByText('1 table')).toBeTruthy()
    })
  })

  describe('TC-04-01: whiteboard card links to /whiteboard/:whiteboardId', () => {
    it('whiteboard card renders as a link with correct whiteboard href', () => {
      renderGrid({
        projectId: PROJECT_ID,
        folders: [],
        whiteboards: [
          {
            id: 'wb-abc123',
            name: 'My Whiteboard',
            updatedAt: new Date(),
            _count: { tables: 2 },
          },
        ],
      })

      const link = screen.getByText('My Whiteboard').closest('a')
      expect(link).toBeTruthy()
      expect(link!.getAttribute('href')).toContain('wb-abc123')
    })
  })

  describe('TC-04-02: whiteboard card does not link to project/folder route', () => {
    it('whiteboard card href does not contain /project/ or /folder/', () => {
      renderGrid({
        projectId: PROJECT_ID,
        folders: [],
        whiteboards: [
          {
            id: 'wb-abc123',
            name: 'My Whiteboard',
            updatedAt: new Date(),
            _count: { tables: 2 },
          },
        ],
      })

      const link = screen.getByText('My Whiteboard').closest('a')
      expect(link).toBeTruthy()
      const href = link!.getAttribute('href') ?? ''
      expect(href).not.toContain('/project/')
      expect(href).not.toContain('/folder/')
    })
  })

  describe('folder card links to project folder route', () => {
    it('folder card renders as a link with correct folder route href', () => {
      renderGrid({
        projectId: 'proj-001',
        folders: [
          { id: 'folder-xyz', name: 'Test Folder', createdAt: new Date() },
        ],
        whiteboards: [],
      })

      const link = screen.getByText('Test Folder').closest('a')
      expect(link).toBeTruthy()
      const href = link!.getAttribute('href') ?? ''
      expect(href).toContain('proj-001')
      expect(href).toContain('folder-xyz')
    })
  })
})
