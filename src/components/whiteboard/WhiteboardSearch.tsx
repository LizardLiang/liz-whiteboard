/**
 * WhiteboardSearch — Cmd/Ctrl+K command palette to jump to a table or column.
 *
 * Wraps the shadcn `CommandDialog` (cmdk). Results are grouped into "Tables"
 * and "Columns"; selecting one closes the palette and asks the container to
 * pan/zoom the canvas to the owning table (see `onNavigateToTable`).
 *
 * Filtering is handled by cmdk's built-in case-insensitive matcher against
 * each item's value/keywords. The flat index is derived from the current
 * nodes via `buildSearchIndex`.
 */

import { useMemo } from 'react'
import { Columns3, Table2 } from 'lucide-react'

import type {
  ExternalTableNodeType,
  TableNodeType,
} from '@/lib/react-flow/types'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { buildSearchIndex } from '@/lib/react-flow/search-index'

/** Stable empty default, so the index memo is not invalidated every render. */
const EMPTY_REFERENCE_NODES: Array<ExternalTableNodeType> = []

export interface WhiteboardSearchProps {
  /** Whether the palette is open. */
  open: boolean
  /** Open/close handler. */
  onOpenChange: (open: boolean) => void
  /** Current React Flow nodes — the search index is derived from these. */
  nodes: Array<TableNodeType>
  /**
   * Cross-file reference nodes (LizMeter #83). Indexed alongside tables so a
   * reference is findable by the name it actually displays.
   */
  referenceNodes?: Array<ExternalTableNodeType>
  /** Called with the target table id when a result is selected. */
  onNavigateToTable: (tableId: string) => void
}

export function WhiteboardSearch({
  open,
  onOpenChange,
  nodes,
  referenceNodes = EMPTY_REFERENCE_NODES,
  onNavigateToTable,
}: WhiteboardSearchProps) {
  const index = useMemo(
    () => buildSearchIndex(nodes, referenceNodes),
    [nodes, referenceNodes],
  )

  const tables = index.filter((entry) => entry.type === 'table')
  const columns = index.filter((entry) => entry.type === 'column')

  const handleSelect = (tableId: string) => {
    onNavigateToTable(tableId)
    onOpenChange(false)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search tables and columns"
      description="Type a table or column name to jump to it on the canvas."
    >
      <CommandInput placeholder="Search tables and columns…" />
      <CommandList>
        <CommandEmpty>No matching tables or columns.</CommandEmpty>

        {tables.length > 0 && (
          <CommandGroup heading="Tables">
            {tables.map((entry) => (
              <CommandItem
                key={`table:${entry.tableId}`}
                value={entry.tableName}
                keywords={[entry.tableName]}
                onSelect={() => handleSelect(entry.tableId)}
              >
                <Table2 />
                <span>{entry.tableName}</span>
                {entry.sourceWhiteboardName != null && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    in {entry.sourceWhiteboardName}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {columns.length > 0 && (
          <CommandGroup heading="Columns">
            {columns.map((entry) => (
              <CommandItem
                key={`column:${entry.columnId}`}
                value={`${entry.columnName} ${entry.tableName}`}
                keywords={[entry.columnName, entry.tableName]}
                onSelect={() => handleSelect(entry.tableId)}
              >
                <Columns3 />
                <span>
                  {entry.tableName}
                  <span className="text-muted-foreground">.</span>
                  {entry.columnName}
                </span>
                {entry.sourceWhiteboardName != null && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    in {entry.sourceWhiteboardName}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
