// src/components/whiteboard/table-history-context.tsx
// Lets a table's context menu open the history panel on its Changes tab. The
// whiteboard route owns the panel (the panel reuses ReactFlowWhiteboard for
// its preview, so rendering it below the canvas would be a circular import)
// and provides the opener; the read-only preview provides null, which hides
// the menu item.

import { createContext, useContext } from 'react'

export type OpenTableHistory = (tableName: string) => void

const TableHistoryContext = createContext<OpenTableHistory | null>(null)

export const TableHistoryProvider = TableHistoryContext.Provider

/** The opener, or null where the table menu must not offer "View history". */
export function useOpenTableHistory(): OpenTableHistory | null {
  return useContext(TableHistoryContext)
}
