/**
 * InlineNameEditor — inline text input for editing column name
 * Auto-focuses on mount, Enter commits, Escape cancels, blur commits.
 *
 * The editor takes the width of the text it holds. A hidden copy of the typed
 * text sizes the slot and the input fills it, so the whole name stays visible
 * while typing, and a blur-commit (typed text == committed name) leaves the
 * table width as it is. A table that changed width on the blur-commit that a
 * click on a header button starts would move the button from under the
 * pointer, and the click would miss.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export interface InlineNameEditorProps {
  value: string
  onCommit: (newValue: string) => void
  onCancel: () => void
  /** Weight of the name text this editor replaces (the hidden sizer uses it). */
  fontWeight?: number | string
}

export function InlineNameEditor({
  value,
  onCommit,
  onCancel,
  fontWeight,
}: InlineNameEditorProps) {
  const [inputValue, setInputValue] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelledRef = useRef(false)

  // Auto-focus on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [])

  const commit = useCallback(() => {
    const trimmed = inputValue.trim()
    if (!trimmed) {
      // Empty name — revert to original
      onCancel()
      return
    }
    onCommit(trimmed)
  }, [inputValue, onCommit, onCancel])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        cancelledRef.current = false
        commit()
      } else if (e.key === 'Escape') {
        cancelledRef.current = true
        onCancel()
      }
    },
    [commit, onCancel],
  )

  const handleBlur = useCallback(() => {
    if (!cancelledRef.current) {
      commit()
    }
  }, [commit])

  return (
    <span
      style={{
        position: 'relative',
        flex: 1,
        minWidth: 0,
        display: 'block',
        fontWeight,
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'block',
          visibility: 'hidden',
          overflow: 'hidden',
          whiteSpace: 'pre',
        }}
      >
        {inputValue.trim() === '' ? value : inputValue}
      </span>
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className="nodrag nowheel"
        style={{
          position: 'absolute',
          top: '50%',
          // Border and padding (3px a side) hang outside the slot, so the
          // text area is exactly as wide as the sizer text.
          left: -3,
          width: 'calc(100% + 6px)',
          transform: 'translateY(-50%)',
          fontSize: '13px',
          fontWeight: 'inherit',
          padding: '1px 2px',
          border: '1px solid var(--rf-edge-stroke-selected, #6366f1)',
          borderRadius: '3px',
          background: 'var(--rf-column-edit-bg, rgba(99,102,241,0.1))',
          color: 'var(--rf-table-text)',
          outline: 'none',
          minWidth: 0,
          boxSizing: 'border-box',
        }}
        // Stop click from propagating to React Flow (prevent node selection issues)
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      />
    </span>
  )
}
