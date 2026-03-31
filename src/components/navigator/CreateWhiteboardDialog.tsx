// src/components/navigator/CreateWhiteboardDialog.tsx
// Standalone dialog component for creating a new whiteboard.
// Extracted from ProjectTree.tsx for reuse on the project page.

import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
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
import { createWhiteboardFn } from '@/routes/api/whiteboards'
import type { CreateWhiteboard } from '@/data/schema'

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
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')

  const createWhiteboardMutation = useMutation({
    mutationFn: (data: CreateWhiteboard) => createWhiteboardFn({ data }),
    onSuccess: (whiteboard) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['project-page'] })
      onOpenChange(false)
      setName('')
      toast.success('Whiteboard created!', {
        description: `${whiteboard.name} has been created successfully.`,
      })
      navigate({
        to: '/whiteboard/$whiteboardId',
        params: { whiteboardId: whiteboard.id },
      })
    },
    onError: (error: Error) => {
      toast.error('Failed to create whiteboard', {
        description: error.message || 'An unexpected error occurred.',
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
            <DialogTitle>Create Whiteboard</DialogTitle>
            <DialogDescription>
              Create a new whiteboard for your ER diagrams.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="whiteboard-name">Name</Label>
              <Input
                id="whiteboard-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Whiteboard"
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
              disabled={!name.trim() || createWhiteboardMutation.isPending}
            >
              {createWhiteboardMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
