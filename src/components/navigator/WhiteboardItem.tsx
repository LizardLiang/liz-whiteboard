// src/components/navigator/WhiteboardItem.tsx
// Whiteboard item component for navigation tree

import { Link } from '@tanstack/react-router'
import { FileText, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

/**
 * Props for WhiteboardItem component
 */
export interface WhiteboardItemProps {
  /** Whiteboard ID */
  id: string
  /** Whiteboard name */
  name: string
  /** Whether the whiteboard is currently selected */
  isActive?: boolean
  /** Callback for rename action */
  onRename?: (id: string, currentName: string) => void
  /** Callback for delete action */
  onDelete?: (id: string, name: string) => void
  /** Whether drag-and-drop is enabled */
  draggable?: boolean
  /** Callback when drag starts */
  onDragStart?: (e: React.DragEvent, whiteboardId: string) => void
}

/**
 * WhiteboardItem component
 * Displays a whiteboard in the navigation tree with click navigation and context menu
 */
export function WhiteboardItem({
  id,
  name,
  isActive = false,
  onRename,
  onDelete,
  draggable = true,
  onDragStart,
}: WhiteboardItemProps) {
  const [isDragging, setIsDragging] = useState(false)

  const handleDragStart = (e: React.DragEvent) => {
    setIsDragging(true)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('whiteboardId', id)
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
        to="/whiteboard/$whiteboardId"
        params={{ whiteboardId: id }}
        className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
          isActive
            ? 'bg-accent text-accent-foreground'
            : 'hover:bg-accent/50 text-muted-foreground hover:text-foreground'
        }`}
      >
        <FileText className="h-4 w-4 flex-shrink-0" />
        <span className="flex-1 truncate">{name}</span>
      </Link>

      {/* Action Buttons */}
      {(onRename || onDelete) && (
        <div className="absolute right-1 top-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-sidebar rounded-md px-0.5">
          {onRename && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
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
              className="h-6 w-6 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
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
        </div>
      )}
    </div>
  )
}
