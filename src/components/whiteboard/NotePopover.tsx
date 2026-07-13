/**
 * NotePopover — shared inline popover for editing a free-text note.
 *
 * Extracted (Hermes review, W2) from ColumnNotePopover and TableNotePopover,
 * which were ~90% identical. Both now render this component; behavior is
 * preserved EXACTLY for both call sites: 500ms debounce, localValue/open
 * state, external-sync useEffect (so inbound real-time updates refresh the
 * field while closed), MAX_LENGTH=2000 + char counter, nodrag/nowheel +
 * stopPropagation, StickyNote icon.
 *
 * Per-caller differences (aria-label, data-testid, icon size, placeholder,
 * idle-state text color, optional title/tooltip) are passed as props.
 */

import { useCallback, useEffect, useState } from 'react'
import { useDebouncedCallback } from 'use-debounce'
import { StickyNote } from 'lucide-react'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'

const MAX_LENGTH = 2000

export interface NotePopoverProps {
  description: string | null
  onSave: (description: string) => void
  /** aria-label for the trigger button, e.g. "Edit table note" */
  label: string
  /** data-testid for the trigger button (column note has none; table note uses "table-note-trigger") */
  testId?: string
  /** StickyNote icon size in px */
  iconSize?: number
  /** Textarea placeholder text */
  placeholder?: string
  /** Extra class applied to the trigger button (e.g. "column-note-btn" / "table-note-btn" — drives the CSS hover-reveal rules) */
  className?: string
  /** Idle (no-notes) text color CSS value — differs by rendering context (table header vs column row use different CSS vars) */
  idleColor?: string
  /** Optional title/tooltip attribute on the trigger (table note uses "Table note"; column note has none) */
  title?: string
  /**
   * Controlled open state (tactical plan: canvas-table-affordances) —
   * optional. When provided (together with `onOpenChange`), the popover's
   * open/closed state is driven externally instead of the internal
   * `useState` below, and `anchorOnly` swaps the visible StickyNote trigger
   * button for a zero-size `PopoverAnchor` (used by TableNode's chrome-light
   * branch, which has no visible header DOM to anchor a button to — the
   * canvas paints over it). Omitting both keeps the existing trigger-button
   * usage (full-DOM header) byte-identical to before this change.
   */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Render a zero-size `PopoverAnchor` instead of the StickyNote trigger
   * button — paired with `open`/`onOpenChange` above. */
  anchorOnly?: boolean
  /**
   * Override the anchor's inline style (tactical plan:
   * canvas-field-note-popover) — only meaningful with `anchorOnly`. Defaults
   * to the existing zero-size top-right anchor (TableNotePopover's
   * byte-for-byte prior behavior) when omitted; the field-note caller passes
   * a row-offset style so the popover opens beside the clicked column row
   * instead of the table's top-right corner.
   */
  anchorStyle?: React.CSSProperties
}

export function NotePopover({
  description,
  onSave,
  label,
  testId,
  iconSize = 13,
  placeholder,
  className,
  idleColor = 'var(--rf-table-text)',
  title,
  open: openProp,
  onOpenChange: onOpenChangeProp,
  anchorOnly = false,
  anchorStyle,
}: NotePopoverProps) {
  const [localValue, setLocalValue] = useState(description ?? '')
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : internalOpen
  const setOpen = isControlled ? (onOpenChangeProp ?? (() => {})) : setInternalOpen

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
      {anchorOnly ? (
        // Zero-size anchor (tactical plan: canvas-table-affordances) — the
        // chrome-light branch has no visible header DOM to attach a button
        // to (CanvasNodeLayer paints over it); the popover's open state is
        // driven entirely by the caller's `open`/`onOpenChange` (opened via
        // the right-click context menu instead of a click on this element).
        <PopoverAnchor asChild>
          <span
            aria-hidden
            style={
              anchorStyle ?? {
                position: 'absolute',
                top: 0,
                right: 0,
                width: 0,
                height: 0,
              }
            }
          />
        </PopoverAnchor>
      ) : (
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            title={title}
            data-testid={testId}
            className={`nodrag nowheel ${className ?? ''}`.trim()}
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
                : idleColor,
              transition: 'opacity 0.1s',
              fontSize: '13px',
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <StickyNote size={iconSize} />
          </button>
        </PopoverTrigger>
      )}
      <PopoverContent
        side="right"
        align="start"
        className="w-64 p-3"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-2">
          <Textarea
            placeholder={placeholder}
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
