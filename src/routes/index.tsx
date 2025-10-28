// src/routes/index.tsx
// Home page - Project Dashboard

import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { PlusCircle, FolderOpen, FileText } from 'lucide-react';
import { getAllProjects } from '@/lib/server-functions-project';

export const Route = createFileRoute('/')({
  component: HomePage,
});

/**
 * Home page component - Project Dashboard
 * Shows list of projects and quick access to whiteboards
 */
function HomePage() {
  // Fetch all projects with their whiteboards
  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      return await getAllProjects();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <p className="text-lg text-muted-foreground">Loading projects...</p>
      </div>
    );
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
            <Button>
              <PlusCircle className="mr-2 h-4 w-4" />
              New Project
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        {!projects || projects.length === 0 ? (
          // Empty state
          <div className="flex flex-col items-center justify-center py-20">
            <FolderOpen className="h-24 w-24 text-muted-foreground mb-4" />
            <h2 className="text-2xl font-semibold mb-2">No projects yet</h2>
            <p className="text-muted-foreground mb-6 text-center max-w-md">
              Get started by creating your first project to organize your ER
              diagrams
            </p>
            <Button size="lg">
              <PlusCircle className="mr-2 h-5 w-5" />
              Create Your First Project
            </Button>
          </div>
        ) : (
          // Projects list
          <div className="space-y-8">
            {projects.map((project) => (
              <div key={project.id}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-2xl font-semibold">{project.name}</h2>
                    {project.description && (
                      <p className="text-muted-foreground mt-1">
                        {project.description}
                      </p>
                    )}
                  </div>
                  <Button variant="outline" size="sm">
                    <PlusCircle className="mr-2 h-4 w-4" />
                    New Whiteboard
                  </Button>
                </div>

                {/* Whiteboards Grid */}
                {project.whiteboards && project.whiteboards.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {project.whiteboards.map((whiteboard) => (
                      <Link
                        key={whiteboard.id}
                        to="/whiteboard/$whiteboardId"
                        params={{ whiteboardId: whiteboard.id }}
                      >
                        <Card className="hover:border-primary transition-colors cursor-pointer h-full">
                          <CardHeader>
                            <div className="flex items-start justify-between">
                              <FileText className="h-8 w-8 text-primary" />
                            </div>
                            <CardTitle className="mt-4">
                              {whiteboard.name}
                            </CardTitle>
                            <CardDescription>
                              Last updated{' '}
                              {new Date(whiteboard.updatedAt).toLocaleDateString()}
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                            <div className="text-sm text-muted-foreground">
                              Click to open whiteboard
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-12">
                      <FileText className="h-12 w-12 text-muted-foreground mb-3" />
                      <p className="text-muted-foreground">
                        No whiteboards in this project yet
                      </p>
                      <Button variant="outline" size="sm" className="mt-4">
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Create Whiteboard
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </div>
            ))}
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
    </div>
  );
}
