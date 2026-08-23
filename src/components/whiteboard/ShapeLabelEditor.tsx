// src/components/whiteboard/ShapeLabelEditor.tsx
// The native <textarea> label editor for all five shape kinds (FR-011,
// FR-011a). A NATIVE textarea is a requirement, not an implementation
// detail: the canvas's bare-key shortcuts (z/m/f/r/d) and React Flow's own
// deleteKeyCode already self-guard by skipping events whose target is an
// INPUT/TEXTAREA/contenteditable — a custom focusable <div> would defeat
// all of them at once (D-6).
//
// Escape COMMITS — it does not cancel. This differs from AreaNode's rename
// editor, which reverts on Escape; copying that file here would silently
// discard the user's text (D-5, tech-spec §8 Known Trap).

import { useEffect, useRef, useState } from 'react'
import { SHAPE_LABEL_MAX_LENGTH } from '@/data/schema'

export interface ShapeLabelEditorProps {
  initialText: string
  onCommit: (text: string) => void
}

export function ShapeLabelEditor({
  initialText,
  onCommit,
}: ShapeLabelEditorProps) {
  const [value, setValue] = useState(initialText)
  const ref = useRef<HTMLTextAreaElement>(null)
  const committedRef = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  function commit() {
    if (committedRef.current) return
    committedRef.current = true
    onCommit(value)
  }

  return (
    <textarea
      ref={ref}
      className="nodrag nopan shape-label-editor"
      value={value}
      maxLength={SHAPE_LABEL_MAX_LENGTH}
      aria-label="Shape label"
      style={{
        width: '100%',
        height: '100%',
        resize: 'none',
        border: 'none',
        outline: 'none',
        background: 'transparent',
        textAlign: 'center',
        font: 'inherit',
        color: 'inherit',
      }}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          // Commit + close. preventDefault so no newline is inserted.
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          // Commit (not cancel) + close + suppress bubbling to the
          // document-level table-edit-overlay Escape listener (D-5).
          e.preventDefault()
          e.stopPropagation()
          commit()
        }
        // Shift+Enter: default behaviour inserts a line break — no
        // preventDefault. Backspace/Delete: native textarea editing, no
        // special handling needed (D-6).
      }}
    />
  )
}
