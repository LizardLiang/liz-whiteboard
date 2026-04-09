// src/components/project/ProjectSharePanel.tsx
// Share panel for managing project-level permissions

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import {
  listProjectPermissions,
  grantPermission,
  updatePermission,
  revokePermission,
} from '@/routes/api/permissions'
import type { ProjectRole } from '@prisma/client'

interface ProjectSharePanelProps {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}


/**
 * ProjectSharePanel renders a slide-out sheet for managing project permissions.
 * Shows current members, allows adding by email, changing roles, and removing.
 * Visible only to OWNER and ADMIN.
 */
export function ProjectSharePanel({
  projectId,
  open,
  onOpenChange,
}: ProjectSharePanelProps) {
  const queryClient = useQueryClient()
  const [addEmail, setAddEmail] = useState('')
  const [addRole, setAddRole] = useState<ProjectRole>('VIEWER')
  const [addError, setAddError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['project-permissions', projectId],
    queryFn: () => listProjectPermissions({ data: projectId }),
    enabled: open,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['project-permissions', projectId] })
  }

  const grantMutation = useMutation({
    mutationFn: (vars: { email: string; role: ProjectRole }) =>
      grantPermission({ data: { projectId, email: vars.email, role: vars.role } }),
    onSuccess: (result) => {
      if (result && 'error' in result) {
        setAddError((result as any).message || 'Failed to add user')
        return
      }
      setAddEmail('')
      setAddRole('VIEWER')
      setAddError(null)
      invalidate()
    },
    onError: () => setAddError('Failed to add user'),
  })

  const updateMutation = useMutation({
    mutationFn: (vars: { userId: string; role: ProjectRole }) =>
      updatePermission({
        data: { projectId, userId: vars.userId, role: vars.role },
      }),
    onSuccess: invalidate,
  })

  const revokeMutation = useMutation({
    mutationFn: (userId: string) =>
      revokePermission({ data: { projectId, userId } }),
    onSuccess: invalidate,
  })

  const handleAddUser = (e: React.FormEvent) => {
    e.preventDefault()
    setAddError(null)
    if (!addEmail) return
    grantMutation.mutate({ email: addEmail, role: addRole })
  }

  const permissions =
    data && !('error' in data) ? data : { owner: null, members: [] }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md" side="right">
        <SheetHeader>
          <SheetTitle>Share Project</SheetTitle>
          <SheetDescription>
            Manage who has access to this project and their roles.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Add user form */}
          <form onSubmit={handleAddUser} className="space-y-3">
            <Label className="text-sm font-medium">Add a person</Label>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="email@example.com"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                className="flex-1"
                aria-label="Email address to add"
              />
              <Select
                value={addRole}
                onValueChange={(v) => setAddRole(v as ProjectRole)}
              >
                <SelectTrigger className="w-28" aria-label="Select role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="VIEWER">Viewer</SelectItem>
                  <SelectItem value="EDITOR">Editor</SelectItem>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {addError && (
              <p
                role="alert"
                aria-live="polite"
                className="text-xs text-destructive"
              >
                {addError}
              </p>
            )}
            <Button
              type="submit"
              size="sm"
              disabled={!addEmail || grantMutation.isPending}
              className="w-full"
            >
              {grantMutation.isPending ? 'Adding...' : 'Add'}
            </Button>
          </form>

          {/* Current members */}
          <div>
            <Label className="text-sm font-medium">Current access</Label>
            {isLoading ? (
              <p className="mt-2 text-sm text-muted-foreground">Loading...</p>
            ) : (
              <ul className="mt-2 space-y-2" aria-label="Project members">
                {/* Owner row */}
                {permissions.owner && (
                  <li className="flex items-center gap-2 rounded-md border px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {permissions.owner.username}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {permissions.owner.email}
                      </p>
                    </div>
                    <Badge variant="secondary">Owner</Badge>
                  </li>
                )}

                {/* Members */}
                {permissions.members.map((member) => (
                  <li
                    key={member.userId}
                    className="flex items-center gap-2 rounded-md border px-3 py-2"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {member.username}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {member.email}
                      </p>
                    </div>
                    <Select
                      value={member.role}
                      onValueChange={(v) =>
                        updateMutation.mutate({
                          userId: member.userId,
                          role: v as ProjectRole,
                        })
                      }
                    >
                      <SelectTrigger
                        className="w-24 h-7 text-xs"
                        aria-label={`Change ${member.username}'s role`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="VIEWER">Viewer</SelectItem>
                        <SelectItem value="EDITOR">Editor</SelectItem>
                        <SelectItem value="ADMIN">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => revokeMutation.mutate(member.userId)}
                      aria-label={`Remove ${member.username}`}
                      disabled={revokeMutation.isPending}
                    >
                      ×
                    </Button>
                  </li>
                ))}

                {permissions.members.length === 0 && !permissions.owner && (
                  <li className="text-sm text-muted-foreground py-2">
                    No members yet.
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
