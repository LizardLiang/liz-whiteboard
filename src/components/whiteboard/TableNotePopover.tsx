/**
 * TableNotePopover — inline popover for editing a table's comment/note.
 * Table-level twin of column/ColumnNotePopover.tsx — auto-saves via a
 * debounced callback through the table:update WebSocket pipeline (reuses
 * DiagramTable.description, no schema changes).
 *
 * Renders the shared NotePopover (W2, Hermes review) with table-scoped props.
 */

import { NotePopover } from './NotePopover'
import { useT } from '@/lib/i18n/use-t'

interface TableNotePopoverProps {
  description: string | null
  onSave: (description: string) => void
  /** Controlled open passthrough (tactical plan: canvas-table-affordances)
   * — see NotePopoverProps for the full contract. Omitting all three keeps
   * the existing trigger-button usage (full-DOM header) unchanged. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  anchorOnly?: boolean
}

export function TableNotePopover({
  description,
  onSave,
  open,
  onOpenChange,
  anchorOnly,
}: TableNotePopoverProps) {
  const t = useT()
  return (
    <NotePopover
      description={description}
      onSave={onSave}
      label={t('whiteboard.tableNote.edit')}
      title={t('whiteboard.tableNote.title')}
      testId="table-note-trigger"
      className="table-note-btn"
      iconSize={14}
      placeholder={t('whiteboard.tableNote.placeholder')}
      idleColor="var(--rf-table-header-text)"
      open={open}
      onOpenChange={onOpenChange}
      anchorOnly={anchorOnly}
    />
  )
}
