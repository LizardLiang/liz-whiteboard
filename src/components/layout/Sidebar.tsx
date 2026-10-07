// src/components/layout/Sidebar.tsx
// Sidebar for project navigation and whiteboard organization

import { Link } from '@tanstack/react-router'
import { Home, PinOff } from 'lucide-react'
import { ProjectTree } from '@/components/navigator/ProjectTree'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface SidebarProps {
  /** Renders without the docked column chrome, to fill a drawer. */
  embedded?: boolean
  /** Shows an unpin button; set when the sidebar is docked on a board. */
  onUnpin?: () => void
}

/**
 * Application sidebar component
 * Provides navigation to projects, folders, and whiteboards
 */
export function Sidebar({ embedded = false, onUnpin }: SidebarProps) {
  return (
    <aside
      className={cn(
        'flex flex-col',
        embedded
          ? 'min-h-0 flex-1'
          : 'w-64 border-r bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60',
      )}
    >
      <nav className="flex items-center gap-2 p-4">
        {/* Home Link */}
        <Link
          to="/"
          className="flex flex-1 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
          activeProps={{
            className:
              'flex flex-1 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium bg-accent',
          }}
        >
          <Home className="h-4 w-4" />
          <span>Home</span>
        </Link>
        {onUnpin && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Unpin navigator"
            title="Unpin navigator"
            onClick={onUnpin}
          >
            <PinOff className="h-4 w-4" />
          </Button>
        )}
      </nav>

      {/* Project Tree Navigation */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <ProjectTree />
      </div>
    </aside>
  )
}
