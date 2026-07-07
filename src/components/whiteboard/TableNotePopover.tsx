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
}

export function TableNotePopover({
  description,
  onSave,
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
    />
  )
}
