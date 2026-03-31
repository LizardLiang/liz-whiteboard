// @vitest-environment jsdom
// src/components/navigator/CreateWhiteboardDialog.test.tsx
// TS-05 (R5) + TS-12 (TC-12-01, TC-12-02): CreateWhiteboardDialog unit/integration tests

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterContextProvider, createRouter, createMemoryHistory } from '@tanstack/react-router'
import { routeTree } from '@/routeTree.gen'
import { CreateWhiteboardDialog } from './CreateWhiteboardDialog'
import type { ReactNode } from 'react'

// Mock the server function
vi.mock('@/routes/api/whiteboards', () => ({
  createWhiteboardFn: vi.fn(),
}))

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

import { createWhiteboardFn } from '@/routes/api/whiteboards'

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function createTestRouter() {
  const history = createMemoryHistory({ initialEntries: ['/'] })
  return createRouter({ routeTree, history })
}

function renderDialog(
  props: { open: boolean; projectId: string; folderId?: string; onOpenChange?: (open: boolean) => void },
  queryClient?: QueryClient,
) {
  const qc = queryClient ?? createTestQueryClient()
  const router = createTestRouter()

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <RouterContextProvider router={router}>
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      </RouterContextProvider>
    )
  }

  return {
    ...render(
      <Wrapper>
        <CreateWhiteboardDialog
          open={props.open}
          onOpenChange={props.onOpenChange ?? vi.fn()}
          projectId={props.projectId}
          folderId={props.folderId}
        />
      </Wrapper>,
    ),
    queryClient: qc,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CreateWhiteboardDialog', () => {
  describe('TC-05-02: clicking open renders the dialog', () => {
    it('dialog is visible in DOM when open=true', () => {
      renderDialog({ open: true, projectId: 'proj-001' })
      expect(screen.getByText('Create Whiteboard')).toBeTruthy()
    })

    it('dialog is not visible when open=false', () => {
      renderDialog({ open: false, projectId: 'proj-001' })
      expect(screen.queryByText('Create Whiteboard')).toBeNull()
    })
  })

  describe('TC-05-03: dialog submits with projectId', () => {
    it('calls createWhiteboardFn with the projectId on submit', async () => {
      const mockWhiteboard = { id: 'wb-new', name: 'Test Board' }
      vi.mocked(createWhiteboardFn).mockResolvedValue(mockWhiteboard as any)

      renderDialog({ open: true, projectId: 'proj-001' })

      const nameInput = screen.getByPlaceholderText('My Whiteboard')
      fireEvent.change(nameInput, { target: { value: 'Test Board' } })

      const submitButton = screen.getByRole('button', { name: /create/i })
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(createWhiteboardFn).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              projectId: 'proj-001',
              name: 'Test Board',
            }),
          }),
        )
      })
    })
  })

  describe('TC-05-04: folderId is undefined when opened from project root', () => {
    it('calls createWhiteboardFn without folderId when opened from root', async () => {
      const mockWhiteboard = { id: 'wb-new', name: 'Root Board' }
      vi.mocked(createWhiteboardFn).mockResolvedValue(mockWhiteboard as any)

      renderDialog({ open: true, projectId: 'proj-001', folderId: undefined })

      const nameInput = screen.getByPlaceholderText('My Whiteboard')
      fireEvent.change(nameInput, { target: { value: 'Root Board' } })

      const submitButton = screen.getByRole('button', { name: /create/i })
      fireEvent.click(submitButton)

      await waitFor(() => {
        const callArgs = vi.mocked(createWhiteboardFn).mock.calls[0][0]
        expect(callArgs.data.folderId).toBeUndefined()
      })
    })
  })

  describe('TC-05-05: folderId is set when opened from inside a folder', () => {
    it('calls createWhiteboardFn with folderId when opened from a folder', async () => {
      const mockWhiteboard = { id: 'wb-new', name: 'Folder Board' }
      vi.mocked(createWhiteboardFn).mockResolvedValue(mockWhiteboard as any)

      renderDialog({ open: true, projectId: 'proj-001', folderId: 'folder-001' })

      const nameInput = screen.getByPlaceholderText('My Whiteboard')
      fireEvent.change(nameInput, { target: { value: 'Folder Board' } })

      const submitButton = screen.getByRole('button', { name: /create/i })
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(createWhiteboardFn).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              projectId: 'proj-001',
              folderId: 'folder-001',
            }),
          }),
        )
      })
    })
  })

  describe('TC-05-06 / TC-12-01 / TC-12-02: query cache invalidation after whiteboard creation', () => {
    it("invalidates ['project-page'] query key on successful creation", async () => {
      const mockWhiteboard = { id: 'wb-new', name: 'Cache Test Board' }
      vi.mocked(createWhiteboardFn).mockResolvedValue(mockWhiteboard as any)

      const queryClient = createTestQueryClient()
      const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries')

      renderDialog({ open: true, projectId: 'proj-001' }, queryClient)

      const nameInput = screen.getByPlaceholderText('My Whiteboard')
      fireEvent.change(nameInput, { target: { value: 'Cache Test Board' } })

      fireEvent.click(screen.getByRole('button', { name: /create/i }))

      await waitFor(() => {
        expect(invalidateQueriesSpy).toHaveBeenCalledWith(
          expect.objectContaining({ queryKey: ['project-page'] }),
        )
      })
    })

    it("invalidates ['projects'] query key on successful creation", async () => {
      const mockWhiteboard = { id: 'wb-new', name: 'Cache Test Board' }
      vi.mocked(createWhiteboardFn).mockResolvedValue(mockWhiteboard as any)

      const queryClient = createTestQueryClient()
      const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries')

      renderDialog({ open: true, projectId: 'proj-001' }, queryClient)

      const nameInput = screen.getByPlaceholderText('My Whiteboard')
      fireEvent.change(nameInput, { target: { value: 'Cache Test Board' } })

      fireEvent.click(screen.getByRole('button', { name: /create/i }))

      await waitFor(() => {
        expect(invalidateQueriesSpy).toHaveBeenCalledWith(
          expect.objectContaining({ queryKey: ['projects'] }),
        )
      })
    })
  })

  describe('form behavior', () => {
    it('create button is disabled when name field is empty', () => {
      renderDialog({ open: true, projectId: 'proj-001' })

      const submitButton = screen.getByRole('button', { name: /create/i })
      expect(submitButton).toHaveProperty('disabled', true)
    })

    it('create button is enabled when name field has content', () => {
      renderDialog({ open: true, projectId: 'proj-001' })

      const nameInput = screen.getByPlaceholderText('My Whiteboard')
      fireEvent.change(nameInput, { target: { value: 'Valid Name' } })

      const submitButton = screen.getByRole('button', { name: /create/i })
      expect(submitButton).toHaveProperty('disabled', false)
    })
  })
})
