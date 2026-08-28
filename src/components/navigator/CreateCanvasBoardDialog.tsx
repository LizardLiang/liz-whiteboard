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
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')

  const createCanvasBoardMutation = useMutation({
    mutationFn: (data: CreateCanvasBoard) => createCanvasBoardFn({ data }),
    onSuccess: (board) => {
      if (isUnauthorizedError(board)) {
        toast.error('Session expired', { description: 'Please log in again.' })
        return
      }
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['projects', 'tree'] })
      queryClient.invalidateQueries({ queryKey: ['project-page'] })
      onOpenChange(false)
      setName('')
      toast.success('Canvas board created!', {
        description: `${board.name} has been created successfully.`,
      })
      navigate({
        to: '/canvas/$boardId',
        params: { boardId: board.id },
      })
    },
    onError: (error: Error) => {
      toast.error('Failed to create canvas board', {
        description: error.message || 'An unexpected error occurred.',
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
            <DialogTitle>Create Canvas Board</DialogTitle>
            <DialogDescription>
              Create a new canvas board for freeform diagrams and notes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="canvas-board-name">Name</Label>
              <Input
                id="canvas-board-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Canvas Board"
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
              disabled={!name.trim() || createCanvasBoardMutation.isPending}
            >
              {createCanvasBoardMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
