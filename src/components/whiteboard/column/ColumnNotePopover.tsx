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
  /** Controlled open passthrough (tactical plan: canvas-field-note-popover)
   * — see NotePopoverProps for the full contract. Omitting all four keeps
   * the existing trigger-button usage (full-DOM ColumnRow) unchanged. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  anchorOnly?: boolean
  /** Anchor position override — see NotePopoverProps.anchorStyle. Used by
   * the canvas-native fieldnote affordance to anchor beside the clicked
   * column's row instead of the default top-right corner. */
  anchorStyle?: React.CSSProperties
}

export function ColumnNotePopover({
  description,
  onSave,
  open,
  onOpenChange,
  anchorOnly,
  anchorStyle,
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
      open={open}
      onOpenChange={onOpenChange}
      anchorOnly={anchorOnly}
      anchorStyle={anchorStyle}
    />
  )
}
