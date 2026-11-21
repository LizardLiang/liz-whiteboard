// src/lib/invite/email-invite-handlers.ts
// Grant-by-email server-fn HANDLER LOGIC. Kept out of src/routes/api/
// permissions.ts and src/routes/api/email-invites.ts for the same reason
// src/lib/invite/handlers.ts is kept out of src/routes/api/invites.ts: those
// route files are imported by client components, and the handler bodies pull
// in server-only modules (db, email) that must not reach the browser bundle.
//
// Anti-enumeration rule: grantPermissionHandler never reads the User table. An
// ADMIN/OWNER request that passes the role rules always returns
// `{ success: true, invited: true }`, whether the email is registered,
// unregistered or already a member. Every rule that depends on the TARGET's
// account (an existing ADMIN target, the target's current role) runs at accept
// time, when the target proves who they are. The only target-identity check at
// send time is "is this the owner's own email": the owner's email is already
// visible to every member in the Share panel, so refusing it leaks nothing.

import type { AuthContext } from '@/lib/auth/middleware'
import type {
  AcceptEmailInvite,
  GrantPermission,
  RevokeInvite,
} from '@/data/schema'
import type { InviteDenialReason } from '@/lib/invite/denial-reasons'
import type { Locale } from '@/lib/i18n/resolve-locale'
import { hasMinimumRole } from '@/lib/auth/permissions'
import { checkAdminRoleChange } from '@/lib/auth/admin-role-guard'
import { buildEmailInviteHtml } from '@/lib/auth/escape-html'
import { resolveBaseUrl } from '@/lib/auth/signup-flow'
import { findEffectiveRole, setProjectMemberRole } from '@/data/permission'
import { findProjectById } from '@/data/project'
import { findUserById } from '@/data/user'
import {
  EMAIL_INVITE_PENDING_MAX,
  claimEmailInvite,
  classifyEmailInvite,
  countPendingEmailInvites,
  findEmailInviteByTokenHash,
  findPendingEmailInvites,
  releaseEmailInvite,
  revokeEmailInvite,
  tryCreateEmailInvite,
} from '@/data/project-email-invite'
import { logSampledError } from '@/lib/auth/log-sample'
import { generateInviteToken, hashInviteToken } from '@/lib/auth/invite-token'
import { INVITE_DENIAL_MESSAGES } from '@/lib/invite/denial-reasons'
import { sendEmail } from '@/lib/email/resend'
import { getRequestLocale } from '@/lib/i18n/server-locale'
import { translate } from '@/lib/i18n/translate'

async function requestOrigin(): Promise<string | null> {
  try {
    const { getRequest } = await import('@tanstack/react-start/server')
    return new URL(getRequest().url).origin
  } catch {
    return null
  }
}

function forbidden(message: string) {
  return { error: 'FORBIDDEN' as const, status: 403, message }
}

function logCeiling(userId: string) {
  logSampledError({
    userId,
    errorClass: 'email-invite-recipient-ceiling',
    message: '[email-invite] recipient ceiling',
  })
}

function rateLimited(message: string) {
  return { error: 'RATE_LIMITED' as const, status: 429, message }
}

function deny(reason: InviteDenialReason) {
  return {
    success: false as const,
    error: reason,
    message: INVITE_DENIAL_MESSAGES[reason],
  }
}

function buildInviteMessage(params: {
  baseUrl: string
  rawToken: string
  inviter: string
  projectName: string
  role: string
  locale: Locale
}) {
  const { baseUrl, rawToken, locale } = params
  const acceptPath = `/invite/email/${rawToken}`
  const link = `${baseUrl}${acceptPath}`
  const registerLink = `${baseUrl}/register?redirect=${encodeURIComponent(acceptPath)}`
  const vars = {
    inviter: params.inviter,
    project: params.projectName,
    role: translate(locale, `invite.roles.${params.role}`),
  }
  return {
    subject: translate(locale, 'email.inviteSubject'),
    text: translate(locale, 'email.inviteText', {
      ...vars,
      link,
      registerLink,
    }),
    html: buildEmailInviteHtml({
      intro: translate(locale, 'email.inviteHtmlIntro', vars),
      link,
      registerHint: translate(locale, 'email.inviteHtmlRegister'),
      registerLink,
      outro: translate(locale, 'email.inviteHtmlOutro'),
    }),
  }
}

/**
 * Invite an email address to a project at a role. Requires ADMIN or OWNER;
 * granting ADMIN requires OWNER. The reply is the same for a registered, an
 * unregistered and an already-member address.
 *
 * @requires admin
 */
export async function grantPermissionHandler(
  { user }: AuthContext,
  data: GrantPermission,
) {
  const effectiveRole = await findEffectiveRole(user.id, data.projectId)
  if (!hasMinimumRole(effectiveRole, 'ADMIN')) {
    return forbidden('Only ADMIN or OWNER can grant permissions')
  }

  const project = await findProjectById(data.projectId)
  if (!project) return forbidden('Only ADMIN or OWNER can grant permissions')

  // The owner's email is shown to every member, so refusing it reveals nothing.
  const owner = project.ownerId ? await findUserById(project.ownerId) : null
  if (owner && owner.email.toLowerCase() === data.email) {
    return forbidden("Cannot modify the project owner's access")
  }

  // Depends only on the caller and the requested role, never on the target.
  const adminDenial = checkAdminRoleChange(effectiveRole, {
    newRole: data.role,
    targetRole: null,
  })
  if (adminDenial) return adminDenial

  if (countPendingEmailInvites(data.projectId) >= EMAIL_INVITE_PENDING_MAX) {
    return {
      error: 'FORBIDDEN' as const,
      status: 403,
      message: 'Too many pending invites. Revoke some before sending more.',
    }
  }

  const rawToken = generateInviteToken()
  const created = tryCreateEmailInvite({
    projectId: data.projectId,
    email: data.email,
    role: data.role,
    tokenHash: hashInviteToken(rawToken),
    invitedByUserId: user.id,
  })
  // Inside the (project, address) cooldown the reply is the same as for a
  // send, so it cannot be told apart; nothing goes out.
  if (created.status === 'cooldown') {
    return { success: true as const, invited: true as const }
  }
  // These limits describe the inviter's own sending, or the volume sent to an
  // address; neither says whether the address has an account.
  if (created.status === 'inviter_limit') {
    return rateLimited('Too many invites sent. Try again later.')
  }
  if (created.status === 'recipient_limit') {
    return rateLimited('Too many invites to this address recently.')
  }

  if (created.status === 'suppressed') {
    logCeiling(user.id)
    return { success: true as const, invited: true as const }
  }

  // Silent per-address ceiling: the row exists, no email goes out, and the
  // reply is the same, so no tenant can make another tenant's invite fail.
  if (created.suppressEmail) {
    logCeiling(user.id)
    return { success: true as const, invited: true as const }
  }

  const baseUrl = resolveBaseUrl(await requestOrigin())
  if (!baseUrl) {
    console.error('[invite] APP_BASE_URL is not set — invite email not sent.')
  } else {
    const message = buildInviteMessage({
      baseUrl,
      rawToken,
      inviter: user.username,
      projectName: project.name,
      role: data.role,
      locale: await getRequestLocale(),
    })
    void sendEmail({ to: data.email, ...message }).catch((err: unknown) => {
      console.error('[invite] sendEmail failed:', err)
    })
  }

  return { success: true as const, invited: true as const }
}

/**
 * List the pending email invites of a project. Never returns the token hash.
 *
 * @requires admin
 */
export async function listEmailInvitesHandler(
  { user }: AuthContext,
  projectId: string,
) {
  const role = await findEffectiveRole(user.id, projectId)
  if (!hasMinimumRole(role, 'ADMIN')) {
    return forbidden('Only ADMIN or OWNER can view invite links')
  }
  return {
    invites: findPendingEmailInvites(projectId).map((invite) => ({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt,
      createdAt: invite.createdAt,
    })),
  }
}

/**
 * Revoke a pending email invite. Idempotent.
 *
 * @requires admin
 */
export async function revokeEmailInviteHandler(
  { user }: AuthContext,
  data: RevokeInvite,
) {
  const role = await findEffectiveRole(user.id, data.projectId)
  if (!hasMinimumRole(role, 'ADMIN')) {
    return forbidden('Only ADMIN or OWNER can revoke invite links')
  }
  revokeEmailInvite(data.projectId, data.inviteId)
  return { success: true as const }
}

type Checked =
  | {
      ok: true
      invite: NonNullable<ReturnType<typeof findEmailInviteByTokenHash>>
      projectName: string
    }
  | {
      ok: false
      denial:
        | ReturnType<typeof deny>
        | (ReturnType<typeof forbidden> & { success: false })
    }

/**
 * Every accept-time rule, shared by the preview and the accept. Nothing here
 * writes. The token holder learns only whether THEIR link works.
 */
async function checkInvite(
  user: AuthContext['user'],
  token: string,
): Promise<Checked> {
  const invite = findEmailInviteByTokenHash(hashInviteToken(token))
  if (!invite) return { ok: false, denial: deny('INVALID') }

  const state = classifyEmailInvite(invite)
  if (state === 'used') return { ok: false, denial: deny('EXHAUSTED') }
  if (state === 'revoked') return { ok: false, denial: deny('REVOKED') }
  if (state === 'expired') return { ok: false, denial: deny('EXPIRED') }

  if (invite.email !== user.email.toLowerCase()) {
    return { ok: false, denial: deny('WRONG_ACCOUNT') }
  }

  const project = await findProjectById(invite.projectId)
  if (!project) return { ok: false, denial: deny('INVALID') }
  if (project.ownerId === user.id) {
    return {
      ok: false,
      denial: {
        success: false as const,
        ...forbidden("Cannot modify the project owner's access"),
      },
    }
  }

  // The inviter must still be allowed to grant this role.
  const inviterRole = await findEffectiveRole(
    invite.invitedByUserId,
    invite.projectId,
  )
  if (!hasMinimumRole(inviterRole, 'ADMIN')) {
    return { ok: false, denial: deny('REVOKED') }
  }
  const targetRole = await findEffectiveRole(user.id, invite.projectId)
  const adminDenial = checkAdminRoleChange(inviterRole, {
    newRole: invite.role,
    targetRole,
  })
  if (adminDenial) {
    return { ok: false, denial: { success: false as const, ...adminDenial } }
  }

  return { ok: true, invite, projectName: project.name }
}

/**
 * Preview an email invite for the logged-in visitor: project name and role
 * when the link works for THIS account, else the reason it does not.
 *
 * @requires authenticated
 */
export async function previewEmailInviteHandler(
  { user }: AuthContext,
  token: string,
) {
  const checked = await checkInvite(user, token)
  if (!checked.ok) {
    return {
      valid: false as const,
      reason:
        checked.denial.error === 'FORBIDDEN'
          ? ('INVALID' as const)
          : checked.denial.error,
      message: checked.denial.message,
    }
  }
  return {
    valid: true as const,
    projectName: checked.projectName,
    role: checked.invite.role,
  }
}

/**
 * Accept an email invite. The session email must equal the invited email
 * (case-insensitive). The owner guard and role rules run again, then the role
 * is written and acceptedAt is set. A wrong user, or an expired, revoked or
 * used invite, grants nothing.
 *
 * @requires authenticated
 */
export async function acceptEmailInviteHandler(
  { user }: AuthContext,
  data: AcceptEmailInvite,
) {
  const checked = await checkInvite(user, data.token)
  if (!checked.ok) return checked.denial
  const { invite } = checked

  // Exactly one caller wins the claim, so a replayed link cannot join twice.
  if (!claimEmailInvite(invite.id)) return deny('EXHAUSTED')
  try {
    await setProjectMemberRole({
      projectId: invite.projectId,
      userId: user.id,
      role: invite.role,
    })
  } catch (error) {
    releaseEmailInvite(invite.id)
    throw error
  }
  return {
    success: true as const,
    projectId: invite.projectId,
    role: invite.role,
  }
}
