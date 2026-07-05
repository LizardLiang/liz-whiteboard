/**
 * TableNodeContextMenu — right-click context menu wrapper for TableNode
 * Uses Radix ContextMenu (via shadcn) for accessibility and portal-based positioning
 */

import { useWhiteboardPermissions } from './whiteboard-permissions-context'
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
  onPreviewRelations?: () => void
  disabled?: boolean
  /** Subject areas on this whiteboard (GH #106) — for the membership submenu */
  areas?: Array<{ id: string; name: string; memberTableIds: Array<string> }>
  /** This table's id — used to compute + toggle area membership */
  tableId?: string
  /** Add this table to an area */
  onAddToArea?: (tableId: string, areaId: string) => void
  /** Remove this table from an area */
  onRemoveFromArea?: (tableId: string, areaId: string) => void
}

export function TableNodeContextMenu({
  children,
  onDeleteTable,
  onFocusTable,
  onExportDdl,
  onPreviewRelations,
  disabled,
  areas,
  tableId,
  onAddToArea,
  onRemoveFromArea,
}: TableNodeContextMenuProps) {
  const { canEdit } = useWhiteboardPermissions()
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
        <ContextMenuItem
          onSelect={() => {
            onPreviewRelations?.()
          }}
          disabled={disabled}
        >
          Show relations
          <ContextMenuShortcut>R</ContextMenuShortcut>
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
        {/* Add to area — membership submenu (GH #106); EDITOR+ only */}
        {canEdit && tableId && (
          <ContextMenuSub>
            <ContextMenuSubTrigger disabled={disabled}>
              Add to area
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {!areas || areas.length === 0 ? (
                <ContextMenuItem disabled>No areas yet</ContextMenuItem>
              ) : (
                areas.map((area) => {
                  const isMember = area.memberTableIds.includes(tableId)
                  return (
                    <ContextMenuItem
                      key={area.id}
                      onSelect={() => {
                        if (isMember) onRemoveFromArea?.(tableId, area.id)
                        else onAddToArea?.(tableId, area.id)
                      }}
                    >
                      <span
                        className="mr-2 inline-block w-3 text-center"
                        aria-hidden
                      >
                        {isMember ? '✓' : ''}
                      </span>
                      {area.name}
                    </ContextMenuItem>
                  )
                })
              )}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        {/* Delete table — write action; hidden entirely for view-only viewers
            (not just disabled, matching the fail-closed header delete button). */}
        {canEdit && (
          <>
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
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
