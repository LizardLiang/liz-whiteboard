// src/components/navigator/CreateFolderDialog.tsx
// Standalone dialog component for creating a new folder.
// Extracted from ProjectTree.tsx for reuse on the project page.

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { CreateFolder } from '@/data/schema'
import { isForbiddenError, isUnauthorizedError } from '@/lib/auth/errors'
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
import { createFolderFn } from '@/routes/api/folders'
import { useT } from '@/lib/i18n/use-t'
import { tError } from '@/lib/i18n/t-error'

interface CreateFolderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  parentFolderId?: string
}

export function CreateFolderDialog({
  open,
  onOpenChange,
  projectId,
  parentFolderId,
}: CreateFolderDialogProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')

  const createFolderMutation = useMutation({
    mutationFn: (data: CreateFolder) => createFolderFn({ data }),
    onSuccess: (folder) => {
      if (isUnauthorizedError(folder)) {
        toast.error(t('toast.sessionExpired'), {
          description: t('toast.loginAgain'),
        })
        return
      }
      if (isForbiddenError(folder)) {
        toast.error(t('navigator.toast.failCreateFolder'), {
          description: tError(t, folder.message),
        })
        return
      }
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['project-page'] })
      onOpenChange(false)
      setName('')
      toast.success(t('navigator.toast.folderCreated'), {
        description: t('toast.createdDesc', { name: folder.name }),
      })
    },
    onError: (error: Error) => {
      toast.error(t('navigator.toast.failCreateFolder'), {
        description: tError(t, error) || t('toast.unexpected'),
      })
    },
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await createFolderMutation.mutateAsync({
        name,
        projectId,
        parentFolderId: parentFolderId || undefined,
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
            <DialogTitle>{t('navigator.dialog.createFolderTitle')}</DialogTitle>
            <DialogDescription>
              {t('navigator.dialog.createFolderDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="folder-name">{t('common.name')}</Label>
              <Input
                id="folder-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('navigator.dialog.folderPlaceholder')}
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
              disabled={!name.trim() || createFolderMutation.isPending}
            >
              {createFolderMutation.isPending
                ? t('common.creating')
                : t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
