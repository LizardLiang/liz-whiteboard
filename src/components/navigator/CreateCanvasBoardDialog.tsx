// src/components/navigator/CreateCanvasBoardDialog.tsx
// Standalone dialog component for creating a new canvas board.
// A copy of CreateWhiteboardDialog.tsx calling createCanvasBoardFn instead of
// createWhiteboardFn, invalidating the tree query too (['projects', 'tree']
// — CreateWhiteboardDialog only invalidates ['projects'] and
// ['project-page'], but ProjectTree.tsx reads the sidebar via the more
// specific ['projects', 'tree'] key, so a create must invalidate that key
// for the new row to appear in the sidebar without a manual refresh), and
// navigating to /canvas/$boardId on success.

import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { CreateCanvasBoard } from '@/data/schema'
import { isUnauthorizedError } from '@/lib/auth/errors'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createCanvasBoardFn } from '@/lib/canvas-board/server-functions'
import { useT } from '@/lib/i18n/use-t'
import { tError } from '@/lib/i18n/t-error'

interface CreateCanvasBoardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  folderId?: string
}

export function CreateCanvasBoardDialog({
  open,
  onOpenChange,
  projectId,
  folderId,
}: CreateCanvasBoardDialogProps) {
  const t = useT()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')

  const createCanvasBoardMutation = useMutation({
    mutationFn: (data: CreateCanvasBoard) => createCanvasBoardFn({ data }),
    onSuccess: (board) => {
      if (isUnauthorizedError(board)) {
        toast.error(t('toast.sessionExpired'), {
          description: t('toast.loginAgain'),
        })
        return
      }
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['projects', 'tree'] })
      queryClient.invalidateQueries({ queryKey: ['project-page'] })
      onOpenChange(false)
      setName('')
      toast.success(t('navigator.toast.canvasBoardCreated'), {
        description: t('toast.createdDesc', { name: board.name }),
      })
      navigate({
        to: '/canvas/$boardId',
        params: { boardId: board.id },
      })
    },
    onError: (error: Error) => {
      toast.error(t('navigator.toast.failCreateCanvasBoard'), {
        description: tError(t, error) || t('toast.unexpected'),
      })
    },
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await createCanvasBoardMutation.mutateAsync({
        name,
        projectId,
        folderId: folderId || undefined,
      })
    } catch {
      // Error handled by onError
    }
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setName('')
    }
    onOpenChange(open)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('navigator.dialog.createCanvasTitle')}</DialogTitle>
            <DialogDescription>
              {t('navigator.dialog.createCanvasDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="canvas-board-name">{t('common.name')}</Label>
              <Input
                id="canvas-board-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('navigator.dialog.canvasPlaceholder')}
                required
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || createCanvasBoardMutation.isPending}
            >
              {createCanvasBoardMutation.isPending
                ? t('common.creating')
                : t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
