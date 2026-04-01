/**
 * TableNodeContextMenu — right-click context menu wrapper for TableNode
 * Uses Radix ContextMenu (via shadcn) for accessibility and portal-based positioning
 */

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

export interface TableNodeContextMenuProps {
  children: React.ReactNode
  onDeleteTable: () => void
  disabled?: boolean
}

export function TableNodeContextMenu({
  children,
  onDeleteTable,
  disabled,
}: TableNodeContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={onDeleteTable}
          disabled={disabled}
        >
          Delete table
          <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
