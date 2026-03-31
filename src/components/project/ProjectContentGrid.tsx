// src/components/project/ProjectContentGrid.tsx
// Shared grid component that renders folder and whiteboard cards.
// Used by both ProjectPage (root view) and FolderPage (folder view).

import { Link } from '@tanstack/react-router'
import { FileText, Folder } from 'lucide-react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

interface ProjectContentGridProps {
  projectId: string
  folders: Array<{ id: string; name: string; createdAt: Date }>
  whiteboards: Array<{
    id: string
    name: string
    updatedAt: Date
    _count: { tables: number }
  }>
}

export function ProjectContentGrid({
  projectId,
  folders,
  whiteboards,
}: ProjectContentGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {/* Folders first */}
      {folders.map((folder) => (
        <Link
          key={folder.id}
          to="/project/$projectId/folder/$folderId"
          params={{ projectId, folderId: folder.id }}
        >
          <Card className="hover:border-primary transition-colors cursor-pointer h-full">
            <CardHeader>
              <div className="flex items-center gap-3">
                <Folder className="h-8 w-8 text-primary flex-shrink-0" />
                <CardTitle className="text-base truncate">
                  {folder.name}
                </CardTitle>
              </div>
            </CardHeader>
          </Card>
        </Link>
      ))}

      {/* Whiteboard cards after folders */}
      {whiteboards.map((whiteboard) => (
        <Link
          key={whiteboard.id}
          to="/whiteboard/$whiteboardId"
          params={{ whiteboardId: whiteboard.id }}
        >
          <Card className="hover:border-primary transition-colors cursor-pointer h-full">
            <CardHeader>
              <div className="flex items-center gap-3">
                <FileText className="h-8 w-8 text-primary flex-shrink-0" />
                <CardTitle className="text-base truncate">
                  {whiteboard.name}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground space-y-1">
                <div>
                  {new Date(whiteboard.updatedAt).toLocaleDateString()}
                </div>
                <div>
                  {whiteboard._count.tables} table
                  {whiteboard._count.tables !== 1 ? 's' : ''}
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  )
}
