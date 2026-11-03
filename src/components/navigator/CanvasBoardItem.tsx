// src/components/navigator/CanvasBoardItem.tsx
// Canvas board item component for navigation tree.
//
// A deliberate mirror of WhiteboardItem.tsx rather than a `kind`-prop
// generalisation on WhiteboardItem itself (navigator-create-canvas-board
// tactical plan, decision C1) — the repo's own stated preference is a
// parallel mirror over a generalised component (see the CanvasBoardShareLink
// rationale in schema-sql.ts). Every wrapper `className` string below is
// copied VERBATIM from WhiteboardItem.tsx: the tree's row alignment has been
// corrected four times (907cc32, 81052ef, 9e91322, fa47fc6) and a
// hand-written variant would misalign.

import { Link } from '@tanstack/react-router'
import { Pencil, Shapes, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  ROW_ACTION_BUTTON_CLASS,
  ROW_ACTION_DELETE_CLASS,
  RowActions,
} from './RowActions'
import { Button } from '@/components/ui/button'

/**
 * Props for CanvasBoardItem component
 */
export interface CanvasBoardItemProps {
  /** Canvas board ID */
  id: string
  /** Canvas board name */
  name: string
  /** Whether the canvas board is currently selected */
  isActive?: boolean
  /** Callback for rename action */
  onRename?: (id: string, currentName: string) => void
  /** Callback for delete action */
  onDelete?: (id: string, name: string) => void
  /** Whether drag-and-drop is enabled */
  draggable?: boolean
  /** Callback when drag starts */
  onDragStart?: (e: React.DragEvent, canvasBoardId: string) => void
}

/**
 * CanvasBoardItem component
 * Displays a canvas board in the navigation tree with click navigation and context menu
 */
export function CanvasBoardItem({
  id,
  name,
  isActive = false,
  onRename,
  onDelete,
  draggable = true,
  onDragStart,
}: CanvasBoardItemProps) {
  const [isDragging, setIsDragging] = useState(false)

  const handleDragStart = (e: React.DragEvent) => {
    setIsDragging(true)
    e.dataTransfer.effectAllowed = 'move'
    // Distinct key from WhiteboardItem's 'whiteboardId' — the drag payload
    // must identify the board kind so a folder drop handler never routes a
    // canvas board through `updateWhiteboardFn` (plan step 8's two-key rule).
    e.dataTransfer.setData('canvasBoardId', id)
    onDragStart?.(e, id)
  }

  const handleDragEnd = () => {
    setIsDragging(false)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    // Prevent default right-click menu if we have actions
    if (onRename || onDelete) {
      e.preventDefault()
    }
  }

  return (
    <div
      className={`group relative ${isDragging ? 'opacity-50' : ''}`}
      draggable={draggable}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onContextMenu={handleContextMenu}
    >
      <Link
        to="/canvas/$boardId"
        params={{ boardId: id }}
        className={`flex items-center gap-2 rounded-md pl-2 pr-2 py-2 text-sm transition-colors ${
          isActive
            ? 'bg-accent text-accent-foreground'
            : 'hover:bg-accent/50 text-muted-foreground hover:text-foreground'
        }`}
      >
        <Shapes className="h-4 w-4 flex-shrink-0" />
        <span className="flex-1 truncate">{name}</span>
      </Link>

      {/* Action Buttons */}
      {(onRename || onDelete) && (
        <RowActions>
          {onRename && (
            <Button
              variant="ghost"
              size="sm"
              className={ROW_ACTION_BUTTON_CLASS}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onRename(id, name)
              }}
              title="Rename"
            >
              <Pencil className="h-3 w-3" />
              <span className="sr-only">Rename</span>
            </Button>
          )}
          {onDelete && (
            <Button
              variant="ghost"
              size="sm"
              className={ROW_ACTION_DELETE_CLASS}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onDelete(id, name)
              }}
              title="Delete"
            >
              <Trash2 className="h-3 w-3" />
              <span className="sr-only">Delete</span>
            </Button>
          )}
        </RowActions>
      )}
    </div>
  )
}
