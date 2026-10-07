// src/components/layout/BoardChip.tsx
// Floating top-left chip on board routes: navigator button, breadcrumb, status

import { useQuery } from '@tanstack/react-query'
import { findBoardPath } from './board-breadcrumb'
import type { TreeProject } from './board-breadcrumb'
import type { ReactNode } from 'react'
import type { ConnectionState } from '@/hooks/use-collaboration'
import { NavigatorDrawer } from '@/components/layout/NavigatorDrawer'
import { useNavigatorPin } from '@/hooks/use-navigator-pin'
import { getProjectsWithTree } from '@/routes/api/projects'
import { cn } from '@/lib/utils'

interface BoardChipProps {
  boardId: string
  boardName: string
  /** Omit when the board surface shows its own connection status. */
  connectionState?: ConnectionState
  /** Extra controls shown at the chip's right edge. */
  trailing?: ReactNode
  className?: string
}

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connected: 'Connected',
  connecting: 'Connecting...',
  disconnected: 'Disconnected',
}

const CONNECTION_DOT: Record<ConnectionState, string> = {
  connected: 'bg-green-500',
  connecting: 'bg-yellow-500',
  disconnected: 'bg-red-500',
}

export function BoardChip({
  boardId,
  boardName,
  connectionState,
  trailing,
  className,
}: BoardChipProps) {
  const { isPinned } = useNavigatorPin()
  const { data: projects } = useQuery({
    queryKey: ['projects', 'tree'],
    queryFn: () => getProjectsWithTree(),
  })

  const path = findBoardPath(
    Array.isArray(projects) ? (projects as Array<TreeProject>) : undefined,
    boardId,
  )
  const ancestors = path ? path.slice(0, -1) : []

  return (
    <div
      className={cn(
        'absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-md border bg-background/90 px-1.5 py-1 shadow-sm backdrop-blur-sm',
        className,
      )}
      data-testid="board-chip"
    >
      {!isPinned && <NavigatorDrawer />}
      <div className="flex min-w-0 items-center gap-1 px-1 text-sm">
        {ancestors.map((name, index) => (
          <span
            key={`${index}-${name}`}
            className="hidden max-w-32 truncate text-muted-foreground md:inline"
          >
            {name}
            <span className="pl-1">/</span>
          </span>
        ))}
        <h1 className="truncate font-semibold">{boardName}</h1>
      </div>
      {connectionState && (
        <span
          role="status"
          className={cn(
            'mx-1 h-2 w-2 shrink-0 rounded-full',
            CONNECTION_DOT[connectionState],
          )}
          title={CONNECTION_LABEL[connectionState]}
          aria-label={CONNECTION_LABEL[connectionState]}
        />
      )}
      {trailing}
    </div>
  )
}

/**
 * Navigator button for board states that have no chip (loading, access denied,
 * not found). The parent must be positioned.
 */
export function BoardNavFallback() {
  const { isPinned } = useNavigatorPin()
  if (isPinned) return null
  return (
    <div className="absolute left-3 top-3 z-10 rounded-md border bg-background/90 p-1 shadow-sm">
      <NavigatorDrawer />
    </div>
  )
}
