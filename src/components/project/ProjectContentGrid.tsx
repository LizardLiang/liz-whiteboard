// src/components/project/ProjectContentGrid.tsx
// Shared grid component that renders folder and whiteboard cards.
// Used by both ProjectPage (root view) and FolderPage (folder view).

import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, Folder, Shapes, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ROW_ACTION_DELETE_CLASS } from '@/components/navigator/RowActions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { deleteWhiteboardFn } from '@/routes/api/whiteboards'
import { deleteCanvasBoardFn } from '@/lib/canvas-board/server-functions'
import { isUnauthorizedError } from '@/lib/auth/errors'
import { cn } from '@/lib/utils'
import { tError } from '@/lib/i18n/t-error'
import { useI18n } from '@/lib/i18n/use-t'

type DeleteTarget = { kind: 'whiteboard' | 'canvas'; id: string; name: string }

function DeleteBoardDialog({
  target,
  onClose,
}: {
  target: DeleteTarget | null
  onClose: () => void
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async (board: DeleteTarget): Promise<unknown> =>
      board.kind === 'whiteboard'
        ? await deleteWhiteboardFn({ data: board.id })
        : await deleteCanvasBoardFn({ data: board.id }),
    onSuccess: (result, board) => {
      if (isUnauthorizedError(result)) {
        toast.error(t('toast.sessionExpired'), {
          description: t('toast.loginAgain'),
        })
        return
      }
      queryClient.invalidateQueries({ queryKey: ['project-page'] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      onClose()
      if (board.kind === 'whiteboard') {
        toast.success(t('navigator.toast.whiteboardDeleted'), {
          description: t('navigator.toast.whiteboardDeletedDesc'),
        })
      } else {
        toast.success(t('navigator.toast.canvasBoardDeleted'), {
          description: t('navigator.toast.canvasBoardDeletedDesc'),
        })
      }
    },
    onError: (error: Error, board) => {
      toast.error(
        t(
          board.kind === 'whiteboard'
            ? 'navigator.toast.failDeleteWhiteboard'
            : 'navigator.toast.failDeleteCanvasBoard',
        ),
        { description: tError(t, error) || t('toast.unexpected') },
      )
    },
  })

  const isWhiteboard = target?.kind === 'whiteboard'
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(
              isWhiteboard
                ? 'navigator.dialog.deleteWhiteboardTitle'
                : 'navigator.dialog.deleteCanvasTitle',
            )}
          </DialogTitle>
          <DialogDescription>
            {t('navigator.dialog.deleteConfirmPrefix')}
            <strong>{target?.name ?? ''}</strong>
            {t(
              isWhiteboard
                ? 'navigator.dialog.deleteWhiteboardSuffix'
                : 'navigator.dialog.deleteCanvasSuffix',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={mutation.isPending}
            onClick={() => {
              if (target) mutation.mutate(target)
            }}
          >
            {t('common.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CardDeleteButton({
  name,
  onClick,
}: {
  name: string
  onClick: () => void
}) {
  const { t } = useI18n()
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(ROW_ACTION_DELETE_CLASS, 'h-8 w-8 flex-shrink-0')}
      aria-label={t('project.grid.deleteAria', { name })}
      title={t('common.delete')}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onClick()
      }}
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  )
}

interface ProjectContentGridProps {
  projectId: string
  folders: Array<{ id: string; name: string; createdAt: Date }>
  whiteboards: Array<{
    id: string
    name: string
    updatedAt: Date
    _count: { tables: number }
  }>
  /**
   * Canvas board cards, rendered after the whiteboard cards (grouped by
   * kind, not interleaved by updatedAt — the interleaved ordering only
   * applies to the sidebar tree, see findAllProjectsWithTreeForUser's doc
   * comment). Optional so existing callers/tests that don't pass it keep
   * rendering exactly as before.
   */
  canvasBoards?: Array<{
    id: string
    name: string
    updatedAt: Date
    _count: { elements: number }
  }>
  /**
   * Show a delete button on whiteboard and canvas cards. Callers pass
   * `hasMinimumRole(viewerRole, 'EDITOR')`; defaults to false.
   */
  canDelete?: boolean
}

export function ProjectContentGrid({
  projectId,
  folders,
  whiteboards,
  canvasBoards = [],
  canDelete = false,
}: ProjectContentGridProps) {
  const { t, locale } = useI18n()
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {canDelete && (
        <DeleteBoardDialog
          target={deleteTarget}
          onClose={() => setDeleteTarget(null)}
        />
      )}
      {/* Folders first */}
      {folders.map((folder) => (
        <Link
          key={folder.id}
          to="/project/$projectId/folder/$folderId"
          params={{ projectId, folderId: folder.id }}
        >
          <Card className="hover:border-primary transition-colors cursor-pointer h-full">
            <CardHeader>
              <div className="flex min-w-0 items-center gap-3">
                <Folder className="h-8 w-8 text-primary flex-shrink-0" />
                <CardTitle
                  className="min-w-0 text-base truncate"
                  title={folder.name}
                >
                  {folder.name}
                </CardTitle>
              </div>
            </CardHeader>
          </Card>
        </Link>
      ))}

      {/* Whiteboard cards after folders */}
      {whiteboards.map((whiteboard) => (
        <Link
          key={whiteboard.id}
          to="/whiteboard/$whiteboardId"
          params={{ whiteboardId: whiteboard.id }}
        >
          <Card className="hover:border-primary transition-colors cursor-pointer h-full">
            <CardHeader>
              <div className="flex min-w-0 items-center gap-3">
                <FileText className="h-8 w-8 text-primary flex-shrink-0" />
                <CardTitle
                  className="min-w-0 text-base truncate"
                  title={whiteboard.name}
                >
                  {whiteboard.name}
                </CardTitle>
                {canDelete && (
                  <CardDeleteButton
                    name={whiteboard.name}
                    onClick={() =>
                      setDeleteTarget({
                        kind: 'whiteboard',
                        id: whiteboard.id,
                        name: whiteboard.name,
                      })
                    }
                  />
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground space-y-1">
                <div>
                  {new Date(whiteboard.updatedAt).toLocaleDateString(locale)}
                </div>
                <div>
                  {t(
                    whiteboard._count.tables === 1
                      ? 'project.grid.tableOne'
                      : 'project.grid.tableOther',
                    { count: whiteboard._count.tables },
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}

      {/* Canvas board cards after whiteboard cards */}
      {canvasBoards.map((board) => (
        <Link
          key={board.id}
          to="/canvas/$boardId"
          params={{ boardId: board.id }}
        >
          <Card className="hover:border-primary transition-colors cursor-pointer h-full">
            <CardHeader>
              <div className="flex min-w-0 items-center gap-3">
                <Shapes className="h-8 w-8 text-primary flex-shrink-0" />
                <CardTitle
                  className="min-w-0 text-base truncate"
                  title={board.name}
                >
                  {board.name}
                </CardTitle>
                {canDelete && (
                  <CardDeleteButton
                    name={board.name}
                    onClick={() =>
                      setDeleteTarget({
                        kind: 'canvas',
                        id: board.id,
                        name: board.name,
                      })
                    }
                  />
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground space-y-1">
                <div>
                  {new Date(board.updatedAt).toLocaleDateString(locale)}
                </div>
                <div>
                  {t(
                    board._count.elements === 1
                      ? 'project.grid.elementOne'
                      : 'project.grid.elementOther',
                    { count: board._count.elements },
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  )
}
