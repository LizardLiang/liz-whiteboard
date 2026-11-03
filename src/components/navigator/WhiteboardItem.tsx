// src/components/navigator/WhiteboardItem.tsx
// Whiteboard item component for navigation tree

import { Link } from '@tanstack/react-router'
import { FileText, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  ROW_ACTION_BUTTON_CLASS,
  ROW_ACTION_DELETE_CLASS,
  RowActions,
} from './RowActions'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n/use-t'

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
  const t = useT()
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
        className={`flex items-center gap-2 rounded-md pl-2 pr-2 py-2 text-sm transition-colors ${
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
              title={t('common.rename')}
            >
              <Pencil className="h-3 w-3" />
              <span className="sr-only">{t('common.rename')}</span>
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
              title={t('common.delete')}
            >
              <Trash2 className="h-3 w-3" />
              <span className="sr-only">{t('common.delete')}</span>
            </Button>
          )}
        </RowActions>
      )}
    </div>
  )
}
