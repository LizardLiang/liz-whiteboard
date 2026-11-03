// src/components/navigator/CreateWhiteboardDialog.tsx
// Standalone dialog component for creating a new whiteboard.
// Extracted from ProjectTree.tsx for reuse on the project page.

import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { CreateWhiteboard } from '@/data/schema'
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
import { createWhiteboardFn } from '@/routes/api/whiteboards'
import { useT } from '@/lib/i18n/use-t'
import { tError } from '@/lib/i18n/t-error'

interface CreateWhiteboardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  folderId?: string
}

export function CreateWhiteboardDialog({
  open,
  onOpenChange,
  projectId,
  folderId,
}: CreateWhiteboardDialogProps) {
  const t = useT()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')

  const createWhiteboardMutation = useMutation({
    mutationFn: (data: CreateWhiteboard) => createWhiteboardFn({ data }),
    onSuccess: (whiteboard) => {
      if (isUnauthorizedError(whiteboard)) {
        toast.error(t('toast.sessionExpired'), {
          description: t('toast.loginAgain'),
        })
        return
      }
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['project-page'] })
      onOpenChange(false)
      setName('')
      toast.success(t('navigator.toast.whiteboardCreated'), {
        description: t('toast.createdDesc', { name: whiteboard.name }),
      })
      navigate({
        to: '/whiteboard/$whiteboardId',
        params: { whiteboardId: whiteboard.id },
      })
    },
    onError: (error: Error) => {
      toast.error(t('navigator.toast.failCreateWhiteboard'), {
        description: tError(t, error) || t('toast.unexpected'),
      })
    },
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await createWhiteboardMutation.mutateAsync({
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
            <DialogTitle>
              {t('navigator.dialog.createWhiteboardTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('navigator.dialog.createWhiteboardDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="whiteboard-name">{t('common.name')}</Label>
              <Input
                id="whiteboard-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('navigator.dialog.whiteboardPlaceholder')}
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
              disabled={!name.trim() || createWhiteboardMutation.isPending}
            >
              {createWhiteboardMutation.isPending
                ? t('common.creating')
                : t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
