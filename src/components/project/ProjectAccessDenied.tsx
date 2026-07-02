// src/components/project/ProjectAccessDenied.tsx
// Friendly access-denied state for project/folder pages when the viewer
// lacks VIEWER+ role on the project. Renders in place of the content grid
// instead of letting a resolved FORBIDDEN payload fall through to a
// TypeError on unguarded property access (see getProjectPageContent).

import { Link } from '@tanstack/react-router'
import { ShieldAlert } from 'lucide-react'

interface ProjectAccessDeniedProps {
  message?: string
}

export function ProjectAccessDenied({ message }: ProjectAccessDeniedProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <ShieldAlert
        className="h-10 w-10 text-muted-foreground"
        aria-hidden="true"
      />
      <p className="text-lg font-semibold">
        You don't have access to this project
      </p>
      <p className="text-sm text-muted-foreground max-w-sm">
        {message ??
          "You don't have permission to view this project. Ask a project admin for access."}
      </p>
      <Link
        to="/"
        className="text-sm text-primary underline underline-offset-4"
      >
        Back to dashboard
      </Link>
    </div>
  )
}
