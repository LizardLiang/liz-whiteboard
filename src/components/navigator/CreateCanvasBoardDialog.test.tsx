// @vitest-environment jsdom
// src/components/navigator/CreateCanvasBoardDialog.test.tsx
// Unit/integration tests for CreateCanvasBoardDialog, mirroring
// CreateWhiteboardDialog.test.tsx (navigator-create-canvas-board tactical
// plan, step 11).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterContextProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router'
import { CreateCanvasBoardDialog } from './CreateCanvasBoardDialog'
import type { ReactNode } from 'react'
import { routeTree } from '@/routeTree.gen'

import { createCanvasBoardFn } from '@/lib/canvas-board/server-functions'

// Mock the server function
vi.mock('@/lib/canvas-board/server-functions', () => ({
  createCanvasBoardFn: vi.fn(),
}))

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function createTestRouter(
  queryClient?: ReturnType<typeof createTestQueryClient>,
) {
  const qc = queryClient ?? createTestQueryClient()
  const history = createMemoryHistory({ initialEntries: ['/'] })
  return createRouter({ routeTree, history, context: { queryClient: qc } })
}

function renderDialog(
  props: {
    open: boolean
    projectId: string
    folderId?: string
    onOpenChange?: (open: boolean) => void
  },
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
        <CreateCanvasBoardDialog
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

describe('CreateCanvasBoardDialog', () => {
  describe('dialog visibility', () => {
    it('dialog is visible in DOM when open=true', () => {
      renderDialog({ open: true, projectId: 'proj-001' })
      expect(screen.getByText('Create Canvas Board')).toBeTruthy()
    })

    it('dialog is not visible when open=false', () => {
      renderDialog({ open: false, projectId: 'proj-001' })
      expect(screen.queryByText('Create Canvas Board')).toBeNull()
    })
  })

  describe('dialog submits with projectId', () => {
    it('calls createCanvasBoardFn with the projectId on submit', async () => {
      const mockBoard = { id: 'board-new', name: 'Test Board' }
      vi.mocked(createCanvasBoardFn).mockResolvedValue(mockBoard as any)

      renderDialog({ open: true, projectId: 'proj-001' })

      const nameInput = screen.getByPlaceholderText('My Canvas Board')
      fireEvent.change(nameInput, { target: { value: 'Test Board' } })

      const submitButton = screen.getByRole('button', { name: /create/i })
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(createCanvasBoardFn).toHaveBeenCalledWith(
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

  describe('folderId is undefined when opened from project root', () => {
    it('calls createCanvasBoardFn without folderId when opened from root', async () => {
      const mockBoard = { id: 'board-new', name: 'Root Board' }
      vi.mocked(createCanvasBoardFn).mockResolvedValue(mockBoard as any)

      renderDialog({ open: true, projectId: 'proj-001', folderId: undefined })

      const nameInput = screen.getByPlaceholderText('My Canvas Board')
      fireEvent.change(nameInput, { target: { value: 'Root Board' } })

      const submitButton = screen.getByRole('button', { name: /create/i })
      fireEvent.click(submitButton)

      await waitFor(() => {
        const callArgs = vi.mocked(createCanvasBoardFn).mock.calls[0]?.[0] as {
          data: { folderId?: string }
        }
        expect(callArgs.data.folderId).toBeUndefined()
      })
    })
  })

  describe('folderId is set when opened from inside a folder', () => {
    it('calls createCanvasBoardFn with folderId when opened from a folder', async () => {
      const mockBoard = { id: 'board-new', name: 'Folder Board' }
      vi.mocked(createCanvasBoardFn).mockResolvedValue(mockBoard as any)

      renderDialog({
        open: true,
        projectId: 'proj-001',
        folderId: 'folder-001',
      })

      const nameInput = screen.getByPlaceholderText('My Canvas Board')
      fireEvent.change(nameInput, { target: { value: 'Folder Board' } })

      const submitButton = screen.getByRole('button', { name: /create/i })
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(createCanvasBoardFn).toHaveBeenCalledWith(
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

  describe('query cache invalidation after canvas board creation', () => {
    it("invalidates ['projects', 'tree'] query key on successful creation", async () => {
      const mockBoard = { id: 'board-new', name: 'Cache Test Board' }
      vi.mocked(createCanvasBoardFn).mockResolvedValue(mockBoard as any)

      const queryClient = createTestQueryClient()
      const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries')

      renderDialog({ open: true, projectId: 'proj-001' }, queryClient)

      const nameInput = screen.getByPlaceholderText('My Canvas Board')
      fireEvent.change(nameInput, { target: { value: 'Cache Test Board' } })

      fireEvent.click(screen.getByRole('button', { name: /create/i }))

      await waitFor(() => {
        expect(invalidateQueriesSpy).toHaveBeenCalledWith(
          expect.objectContaining({ queryKey: ['projects', 'tree'] }),
        )
      })
    })

    it("invalidates ['project-page'] query key on successful creation", async () => {
      const mockBoard = { id: 'board-new', name: 'Cache Test Board' }
      vi.mocked(createCanvasBoardFn).mockResolvedValue(mockBoard as any)

      const queryClient = createTestQueryClient()
      const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries')

      renderDialog({ open: true, projectId: 'proj-001' }, queryClient)

      const nameInput = screen.getByPlaceholderText('My Canvas Board')
      fireEvent.change(nameInput, { target: { value: 'Cache Test Board' } })

      fireEvent.click(screen.getByRole('button', { name: /create/i }))

      await waitFor(() => {
        expect(invalidateQueriesSpy).toHaveBeenCalledWith(
          expect.objectContaining({ queryKey: ['project-page'] }),
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

      const nameInput = screen.getByPlaceholderText('My Canvas Board')
      fireEvent.change(nameInput, { target: { value: 'Valid Name' } })

      const submitButton = screen.getByRole('button', { name: /create/i })
      expect(submitButton).toHaveProperty('disabled', false)
    })
  })
})
