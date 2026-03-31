// src/components/navigator/CreateFolderDialog.tsx
// Standalone dialog component for creating a new folder.
// Extracted from ProjectTree.tsx for reuse on the project page.

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
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
import type { CreateFolder } from '@/data/schema'

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
  const queryClient = useQueryClient()
  const [name, setName] = useState('')

  const createFolderMutation = useMutation({
    mutationFn: (data: CreateFolder) => createFolderFn({ data }),
    onSuccess: (folder) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['project-page'] })
      onOpenChange(false)
      setName('')
      toast.success('Folder created!', {
        description: `${folder.name} has been created successfully.`,
      })
    },
    onError: (error: Error) => {
      toast.error('Failed to create folder', {
        description: error.message || 'An unexpected error occurred.',
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
            <DialogTitle>Create Folder</DialogTitle>
            <DialogDescription>
              Create a new folder to organize your whiteboards.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="folder-name">Name</Label>
              <Input
                id="folder-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Folder"
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
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || createFolderMutation.isPending}
            >
              {createFolderMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
