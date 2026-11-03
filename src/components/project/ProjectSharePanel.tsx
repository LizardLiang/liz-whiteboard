// src/components/project/ProjectSharePanel.tsx
// Share panel for managing project-level permissions

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
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
import { copyText } from '@/lib/copy-text'
import { useI18n, useT } from '@/lib/i18n/use-t'
import { tError } from '@/lib/i18n/t-error'

const EXPIRY_OPTIONS = [
  { value: 1, labelKey: 'project.share.expiry.hour1' },
  { value: 24, labelKey: 'project.share.expiry.hours24' },
  { value: 24 * 7, labelKey: 'project.share.expiry.days7' },
  { value: 24 * 30, labelKey: 'project.share.expiry.days30' },
] as const satisfies ReadonlyArray<{
  value: InviteExpiryHours
  labelKey: string
}>

/** VIEWER/EDITOR/ADMIN role choices — shared by every role Select in this
 * panel (add-a-person, existing-member role change, invite-link role). */
const ROLE_OPTIONS: Array<ProjectRole> = ['VIEWER', 'EDITOR', 'ADMIN']

function RoleSelectItems() {
  const t = useT()
  return (
    <>
      {ROLE_OPTIONS.map((role) => (
        <SelectItem key={role} value={role}>
          {t(`invite.roles.${role}`)}
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
  expiresAt: string | Date | null
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
  const { t, locale } = useI18n()
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
      if ('error' in result) {
        setAddError((result as { message?: string }).message ?? '')
        return
      }
      setAddEmail('')
      setAddRole('VIEWER')
      setAddError(null)
      invalidate()
    },
    onError: () => setAddError(''),
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
    const didCopy = await copyText(url)
    if (!didCopy) {
      toast.error(t('project.share.copyFailed'))
      return
    }
    setCopied(true)
  }

  const handleCopyShareLink = async () => {
    if (!createdShareToken) return
    const url = `${window.location.origin}/share/${createdShareToken}`
    const didCopy = await copyText(url)
    if (!didCopy) {
      toast.error(t('project.share.copyFailed'))
      return
    }
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
      <SheetContent className="w-full gap-0 sm:max-w-lg" side="right">
        <SheetHeader className="px-6 pt-6 pb-4">
          <SheetTitle>{t('project.share.title')}</SheetTitle>
          <SheetDescription>{t('project.share.description')}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 pt-2 pb-6">
          {/* Add user form */}
          <form onSubmit={handleAddUser} className="space-y-3">
            <Label className="text-sm font-medium">
              {t('project.share.addPerson')}
            </Label>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="email@example.com"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                className="flex-1"
                aria-label={t('project.share.emailAria')}
              />
              <Select
                value={addRole}
                onValueChange={(v) => setAddRole(v as ProjectRole)}
              >
                <SelectTrigger
                  className="w-28"
                  aria-label={t('project.share.selectRole')}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <RoleSelectItems />
                </SelectContent>
              </Select>
            </div>
            {addError !== null && (
              <p
                role="alert"
                aria-live="polite"
                className="text-xs text-destructive"
              >
                {tError(t, { message: addError }) ||
                  t('project.share.addFailed')}
              </p>
            )}
            <Button
              type="submit"
              size="sm"
              disabled={!addEmail || grantMutation.isPending}
              className="w-full"
            >
              {grantMutation.isPending
                ? t('project.share.adding')
                : t('project.share.add')}
            </Button>
          </form>

          {/* Current members */}
          <div>
            <Label className="text-sm font-medium">
              {t('project.share.currentAccess')}
            </Label>
            {isLoading ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {t('common.loading')}
              </p>
            ) : (
              <ul
                className="mt-2 space-y-2"
                aria-label={t('project.share.membersAria')}
              >
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
                    <Badge variant="secondary">
                      {t('project.share.owner')}
                    </Badge>
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
                        aria-label={t('project.share.changeRole', {
                          name: member.username,
                        })}
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
                      aria-label={t('project.share.remove', {
                        name: member.username,
                      })}
                      disabled={revokeMutation.isPending}
                    >
                      ×
                    </Button>
                  </li>
                ))}

                {permissions.members.length === 0 && !permissions.owner && (
                  <li className="text-sm text-muted-foreground py-2">
                    {t('project.share.noMembers')}
                  </li>
                )}
              </ul>
            )}
          </div>

          {/* Create invite link */}
          <div className="space-y-3 border-t pt-6">
            <Label className="text-sm font-medium">
              {t('project.share.inviteByLink')}
            </Label>
            <div className="flex gap-2">
              <Select
                value={inviteRole}
                onValueChange={(v) => setInviteRole(v as ProjectRole)}
              >
                <SelectTrigger
                  className="flex-1"
                  aria-label={t('project.share.inviteRole')}
                >
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
                <SelectTrigger
                  className="flex-1"
                  aria-label={t('project.share.linkExpiry')}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>
                      {t(opt.labelKey)}
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
                ? t('project.share.creatingLink')
                : t('project.share.createLink')}
            </Button>

            {createdInviteToken && (
              <div className="space-y-1">
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={`${window.location.origin}/invite/${createdInviteToken}`}
                    aria-label={t('project.share.inviteLinkAria')}
                    className="flex-1 text-xs"
                    onFocus={(e) => e.target.select()}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleCopyInviteLink}
                  >
                    {copied
                      ? t('project.share.copied')
                      : t('project.share.copy')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('project.share.wontShowAgain')}
                </p>
              </div>
            )}
          </div>

          {/* Outstanding invite links */}
          <div>
            <Label className="text-sm font-medium">
              {t('project.share.outstandingLinks')}
            </Label>
            {isInvitesLoading ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {t('common.loading')}
              </p>
            ) : (
              <ul
                className="mt-2 space-y-2"
                aria-label={t('project.share.outstandingInviteAria')}
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
                          <Badge variant="secondary">
                            {t(`invite.roles.${invite.role}`)}
                          </Badge>
                          {isRevoked && (
                            <span className="text-xs text-destructive">
                              {t('project.share.revoked')}
                            </span>
                          )}
                          {!isRevoked && isExpired && (
                            <span className="text-xs text-muted-foreground">
                              {t('project.share.expired')}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {t('project.share.inviteMeta', {
                            date: new Date(invite.expiresAt).toLocaleDateString(
                              locale,
                            ),
                            uses: t(
                              invite.usedCount === 1
                                ? 'project.share.usesOne'
                                : 'project.share.usesOther',
                              {
                                count:
                                  invite.maxUses !== null
                                    ? `${invite.usedCount}/${invite.maxUses}`
                                    : invite.usedCount,
                              },
                            ),
                          })}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => revokeInviteMutation.mutate(invite.id)}
                        aria-label={t('project.share.revokeInviteAria', {
                          role: t(`invite.roles.${invite.role}`),
                        })}
                        disabled={isInactive || revokeInviteMutation.isPending}
                      >
                        {t('project.share.revoke')}
                      </Button>
                    </li>
                  )
                })}

                {invites.length === 0 && (
                  <li className="text-sm text-muted-foreground py-2">
                    {t('project.share.noOutstanding')}
                  </li>
                )}
              </ul>
            )}
          </div>

          {/* Share read-only links (GH #109) */}
          <div className="space-y-3 border-t pt-6">
            <Label className="text-sm font-medium">
              {t('project.share.shareReadOnly')}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t('project.share.readOnlyHint')}
            </p>
            <div className="flex gap-2">
              <Select
                value={shareWhiteboardId}
                onValueChange={setShareWhiteboardId}
              >
                <SelectTrigger
                  className="flex-1"
                  aria-label={t('project.share.selectWhiteboard')}
                >
                  <SelectValue
                    placeholder={t('project.share.selectWhiteboard')}
                  />
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
                  aria-label={t('project.share.shareExpiryAria')}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>
                      {t(opt.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              className="w-full"
              aria-label={t('project.share.createShareAria')}
              disabled={
                !shareWhiteboardId ||
                isWhiteboardsLoading ||
                createShareLinkMutation.isPending
              }
              onClick={() => createShareLinkMutation.mutate()}
            >
              {createShareLinkMutation.isPending
                ? t('project.share.creatingLink')
                : t('project.share.createLink')}
            </Button>

            {createdShareToken && (
              <div className="space-y-1">
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={`${window.location.origin}/share/${createdShareToken}`}
                    aria-label={t('project.share.shareLinkAria')}
                    className="flex-1 text-xs"
                    onFocus={(e) => e.target.select()}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleCopyShareLink}
                  >
                    {shareCopied
                      ? t('project.share.copied')
                      : t('project.share.copy')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('project.share.wontShowAgain')}
                </p>
              </div>
            )}
          </div>

          {/* Outstanding read-only links */}
          <div>
            <Label className="text-sm font-medium">
              {t('project.share.outstandingReadOnly')}
            </Label>
            {isShareLinksLoading ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {t('common.loading')}
              </p>
            ) : (
              <ul
                className="mt-2 space-y-2"
                aria-label={t('project.share.outstandingReadOnlyAria')}
              >
                {shareLinks.map((link) => {
                  const isRevoked = link.revokedAt !== null
                  const isExpired =
                    link.expiresAt !== null &&
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
                              {t('project.share.revoked')}
                            </span>
                          )}
                          {!isRevoked && isExpired && (
                            <span className="text-xs text-muted-foreground">
                              {t('project.share.expired')}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {link.expiresAt === null
                            ? t('project.share.neverExpires')
                            : t('project.share.expiresOn', {
                                date: new Date(
                                  link.expiresAt,
                                ).toLocaleDateString(locale),
                              })}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => revokeShareLinkMutation.mutate(link.id)}
                        aria-label={t('project.share.revokeShareAria', {
                          name: link.whiteboardName,
                        })}
                        disabled={
                          isInactive || revokeShareLinkMutation.isPending
                        }
                      >
                        {t('project.share.revoke')}
                      </Button>
                    </li>
                  )
                })}

                {shareLinks.length === 0 && (
                  <li className="text-sm text-muted-foreground py-2">
                    {t('project.share.noOutstanding')}
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
