/**
 * ColumnNotePopover — inline popover for editing a column's description/note.
 * Auto-saves via debounced callback through the existing column update pipeline.
 */

import { useState, useCallback, useEffect } from 'react'
import { useDebouncedCallback } from 'use-debounce'
import { StickyNote } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'

const MAX_LENGTH = 2000

interface ColumnNotePopoverProps {
  description: string | null
  onSave: (description: string) => void
}

export function ColumnNotePopover({
  description,
  onSave,
}: ColumnNotePopoverProps) {
  const [localValue, setLocalValue] = useState(description ?? '')
  const [open, setOpen] = useState(false)

  // Sync external changes (e.g., real-time updates from other users)
  useEffect(() => {
    if (!open) {
      setLocalValue(description ?? '')
    }
  }, [description, open])

  const debouncedSave = useDebouncedCallback((value: string) => {
    onSave(value)
  }, 500)

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value.slice(0, MAX_LENGTH)
      setLocalValue(value)
      debouncedSave(value)
    },
    [debouncedSave],
  )

  const hasNotes = Boolean(description?.trim())

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Edit column note"
          className="nodrag nowheel column-note-btn"
          onClick={(e) => e.stopPropagation()}
          style={{
            opacity: hasNotes || open ? 0.8 : 0,
            flexShrink: 0,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '2px',
            color: hasNotes
              ? 'var(--rf-edge-stroke-selected, #6366f1)'
              : 'var(--rf-table-text)',
            transition: 'opacity 0.1s',
            fontSize: '13px',
            lineHeight: 1,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <StickyNote size={13} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        className="w-64 p-3"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-2">
          <Textarea
            placeholder="Add a note for this field..."
            value={localValue}
            onChange={handleChange}
            className="min-h-20 resize-none text-xs"
            maxLength={MAX_LENGTH}
            autoFocus
          />
          <span className="text-[10px] text-muted-foreground text-right">
            {localValue.length}/{MAX_LENGTH}
          </span>
        </div>
      </PopoverContent>
    </Popover>
  )
}
