// src/components/layout/Sidebar.tsx
// Sidebar for project navigation and whiteboard organization

import { Link } from '@tanstack/react-router'
import { Home } from 'lucide-react'
import { ProjectTree } from '@/components/navigator/ProjectTree'

/**
 * Application sidebar component
 * Provides navigation to projects, folders, and whiteboards
 */
export function Sidebar() {
  return (
    <aside className="w-64 border-r bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex flex-col">
      <nav className="flex flex-col gap-2 p-4">
        {/* Home Link */}
        <Link
          to="/"
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
          activeProps={{
            className:
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium bg-accent',
          }}
        >
          <Home className="h-4 w-4" />
          <span>Home</span>
        </Link>
      </nav>

      {/* Project Tree Navigation */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <ProjectTree />
      </div>
    </aside>
  )
}
