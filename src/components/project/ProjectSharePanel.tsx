// src/components/project/ProjectSharePanel.tsx
// Share panel for managing project-level permissions

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  InviteExpiryHours,
  ProjectRoleValue as ProjectRole,
} from '@/data/schema'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
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
  grantPermission,
  listProjectPermissions,
  revokePermission,
  updatePermission,
} from '@/routes/api/permissions'
import {
  createProjectInvite,
  listProjectInvites,
  revokeInvite,
} from '@/routes/api/invites'
import {
  createShareLink,
  listShareLinks,
  revokeShareLink,
} from '@/routes/api/share'
import { getWhiteboardsByProject } from '@/routes/api/whiteboards'

const EXPIRY_OPTIONS: Array<{ value: InviteExpiryHours; label: string }> = [
  { value: 1, label: '1 hour' },
  { value: 24, label: '24 hours' },
  { value: 24 * 7, label: '7 days' },
  { value: 24 * 30, label: '30 days' },
]

/** VIEWER/EDITOR/ADMIN role choices — shared by every role Select in this
 * panel (add-a-person, existing-member role change, invite-link role). */
const ROLE_OPTIONS: Array<{ value: ProjectRole; label: string }> = [
  { value: 'VIEWER', label: 'Viewer' },
  { value: 'EDITOR', label: 'Editor' },
  { value: 'ADMIN', label: 'Admin' },
]

function RoleSelectItems() {
  return (
    <>
      {ROLE_OPTIONS.map((opt) => (
        <SelectItem key={opt.value} value={opt.value}>
          {opt.label}
        </SelectItem>
      ))}
    </>
  )
}

/** Client-safe invite shape returned by listProjectInvites (tokenHash omitted). */
interface InviteListItem {
  id: string
  role: ProjectRole
  maxUses: number | null
  usedCount: number
  expiresAt: string | Date
  revokedAt: string | Date | null
  createdAt: string | Date
  createdByUserId: string
  createdByUsername: string | null
}

/** Whiteboard picker option, from getWhiteboardsByProject. */
interface WhiteboardOption {
  id: string
  name: string
}

/** Client-safe share-link shape returned by listShareLinks (tokenHash omitted). */
interface ShareLinkListItem {
  id: string
  whiteboardId: string
  whiteboardName: string
  expiresAt: string | Date
  revokedAt: string | Date | null
  createdAt: string | Date
}

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

  const [inviteRole, setInviteRole] = useState<ProjectRole>('VIEWER')
  const [inviteExpiresInHours, setInviteExpiresInHours] =
    useState<InviteExpiryHours>(24 * 7)
  const [createdInviteToken, setCreatedInviteToken] = useState<string | null>(
    null,
  )
  const [copied, setCopied] = useState(false)

  const [shareWhiteboardId, setShareWhiteboardId] = useState<string>('')
  const [shareExpiresInHours, setShareExpiresInHours] =
    useState<InviteExpiryHours>(24 * 7)
  const [createdShareToken, setCreatedShareToken] = useState<string | null>(
    null,
  )
  const [shareCopied, setShareCopied] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['project-permissions', projectId],
    queryFn: () => listProjectPermissions({ data: projectId }),
    enabled: open,
  })

  const { data: invitesData, isLoading: isInvitesLoading } = useQuery({
    queryKey: ['project-invites', projectId],
    queryFn: () => listProjectInvites({ data: projectId }),
    enabled: open,
  })

  const { data: whiteboardsData, isLoading: isWhiteboardsLoading } = useQuery({
    queryKey: ['project-whiteboards', projectId],
    queryFn: () => getWhiteboardsByProject({ data: projectId }),
    enabled: open,
  })

  const { data: shareLinksData, isLoading: isShareLinksLoading } = useQuery({
    queryKey: ['project-share-links', projectId],
    queryFn: () => listShareLinks({ data: projectId }),
    enabled: open,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: ['project-permissions', projectId],
    })
  }

  const invalidateInvites = () => {
    queryClient.invalidateQueries({
      queryKey: ['project-invites', projectId],
    })
  }

  const invalidateShareLinks = () => {
    queryClient.invalidateQueries({
      queryKey: ['project-share-links', projectId],
    })
  }

  const grantMutation = useMutation({
    mutationFn: (vars: { email: string; role: ProjectRole }) =>
      grantPermission({
        data: { projectId, email: vars.email, role: vars.role },
      }),
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

  const createInviteMutation = useMutation({
    mutationFn: () =>
      createProjectInvite({
        data: {
          projectId,
          role: inviteRole,
          expiresInHours: inviteExpiresInHours,
        },
      }),
    onSuccess: (result) => {
      if ('error' in result) return
      // Only place in the whole feature the raw token is ever available —
      // display it once, never persist it beyond this local state, never log it.
      setCreatedInviteToken(result.token)
      setCopied(false)
      invalidateInvites()
    },
  })

  const revokeInviteMutation = useMutation({
    mutationFn: (inviteId: string) =>
      revokeInvite({ data: { projectId, inviteId } }),
    onSuccess: invalidateInvites,
  })

  const createShareLinkMutation = useMutation({
    mutationFn: () =>
      createShareLink({
        data: {
          whiteboardId: shareWhiteboardId,
          expiresInHours: shareExpiresInHours,
        },
      }),
    onSuccess: (result) => {
      if ('error' in result) return
      // Only place the raw token is ever available — display it once, never
      // persist it beyond this local state, never log it.
      setCreatedShareToken(result.token)
      setShareCopied(false)
      invalidateShareLinks()
    },
  })

  const revokeShareLinkMutation = useMutation({
    mutationFn: (linkId: string) => revokeShareLink({ data: { linkId } }),
    onSuccess: invalidateShareLinks,
  })

  // Default the whiteboard picker to the project's first whiteboard once
  // loaded, so the Select isn't left empty when there's an obvious choice.
  useEffect(() => {
    if (shareWhiteboardId) return
    const whiteboards =
      whiteboardsData && !('error' in whiteboardsData) ? whiteboardsData : []
    if (whiteboards.length > 0) {
      setShareWhiteboardId(whiteboards[0].id)
    }
  }, [whiteboardsData, shareWhiteboardId])

  const handleAddUser = (e: React.FormEvent) => {
    e.preventDefault()
    setAddError(null)
    if (!addEmail) return
    grantMutation.mutate({ email: addEmail, role: addRole })
  }

  const handleCopyInviteLink = async () => {
    if (!createdInviteToken) return
    const url = `${window.location.origin}/invite/${createdInviteToken}`
    await navigator.clipboard.writeText(url)
    setCopied(true)
  }

  const handleCopyShareLink = async () => {
    if (!createdShareToken) return
    const url = `${window.location.origin}/share/${createdShareToken}`
    await navigator.clipboard.writeText(url)
    setShareCopied(true)
  }

  const permissions =
    data && !('error' in data) ? data : { owner: null, members: [] }

  const invites: Array<InviteListItem> =
    invitesData && !('error' in invitesData) ? invitesData.invites : []

  const whiteboards: Array<WhiteboardOption> =
    whiteboardsData && !('error' in whiteboardsData) ? whiteboardsData : []

  const shareLinks: Array<ShareLinkListItem> =
    shareLinksData && !('error' in shareLinksData) ? shareLinksData.links : []

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
                  <RoleSelectItems />
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
                        <RoleSelectItems />
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

          {/* Create invite link */}
          <div className="space-y-3 border-t pt-6">
            <Label className="text-sm font-medium">Invite by link</Label>
            <div className="flex gap-2">
              <Select
                value={inviteRole}
                onValueChange={(v) => setInviteRole(v as ProjectRole)}
              >
                <SelectTrigger className="flex-1" aria-label="Invite role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <RoleSelectItems />
                </SelectContent>
              </Select>
              <Select
                value={String(inviteExpiresInHours)}
                onValueChange={(v) => setInviteExpiresInHours(Number(v))}
              >
                <SelectTrigger className="flex-1" aria-label="Link expiry">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              className="w-full"
              disabled={createInviteMutation.isPending}
              onClick={() => createInviteMutation.mutate()}
            >
              {createInviteMutation.isPending
                ? 'Creating link...'
                : 'Create link'}
            </Button>

            {createdInviteToken && (
              <div className="space-y-1">
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={`${window.location.origin}/invite/${createdInviteToken}`}
                    aria-label="Invite link"
                    className="flex-1 text-xs"
                    onFocus={(e) => e.target.select()}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleCopyInviteLink}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  This link won't be shown again — copy it now.
                </p>
              </div>
            )}
          </div>

          {/* Outstanding invite links */}
          <div>
            <Label className="text-sm font-medium">Outstanding links</Label>
            {isInvitesLoading ? (
              <p className="mt-2 text-sm text-muted-foreground">Loading...</p>
            ) : (
              <ul
                className="mt-2 space-y-2"
                aria-label="Outstanding invite links"
              >
                {invites.map((invite) => {
                  const isRevoked = invite.revokedAt !== null
                  const isExpired =
                    new Date(invite.expiresAt).getTime() < Date.now()
                  const isInactive = isRevoked || isExpired
                  return (
                    <li
                      key={invite.id}
                      className="flex items-center gap-2 rounded-md border px-3 py-2"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{invite.role}</Badge>
                          {isRevoked && (
                            <span className="text-xs text-destructive">
                              Revoked
                            </span>
                          )}
                          {!isRevoked && isExpired && (
                            <span className="text-xs text-muted-foreground">
                              Expired
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          Expires{' '}
                          {new Date(invite.expiresAt).toLocaleDateString()} ·{' '}
                          {invite.usedCount}
                          {invite.maxUses !== null
                            ? `/${invite.maxUses}`
                            : ''}{' '}
                          use{invite.usedCount === 1 ? '' : 's'}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => revokeInviteMutation.mutate(invite.id)}
                        aria-label={`Revoke ${invite.role} invite link`}
                        disabled={isInactive || revokeInviteMutation.isPending}
                      >
                        Revoke
                      </Button>
                    </li>
                  )
                })}

                {invites.length === 0 && (
                  <li className="text-sm text-muted-foreground py-2">
                    No outstanding links.
                  </li>
                )}
              </ul>
            )}
          </div>

          {/* Share read-only links (GH #109) */}
          <div className="space-y-3 border-t pt-6">
            <Label className="text-sm font-medium">Share read-only links</Label>
            <p className="text-xs text-muted-foreground">
              Anyone with the link can view a whiteboard's diagram — no account
              required. No editing, no live collaboration.
            </p>
            <div className="flex gap-2">
              <Select
                value={shareWhiteboardId}
                onValueChange={setShareWhiteboardId}
              >
                <SelectTrigger
                  className="flex-1"
                  aria-label="Select whiteboard"
                >
                  <SelectValue placeholder="Select whiteboard" />
                </SelectTrigger>
                <SelectContent>
                  {whiteboards.map((wb) => (
                    <SelectItem key={wb.id} value={wb.id}>
                      {wb.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={String(shareExpiresInHours)}
                onValueChange={(v) => setShareExpiresInHours(Number(v))}
              >
                <SelectTrigger
                  className="flex-1"
                  aria-label="Share link expiry"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              className="w-full"
              aria-label="Create read-only share link"
              disabled={
                !shareWhiteboardId ||
                isWhiteboardsLoading ||
                createShareLinkMutation.isPending
              }
              onClick={() => createShareLinkMutation.mutate()}
            >
              {createShareLinkMutation.isPending
                ? 'Creating link...'
                : 'Create link'}
            </Button>

            {createdShareToken && (
              <div className="space-y-1">
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={`${window.location.origin}/share/${createdShareToken}`}
                    aria-label="Share link"
                    className="flex-1 text-xs"
                    onFocus={(e) => e.target.select()}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleCopyShareLink}
                  >
                    {shareCopied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  This link won't be shown again — copy it now.
                </p>
              </div>
            )}
          </div>

          {/* Outstanding read-only links */}
          <div>
            <Label className="text-sm font-medium">
              Outstanding read-only links
            </Label>
            {isShareLinksLoading ? (
              <p className="mt-2 text-sm text-muted-foreground">Loading...</p>
            ) : (
              <ul
                className="mt-2 space-y-2"
                aria-label="Outstanding read-only links"
              >
                {shareLinks.map((link) => {
                  const isRevoked = link.revokedAt !== null
                  const isExpired =
                    new Date(link.expiresAt).getTime() < Date.now()
                  const isInactive = isRevoked || isExpired
                  return (
                    <li
                      key={link.id}
                      className="flex items-center gap-2 rounded-md border px-3 py-2"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">
                            {link.whiteboardName}
                          </Badge>
                          {isRevoked && (
                            <span className="text-xs text-destructive">
                              Revoked
                            </span>
                          )}
                          {!isRevoked && isExpired && (
                            <span className="text-xs text-muted-foreground">
                              Expired
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          Expires{' '}
                          {new Date(link.expiresAt).toLocaleDateString()}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => revokeShareLinkMutation.mutate(link.id)}
                        aria-label={`Revoke ${link.whiteboardName} share link`}
                        disabled={
                          isInactive || revokeShareLinkMutation.isPending
                        }
                      >
                        Revoke
                      </Button>
                    </li>
                  )
                })}

                {shareLinks.length === 0 && (
                  <li className="text-sm text-muted-foreground py-2">
                    No outstanding links.
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
