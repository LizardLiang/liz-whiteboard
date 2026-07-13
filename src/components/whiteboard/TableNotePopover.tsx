/**
 * TableNotePopover — inline popover for editing a table's comment/note.
 * Table-level twin of column/ColumnNotePopover.tsx — auto-saves via a
 * debounced callback through the table:update WebSocket pipeline (reuses
 * DiagramTable.description, no schema changes).
 *
 * Renders the shared NotePopover (W2, Hermes review) with table-scoped props.
 */

import { NotePopover } from './NotePopover'

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
  return (
    <NotePopover
      description={description}
      onSave={onSave}
      label="Edit table note"
      title="Table note"
      testId="table-note-trigger"
      className="table-note-btn"
      iconSize={14}
      placeholder="Add a note for this table..."
      idleColor="var(--rf-table-header-text)"
      open={open}
      onOpenChange={onOpenChange}
      anchorOnly={anchorOnly}
    />
  )
}
