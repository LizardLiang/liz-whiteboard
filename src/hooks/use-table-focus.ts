/**
 * useTableFocus — keyboard shortcut (f) handler for table focus overlay
 *
 * Registers a document-level keydown listener that intercepts bare `f`
 * on a single selected table node and calls onRequestFocus to open the
 * focus overlay dialog.
 *
 * Must be used inside a ReactFlowProvider context (calls useReactFlow).
 */

import { useEffect } from 'react'
import { useReactFlow } from '@xyflow/react'

export function useTableFocus(
  onRequestFocus: (tableId: string) => void,
  focusOverlayOpen: boolean,
): void {
  const { getNodes } = useReactFlow()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only bare lowercase 'f' — any modifier disqualifies
      if (e.key !== 'f') return
      if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return

      // Skip if the overlay is already open
      if (focusOverlayOpen) return

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
      // (column rows handle their own key events)
      if (active.closest('.column-row') || active.closest('.add-column-row')) {
        return
      }

      // Read currently selected nodes
      const selectedNodes = getNodes().filter((n) => n.selected)

      // Only act on exactly one selected node
      if (selectedNodes.length !== 1) return

      onRequestFocus(selectedNodes[0].id)
    }

    document.addEventListener('keydown', handler)
    return () => {
      document.removeEventListener('keydown', handler)
    }
  }, [getNodes, onRequestFocus, focusOverlayOpen])
}
