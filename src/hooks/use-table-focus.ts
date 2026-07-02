/**
 * useTableFocus — keyboard shortcut (f) handler for table focus overlay
 *
 * Intercepts bare `f` on a single selected table node and calls
 * onRequestFocus to open the focus overlay dialog. Guard/dispatch logic is
 * shared with the other table-scoped shortcuts via
 * useSingleSelectedTableShortcut.
 *
 * Must be used inside a ReactFlowProvider context (calls useReactFlow).
 */

import { useSingleSelectedTableShortcut } from './use-single-selected-table-shortcut'

export function useTableFocus(
  onRequestFocus: (tableId: string) => void,
  focusOverlayOpen: boolean,
): void {
  useSingleSelectedTableShortcut({
    key: 'f',
    onTrigger: onRequestFocus,
    suppressed: focusOverlayOpen,
  })
}
