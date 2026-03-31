// @vitest-environment jsdom
// src/components/navigator/CreateFolderDialog.test.tsx
// TS-07 (R7) + TS-12 (TC-12-03): CreateFolderDialog unit/integration tests

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CreateFolderDialog } from './CreateFolderDialog'
import type { ReactNode } from 'react'

// Mock the server function
vi.mock('@/routes/api/folders', () => ({
  createFolderFn: vi.fn(),
  deleteFolderFn: vi.fn(),
  updateFolderFn: vi.fn(),
}))

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

import { createFolderFn } from '@/routes/api/folders'

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function renderDialog(
  props: {
    open: boolean
    projectId: string
    parentFolderId?: string
    onOpenChange?: (open: boolean) => void
  },
  queryClient?: QueryClient,
) {
  const qc = queryClient ?? createTestQueryClient()

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }

  return {
    ...render(
      <Wrapper>
        <CreateFolderDialog
          open={props.open}
          onOpenChange={props.onOpenChange ?? vi.fn()}
          projectId={props.projectId}
          parentFolderId={props.parentFolderId}
        />
      </Wrapper>,
    ),
    queryClient: qc,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CreateFolderDialog', () => {
  describe('TC-07-02: dialog opens when open=true', () => {
    it('dialog is visible when open=true', () => {
      renderDialog({ open: true, projectId: 'proj-001' })
      expect(screen.getByText('Create Folder')).toBeTruthy()
    })

    it('dialog is not visible when open=false', () => {
      renderDialog({ open: false, projectId: 'proj-001' })
      expect(screen.queryByText('Create Folder')).toBeNull()
    })
  })

  describe('TC-07-03: dialog pre-fills projectId and no parentFolderId for root context', () => {
    it('calls createFolderFn with projectId and no parentFolderId when at root', async () => {
      const mockFolder = { id: 'folder-new', name: 'My Folder', projectId: 'proj-001' }
      vi.mocked(createFolderFn).mockResolvedValue(mockFolder as any)

      renderDialog({ open: true, projectId: 'proj-001', parentFolderId: undefined })

      const nameInput = screen.getByPlaceholderText('My Folder')
      fireEvent.change(nameInput, { target: { value: 'My Folder' } })

      const submitButton = screen.getByRole('button', { name: /create/i })
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(createFolderFn).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              projectId: 'proj-001',
            }),
          }),
        )
        const callArgs = vi.mocked(createFolderFn).mock.calls[0][0]
        expect(callArgs.data.parentFolderId).toBeUndefined()
      })
    })
  })

  describe('TC-07-04: parentFolderId is set when inside a folder', () => {
    it('calls createFolderFn with parentFolderId when inside a folder', async () => {
      const mockFolder = { id: 'folder-new', name: 'Sub Folder', projectId: 'proj-001' }
      vi.mocked(createFolderFn).mockResolvedValue(mockFolder as any)

      renderDialog({ open: true, projectId: 'proj-001', parentFolderId: 'folder-001' })

      const nameInput = screen.getByPlaceholderText('My Folder')
      fireEvent.change(nameInput, { target: { value: 'Sub Folder' } })

      const submitButton = screen.getByRole('button', { name: /create/i })
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(createFolderFn).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              projectId: 'proj-001',
              parentFolderId: 'folder-001',
            }),
          }),
        )
      })
    })
  })

  describe('TC-12-03: query cache invalidation after folder creation', () => {
    it("invalidates ['project-page'] and ['projects'] keys on successful creation", async () => {
      const mockFolder = { id: 'folder-new', name: 'Cache Test Folder', projectId: 'proj-001' }
      vi.mocked(createFolderFn).mockResolvedValue(mockFolder as any)

      const queryClient = createTestQueryClient()
      const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries')

      renderDialog({ open: true, projectId: 'proj-001' }, queryClient)

      const nameInput = screen.getByPlaceholderText('My Folder')
      fireEvent.change(nameInput, { target: { value: 'Cache Test Folder' } })

      fireEvent.click(screen.getByRole('button', { name: /create/i }))

      await waitFor(() => {
        expect(invalidateQueriesSpy).toHaveBeenCalledWith(
          expect.objectContaining({ queryKey: ['project-page'] }),
        )
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

      const nameInput = screen.getByPlaceholderText('My Folder')
      fireEvent.change(nameInput, { target: { value: 'Valid Folder Name' } })

      const submitButton = screen.getByRole('button', { name: /create/i })
      expect(submitButton).toHaveProperty('disabled', false)
    })
  })
})
