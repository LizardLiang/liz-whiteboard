// src/components/layout/Sidebar.tsx
// Sidebar for project navigation and whiteboard organization

import { Link } from '@tanstack/react-router';
import { Folder, FileText, Home } from 'lucide-react';

/**
 * Application sidebar component
 * Provides navigation to projects, folders, and whiteboards
 *
 * Note: This is a placeholder implementation for Phase 1.
 * Full project tree navigation will be implemented in User Story 4 (Phase 6).
 */
export function Sidebar() {
  return (
    <aside className="w-64 border-r bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
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

        {/* Projects Section - Placeholder */}
        <div className="mt-4">
          <div className="px-3 py-2 text-xs font-semibold text-muted-foreground">
            PROJECTS
          </div>
          <div className="text-sm text-muted-foreground px-3 py-2">
            <p>Project navigation will be available in User Story 4.</p>
          </div>
        </div>

        {/* Placeholder Items */}
        <div className="flex flex-col gap-1 mt-2">
          <div className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground">
            <Folder className="h-4 w-4" />
            <span>Example Project</span>
          </div>
          <div className="flex items-center gap-3 rounded-md px-6 py-2 text-sm text-muted-foreground">
            <FileText className="h-4 w-4" />
            <span>Example Whiteboard</span>
          </div>
        </div>
      </nav>
    </aside>
  );
}
