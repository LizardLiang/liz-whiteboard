/**
 * TableNodeContextMenu — right-click context menu wrapper for TableNode
 * Uses Radix ContextMenu (via shadcn) for accessibility and portal-based positioning
 */

import type { Dialect } from '@/lib/ddl-generator'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

export interface TableNodeContextMenuProps {
  children: React.ReactNode
  onDeleteTable: () => void
  onFocusTable?: () => void
  onExportDdl?: (dialect: Dialect) => void
  disabled?: boolean
}

export function TableNodeContextMenu({
  children,
  onDeleteTable,
  onFocusTable,
  onExportDdl,
  disabled,
}: TableNodeContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={() => {
            onFocusTable?.()
          }}
          disabled={disabled}
        >
          Focus view
          <ContextMenuShortcut>F</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={disabled}>
            Export DDL
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem
              onSelect={() => {
                onExportDdl?.('postgres')
              }}
            >
              Postgres
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                onExportDdl?.('mysql')
              }}
            >
              MySQL
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                onExportDdl?.('mssql')
              }}
            >
              MSSQL
              <ContextMenuShortcut>D</ContextMenuShortcut>
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => {
            onDeleteTable()
          }}
          disabled={disabled}
        >
          Delete table
          <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
