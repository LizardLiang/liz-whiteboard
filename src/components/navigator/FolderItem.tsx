// src/components/navigator/FolderItem.tsx
// Folder item component for navigation tree with recursive nesting

import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { WhiteboardItem } from './WhiteboardItem'
import type { Folder as FolderType, Whiteboard } from '@prisma/client'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

/**
 * Maximum nesting depth for folders
 */
const MAX_FOLDER_DEPTH = 10

/**
 * Extended folder type with nested data
 */
export type FolderWithChildren = FolderType & {
  childFolders?: Array<FolderWithChildren>
  whiteboards?: Array<Whiteboard>
}

/**
 * Props for FolderItem component
 */
export interface FolderItemProps {
  /** Folder data */
  folder: FolderWithChildren
  /** Current nesting depth (used to prevent infinite recursion) */
  depth?: number
  /** ID of currently active whiteboard */
  activeWhiteboardId?: string
  /** Callback for creating a new subfolder */
  onCreateFolder?: (parentFolderId: string) => void
  /** Callback for creating a new whiteboard */
  onCreateWhiteboard?: (folderId: string) => void
  /** Callback for renaming folder */
  onRenameFolder?: (id: string, currentName: string) => void
  /** Callback for deleting folder */
  onDeleteFolder?: (id: string, name: string) => void
  /** Callback for renaming whiteboard */
  onRenameWhiteboard?: (id: string, currentName: string) => void
  /** Callback for deleting whiteboard */
  onDeleteWhiteboard?: (id: string, name: string) => void
  /** Callback when whiteboard drag starts */
  onWhiteboardDragStart?: (e: React.DragEvent, whiteboardId: string) => void
  /** Callback when whiteboard is dropped on this folder */
  onWhiteboardDrop?: (whiteboardId: string, targetFolderId: string) => void
}

/**
 * FolderItem component
 * Displays a folder in the navigation tree with expand/collapse functionality
 * Supports recursive nesting up to MAX_FOLDER_DEPTH levels
 */
export function FolderItem({
  folder,
  depth = 0,
  activeWhiteboardId,
  onCreateFolder,
  onCreateWhiteboard,
  onRenameFolder,
  onDeleteFolder,
  onRenameWhiteboard,
  onDeleteWhiteboard,
  onWhiteboardDragStart,
  onWhiteboardDrop,
}: FolderItemProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)

  const hasChildren =
    (folder.childFolders && folder.childFolders.length > 0) ||
    (folder.whiteboards && folder.whiteboards.length > 0)

  const canNestDeeper = depth < MAX_FOLDER_DEPTH

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    const whiteboardId = e.dataTransfer.getData('whiteboardId')
    if (whiteboardId && onWhiteboardDrop) {
      onWhiteboardDrop(whiteboardId, folder.id)
    }
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className={`group relative ${isDragOver ? 'bg-accent/50' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="flex items-center gap-1 pr-8">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              disabled={!hasChildren}
            >
              {hasChildren ? (
                isOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )
              ) : (
                <span className="w-4" />
              )}
            </Button>
          </CollapsibleTrigger>

          <div className="flex items-center gap-2 flex-1 px-2 py-2 rounded-md hover:bg-accent/50 transition-colors">
            {isOpen ? (
              <FolderOpen className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            ) : (
              <Folder className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            )}
            <span className="text-sm flex-1 truncate">{folder.name}</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="absolute right-1 top-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {onCreateWhiteboard && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={(e) => {
                e.stopPropagation()
                onCreateWhiteboard(folder.id)
              }}
              title="New Whiteboard"
            >
              <Plus className="h-3 w-3" />
              <span className="sr-only">New Whiteboard</span>
            </Button>
          )}
          {onCreateFolder && canNestDeeper && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={(e) => {
                e.stopPropagation()
                onCreateFolder(folder.id)
              }}
              title="New Subfolder"
            >
              <Folder className="h-3 w-3" />
              <span className="sr-only">New Subfolder</span>
            </Button>
          )}
          {onRenameFolder && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={(e) => {
                e.stopPropagation()
                onRenameFolder(folder.id, folder.name)
              }}
              title="Rename"
            >
              <Pencil className="h-3 w-3" />
              <span className="sr-only">Rename</span>
            </Button>
          )}
          {onDeleteFolder && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={(e) => {
                e.stopPropagation()
                onDeleteFolder(folder.id, folder.name)
              }}
              title="Delete"
            >
              <Trash2 className="h-3 w-3" />
              <span className="sr-only">Delete</span>
            </Button>
          )}
        </div>
      </div>

      {/* Collapsible Content */}
      <CollapsibleContent>
        <div className="ml-4 mt-1 space-y-1">
          {/* Render child folders recursively (if not at max depth) */}
          {canNestDeeper &&
            folder.childFolders?.map((childFolder) => (
              <FolderItem
                key={childFolder.id}
                folder={childFolder}
                depth={depth + 1}
                activeWhiteboardId={activeWhiteboardId}
                onCreateFolder={onCreateFolder}
                onCreateWhiteboard={onCreateWhiteboard}
                onRenameFolder={onRenameFolder}
                onDeleteFolder={onDeleteFolder}
                onRenameWhiteboard={onRenameWhiteboard}
                onDeleteWhiteboard={onDeleteWhiteboard}
                onWhiteboardDragStart={onWhiteboardDragStart}
                onWhiteboardDrop={onWhiteboardDrop}
              />
            ))}

          {/* Render whiteboards */}
          {folder.whiteboards?.map((whiteboard) => (
            <WhiteboardItem
              key={whiteboard.id}
              id={whiteboard.id}
              name={whiteboard.name}
              isActive={whiteboard.id === activeWhiteboardId}
              onRename={onRenameWhiteboard}
              onDelete={onDeleteWhiteboard}
              onDragStart={onWhiteboardDragStart}
            />
          ))}

          {/* Show warning if max depth reached */}
          {!canNestDeeper &&
            folder.childFolders &&
            folder.childFolders.length > 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground italic">
                Maximum nesting depth reached
              </div>
            )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
