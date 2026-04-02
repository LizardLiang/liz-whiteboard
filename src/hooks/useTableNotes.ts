/**
 * useTableNotes - TanStack Query hook for table notes operations
 * Provides cached access to table notes with optimistic updates
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { updateTableNotes, getTableNotes } from '@/data/table-notes'
import type { UpdateTableNotesResponse } from '@/data/table-notes'

interface UseTableNotesOptions {
  tableId: string
  whiteboardId: string
  userId: string
}

interface UseTableNotesReturn {
  /** Current notes content or empty string if no notes */
  notes: string
  /** Loading state for initial notes fetch */
  isLoading: boolean
  /** Saving state for note updates */
  isUpdating: boolean
  /** Error from notes operations */
  error: Error | null
  /** Function to update notes with optimistic updates */
  updateNotes: (description: string) => Promise<UpdateTableNotesResponse>
  /** Whether the table has notes */
  hasNotes: boolean
  /** Last updated timestamp */
  updatedAt: Date | null
}

/**
 * Hook for table notes operations with TanStack Query integration
 *
 * Features:
 * - Cached notes data with 5-minute stale time
 * - Optimistic updates for better UX
 * - Automatic cache invalidation on updates
 * - Error handling for failed operations
 *
 * @example
 * ```tsx
 * const { notes, updateNotes, isLoading, hasNotes } = useTableNotes({
 *   tableId: 'table123',
 *   whiteboardId: 'whiteboard456',
 *   userId: 'user789'
 * })
 * ```
 */
export function useTableNotes({
  tableId,
  whiteboardId,
  userId,
}: UseTableNotesOptions): UseTableNotesReturn {
  const queryClient = useQueryClient()

  // Query for getting notes
  const {
    data: notesData,
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: ['table-notes', tableId],
    queryFn: () => getTableNotes({ data: { tableId } }),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes (garbage collection time, previously cacheTime)
    retry: 2, // Retry failed requests up to 2 times
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000), // Exponential backoff
  })

  // Mutation for updating notes
  const updateMutation = useMutation({
    mutationFn: (description: string) =>
      updateTableNotes({
        data: {
          tableId,
          description,
          whiteboardId,
          userId,
        },
      }),
    // Optimistic update
    onMutate: async (newDescription) => {
      // Cancel any outgoing refetches to prevent overwriting our optimistic update
      await queryClient.cancelQueries({ queryKey: ['table-notes', tableId] })

      // Snapshot the previous value
      const previousNotes = queryClient.getQueryData(['table-notes', tableId])

      // Optimistically update the cache
      queryClient.setQueryData(['table-notes', tableId], {
        description: newDescription,
        updatedAt: new Date(),
      })

      // Return context with the previous value
      return { previousNotes }
    },
    // If the mutation fails, use the context returned from onMutate to roll back
    onError: (err, _variables, context) => {
      if (context?.previousNotes) {
        queryClient.setQueryData(['table-notes', tableId], context.previousNotes)
      }
      console.error('Failed to save notes:', err)
    },
    // Always refetch after error or success to ensure we have the latest data
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['table-notes', tableId] })
    },
    // Optional: Success callback for additional side effects
    onSuccess: (responseData: UpdateTableNotesResponse) => {
      console.log('Notes saved successfully:', responseData.updatedAt)
    },
  })

  // Derived values
  const notes = notesData?.description || ''
  const hasNotes = Boolean(notes.trim())
  const updatedAt = notesData?.updatedAt || null

  return {
    notes,
    isLoading,
    isUpdating: updateMutation.isPending,
    error: queryError || updateMutation.error,
    updateNotes: updateMutation.mutateAsync,
    hasNotes,
    updatedAt,
  }
}

/**
 * Hook for bulk loading notes for multiple tables
 * Useful for loading notes indicators for all visible tables
 */
export function useBulkTableNotes(tableIds: string[]) {
  return useQuery({
    queryKey: ['table-notes-bulk', ...tableIds.sort()],
    queryFn: async () => {
      if (tableIds.length === 0) return { notes: {} }

      const { bulkLoadNotes } = await import('@/data/table-notes')
      return bulkLoadNotes({ data: { tableIds } })
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    enabled: tableIds.length > 0,
  })
}