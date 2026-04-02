/**
 * TableNoteDrawer - Side drawer for editing table notes
 * Uses shadcn/ui Sheet component with responsive design
 */

import React, { useEffect, useState, useCallback } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useAutoSaveNotes, useNotesConflictResolution } from '@/hooks/useAutoSaveNotes'
import { useTableNotes } from '@/hooks/useTableNotes'
import { cn } from '@/lib/utils'
import { AlertCircle, CheckCircle2, Loader2, Clock, User } from 'lucide-react'

interface TableNoteDrawerProps {
  /** Whether the drawer is open */
  isOpen: boolean
  /** Table ID for notes, null when drawer should be closed */
  tableId: string | null
  /** Display name of the table */
  tableName: string
  /** Whiteboard ID for collaboration context */
  whiteboardId: string
  /** Current user ID */
  userId: string
  /** Callback to close the drawer */
  onClose: () => void
}

/**
 * TableNoteDrawer component with auto-save and collaborative features
 *
 * Features:
 * - shadcn/ui Sheet for responsive side drawer
 * - Auto-save with 500ms debouncing
 * - Character count with 10,000 character limit
 * - Conflict resolution with localStorage backup
 * - Collaborative editing indicators
 * - Loading and error states
 * - Responsive design for mobile/tablet
 *
 * @example
 * ```tsx
 * <TableNoteDrawer
 *   isOpen={isDrawerOpen}
 *   tableId={selectedTableId}
 *   tableName="users"
 *   whiteboardId="wb123"
 *   userId="user456"
 *   onClose={() => setIsDrawerOpen(false)}
 * />
 * ```
 */
export function TableNoteDrawer({
  isOpen,
  tableId,
  tableName,
  whiteboardId,
  userId,
  onClose,
}: TableNoteDrawerProps) {
  // Local content state for immediate UI updates
  const [localContent, setLocalContent] = useState('')

  // Hooks for notes management (only when tableId is available)
  const notesOptions = tableId
    ? { tableId, whiteboardId, userId }
    : { tableId: '', whiteboardId: '', userId: '' }

  const { notes, isLoading, hasNotes, updatedAt } = useTableNotes(notesOptions)
  const {
    saveNotes,
    status,
    hasUnsavedChanges,
    error: saveError,
    lastSaved,
  } = useAutoSaveNotes(notesOptions, {
    debounceDelay: 500,
    retryAttempts: 3,
    retryBackoff: 1000,
  })

  const { getBackupContent, clearBackupContent } = useNotesConflictResolution(
    tableId || '',
  )

  // Character limit
  const CHARACTER_LIMIT = 10000

  // Update local content when notes change from server
  useEffect(() => {
    if (notes !== localContent && !hasUnsavedChanges) {
      setLocalContent(notes)
    }
  }, [notes, hasUnsavedChanges]) // Don't include localContent to avoid loops

  // Reset state when drawer opens/closes or table changes
  useEffect(() => {
    if (isOpen && tableId) {
      setLocalContent(notes)
    }
  }, [isOpen, tableId, notes])

  // Handle text changes with auto-save
  const handleContentChange = useCallback(
    (value: string) => {
      // Enforce character limit
      if (value.length > CHARACTER_LIMIT) {
        value = value.slice(0, CHARACTER_LIMIT)
      }

      setLocalContent(value)

      // Only save if we have a valid tableId
      if (tableId) {
        saveNotes(value)
      }
    },
    [tableId, saveNotes],
  )

  // Handle conflict resolution
  const handleRestoreBackup = useCallback(() => {
    const backup = getBackupContent()
    if (backup && backup.content) {
      setLocalContent(backup.content)
      if (tableId) {
        saveNotes(backup.content)
      }
    }
  }, [getBackupContent, saveNotes, tableId])

  const handleDiscardBackup = useCallback(() => {
    clearBackupContent()
  }, [clearBackupContent])

  // Character count with warning states
  const characterCount = localContent.length
  const isNearLimit = characterCount > CHARACTER_LIMIT * 0.9
  const atLimit = characterCount >= CHARACTER_LIMIT

  // Save status indicator
  const getSaveStatusIndicator = () => {
    switch (status) {
      case 'saving':
        return (
          <Badge variant="secondary" className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Saving...
          </Badge>
        )
      case 'saved':
        return (
          <Badge variant="outline" className="gap-1 text-green-600">
            <CheckCircle2 className="h-3 w-3" />
            Saved
          </Badge>
        )
      case 'error':
        return (
          <Badge variant="destructive" className="gap-1">
            <AlertCircle className="h-3 w-3" />
            Error
          </Badge>
        )
      default:
        return hasUnsavedChanges ? (
          <Badge variant="secondary" className="gap-1">
            <Clock className="h-3 w-3" />
            Unsaved changes
          </Badge>
        ) : null
    }
  }

  // Format last modified time
  const formatLastModified = (date: Date | null) => {
    if (!date) return null
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins} min${diffMins === 1 ? '' : 's'} ago`
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
  }

  // Check for backup content on error
  const backupContent = status === 'error' ? getBackupContent() : null

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent
        side="right"
        className={cn(
          'w-[500px] max-w-[90vw]', // Responsive width
          'flex flex-col gap-4',
          'sm:w-[400px]', // Smaller width on tablet
        )}
      >
        <SheetHeader className="space-y-2">
          <SheetTitle className="flex items-center justify-between">
            <span className="truncate">Table Notes: {tableName}</span>
            {getSaveStatusIndicator()}
          </SheetTitle>
          <SheetDescription>
            Add notes and documentation for this table. Changes are saved automatically.
          </SheetDescription>

          {/* Last modified info */}
          {updatedAt && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <User className="h-3 w-3" />
              <span>Last modified {formatLastModified(updatedAt)}</span>
            </div>
          )}
        </SheetHeader>

        {/* Error state with conflict resolution */}
        {saveError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="flex flex-col gap-2">
              <span>Failed to save notes: {saveError}</span>
              {backupContent && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRestoreBackup}
                  >
                    Restore Backup
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleDiscardBackup}
                  >
                    Discard
                  </Button>
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Main content area */}
        <div className="flex-1 flex flex-col gap-2">
          {isLoading ? (
            // Loading state
            <div className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-[200px] w-full" />
              <Skeleton className="h-4 w-32" />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <label htmlFor="notes-textarea" className="font-medium">
                  Notes Content
                </label>
                <span
                  className={cn(
                    'tabular-nums',
                    isNearLimit && 'text-orange-600',
                    atLimit && 'text-red-600',
                  )}
                >
                  {characterCount.toLocaleString()} / {CHARACTER_LIMIT.toLocaleString()}
                </span>
              </div>

              <Textarea
                id="notes-textarea"
                placeholder="Add notes for this table..."
                value={localContent}
                onChange={(e) => handleContentChange(e.target.value)}
                className={cn(
                  'min-h-[300px] resize-none',
                  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  atLimit && 'border-red-500 focus-visible:ring-red-500',
                )}
                autoFocus={isOpen}
                aria-label="Table notes editor"
                aria-describedby="character-count save-status"
                disabled={!tableId} // Disable if no table selected
              />

              {/* Additional help text */}
              <p className="text-xs text-muted-foreground">
                Use this space to document table purpose, business rules, or implementation notes.
                {hasNotes && ' This table already has notes.'}
              </p>
            </>
          )}
        </div>

        {/* Footer with status and help */}
        <div className="border-t pt-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span id="save-status">
              {status === 'idle' && !hasUnsavedChanges && 'All changes saved'}
              {hasUnsavedChanges && 'Auto-save in 500ms...'}
              {status === 'saving' && 'Saving changes...'}
              {status === 'saved' && lastSaved && `Saved at ${lastSaved.toLocaleTimeString()}`}
              {status === 'error' && 'Save failed - changes backed up locally'}
            </span>
          </div>

          {/* Keyboard shortcuts help */}
          <div className="text-xs text-muted-foreground space-y-1">
            <p><kbd className="text-xs">Esc</kbd> to close drawer</p>
            <p><kbd className="text-xs">Ctrl+Z</kbd> to undo</p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/**
 * Lazy-loaded wrapper for TableNoteDrawer
 * Reduces initial bundle size by loading drawer code only when needed
 */
export const LazyTableNoteDrawer = React.lazy(() =>
  Promise.resolve({ default: TableNoteDrawer }),
)