// src/components/navigator/ProjectTree.tsx
// Project tree component for hierarchical navigation

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Link,
  useNavigate,
  useParams,
  useRouterState,
} from '@tanstack/react-router'
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { FolderItem } from './FolderItem'
import { WhiteboardItem } from './WhiteboardItem'
import { CanvasBoardItem } from './CanvasBoardItem'
import { CreateWhiteboardDialog } from './CreateWhiteboardDialog'
import { CreateCanvasBoardDialog } from './CreateCanvasBoardDialog'
import { CreateFolderDialog } from './CreateFolderDialog'
import { CreateBoardMenu } from './CreateBoardMenu'
import {
  ROW_ACTION_BUTTON_CLASS,
  ROW_ACTION_DELETE_CLASS,
  RowActions,
} from './RowActions'
import { mergeBoardsByUpdatedAt } from './merge-boards'
import type { FolderWithChildren } from './FolderItem'
import type {
  CreateProject,
  UpdateCanvasBoard,
  UpdateFolder,
  UpdateProject,
  UpdateWhiteboard,
} from '@/data/schema'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  createProjectFn,
  deleteProjectFn,
  getProjectsWithTree,
  updateProjectFn,
} from '@/routes/api/projects'
import { deleteFolderFn, updateFolderFn } from '@/routes/api/folders'
import {
  deleteWhiteboardFn,
  updateWhiteboardFn,
} from '@/routes/api/whiteboards'
import {
  deleteCanvasBoardFn,
  updateCanvasBoardFn,
} from '@/lib/canvas-board/server-functions'
import { isForbiddenError, isUnauthorizedError } from '@/lib/auth/errors'
import { useT } from '@/lib/i18n/use-t'
import { tError } from '@/lib/i18n/t-error'

/**
 * Dialog state types
 */
type DialogState =
  | { type: 'none' }
  | { type: 'createProject' }
  | { type: 'editProject'; id: string; name: string; description?: string }
  | { type: 'deleteProject'; id: string; name: string }
  | { type: 'editFolder'; id: string; name: string }
  | { type: 'deleteFolder'; id: string; name: string }
  | { type: 'editWhiteboard'; id: string; name: string }
  | { type: 'deleteWhiteboard'; id: string; name: string }
  | { type: 'editCanvasBoard'; id: string; name: string }
  | { type: 'deleteCanvasBoard'; id: string; name: string }

/**
 * State for the extracted create dialogs
 */
type CreateFolderDialogState = {
  open: boolean
  projectId: string
  parentFolderId?: string
}

type CreateWhiteboardDialogState = {
  open: boolean
  projectId: string
  folderId?: string
}

type CreateCanvasBoardDialogState = {
  open: boolean
  projectId: string
  folderId?: string
}

/**
 * ProjectTree component
 * Displays hierarchical navigation tree for projects, folders, and whiteboards
 */
export function ProjectTree() {
  const t = useT()
  const navigate = useNavigate()
  const params = useParams({ strict: false })
  const queryClient = useQueryClient()
  const [dialogState, setDialogState] = useState<DialogState>({ type: 'none' })
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    new Set(),
  )
  const [createWhiteboardDialog, setCreateWhiteboardDialog] =
    useState<CreateWhiteboardDialogState>({
      open: false,
      projectId: '',
      folderId: undefined,
    })
  const [createCanvasBoardDialog, setCreateCanvasBoardDialog] =
    useState<CreateCanvasBoardDialogState>({
      open: false,
      projectId: '',
      folderId: undefined,
    })
  const [createFolderDialog, setCreateFolderDialog] =
    useState<CreateFolderDialogState>({
      open: false,
      projectId: '',
      parentFolderId: undefined,
    })

  // Form state
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')

  // Get current whiteboard/canvas-board ID from URL params
  const activeWhiteboardId =
    'whiteboardId' in params ? params.whiteboardId : undefined
  const activeCanvasBoardId = 'boardId' in params ? params.boardId : undefined

  // Get current pathname for route-based project highlighting
  const currentPathname = useRouterState({
    select: (s) => s.location.pathname,
  })

  // Fetch projects with tree structure
  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects', 'tree'],
    queryFn: () => getProjectsWithTree(),
  })

  // Mutations
  const createProjectMutation = useMutation({
    mutationFn: (data: CreateProject) => createProjectFn({ data }),
    onSuccess: (data) => {
      if (isUnauthorizedError(data)) {
        toast.error(t('toast.sessionExpired'), {
          description: t('toast.loginAgain'),
        })
        return
      }
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['projects', 'tree'] })
      setDialogState({ type: 'none' })
      resetForm()
      toast.success(t('navigator.toast.projectCreated'), {
        description: t('toast.createdDesc', { name: data.name }),
      })
    },
    onError: (error: Error) => {
      toast.error(t('navigator.toast.failCreateProject'), {
        description: tError(t, error) || t('toast.unexpected'),
      })
    },
  })

  const updateProjectMutation = useMutation({
    mutationFn: (data: { id: string; data: UpdateProject }) =>
      updateProjectFn({ data }),
    onSuccess: (data) => {
      if (isUnauthorizedError(data)) {
        toast.error(t('toast.sessionExpired'), {
          description: t('toast.loginAgain'),
        })
        return
      }
      if (isForbiddenError(data)) {
        toast.error(t('navigator.toast.failUpdateProject'), {
          description: tError(t, data),
        })
        return
      }
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setDialogState({ type: 'none' })
      resetForm()
      toast.success(t('navigator.toast.projectUpdated'), {
        description: t('toast.updatedDesc', { name: data.name }),
      })
    },
    onError: (error: Error) => {
      toast.error(t('navigator.toast.failUpdateProject'), {
        description: tError(t, error) || t('toast.unexpected'),
      })
    },
  })

  const deleteProjectMutation = useMutation({
    mutationFn: (id: string) => deleteProjectFn({ data: id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setDialogState({ type: 'none' })
      toast.success(t('navigator.toast.projectDeleted'), {
        description: t('navigator.toast.projectDeletedDesc'),
      })
    },
    onError: (error: Error) => {
      toast.error(t('navigator.toast.failDeleteProject'), {
        description: tError(t, error) || t('toast.unexpected'),
      })
    },
  })

  const updateFolderMutation = useMutation({
    mutationFn: (data: { id: string; data: UpdateFolder }) =>
      updateFolderFn({ data }),
    onSuccess: (data) => {
      if (isUnauthorizedError(data)) {
        toast.error(t('toast.sessionExpired'), {
          description: t('toast.loginAgain'),
        })
        return
      }
      if (isForbiddenError(data)) {
        toast.error(t('navigator.toast.failUpdateFolder'), {
          description: tError(t, data),
        })
        return
      }
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setDialogState({ type: 'none' })
      resetForm()
      toast.success(t('navigator.toast.folderUpdated'), {
        description: t('toast.updatedDesc', { name: data.name }),
      })
    },
    onError: (error: Error) => {
      toast.error(t('navigator.toast.failUpdateFolder'), {
        description: tError(t, error) || t('toast.unexpected'),
      })
    },
  })

  const deleteFolderMutation = useMutation({
    mutationFn: (id: string) => deleteFolderFn({ data: id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setDialogState({ type: 'none' })
      toast.success(t('navigator.toast.folderDeleted'), {
        description: t('navigator.toast.folderDeletedDesc'),
      })
    },
    onError: (error: Error) => {
      toast.error(t('navigator.toast.failDeleteFolder'), {
        description: tError(t, error) || t('toast.unexpected'),
      })
    },
  })

  const updateWhiteboardMutation = useMutation({
    mutationFn: (data: { id: string; data: UpdateWhiteboard }) =>
      updateWhiteboardFn({ data }),
    onSuccess: (data) => {
      if (isUnauthorizedError(data)) {
        toast.error(t('toast.sessionExpired'), {
          description: t('toast.loginAgain'),
        })
        return
      }
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['whiteboard'] })
      setDialogState({ type: 'none' })
      resetForm()
      toast.success(t('navigator.toast.whiteboardUpdated'), {
        description: t('toast.updatedDesc', { name: data.name }),
      })
    },
    onError: (error: Error) => {
      toast.error(t('navigator.toast.failUpdateWhiteboard'), {
        description: tError(t, error) || t('toast.unexpected'),
      })
    },
  })

  const deleteWhiteboardMutation = useMutation({
    mutationFn: (whiteboardId: string) =>
      deleteWhiteboardFn({ data: whiteboardId }),
    onSuccess: (_, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setDialogState({ type: 'none' })
      toast.success(t('navigator.toast.whiteboardDeleted'), {
        description: t('navigator.toast.whiteboardDeletedDesc'),
      })
      // Navigate home if we deleted the active whiteboard
      if (deletedId === activeWhiteboardId) {
        navigate({ to: '/' })
      }
    },
    onError: (error: Error) => {
      toast.error(t('navigator.toast.failDeleteWhiteboard'), {
        description: tError(t, error) || t('toast.unexpected'),
      })
    },
  })

  const updateCanvasBoardMutation = useMutation({
    mutationFn: (data: { id: string; data: UpdateCanvasBoard }) =>
      updateCanvasBoardFn({ data }),
    onSuccess: (data) => {
      if (isUnauthorizedError(data)) {
        toast.error(t('toast.sessionExpired'), {
          description: t('toast.loginAgain'),
        })
        return
      }
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setDialogState({ type: 'none' })
      resetForm()
      toast.success(t('navigator.toast.canvasBoardUpdated'), {
        description: t('toast.updatedDesc', { name: data.name }),
      })
    },
    onError: (error: Error) => {
      toast.error(t('navigator.toast.failUpdateCanvasBoard'), {
        description: tError(t, error) || t('toast.unexpected'),
      })
    },
  })

  const deleteCanvasBoardMutation = useMutation({
    mutationFn: (canvasBoardId: string) =>
      deleteCanvasBoardFn({ data: canvasBoardId }),
    onSuccess: (_, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setDialogState({ type: 'none' })
      toast.success(t('navigator.toast.canvasBoardDeleted'), {
        description: t('navigator.toast.canvasBoardDeletedDesc'),
      })
      // Navigate home if we deleted the active canvas board
      if (deletedId === activeCanvasBoardId) {
        navigate({ to: '/' })
      }
    },
    onError: (error: Error) => {
      toast.error(t('navigator.toast.failDeleteCanvasBoard'), {
        description: tError(t, error) || t('toast.unexpected'),
      })
    },
  })

  // Helper functions
  const resetForm = () => {
    setFormName('')
    setFormDescription('')
  }

  const toggleProject = (projectId: string) => {
    const newExpanded = new Set(expandedProjects)
    if (newExpanded.has(projectId)) {
      newExpanded.delete(projectId)
    } else {
      newExpanded.add(projectId)
    }
    setExpandedProjects(newExpanded)
  }

  // Dialog handlers
  const handleCreateProject = () => {
    setDialogState({ type: 'createProject' })
  }

  const handleEditProject = (
    id: string,
    name: string,
    description?: string,
  ) => {
    setFormName(name)
    setFormDescription(description || '')
    setDialogState({ type: 'editProject', id, name, description })
  }

  const handleDeleteProject = (id: string, name: string) => {
    setDialogState({ type: 'deleteProject', id, name })
  }

  const handleCreateFolder = (projectId: string, parentFolderId?: string) => {
    setCreateFolderDialog({ open: true, projectId, parentFolderId })
  }

  const handleEditFolder = (id: string, name: string) => {
    setFormName(name)
    setDialogState({ type: 'editFolder', id, name })
  }

  const handleDeleteFolder = (id: string, name: string) => {
    setDialogState({ type: 'deleteFolder', id, name })
  }

  const handleCreateWhiteboard = (projectId: string, folderId?: string) => {
    setCreateWhiteboardDialog({ open: true, projectId, folderId })
  }

  const handleEditWhiteboard = (id: string, name: string) => {
    setFormName(name)
    setDialogState({ type: 'editWhiteboard', id, name })
  }

  const handleDeleteWhiteboard = (id: string, name: string) => {
    setDialogState({ type: 'deleteWhiteboard', id, name })
  }

  const handleCreateCanvasBoard = (projectId: string, folderId?: string) => {
    setCreateCanvasBoardDialog({ open: true, projectId, folderId })
  }

  const handleEditCanvasBoard = (id: string, name: string) => {
    setFormName(name)
    setDialogState({ type: 'editCanvasBoard', id, name })
  }

  const handleDeleteCanvasBoard = (id: string, name: string) => {
    setDialogState({ type: 'deleteCanvasBoard', id, name })
  }

  // Drag and drop handlers
  const handleWhiteboardDrop = async (
    whiteboardId: string,
    targetFolderId: string,
  ) => {
    await updateWhiteboardMutation.mutateAsync({
      id: whiteboardId,
      data: { folderId: targetFolderId },
    })
  }

  const handleCanvasBoardDrop = async (
    canvasBoardId: string,
    targetFolderId: string,
  ) => {
    await updateCanvasBoardMutation.mutateAsync({
      id: canvasBoardId,
      data: { folderId: targetFolderId },
    })
  }

  // Submit handlers
  const handleSubmitProject = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      if (dialogState.type === 'createProject') {
        await createProjectMutation.mutateAsync({
          name: formName,
          description: formDescription || undefined,
        })
      } else if (dialogState.type === 'editProject') {
        await updateProjectMutation.mutateAsync({
          id: dialogState.id,
          data: {
            name: formName,
            description: formDescription || undefined,
          },
        })
      }
    } catch (error) {
      console.error('Project submission error:', error)
    }
  }

  const handleSubmitFolder = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      if (dialogState.type === 'editFolder') {
        await updateFolderMutation.mutateAsync({
          id: dialogState.id,
          data: { name: formName },
        })
      }
    } catch (error) {
      console.error('Folder submission error:', error)
    }
  }

  const handleSubmitWhiteboard = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      if (dialogState.type === 'editWhiteboard') {
        await updateWhiteboardMutation.mutateAsync({
          id: dialogState.id,
          data: { name: formName },
        })
      }
    } catch (error) {
      console.error('Whiteboard submission error:', error)
    }
  }

  const handleSubmitCanvasBoard = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      if (dialogState.type === 'editCanvasBoard') {
        await updateCanvasBoardMutation.mutateAsync({
          id: dialogState.id,
          data: { name: formName },
        })
      }
    } catch (error) {
      console.error('Canvas board submission error:', error)
    }
  }

  // Build folder tree structure
  const buildFolderTree = (
    folders: Array<{
      id: string
      name: string
      parentFolderId: string | null
      childFolders?: Array<any>
      whiteboards?: Array<any>
      canvasBoards?: Array<any>
    }>,
    parentId: string | null = null,
  ): Array<FolderWithChildren> => {
    return folders
      .filter((f) => f.parentFolderId === parentId)
      .map((folder) => ({
        ...folder,
        childFolders: buildFolderTree(folders, folder.id),
      })) as Array<FolderWithChildren>
  }

  if (isLoading) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {t('navigator.loadingProjects')}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Header with Create Project button */}
      <div className="flex items-center justify-between px-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase">
          {t('navigator.projects')}
        </h3>
        <Button
          variant="ghost"
          size="sm"
          className={ROW_ACTION_BUTTON_CLASS}
          onClick={handleCreateProject}
        >
          <Plus className="h-4 w-4" />
          <span className="sr-only">{t('navigator.createProject')}</span>
        </Button>
      </div>

      {/* Projects list */}
      {!projects || !Array.isArray(projects) || projects.length === 0 ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">
          {t('navigator.noProjects')}
        </div>
      ) : (
        <div className="space-y-1">
          {projects.map((project) => {
            const isExpanded = expandedProjects.has(project.id)
            const rootFolders = buildFolderTree(project.folders)
            // Merged whiteboard + canvas board rows, most recently updated
            // first across both kinds (spec-delta: "Both kinds appear in one
            // tree level").
            const rootBoards = mergeBoardsByUpdatedAt(
              project.whiteboards,
              project.canvasBoards,
            )
            // Active when URL is /project/:id or /project/:id/folder/:folderId
            const isActiveProject = currentPathname.startsWith(
              `/project/${project.id}`,
            )

            return (
              <Collapsible key={project.id} open={isExpanded}>
                <div className="group relative">
                  <div className="flex items-center gap-1 pr-1">
                    <Link
                      to="/project/$projectId"
                      params={{ projectId: project.id }}
                      title={project.name}
                      className={`flex min-w-0 items-center gap-2 flex-1 pl-2 pr-2 py-2 rounded-md hover:bg-accent/50 transition-colors ${isActiveProject ? 'bg-accent' : ''}`}
                    >
                      <FolderPlus className="h-4 w-4 text-primary flex-shrink-0" />
                      <span className="text-sm font-medium flex-1 truncate">
                        {project.name}
                      </span>
                    </Link>

                    <CollapsibleTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-6 p-0 flex-shrink-0"
                        aria-label={t('navigator.toggleTree', {
                          name: project.name,
                        })}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleProject(project.id)
                        }}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </Button>
                    </CollapsibleTrigger>
                  </div>

                  {/* Project action buttons */}
                  <RowActions>
                    <CreateBoardMenu
                      onCreateWhiteboard={() =>
                        handleCreateWhiteboard(project.id)
                      }
                      onCreateCanvasBoard={() =>
                        handleCreateCanvasBoard(project.id)
                      }
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        className={ROW_ACTION_BUTTON_CLASS}
                        onClick={(e) => e.stopPropagation()}
                        title={t('navigator.newBoard')}
                      >
                        <Plus className="h-3 w-3" />
                        <span className="sr-only">
                          {t('navigator.newBoard')}
                        </span>
                      </Button>
                    </CreateBoardMenu>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={ROW_ACTION_BUTTON_CLASS}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleCreateFolder(project.id)
                      }}
                      title={t('navigator.newFolder')}
                    >
                      <FolderPlus className="h-3 w-3" />
                      <span className="sr-only">
                        {t('navigator.newFolder')}
                      </span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={ROW_ACTION_BUTTON_CLASS}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleEditProject(
                          project.id,
                          project.name,
                          project.description || undefined,
                        )
                      }}
                      title={t('common.rename')}
                    >
                      <Pencil className="h-3 w-3" />
                      <span className="sr-only">{t('common.rename')}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={ROW_ACTION_DELETE_CLASS}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteProject(project.id, project.name)
                      }}
                      title={t('common.delete')}
                    >
                      <Trash2 className="h-3 w-3" />
                      <span className="sr-only">{t('common.delete')}</span>
                    </Button>
                  </RowActions>
                </div>

                {/* Collapsible content */}
                <CollapsibleContent>
                  <div className="ml-6 mt-1 space-y-1">
                    {/* Root folders */}
                    {rootFolders.map((folder) => (
                      <FolderItem
                        key={folder.id}
                        folder={folder}
                        depth={0}
                        activeWhiteboardId={activeWhiteboardId}
                        activeCanvasBoardId={activeCanvasBoardId}
                        onCreateFolder={(parentId) =>
                          handleCreateFolder(project.id, parentId)
                        }
                        onCreateWhiteboard={(folderId) =>
                          handleCreateWhiteboard(project.id, folderId)
                        }
                        onCreateCanvasBoard={(folderId) =>
                          handleCreateCanvasBoard(project.id, folderId)
                        }
                        onRenameFolder={handleEditFolder}
                        onDeleteFolder={handleDeleteFolder}
                        onRenameWhiteboard={handleEditWhiteboard}
                        onDeleteWhiteboard={handleDeleteWhiteboard}
                        onWhiteboardDrop={handleWhiteboardDrop}
                        onRenameCanvasBoard={handleEditCanvasBoard}
                        onDeleteCanvasBoard={handleDeleteCanvasBoard}
                        onCanvasBoardDrop={handleCanvasBoardDrop}
                      />
                    ))}

                    {/* Root boards (not in any folder), whiteboards and
                        canvas boards interleaved by updatedAt */}
                    {rootBoards.map((board) =>
                      board.kind === 'canvas' ? (
                        <CanvasBoardItem
                          key={board.id}
                          id={board.id}
                          name={board.name}
                          isActive={board.id === activeCanvasBoardId}
                          onRename={handleEditCanvasBoard}
                          onDelete={handleDeleteCanvasBoard}
                        />
                      ) : (
                        <WhiteboardItem
                          key={board.id}
                          id={board.id}
                          name={board.name}
                          isActive={board.id === activeWhiteboardId}
                          onRename={handleEditWhiteboard}
                          onDelete={handleDeleteWhiteboard}
                          onDragStart={(e, id) => {
                            e.dataTransfer.setData('whiteboardId', id)
                          }}
                        />
                      ),
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )
          })}
        </div>
      )}

      {/* Dialogs */}
      {/* Project Create/Edit Dialog */}
      <Dialog
        open={
          dialogState.type === 'createProject' ||
          dialogState.type === 'editProject'
        }
        onOpenChange={(open) => {
          if (!open) {
            setDialogState({ type: 'none' })
            resetForm()
          }
        }}
      >
        <DialogContent>
          <form onSubmit={handleSubmitProject}>
            <DialogHeader>
              <DialogTitle>
                {dialogState.type === 'createProject'
                  ? t('navigator.dialog.createProjectTitle')
                  : t('navigator.dialog.editProjectTitle')}
              </DialogTitle>
              <DialogDescription>
                {dialogState.type === 'createProject'
                  ? t('navigator.dialog.createProjectDesc')
                  : t('navigator.dialog.editProjectDesc')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="project-name">{t('common.name')}</Label>
                <Input
                  id="project-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder={t('navigator.dialog.projectPlaceholder')}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="project-description">
                  {t('navigator.dialog.descriptionOptional')}
                </Label>
                <Textarea
                  id="project-description"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder={t('navigator.dialog.descriptionPlaceholder')}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDialogState({ type: 'none' })
                  resetForm()
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={!formName.trim()}>
                {dialogState.type === 'createProject'
                  ? t('common.create')
                  : t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Project Delete Dialog */}
      <Dialog
        open={dialogState.type === 'deleteProject'}
        onOpenChange={(open) => {
          if (!open) setDialogState({ type: 'none' })
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('navigator.dialog.deleteProjectTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('navigator.dialog.deleteConfirmPrefix')}
              <strong>
                {dialogState.type === 'deleteProject' ? dialogState.name : ''}
              </strong>
              {t('navigator.dialog.deleteProjectSuffix')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogState({ type: 'none' })}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (dialogState.type === 'deleteProject') {
                  deleteProjectMutation.mutate(dialogState.id)
                }
              }}
            >
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Folder Dialog (extracted component) */}
      <CreateFolderDialog
        open={createFolderDialog.open}
        onOpenChange={(open) =>
          setCreateFolderDialog((prev) => ({ ...prev, open }))
        }
        projectId={createFolderDialog.projectId}
        parentFolderId={createFolderDialog.parentFolderId}
      />

      {/* Folder Edit Dialog */}
      <Dialog
        open={dialogState.type === 'editFolder'}
        onOpenChange={(open) => {
          if (!open) {
            setDialogState({ type: 'none' })
            resetForm()
          }
        }}
      >
        <DialogContent>
          <form onSubmit={handleSubmitFolder}>
            <DialogHeader>
              <DialogTitle>
                {t('navigator.dialog.renameFolderTitle')}
              </DialogTitle>
              <DialogDescription>
                {t('navigator.dialog.renameFolderDesc')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="folder-name">{t('common.name')}</Label>
                <Input
                  id="folder-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder={t('navigator.dialog.folderPlaceholder')}
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDialogState({ type: 'none' })
                  resetForm()
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={!formName.trim()}>
                {t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Folder Delete Dialog */}
      <Dialog
        open={dialogState.type === 'deleteFolder'}
        onOpenChange={(open) => {
          if (!open) setDialogState({ type: 'none' })
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('navigator.dialog.deleteFolderTitle')}</DialogTitle>
            <DialogDescription>
              {t('navigator.dialog.deleteConfirmPrefix')}
              <strong>
                {dialogState.type === 'deleteFolder' ? dialogState.name : ''}
              </strong>
              {t('navigator.dialog.deleteFolderSuffix')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogState({ type: 'none' })}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (dialogState.type === 'deleteFolder') {
                  deleteFolderMutation.mutate(dialogState.id)
                }
              }}
            >
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Whiteboard Dialog (extracted component) */}
      <CreateWhiteboardDialog
        open={createWhiteboardDialog.open}
        onOpenChange={(open) =>
          setCreateWhiteboardDialog((prev) => ({ ...prev, open }))
        }
        projectId={createWhiteboardDialog.projectId}
        folderId={createWhiteboardDialog.folderId}
      />

      {/* Whiteboard Edit Dialog */}
      <Dialog
        open={dialogState.type === 'editWhiteboard'}
        onOpenChange={(open) => {
          if (!open) {
            setDialogState({ type: 'none' })
            resetForm()
          }
        }}
      >
        <DialogContent>
          <form onSubmit={handleSubmitWhiteboard}>
            <DialogHeader>
              <DialogTitle>
                {t('navigator.dialog.renameWhiteboardTitle')}
              </DialogTitle>
              <DialogDescription>
                {t('navigator.dialog.renameWhiteboardDesc')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="whiteboard-name">{t('common.name')}</Label>
                <Input
                  id="whiteboard-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder={t('navigator.dialog.whiteboardPlaceholder')}
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDialogState({ type: 'none' })
                  resetForm()
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={!formName.trim()}>
                {t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Whiteboard Delete Dialog */}
      <Dialog
        open={dialogState.type === 'deleteWhiteboard'}
        onOpenChange={(open) => {
          if (!open) setDialogState({ type: 'none' })
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('navigator.dialog.deleteWhiteboardTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('navigator.dialog.deleteConfirmPrefix')}
              <strong>
                {dialogState.type === 'deleteWhiteboard'
                  ? dialogState.name
                  : ''}
              </strong>
              {t('navigator.dialog.deleteWhiteboardSuffix')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogState({ type: 'none' })}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (dialogState.type === 'deleteWhiteboard') {
                  deleteWhiteboardMutation.mutate(dialogState.id)
                }
              }}
            >
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Canvas Board Dialog (extracted component) */}
      <CreateCanvasBoardDialog
        open={createCanvasBoardDialog.open}
        onOpenChange={(open) =>
          setCreateCanvasBoardDialog((prev) => ({ ...prev, open }))
        }
        projectId={createCanvasBoardDialog.projectId}
        folderId={createCanvasBoardDialog.folderId}
      />

      {/* Canvas Board Edit Dialog */}
      <Dialog
        open={dialogState.type === 'editCanvasBoard'}
        onOpenChange={(open) => {
          if (!open) {
            setDialogState({ type: 'none' })
            resetForm()
          }
        }}
      >
        <DialogContent>
          <form onSubmit={handleSubmitCanvasBoard}>
            <DialogHeader>
              <DialogTitle>
                {t('navigator.dialog.renameCanvasTitle')}
              </DialogTitle>
              <DialogDescription>
                {t('navigator.dialog.renameCanvasDesc')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="canvas-board-rename">{t('common.name')}</Label>
                <Input
                  id="canvas-board-rename"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder={t('navigator.dialog.canvasPlaceholder')}
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDialogState({ type: 'none' })
                  resetForm()
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={!formName.trim()}>
                {t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Canvas Board Delete Dialog */}
      <Dialog
        open={dialogState.type === 'deleteCanvasBoard'}
        onOpenChange={(open) => {
          if (!open) setDialogState({ type: 'none' })
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('navigator.dialog.deleteCanvasTitle')}</DialogTitle>
            <DialogDescription>
              {t('navigator.dialog.deleteConfirmPrefix')}
              <strong>
                {dialogState.type === 'deleteCanvasBoard'
                  ? dialogState.name
                  : ''}
              </strong>
              {t('navigator.dialog.deleteCanvasSuffix')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogState({ type: 'none' })}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (dialogState.type === 'deleteCanvasBoard') {
                  deleteCanvasBoardMutation.mutate(dialogState.id)
                }
              }}
            >
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
