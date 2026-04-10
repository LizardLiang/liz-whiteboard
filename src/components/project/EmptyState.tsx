// src/components/project/EmptyState.tsx
// Empty state shown when a project or folder has no contents.

import { FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface EmptyStateProps {
  onCreateWhiteboard: () => void
  /**
   * 'first-user' — the user has no projects at all (first time)
   * 'no-permissions' — the user exists but has no project access
   * 'empty-project' — the project exists but has no whiteboards/folders
   */
  variant?: 'first-user' | 'no-permissions' | 'empty-project'
}

export function EmptyState({
  onCreateWhiteboard,
  variant = 'empty-project',
}: EmptyStateProps) {
  const message =
    variant === 'first-user'
      ? 'No projects yet. Create your first project to get started.'
      : variant === 'no-permissions'
        ? "You don't have any projects yet. Create a new project or ask a teammate to share one with you."
        : 'Get started by creating your first whiteboard in this project.'

  const title =
    variant === 'no-permissions' ? 'No projects' : 'Nothing here yet'

  return (
    <div className="flex flex-col items-center justify-center py-20">
      <FolderOpen className="h-24 w-24 text-muted-foreground mb-4" />
      <h2 className="text-2xl font-semibold mb-2">{title}</h2>
      <p className="text-muted-foreground mb-6 text-center max-w-md">
        {message}
      </p>
      {variant !== 'no-permissions' && (
        <Button size="lg" onClick={onCreateWhiteboard}>
          Create your first whiteboard
        </Button>
      )}
    </div>
  )
}
