// src/components/project/EmptyState.tsx
// Empty state shown when a project or folder has no contents.

import { FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CreateBoardMenu } from '@/components/navigator/CreateBoardMenu'
import { useT } from '@/lib/i18n/use-t'

interface EmptyStateProps {
  onCreateWhiteboard: () => void
  /**
   * Optional so the home page's own "No projects yet" empty state (which
   * has no project/folder context to create a canvas board into) can keep
   * using this component unchanged.
   */
  onCreateCanvasBoard?: () => void
  /**
   * 'first-user' — the user has no projects at all (first time)
   * 'no-permissions' — the user exists but has no project access
   * 'empty-project' — the project exists but has no whiteboards/folders
   */
  variant?: 'first-user' | 'no-permissions' | 'empty-project'
}

export function EmptyState({
  onCreateWhiteboard,
  onCreateCanvasBoard,
  variant = 'empty-project',
}: EmptyStateProps) {
  const t = useT()
  const message =
    variant === 'first-user'
      ? t('project.empty.firstUser')
      : variant === 'no-permissions'
        ? t('project.empty.noPermissions')
        : t('project.empty.emptyProject')

  const title =
    variant === 'no-permissions'
      ? t('project.empty.noProjectsTitle')
      : t('project.empty.nothingYet')

  return (
    <div className="flex flex-col items-center justify-center py-20">
      <FolderOpen className="h-24 w-24 text-muted-foreground mb-4" />
      <h2 className="text-2xl font-semibold mb-2">{title}</h2>
      <p className="text-muted-foreground mb-6 text-center max-w-md">
        {message}
      </p>
      {variant !== 'no-permissions' &&
        (onCreateCanvasBoard ? (
          <CreateBoardMenu
            onCreateWhiteboard={onCreateWhiteboard}
            onCreateCanvasBoard={onCreateCanvasBoard}
          >
            <Button size="lg">{t('project.empty.createFirstBoard')}</Button>
          </CreateBoardMenu>
        ) : (
          <Button size="lg" onClick={onCreateWhiteboard}>
            {t('project.empty.createFirstWhiteboard')}
          </Button>
        ))}
    </div>
  )
}
