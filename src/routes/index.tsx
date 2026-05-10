// src/routes/index.tsx
// Home page - Project Dashboard

import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock, FileText, FolderOpen, PlusCircle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { CreateProject } from '@/data/schema'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { createProjectFn, getProjectsWithTree } from '@/routes/api/projects'
import { getRecentWhiteboards } from '@/routes/api/whiteboards'

export const Route = createFileRoute('/')({
  component: HomePage,
})

/**
 * Home page component - Project Dashboard
 * Shows list of projects and quick access to whiteboards
 */
function HomePage() {
  const queryClient = useQueryClient()
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [projectDescription, setProjectDescription] = useState('')

  // Fetch all projects with their tree structure
  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects', 'tree'],
    queryFn: () => getProjectsWithTree(),
  })

  // Fetch recent whiteboards (own projects only — rendered independently of projectsLoading)
  const { data: recentWhiteboards } = useQuery({
    queryKey: ['whiteboards', 'recent'],
    queryFn: () => getRecentWhiteboards({ data: 8 }),
  })

  // Create project mutation
  const createProjectMutation = useMutation({
    mutationFn: (data: CreateProject) => createProjectFn({ data }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['projects', 'tree'] })
      setShowCreateProject(false)
      setProjectName('')
      setProjectDescription('')
      toast.success('Project created successfully!', {
        description: `${data.name} has been added to your projects.`,
      })
    },
    onError: (error: Error) => {
      toast.error('Failed to create project', {
        description:
          error.message || 'An unexpected error occurred. Please try again.',
      })
    },
  })

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await createProjectMutation.mutateAsync({
        name: projectName,
        description: projectDescription || undefined,
      })
    } catch (error) {
      // Error is already handled by onError callback
    }
  }

  // Only block on projectsLoading — the recent whiteboards section renders
  // independently. Blocking on recentLoading as well would hide the project
  // grid (and its navigation Links) while the secondary query settles, causing
  // clicks on project cards to silently fail during that window.
  if (projectsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <p className="text-lg text-muted-foreground">Loading projects...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">ER Diagram Whiteboard</h1>
              <p className="text-muted-foreground mt-1">
                Collaborative database schema design tool
              </p>
            </div>
            <Button onClick={() => setShowCreateProject(true)}>
              <PlusCircle className="mr-2 h-4 w-4" />
              New Project
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        {!projects || !Array.isArray(projects) || projects.length === 0 ? (
          // Empty state
          <div className="flex flex-col items-center justify-center py-20">
            <FolderOpen className="h-24 w-24 text-muted-foreground mb-4" />
            <h2 className="text-2xl font-semibold mb-2">No projects yet</h2>
            <p className="text-muted-foreground mb-6 text-center max-w-md">
              Get started by creating your first project to organize your ER
              diagrams
            </p>
            <Button size="lg" onClick={() => setShowCreateProject(true)}>
              <PlusCircle className="mr-2 h-5 w-5" />
              Create Your First Project
            </Button>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Recent Whiteboards Section */}
            {recentWhiteboards &&
              Array.isArray(recentWhiteboards) &&
              recentWhiteboards.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <Clock className="h-5 w-5 text-muted-foreground" />
                    <h2 className="text-2xl font-semibold">
                      Recent Whiteboards
                    </h2>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {recentWhiteboards.map((whiteboard) => (
                      <Link
                        key={whiteboard.id}
                        to="/whiteboard/$whiteboardId"
                        params={{ whiteboardId: whiteboard.id }}
                      >
                        <Card className="hover:border-primary transition-colors cursor-pointer h-full">
                          <CardHeader>
                            <div className="flex items-start justify-between">
                              <FileText className="h-6 w-6 text-primary" />
                            </div>
                            <CardTitle className="mt-2 text-base">
                              {whiteboard.name}
                            </CardTitle>
                            <CardDescription className="text-xs">
                              {new Date(
                                whiteboard.updatedAt,
                              ).toLocaleDateString()}
                            </CardDescription>
                          </CardHeader>
                        </Card>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

            {/* Projects Section */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-semibold">All Projects</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {projects &&
                  Array.isArray(projects) &&
                  projects.map((project) => (
                    <Link
                      key={project.id}
                      to="/project/$projectId"
                      params={{ projectId: project.id }}
                    >
                      <Card className="hover:border-primary transition-colors cursor-pointer h-full">
                        <CardHeader>
                          <div className="flex items-start justify-between">
                            <FolderOpen className="h-8 w-8 text-primary" />
                          </div>
                          <CardTitle className="mt-4">{project.name}</CardTitle>
                          {project.description && (
                            <CardDescription className="!text-muted-foreground">
                              {project.description}
                            </CardDescription>
                          )}
                        </CardHeader>
                        <CardContent>
                          <div className="text-sm text-muted-foreground space-y-1">
                            <div>
                              {project.folders?.length || 0} folder
                              {project.folders?.length !== 1 ? 's' : ''}
                            </div>
                            <div>
                              {project.whiteboards?.length || 0} whiteboard
                              {project.whiteboards?.length !== 1 ? 's' : ''}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t mt-20">
        <div className="container mx-auto px-4 py-6">
          <p className="text-center text-sm text-muted-foreground">
            Collaborative ER Diagram Whiteboard - Built with TanStack Start
          </p>
        </div>
      </div>

      {/* Create Project Dialog */}
      <Dialog open={showCreateProject} onOpenChange={setShowCreateProject}>
        <DialogContent>
          <form onSubmit={handleCreateProject}>
            <DialogHeader>
              <DialogTitle>Create Project</DialogTitle>
              <DialogDescription>
                Create a new project to organize your whiteboards.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="My Project"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description (optional)</Label>
                <Textarea
                  id="description"
                  value={projectDescription}
                  onChange={(e) => setProjectDescription(e.target.value)}
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
                  setShowCreateProject(false)
                  setProjectName('')
                  setProjectDescription('')
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  !projectName.trim() || createProjectMutation.isPending
                }
              >
                {createProjectMutation.isPending ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
