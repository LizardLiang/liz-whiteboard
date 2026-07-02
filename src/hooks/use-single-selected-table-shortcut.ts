/**
 * useSingleSelectedTableShortcut — shared guard/dispatch logic for the
 * table-scoped keyboard shortcuts (`f` focus, `r` relations panel, `d` DDL
 * export). Registers a document-level keydown listener that fires
 * `onTrigger(tableId)` when a bare (unmodified) `key` is pressed while
 * exactly one table node is selected.
 *
 * Skips while focus is on an input/textarea/contenteditable element, or
 * inside a column row / add-column row (which handle their own key events).
 *
 * Must be used inside a ReactFlowProvider context (calls useReactFlow).
 */

import { useEffect } from 'react'
import { useReactFlow } from '@xyflow/react'

export interface UseSingleSelectedTableShortcutOptions {
  /** The bare (unmodified) key to intercept, e.g. 'f', 'r', 'd'. */
  key: string
  /** Called with the single selected table's id when the shortcut fires. */
  onTrigger: (tableId: string) => void
  /** When true, the shortcut is disabled entirely (e.g. a modal is open). */
  suppressed?: boolean
}

export function useSingleSelectedTableShortcut({
  key,
  onTrigger,
  suppressed = false,
}: UseSingleSelectedTableShortcutOptions): void {
  const { getNodes } = useReactFlow()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only the bare key — any modifier disqualifies
      if (e.key !== key) return
      if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return

      // Skip while suppressed (e.g. a modal/overlay is already open)
      if (suppressed) return

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

      onTrigger(selectedNodes[0].id)
    }

    document.addEventListener('keydown', handler)
    return () => {
      document.removeEventListener('keydown', handler)
    }
  }, [getNodes, key, onTrigger, suppressed])
}
