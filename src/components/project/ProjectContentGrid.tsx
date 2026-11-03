// src/components/project/ProjectContentGrid.tsx
// Shared grid component that renders folder and whiteboard cards.
// Used by both ProjectPage (root view) and FolderPage (folder view).

import { Link } from '@tanstack/react-router'
import { FileText, Folder, Shapes } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n/use-t'

interface ProjectContentGridProps {
  projectId: string
  folders: Array<{ id: string; name: string; createdAt: Date }>
  whiteboards: Array<{
    id: string
    name: string
    updatedAt: Date
    _count: { tables: number }
  }>
  /**
   * Canvas board cards, rendered after the whiteboard cards (grouped by
   * kind, not interleaved by updatedAt — the interleaved ordering only
   * applies to the sidebar tree, see findAllProjectsWithTreeForUser's doc
   * comment). Optional so existing callers/tests that don't pass it keep
   * rendering exactly as before.
   */
  canvasBoards?: Array<{
    id: string
    name: string
    updatedAt: Date
    _count: { elements: number }
  }>
}

export function ProjectContentGrid({
  projectId,
  folders,
  whiteboards,
  canvasBoards = [],
}: ProjectContentGridProps) {
  const { t, locale } = useI18n()
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
              <div className="flex min-w-0 items-center gap-3">
                <Folder className="h-8 w-8 text-primary flex-shrink-0" />
                <CardTitle
                  className="min-w-0 text-base truncate"
                  title={folder.name}
                >
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
              <div className="flex min-w-0 items-center gap-3">
                <FileText className="h-8 w-8 text-primary flex-shrink-0" />
                <CardTitle
                  className="min-w-0 text-base truncate"
                  title={whiteboard.name}
                >
                  {whiteboard.name}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground space-y-1">
                <div>
                  {new Date(whiteboard.updatedAt).toLocaleDateString(locale)}
                </div>
                <div>
                  {t(
                    whiteboard._count.tables === 1
                      ? 'project.grid.tableOne'
                      : 'project.grid.tableOther',
                    { count: whiteboard._count.tables },
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}

      {/* Canvas board cards after whiteboard cards */}
      {canvasBoards.map((board) => (
        <Link
          key={board.id}
          to="/canvas/$boardId"
          params={{ boardId: board.id }}
        >
          <Card className="hover:border-primary transition-colors cursor-pointer h-full">
            <CardHeader>
              <div className="flex min-w-0 items-center gap-3">
                <Shapes className="h-8 w-8 text-primary flex-shrink-0" />
                <CardTitle
                  className="min-w-0 text-base truncate"
                  title={board.name}
                >
                  {board.name}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground space-y-1">
                <div>
                  {new Date(board.updatedAt).toLocaleDateString(locale)}
                </div>
                <div>
                  {t(
                    board._count.elements === 1
                      ? 'project.grid.elementOne'
                      : 'project.grid.elementOther',
                    { count: board._count.elements },
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  )
}
