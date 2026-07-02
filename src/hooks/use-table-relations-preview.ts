/**
 * useTableRelationsPreview — keyboard shortcut (r) handler for the table
 * relations panel
 *
 * Intercepts bare `r` on a single selected table node and calls
 * onToggleTable to open/close that table's attached relations panel. Toggle
 * semantics (pressing the same table's shortcut again closes it, pressing it
 * while a different single table is selected switches to that table) are
 * implemented by the caller, not here. Guard/dispatch logic is shared with
 * the other table-scoped shortcuts via useSingleSelectedTableShortcut.
 *
 * Must be used inside a ReactFlowProvider context (calls useReactFlow).
 */

import { useSingleSelectedTableShortcut } from './use-single-selected-table-shortcut'

export function useTableRelationsPreview(
  onToggleTable: (tableId: string) => void,
  suppressed: boolean,
): void {
  useSingleSelectedTableShortcut({
    key: 'r',
    onTrigger: onToggleTable,
    suppressed,
  })
}
