// src/routes/project.$projectId.tsx
// Project root page — shows all folders and whiteboards at the project level.

import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { FolderPlus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProjectContentGrid } from '@/components/project/ProjectContentGrid'
import { ProjectPageSkeleton } from '@/components/project/ProjectPageSkeleton'
import { ProjectPageError } from '@/components/project/ProjectPageError'
import { EmptyState } from '@/components/project/EmptyState'
import { CreateWhiteboardDialog } from '@/components/navigator/CreateWhiteboardDialog'
import { CreateFolderDialog } from '@/components/navigator/CreateFolderDialog'
import { getProjectPageContent } from '@/routes/api/projects'

export const Route = createFileRoute('/project/$projectId')({
  component: ProjectPage,
})

function ProjectPage() {
  const { projectId } = Route.useParams()
  const queryClient = useQueryClient()
  const [whiteboardDialogOpen, setWhiteboardDialogOpen] = useState(false)
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)

  const {
    data: content,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['project-page', projectId],
    queryFn: () => getProjectPageContent({ data: { projectId } }),
  })

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="h-8 w-48 bg-muted animate-pulse rounded mb-6" />
        <ProjectPageSkeleton />
      </div>
    )
  }

  if (isError || !content) {
    return (
      <div className="container mx-auto px-4 py-8">
        <ProjectPageError
          message={error instanceof Error ? error.message : 'Failed to load project'}
          onRetry={() => refetch()}
        />
      </div>
    )
  }

  const isEmpty = content.folders.length === 0 && content.whiteboards.length === 0

  return (
    <div className="min-h-screen bg-background">
      {/* Page header */}
      <div className="border-b">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold">{content.project.name}</h1>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setFolderDialogOpen(true)}
              >
                <FolderPlus className="mr-2 h-4 w-4" />
                New Folder
              </Button>
              <Button onClick={() => setWhiteboardDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                New Whiteboard
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="container mx-auto px-4 py-8">
        {isEmpty ? (
          <EmptyState onCreateWhiteboard={() => setWhiteboardDialogOpen(true)} />
        ) : (
          <ProjectContentGrid
            projectId={projectId}
            folders={content.folders}
            whiteboards={content.whiteboards}
          />
        )}
      </div>

      {/* Dialogs */}
      <CreateWhiteboardDialog
        open={whiteboardDialogOpen}
        onOpenChange={setWhiteboardDialogOpen}
        projectId={projectId}
        folderId={undefined}
      />
      <CreateFolderDialog
        open={folderDialogOpen}
        onOpenChange={setFolderDialogOpen}
        projectId={projectId}
        parentFolderId={undefined}
      />
    </div>
  )
}
