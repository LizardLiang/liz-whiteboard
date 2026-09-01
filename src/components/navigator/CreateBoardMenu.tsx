// src/components/navigator/CreateBoardMenu.tsx
// Shared dropdown trigger offering "New ERD board" / "New Canvas board",
// replacing each bare "New Whiteboard" `+` (navigator-create-canvas-board
// tactical plan, step 7). Five call sites share this one component rather
// than five hand-written DropdownMenu blocks: ProjectTree.tsx's project row,
// FolderItem.tsx's folder row, the project page header, the folder page
// header, and EmptyState.
//
// Not named in the plan's list of new files (only CanvasBoardItem.tsx and
// CreateCanvasBoardDialog.tsx are) — added because five copies of the same
// three-item dropdown would be pure duplication across files whose class
// strings the repo has already had to correct multiple times.

import { FileText, Shapes } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface CreateBoardMenuProps {
  onCreateWhiteboard: () => void
  onCreateCanvasBoard: () => void
  /** The trigger element (typically a Button), wrapped in DropdownMenuTrigger asChild. */
  children: ReactNode
  align?: 'start' | 'center' | 'end'
}

export function CreateBoardMenu({
  onCreateWhiteboard,
  onCreateCanvasBoard,
  children,
  align = 'start',
}: CreateBoardMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        <DropdownMenuItem onSelect={onCreateWhiteboard}>
          <FileText className="h-4 w-4" />
          New ERD board
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCreateCanvasBoard}>
          <Shapes className="h-4 w-4" />
          New Canvas board
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
