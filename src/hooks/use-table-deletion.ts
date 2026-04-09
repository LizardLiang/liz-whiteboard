/**
 * useTableDeletion — keyboard shortcut (Delete/Backspace) handler for table deletion
 *
 * Registers a document-level keydown listener that intercepts Delete/Backspace
 * on selected table nodes and calls onRequestDelete to open the confirmation dialog.
 *
 * Must be used inside a ReactFlowProvider context (calls useReactFlow).
 */

import { useEffect } from 'react'
import { useReactFlow } from '@xyflow/react'

export function useTableDeletion(
  onRequestDelete: (tableId: string) => void,
): void {
  const { getNodes } = useReactFlow()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return

      const active = document.activeElement
      if (!active) return

      // Skip if focus is on an input, textarea, or contenteditable element
      const tag = active.tagName.toLowerCase()
      if (
        tag === 'input' ||
        tag === 'textarea' ||
        active.getAttribute('contenteditable') === 'true'
      ) {
        return
      }

      // Skip if focus is inside a column row or add-column row
      // (column row handles Delete itself via React onKeyDown)
      if (active.closest('.column-row') || active.closest('.add-column-row')) {
        return
      }

      // Read currently selected nodes
      const selectedNodes = getNodes().filter((n) => n.selected)

      // Only act on exactly one selected node
      if (selectedNodes.length !== 1) return

      onRequestDelete(selectedNodes[0].id)
    }

    document.addEventListener('keydown', handler)
    return () => {
      document.removeEventListener('keydown', handler)
    }
  }, [getNodes, onRequestDelete])
}
