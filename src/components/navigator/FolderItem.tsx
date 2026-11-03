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
import { CanvasBoardItem } from './CanvasBoardItem'
import { CreateBoardMenu } from './CreateBoardMenu'
import {
  ROW_ACTION_BUTTON_CLASS,
  ROW_ACTION_DELETE_CLASS,
  RowActions,
} from './RowActions'
import { mergeBoardsByUpdatedAt } from './merge-boards'
import type { TreeBoardRow } from '@/data/project'
import type { Folder as FolderType, Whiteboard } from '@/data/models'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { useT } from '@/lib/i18n/use-t'

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
  canvasBoards?: Array<TreeBoardRow>
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
  /** ID of currently active canvas board */
  activeCanvasBoardId?: string
  /** Callback for creating a new subfolder */
  onCreateFolder?: (parentFolderId: string) => void
  /** Callback for creating a new whiteboard */
  onCreateWhiteboard?: (folderId: string) => void
  /** Callback for creating a new canvas board */
  onCreateCanvasBoard?: (folderId: string) => void
  /** Callback for renaming folder */
  onRenameFolder?: (id: string, currentName: string) => void
  /** Callback for deleting folder */
  onDeleteFolder?: (id: string, name: string) => void
  /** Callback for renaming whiteboard */
  onRenameWhiteboard?: (id: string, currentName: string) => void
  /** Callback for deleting whiteboard */
  onDeleteWhiteboard?: (id: string, name: string) => void
  /** Callback for renaming canvas board */
  onRenameCanvasBoard?: (id: string, currentName: string) => void
  /** Callback for deleting canvas board */
  onDeleteCanvasBoard?: (id: string, name: string) => void
  /** Callback when whiteboard drag starts */
  onWhiteboardDragStart?: (e: React.DragEvent, whiteboardId: string) => void
  /** Callback when whiteboard is dropped on this folder */
  onWhiteboardDrop?: (whiteboardId: string, targetFolderId: string) => void
  /** Callback when canvas board is dropped on this folder */
  onCanvasBoardDrop?: (canvasBoardId: string, targetFolderId: string) => void
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
  activeCanvasBoardId,
  onCreateFolder,
  onCreateWhiteboard,
  onCreateCanvasBoard,
  onRenameFolder,
  onDeleteFolder,
  onRenameWhiteboard,
  onDeleteWhiteboard,
  onRenameCanvasBoard,
  onDeleteCanvasBoard,
  onWhiteboardDragStart,
  onWhiteboardDrop,
  onCanvasBoardDrop,
}: FolderItemProps) {
  const t = useT()
  const [isOpen, setIsOpen] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)

  const hasChildren =
    (folder.childFolders && folder.childFolders.length > 0) ||
    (folder.whiteboards && folder.whiteboards.length > 0) ||
    (folder.canvasBoards && folder.canvasBoards.length > 0)

  const canNestDeeper = depth < MAX_FOLDER_DEPTH
  const hasActions = Boolean(
    (onCreateWhiteboard && onCreateCanvasBoard) ||
      (onCreateFolder && canNestDeeper) ||
      onRenameFolder ||
      onDeleteFolder,
  )

  // Whiteboard rows and canvas board rows interleaved by updatedAt, most
  // recently updated first across both kinds — mirrors ProjectTree.tsx's
  // root-level merge.
  const boards = mergeBoardsByUpdatedAt(
    (folder.whiteboards ?? []).map((w) => ({
      id: w.id,
      name: w.name,
      updatedAt: w.updatedAt,
      kind: 'whiteboard' as const,
    })),
    folder.canvasBoards ?? [],
  )

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

    // Two distinct dataTransfer keys, one per board kind — never let a
    // canvas board id reach `onWhiteboardDrop` (and its `updateWhiteboardFn`
    // caller) or vice versa.
    const whiteboardId = e.dataTransfer.getData('whiteboardId')
    if (whiteboardId && onWhiteboardDrop) {
      onWhiteboardDrop(whiteboardId, folder.id)
      return
    }
    const canvasBoardId = e.dataTransfer.getData('canvasBoardId')
    if (canvasBoardId && onCanvasBoardDrop) {
      onCanvasBoardDrop(canvasBoardId, folder.id)
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
        <div className="flex items-center gap-1 pr-1">
          <div
            className="flex min-w-0 items-center gap-2 flex-1 pl-2 pr-2 py-2 rounded-md hover:bg-accent/50 transition-colors"
            title={folder.name}
          >
            {isOpen ? (
              <FolderOpen className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            ) : (
              <Folder className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            )}
            <span className="text-sm flex-1 truncate">{folder.name}</span>
          </div>

          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-6 p-0 flex-shrink-0"
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
        </div>

        {/* Action Buttons */}
        {hasActions && (
          <RowActions>
            {onCreateWhiteboard && onCreateCanvasBoard && (
              <CreateBoardMenu
                onCreateWhiteboard={() => onCreateWhiteboard(folder.id)}
                onCreateCanvasBoard={() => onCreateCanvasBoard(folder.id)}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className={ROW_ACTION_BUTTON_CLASS}
                  onClick={(e) => e.stopPropagation()}
                  title={t('navigator.newBoard')}
                >
                  <Plus className="h-3 w-3" />
                  <span className="sr-only">{t('navigator.newBoard')}</span>
                </Button>
              </CreateBoardMenu>
            )}
            {onCreateFolder && canNestDeeper && (
              <Button
                variant="ghost"
                size="sm"
                className={ROW_ACTION_BUTTON_CLASS}
                onClick={(e) => {
                  e.stopPropagation()
                  onCreateFolder(folder.id)
                }}
                title={t('navigator.newSubfolder')}
              >
                <Folder className="h-3 w-3" />
                <span className="sr-only">{t('navigator.newSubfolder')}</span>
              </Button>
            )}
            {onRenameFolder && (
              <Button
                variant="ghost"
                size="sm"
                className={ROW_ACTION_BUTTON_CLASS}
                onClick={(e) => {
                  e.stopPropagation()
                  onRenameFolder(folder.id, folder.name)
                }}
                title={t('common.rename')}
              >
                <Pencil className="h-3 w-3" />
                <span className="sr-only">{t('common.rename')}</span>
              </Button>
            )}
            {onDeleteFolder && (
              <Button
                variant="ghost"
                size="sm"
                className={ROW_ACTION_DELETE_CLASS}
                onClick={(e) => {
                  e.stopPropagation()
                  onDeleteFolder(folder.id, folder.name)
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

      {/* Collapsible Content */}
      <CollapsibleContent>
        <div className="ml-6 mt-1 space-y-1">
          {/* Render child folders recursively (if not at max depth) */}
          {canNestDeeper &&
            folder.childFolders?.map((childFolder) => (
              <FolderItem
                key={childFolder.id}
                folder={childFolder}
                depth={depth + 1}
                activeWhiteboardId={activeWhiteboardId}
                activeCanvasBoardId={activeCanvasBoardId}
                onCreateFolder={onCreateFolder}
                onCreateWhiteboard={onCreateWhiteboard}
                onCreateCanvasBoard={onCreateCanvasBoard}
                onRenameFolder={onRenameFolder}
                onDeleteFolder={onDeleteFolder}
                onRenameWhiteboard={onRenameWhiteboard}
                onDeleteWhiteboard={onDeleteWhiteboard}
                onRenameCanvasBoard={onRenameCanvasBoard}
                onDeleteCanvasBoard={onDeleteCanvasBoard}
                onWhiteboardDragStart={onWhiteboardDragStart}
                onWhiteboardDrop={onWhiteboardDrop}
                onCanvasBoardDrop={onCanvasBoardDrop}
              />
            ))}

          {/* Render boards: whiteboards and canvas boards interleaved by
              updatedAt */}
          {boards.map((board) =>
            board.kind === 'canvas' ? (
              <CanvasBoardItem
                key={board.id}
                id={board.id}
                name={board.name}
                isActive={board.id === activeCanvasBoardId}
                onRename={onRenameCanvasBoard}
                onDelete={onDeleteCanvasBoard}
              />
            ) : (
              <WhiteboardItem
                key={board.id}
                id={board.id}
                name={board.name}
                isActive={board.id === activeWhiteboardId}
                onRename={onRenameWhiteboard}
                onDelete={onDeleteWhiteboard}
                onDragStart={onWhiteboardDragStart}
              />
            ),
          )}

          {/* Show warning if max depth reached */}
          {!canNestDeeper &&
            folder.childFolders &&
            folder.childFolders.length > 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground italic">
                {t('navigator.maxDepth')}
              </div>
            )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
