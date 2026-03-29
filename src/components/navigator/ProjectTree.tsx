// src/components/navigator/ProjectTree.tsx
// Project tree component for hierarchical navigation

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
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
import type { FolderWithChildren } from './FolderItem'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  createProjectFn,
  deleteProjectFn,
  getProjectsWithTree,
  updateProjectFn,
} from '@/routes/api/projects'
import {
  createFolderFn,
  deleteFolderFn,
  updateFolderFn,
} from '@/routes/api/folders'
import {
  createWhiteboardFn,
  deleteWhiteboardFn,
  updateWhiteboardFn,
} from '@/routes/api/whiteboards'

/**
 * Dialog state types
 */
type DialogState =
  | { type: 'none' }
  | { type: 'createProject' }
  | { type: 'editProject'; id: string; name: string; description?: string }
  | { type: 'deleteProject'; id: string; name: string }
  | { type: 'createFolder'; projectId: string; parentFolderId?: string }
  | { type: 'editFolder'; id: string; name: string }
  | { type: 'deleteFolder'; id: string; name: string }
  | {
      type: 'createWhiteboard'
      projectId: string
      folderId?: string
    }
  | { type: 'editWhiteboard'; id: string; name: string }
  | { type: 'deleteWhiteboard'; id: string; name: string }

/**
 * ProjectTree component
 * Displays hierarchical navigation tree for projects, folders, and whiteboards
 */
export function ProjectTree() {
  const navigate = useNavigate()
  const params = useParams({ strict: false })
  const queryClient = useQueryClient()
  const [dialogState, setDialogState] = useState<DialogState>({ type: 'none' })
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    new Set(),
  )

  // Form state
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formProjectId, setFormProjectId] = useState('')
  const [formFolderId, setFormFolderId] = useState('')

  // Get current whiteboard ID from URL params
  const activeWhiteboardId =
    'whiteboardId' in params ? params.whiteboardId : undefined

  // Fetch projects with tree structure
  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects', 'tree'],
    queryFn: () => getProjectsWithTree(),
  })

  // Mutations
  const createProjectMutation = useMutation({
    mutationFn: createProjectFn,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['projects', 'tree'] })
      setDialogState({ type: 'none' })
      resetForm()
      toast.success('Project created!', {
        description: `${data.name} has been created successfully.`,
      })
    },
    onError: (error: Error) => {
      toast.error('Failed to create project', {
        description: error.message || 'An unexpected error occurred.',
      })
    },
  })

  const updateProjectMutation = useMutation({
    mutationFn: updateProjectFn,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setDialogState({ type: 'none' })
      resetForm()
      toast.success('Project updated!', {
        description: `${data.name} has been updated successfully.`,
      })
    },
    onError: (error: Error) => {
      toast.error('Failed to update project', {
        description: error.message || 'An unexpected error occurred.',
      })
    },
  })

  const deleteProjectMutation = useMutation({
    mutationFn: deleteProjectFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setDialogState({ type: 'none' })
      toast.success('Project deleted', {
        description: 'The project has been deleted successfully.',
      })
    },
    onError: (error: Error) => {
      toast.error('Failed to delete project', {
        description: error.message || 'An unexpected error occurred.',
      })
    },
  })

  const createFolderMutation = useMutation({
    mutationFn: createFolderFn,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setDialogState({ type: 'none' })
      resetForm()
      toast.success('Folder created!', {
        description: `${data.name} has been created successfully.`,
      })
    },
    onError: (error: Error) => {
      toast.error('Failed to create folder', {
        description: error.message || 'An unexpected error occurred.',
      })
    },
  })

  const updateFolderMutation = useMutation({
    mutationFn: updateFolderFn,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setDialogState({ type: 'none' })
      resetForm()
      toast.success('Folder updated!', {
        description: `${data.name} has been updated successfully.`,
      })
    },
    onError: (error: Error) => {
      toast.error('Failed to update folder', {
        description: error.message || 'An unexpected error occurred.',
      })
    },
  })

  const deleteFolderMutation = useMutation({
    mutationFn: deleteFolderFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setDialogState({ type: 'none' })
      toast.success('Folder deleted', {
        description: 'The folder has been deleted successfully.',
      })
    },
    onError: (error: Error) => {
      toast.error('Failed to delete folder', {
        description: error.message || 'An unexpected error occurred.',
      })
    },
  })

  const createWhiteboardMutation = useMutation({
    mutationFn: createWhiteboardFn,
    onSuccess: (whiteboard) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setDialogState({ type: 'none' })
      resetForm()
      toast.success('Whiteboard created!', {
        description: `${whiteboard.name} has been created successfully.`,
      })
      // Navigate to the new whiteboard
      navigate({
        to: '/whiteboard/$whiteboardId',
        params: { whiteboardId: whiteboard.id },
      })
    },
    onError: (error: Error) => {
      toast.error('Failed to create whiteboard', {
        description: error.message || 'An unexpected error occurred.',
      })
    },
  })

  const updateWhiteboardMutation = useMutation({
    mutationFn: updateWhiteboardFn,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['whiteboard'] })
      setDialogState({ type: 'none' })
      resetForm()
      toast.success('Whiteboard updated!', {
        description: `${data.name} has been updated successfully.`,
      })
    },
    onError: (error: Error) => {
      toast.error('Failed to update whiteboard', {
        description: error.message || 'An unexpected error occurred.',
      })
    },
  })

  const deleteWhiteboardMutation = useMutation({
    mutationFn: deleteWhiteboardFn,
    onSuccess: (_, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setDialogState({ type: 'none' })
      toast.success('Whiteboard deleted', {
        description: 'The whiteboard has been deleted successfully.',
      })
      // Navigate home if we deleted the active whiteboard
      if (deletedId === activeWhiteboardId) {
        navigate({ to: '/' })
      }
    },
    onError: (error: Error) => {
      toast.error('Failed to delete whiteboard', {
        description: error.message || 'An unexpected error occurred.',
      })
    },
  })

  // Helper functions
  const resetForm = () => {
    setFormName('')
    setFormDescription('')
    setFormProjectId('')
    setFormFolderId('')
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
    setFormProjectId(projectId)
    setFormFolderId(parentFolderId || '')
    setDialogState({ type: 'createFolder', projectId, parentFolderId })
  }

  const handleEditFolder = (id: string, name: string) => {
    setFormName(name)
    setDialogState({ type: 'editFolder', id, name })
  }

  const handleDeleteFolder = (id: string, name: string) => {
    setDialogState({ type: 'deleteFolder', id, name })
  }

  const handleCreateWhiteboard = (projectId: string, folderId?: string) => {
    setFormProjectId(projectId)
    setFormFolderId(folderId || '')
    setDialogState({ type: 'createWhiteboard', projectId, folderId })
  }

  const handleEditWhiteboard = (id: string, name: string) => {
    setFormName(name)
    setDialogState({ type: 'editWhiteboard', id, name })
  }

  const handleDeleteWhiteboard = (id: string, name: string) => {
    setDialogState({ type: 'deleteWhiteboard', id, name })
  }

  // Drag and drop handler
  const handleWhiteboardDrop = async (
    whiteboardId: string,
    targetFolderId: string,
  ) => {
    await updateWhiteboardMutation.mutateAsync({
      id: whiteboardId,
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
      if (dialogState.type === 'createFolder') {
        await createFolderMutation.mutateAsync({
          name: formName,
          projectId: formProjectId,
          parentFolderId: formFolderId || undefined,
        })
      } else if (dialogState.type === 'editFolder') {
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
      if (dialogState.type === 'createWhiteboard') {
        await createWhiteboardMutation.mutateAsync({
          name: formName,
          projectId: formProjectId,
          folderId: formFolderId || undefined,
        })
      } else if (dialogState.type === 'editWhiteboard') {
        await updateWhiteboardMutation.mutateAsync({
          id: dialogState.id,
          data: { name: formName },
        })
      }
    } catch (error) {
      console.error('Whiteboard submission error:', error)
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
        Loading projects...
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Header with Create Project button */}
      <div className="flex items-center justify-between px-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase">
          Projects
        </h3>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={handleCreateProject}
        >
          <Plus className="h-4 w-4" />
          <span className="sr-only">Create project</span>
        </Button>
      </div>

      {/* Projects list */}
      {!projects || !Array.isArray(projects) || projects.length === 0 ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">
          No projects yet. Create one to get started.
        </div>
      ) : (
        <div className="space-y-1">
          {projects.map((project) => {
            const isExpanded = expandedProjects.has(project.id)
            const rootFolders = buildFolderTree(project.folders || [])
            const rootWhiteboards = project.whiteboards || []

            return (
              <Collapsible
                key={project.id}
                open={isExpanded}
                onOpenChange={() => toggleProject(project.id)}
              >
                <div className="group relative">
                  <div className="flex items-center gap-1 pr-8">
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </Button>
                    </CollapsibleTrigger>

                    <div className="flex items-center gap-2 flex-1 px-2 py-2 rounded-md hover:bg-accent/50 transition-colors">
                      <FolderPlus className="h-4 w-4 text-primary flex-shrink-0" />
                      <span className="text-sm font-medium flex-1 truncate">
                        {project.name}
                      </span>
                    </div>
                  </div>

                  {/* Project action buttons */}
                  <div className="absolute right-1 top-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-sidebar rounded-md px-0.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleCreateWhiteboard(project.id)
                      }}
                      title="New Whiteboard"
                    >
                      <Plus className="h-3 w-3" />
                      <span className="sr-only">New Whiteboard</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleCreateFolder(project.id)
                      }}
                      title="New Folder"
                    >
                      <FolderPlus className="h-3 w-3" />
                      <span className="sr-only">New Folder</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleEditProject(
                          project.id,
                          project.name,
                          project.description || undefined,
                        )
                      }}
                      title="Rename"
                    >
                      <Pencil className="h-3 w-3" />
                      <span className="sr-only">Rename</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteProject(project.id, project.name)
                      }}
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span className="sr-only">Delete</span>
                    </Button>
                  </div>
                </div>

                {/* Collapsible content */}
                <CollapsibleContent>
                  <div className="ml-4 mt-1 space-y-1">
                    {/* Root folders */}
                    {rootFolders.map((folder) => (
                      <FolderItem
                        key={folder.id}
                        folder={folder}
                        depth={0}
                        activeWhiteboardId={activeWhiteboardId}
                        onCreateFolder={(parentId) =>
                          handleCreateFolder(project.id, parentId)
                        }
                        onCreateWhiteboard={(folderId) =>
                          handleCreateWhiteboard(project.id, folderId)
                        }
                        onRenameFolder={handleEditFolder}
                        onDeleteFolder={handleDeleteFolder}
                        onRenameWhiteboard={handleEditWhiteboard}
                        onDeleteWhiteboard={handleDeleteWhiteboard}
                        onWhiteboardDrop={handleWhiteboardDrop}
                      />
                    ))}

                    {/* Root whiteboards (not in any folder) */}
                    {rootWhiteboards.map((whiteboard) => (
                      <WhiteboardItem
                        key={whiteboard.id}
                        id={whiteboard.id}
                        name={whiteboard.name}
                        isActive={whiteboard.id === activeWhiteboardId}
                        onRename={handleEditWhiteboard}
                        onDelete={handleDeleteWhiteboard}
                        onDragStart={(e, id) => {
                          e.dataTransfer.setData('whiteboardId', id)
                        }}
                      />
                    ))}
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
                  ? 'Create Project'
                  : 'Edit Project'}
              </DialogTitle>
              <DialogDescription>
                {dialogState.type === 'createProject'
                  ? 'Create a new project to organize your whiteboards.'
                  : 'Update the project details.'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="project-name">Name</Label>
                <Input
                  id="project-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="My Project"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="project-description">
                  Description (optional)
                </Label>
                <Textarea
                  id="project-description"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Project description..."
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
                Cancel
              </Button>
              <Button type="submit" disabled={!formName.trim()}>
                {dialogState.type === 'createProject' ? 'Create' : 'Save'}
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
            <DialogTitle>Delete Project</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{' '}
              <strong>
                {dialogState.type === 'deleteProject' ? dialogState.name : ''}
              </strong>
              ? This will permanently delete all folders and whiteboards in this
              project.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogState({ type: 'none' })}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (dialogState.type === 'deleteProject') {
                  deleteProjectMutation.mutate(dialogState.id)
                }
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Folder Create/Edit Dialog */}
      <Dialog
        open={
          dialogState.type === 'createFolder' ||
          dialogState.type === 'editFolder'
        }
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
                {dialogState.type === 'createFolder'
                  ? 'Create Folder'
                  : 'Rename Folder'}
              </DialogTitle>
              <DialogDescription>
                {dialogState.type === 'createFolder'
                  ? 'Create a new folder to organize your whiteboards.'
                  : 'Update the folder name.'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="folder-name">Name</Label>
                <Input
                  id="folder-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="My Folder"
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
                Cancel
              </Button>
              <Button type="submit" disabled={!formName.trim()}>
                {dialogState.type === 'createFolder' ? 'Create' : 'Save'}
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
            <DialogTitle>Delete Folder</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{' '}
              <strong>
                {dialogState.type === 'deleteFolder' ? dialogState.name : ''}
              </strong>
              ? This will permanently delete all subfolders and whiteboards in
              this folder.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogState({ type: 'none' })}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (dialogState.type === 'deleteFolder') {
                  deleteFolderMutation.mutate(dialogState.id)
                }
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Whiteboard Create/Edit Dialog */}
      <Dialog
        open={
          dialogState.type === 'createWhiteboard' ||
          dialogState.type === 'editWhiteboard'
        }
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
                {dialogState.type === 'createWhiteboard'
                  ? 'Create Whiteboard'
                  : 'Rename Whiteboard'}
              </DialogTitle>
              <DialogDescription>
                {dialogState.type === 'createWhiteboard'
                  ? 'Create a new whiteboard for your ER diagrams.'
                  : 'Update the whiteboard name.'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="whiteboard-name">Name</Label>
                <Input
                  id="whiteboard-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="My Whiteboard"
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
                Cancel
              </Button>
              <Button type="submit" disabled={!formName.trim()}>
                {dialogState.type === 'createWhiteboard' ? 'Create' : 'Save'}
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
            <DialogTitle>Delete Whiteboard</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{' '}
              <strong>
                {dialogState.type === 'deleteWhiteboard'
                  ? dialogState.name
                  : ''}
              </strong>
              ? This will permanently delete all tables and relationships in
              this whiteboard.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogState({ type: 'none' })}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (dialogState.type === 'deleteWhiteboard') {
                  deleteWhiteboardMutation.mutate(dialogState.id)
                }
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
