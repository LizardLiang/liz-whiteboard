/**
 * ColumnNotePopover — inline popover for editing a column's description/note.
 * Auto-saves via debounced callback through the existing column update pipeline.
 *
 * Renders the shared NotePopover (W2, Hermes review) with column-scoped props.
 */

import { NotePopover } from '../NotePopover'

interface ColumnNotePopoverProps {
  description: string | null
  onSave: (description: string) => void
}

export function ColumnNotePopover({
  description,
  onSave,
}: ColumnNotePopoverProps) {
  return (
    <NotePopover
      description={description}
      onSave={onSave}
      label="Edit column note"
      className="column-note-btn"
      iconSize={13}
      placeholder="Add a note for this field..."
      idleColor="var(--rf-table-text)"
    />
  )
}
