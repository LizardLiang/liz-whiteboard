/**
 * InlineNameEditor — inline text input for editing column name
 * Auto-focuses on mount, Enter commits, Escape cancels, blur commits
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export interface InlineNameEditorProps {
  value: string
  onCommit: (newValue: string) => void
  onCancel: () => void
}

export function InlineNameEditor({
  value,
  onCommit,
  onCancel,
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
    <input
      ref={inputRef}
      type="text"
      value={inputValue}
      onChange={(e) => setInputValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      className="nodrag nowheel"
      style={{
        flex: 1,
        fontSize: '13px',
        fontWeight: 'inherit',
        padding: '1px 4px',
        border: '1px solid var(--rf-edge-stroke-selected, #6366f1)',
        borderRadius: '3px',
        background: 'var(--rf-column-edit-bg, rgba(99,102,241,0.1))',
        color: 'var(--rf-table-text)',
        outline: 'none',
        width: '100%',
        minWidth: 0,
      }}
      // Stop click from propagating to React Flow (prevent node selection issues)
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    />
  )
}
