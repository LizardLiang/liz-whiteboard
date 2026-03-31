// src/components/project/Breadcrumb.tsx
// Breadcrumb navigation trail for folder views.
// Last item is always plain text (current location), not a link.

import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'

interface BreadcrumbItem {
  id: string
  name: string
  type: 'project' | 'folder'
}

interface BreadcrumbProps {
  items: BreadcrumbItem[]
  projectId: string
}

export function Breadcrumb({ items, projectId }: BreadcrumbProps) {
  if (items.length === 0) return null

  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground mb-4">
      {items.map((item, index) => {
        const isLast = index === items.length - 1

        const link =
          item.type === 'project' ? (
            <Link
              to="/project/$projectId"
              params={{ projectId: item.id }}
              className="hover:text-foreground transition-colors"
            >
              {item.name}
            </Link>
          ) : (
            <Link
              to="/project/$projectId/folder/$folderId"
              params={{ projectId, folderId: item.id }}
              className="hover:text-foreground transition-colors"
            >
              {item.name}
            </Link>
          )

        return (
          <span key={item.id} className="flex items-center gap-1">
            {index > 0 && <ChevronRight className="h-3 w-3" />}
            {isLast ? (
              <span className="text-foreground font-medium">{item.name}</span>
            ) : (
              link
            )}
          </span>
        )
      })}
    </nav>
  )
}
