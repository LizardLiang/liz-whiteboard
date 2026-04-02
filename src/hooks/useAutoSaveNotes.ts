/**
 * useAutoSaveNotes - Auto-save hook with debouncing for table notes
 * Provides automatic saving with configurable debounce delay and retry logic
 */

import { useCallback, useRef, useEffect } from 'react'
import { useDebouncedCallback } from 'use-debounce'
import { useTableNotes } from './useTableNotes'

interface UseTableNotesOptions {
  tableId: string
  whiteboardId: string
  userId: string
}

interface AutoSaveConfig {
  /** Debounce delay in milliseconds */
  debounceDelay?: number
  /** Number of retry attempts for failed saves */
  retryAttempts?: number
  /** Backoff delay between retries in milliseconds */
  retryBackoff?: number
}

interface AutoSaveState {
  /** Current save status */
  status: 'idle' | 'saving' | 'saved' | 'error'
  /** Last successful save timestamp */
  lastSaved: Date | null
  /** Current error message if any */
  error: string | null
  /** Whether there are unsaved changes */
  hasUnsavedChanges: boolean
}

interface UseAutoSaveNotesReturn extends AutoSaveState {
  /** Debounced save function - call this when content changes */
  saveNotes: (content: string) => void
  /** Force immediate save without debouncing */
  saveImmediately: (content: string) => Promise<void>
  /** Clear any pending save operations */
  cancelPendingSave: () => void
}

/**
 * Auto-save hook for table notes with debouncing and retry logic
 *
 * Features:
 * - Configurable debounce delay (default 500ms)
 * - Retry logic with exponential backoff
 * - Automatic conflict resolution with localStorage backup
 * - Visual feedback for save states
 * - Cleanup on component unmount
 *
 * @example
 * ```tsx
 * const { saveNotes, status, hasUnsavedChanges } = useAutoSaveNotes({
 *   tableId: 'table123',
 *   whiteboardId: 'whiteboard456',
 *   userId: 'user789'
 * }, {
 *   debounceDelay: 500,
 *   retryAttempts: 3
 * })
 *
 * // In text change handler
 * const handleTextChange = (value: string) => {
 *   setText(value)
 *   saveNotes(value)
 * }
 * ```
 */
export function useAutoSaveNotes(
  tableNotesOptions: UseTableNotesOptions,
  config: AutoSaveConfig = {},
): UseAutoSaveNotesReturn {
  const {
    debounceDelay = 500,
    retryAttempts = 3,
    retryBackoff = 1000,
  } = config

  // Use the table notes hook for actual save operations
  const { updateNotes, isUpdating, error } = useTableNotes(tableNotesOptions)

  // Local state tracking
  const statusRef = useRef<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const lastSavedRef = useRef<Date | null>(null)
  const hasUnsavedChangesRef = useRef(false)
  const lastContentRef = useRef<string>('')
  const retryCountRef = useRef(0)

  // Backup mechanism for conflict resolution
  const backupToLocalStorage = useCallback(
    (content: string) => {
      try {
        const backupKey = `table-notes-backup-${tableNotesOptions.tableId}`
        localStorage.setItem(
          backupKey,
          JSON.stringify({
            content,
            timestamp: new Date().toISOString(),
            tableId: tableNotesOptions.tableId,
          }),
        )
      } catch (error) {
        console.warn('Failed to backup notes to localStorage:', error)
      }
    },
    [tableNotesOptions.tableId],
  )

  // Clear backup after successful save
  const clearBackup = useCallback(() => {
    try {
      const backupKey = `table-notes-backup-${tableNotesOptions.tableId}`
      localStorage.removeItem(backupKey)
    } catch (error) {
      console.warn('Failed to clear notes backup:', error)
    }
  }, [tableNotesOptions.tableId])

  // Main save function with retry logic
  const performSave = useCallback(
    async (content: string): Promise<void> => {
      try {
        statusRef.current = 'saving'
        hasUnsavedChangesRef.current = false

        await updateNotes(content)

        // Success
        statusRef.current = 'saved'
        lastSavedRef.current = new Date()
        retryCountRef.current = 0
        clearBackup()

        // Reset to idle after a brief delay
        setTimeout(() => {
          statusRef.current = 'idle'
        }, 1500)
      } catch (saveError) {
        statusRef.current = 'error'
        hasUnsavedChangesRef.current = true

        // Backup content on failed save
        backupToLocalStorage(content)

        // Retry logic with exponential backoff
        if (retryCountRef.current < retryAttempts) {
          retryCountRef.current += 1
          const delay = retryBackoff * Math.pow(2, retryCountRef.current - 1)

          console.log(
            `Save failed (attempt ${retryCountRef.current}/${retryAttempts}). Retrying in ${delay}ms...`,
          )

          setTimeout(() => {
            performSave(content)
          }, delay)
        } else {
          console.error('All save attempts failed:', saveError)
          retryCountRef.current = 0
        }

        throw saveError
      }
    },
    [
      updateNotes,
      retryAttempts,
      retryBackoff,
      backupToLocalStorage,
      clearBackup,
    ],
  )

  // Debounced save function
  const debouncedSave = useDebouncedCallback(
    (content: string) => {
      // Skip save if content hasn't changed
      if (content === lastContentRef.current) {
        return
      }

      lastContentRef.current = content
      performSave(content).catch((error) => {
        console.error('Debounced save failed:', error)
      })
    },
    debounceDelay,
    {
      leading: false,
      trailing: true,
    },
  )

  // Public save function that triggers debouncing
  const saveNotes = useCallback(
    (content: string) => {
      hasUnsavedChangesRef.current = true
      debouncedSave(content)
    },
    [debouncedSave],
  )

  // Immediate save function (no debouncing)
  const saveImmediately = useCallback(
    async (content: string) => {
      debouncedSave.cancel() // Cancel any pending debounced save
      lastContentRef.current = content
      await performSave(content)
    },
    [performSave, debouncedSave],
  )

  // Cancel pending saves
  const cancelPendingSave = useCallback(() => {
    debouncedSave.cancel()
    hasUnsavedChangesRef.current = false
    statusRef.current = 'idle'
  }, [debouncedSave])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      debouncedSave.cancel()
    }
  }, [debouncedSave])

  // Update status based on external loading state
  useEffect(() => {
    if (isUpdating && statusRef.current !== 'saving') {
      statusRef.current = 'saving'
    }
  }, [isUpdating])

  return {
    status: statusRef.current,
    lastSaved: lastSavedRef.current,
    error: error?.message || null,
    hasUnsavedChanges: hasUnsavedChangesRef.current,
    saveNotes,
    saveImmediately,
    cancelPendingSave,
  }
}

/**
 * Hook for handling conflict resolution when saves fail
 * Provides utilities to restore backed up content
 */
export function useNotesConflictResolution(tableId: string) {
  const getBackupContent = useCallback(() => {
    try {
      const backupKey = `table-notes-backup-${tableId}`
      const backup = localStorage.getItem(backupKey)
      if (backup) {
        return JSON.parse(backup)
      }
      return null
    } catch (error) {
      console.warn('Failed to retrieve backup content:', error)
      return null
    }
  }, [tableId])

  const clearBackupContent = useCallback(() => {
    try {
      const backupKey = `table-notes-backup-${tableId}`
      localStorage.removeItem(backupKey)
    } catch (error) {
      console.warn('Failed to clear backup content:', error)
    }
  }, [tableId])

  return {
    getBackupContent,
    clearBackupContent,
  }
}