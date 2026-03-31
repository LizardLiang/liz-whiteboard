// src/components/project/EmptyState.tsx
// Empty state shown when a project or folder has no contents.

import { FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface EmptyStateProps {
  onCreateWhiteboard: () => void
}

export function EmptyState({ onCreateWhiteboard }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <FolderOpen className="h-24 w-24 text-muted-foreground mb-4" />
      <h2 className="text-2xl font-semibold mb-2">Nothing here yet</h2>
      <p className="text-muted-foreground mb-6 text-center max-w-md">
        Get started by creating your first whiteboard in this project.
      </p>
      <Button size="lg" onClick={onCreateWhiteboard}>
        Create your first whiteboard
      </Button>
    </div>
  )
}
