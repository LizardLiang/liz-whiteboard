// @vitest-environment node
// src/lib/invite/email-invite-handlers.test.ts
// Grant-by-email against the real test DB. Only the email sender is mocked.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  acceptEmailInviteHandler,
  grantPermissionHandler,
  listEmailInvitesHandler,
  previewEmailInviteHandler,
  revokeEmailInviteHandler,
} from './email-invite-handlers'
import type { AuthContext } from '@/lib/auth/middleware'
import { findEffectiveRole, upsertProjectMember } from '@/data/permission'
import { createEmailInvite } from '@/data/project-email-invite'
import { db } from '@/db'
import { makeProject, makeUser, resetDb } from '@/test/db-helpers'

const sendEmail = vi.hoisted(() => vi.fn())
vi.mock('@/lib/email/resend', () => ({ sendEmail }))

function ctx(u: { id: string; username?: string; email: string }): AuthContext {
  return {
    user: { id: u.id, username: u.username ?? 'someone', email: u.email },
    session: { id: 's', expiresAt: new Date(Date.now() + 3_600_000) },
  }
}

let owner: { id: string }
let admin: { id: string }
let projectId: string
const ownerEmail = 'owner@example.com'
const adminEmail = 'admin@example.com'

beforeEach(async () => {
  resetDb()
  sendEmail.mockReset()
  sendEmail.mockResolvedValue(undefined)
  vi.stubEnv('APP_BASE_URL', 'https://app.example.com')
  owner = makeUser({ email: ownerEmail, username: 'owner' })
  admin = makeUser({ email: adminEmail, username: 'adminuser' })
  projectId = makeProject({ ownerId: owner.id, name: 'Acme <b>' }).id
  await upsertProjectMember({ projectId, userId: admin.id, role: 'ADMIN' })
})

const asAdmin = () =>
  ctx({ id: admin.id, username: 'adminuser', email: adminEmail })
const asOwner = () =>
  ctx({ id: owner.id, username: 'owner', email: ownerEmail })

const grant = (
  email: string,
  role: 'VIEWER' | 'EDITOR' | 'ADMIN',
  c = asAdmin(),
) => grantPermissionHandler(c, { projectId, email, role })

/** Move every invite row back in time so the send cooldown no longer applies. */
function age(ms: number) {
  db.prepare(
    'UPDATE "ProjectEmailInvite" SET "createdAt" = "createdAt" - ?',
  ).run(ms)
}

const MIN = 60_000

function seedRows(
  n: number,
  over: { email?: (i: number) => string; by?: string; projectId?: string },
) {
  for (let i = 0; i < n; i++) {
    createEmailInvite({
      projectId: over.projectId ?? projectId,
      email: over.email ? over.email(i) : `seed${i}@example.com`,
      role: 'VIEWER',
      tokenHash: `seed-${Math.random()}`,
      invitedByUserId: over.by ?? admin.id,
    })
  }
}

function sentToken(call = 0): string {
  const text = sendEmail.mock.calls[call][0].text as string
  return /\/invite\/email\/([0-9a-f]{64})/.exec(text)![1]
}

describe('grantPermission by email', () => {
  it('returns the same reply for a registered, an unregistered and a member address', async () => {
    makeUser({ email: 'known@example.com' })
    const member = makeUser({ email: 'member@example.com' })
    await upsertProjectMember({ projectId, userId: member.id, role: 'EDITOR' })

    const a = await grant('known@example.com', 'VIEWER')
    const b = await grant('nobody@example.com', 'VIEWER')
    const c = await grant('member@example.com', 'VIEWER')
    expect(a).toEqual({ success: true, invited: true })
    expect(b).toEqual(a)
    expect(c).toEqual(a)
  })

  it('adds no member and sends one email per invite', async () => {
    const known = makeUser({ email: 'known@example.com' })
    await grant('known@example.com', 'EDITOR')
    expect(await findEffectiveRole(known.id, projectId)).toBeNull()
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0][0].to).toBe('known@example.com')
  })

  it('sends the same kind of email to registered and unregistered addresses', async () => {
    makeUser({ email: 'known@example.com' })
    await grant('known@example.com', 'EDITOR')
    await grant('nobody@example.com', 'EDITOR')
    const strip = (m: { text: string }) =>
      m.text.replace(/[0-9a-f]{64}/g, 'T').replace(/known|nobody/g, 'X')
    expect(strip(sendEmail.mock.calls[0][0])).toBe(
      strip(sendEmail.mock.calls[1][0]),
    )
    expect(sendEmail.mock.calls[0][0].text).toContain('/register?redirect=')
  })

  it('escapes the project name in the HTML body', async () => {
    await grant('nobody@example.com', 'VIEWER')
    const html = sendEmail.mock.calls[0][0].html as string
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;b&gt;')
  })

  it('never returns USER_NOT_FOUND', async () => {
    const result = await grant('nobody@example.com', 'VIEWER')
    expect(result).not.toHaveProperty('error')
  })

  it('refuses a non-admin caller', async () => {
    const editor = makeUser({ email: 'ed@example.com' })
    await upsertProjectMember({ projectId, userId: editor.id, role: 'EDITOR' })
    const result = await grant(
      'x@example.com',
      'VIEWER',
      ctx({ id: editor.id, email: 'ed@example.com' }),
    )
    expect(result).toMatchObject({ error: 'FORBIDDEN' })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('refuses the owner email, any case', async () => {
    const result = await grant('Owner@Example.com'.toLowerCase(), 'EDITOR')
    expect(result).toMatchObject({ error: 'FORBIDDEN' })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('refuses ADMIN from an ADMIN, allows it from the OWNER', async () => {
    expect(await grant('x@example.com', 'ADMIN')).toMatchObject({
      error: 'FORBIDDEN',
    })
    expect(await grant('x@example.com', 'ADMIN', asOwner())).toEqual({
      success: true,
      invited: true,
    })
  })

  it('does not deny at send time when the target is an existing ADMIN (checked at accept)', async () => {
    const other = makeUser({ email: 'otheradmin@example.com' })
    await upsertProjectMember({ projectId, userId: other.id, role: 'ADMIN' })
    expect(await grant('otheradmin@example.com', 'VIEWER')).toEqual({
      success: true,
      invited: true,
    })
  })

  it('voids the older pending invite of the same address', async () => {
    await grant('nobody@example.com', 'VIEWER')
    age(11 * MIN)
    await grant('nobody@example.com', 'EDITOR')
    const target = makeUser({ email: 'nobody@example.com' })
    const old = await acceptEmailInviteHandler(
      ctx({ id: target.id, email: 'nobody@example.com' }),
      { token: sentToken(0) },
    )
    expect(old).toMatchObject({ success: false, error: 'REVOKED' })
    const fresh = await acceptEmailInviteHandler(
      ctx({ id: target.id, email: 'nobody@example.com' }),
      { token: sentToken(1) },
    )
    expect(fresh).toMatchObject({ success: true, role: 'EDITOR' })
  })
})

describe('send limits', () => {
  it('inside the (project, address) cooldown the reply is the same and nothing is sent', async () => {
    const first = await grant('nobody@example.com', 'VIEWER')
    const again = await grant('nobody@example.com', 'EDITOR')
    expect(again).toEqual(first)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(
      Number(
        (
          db
            .prepare('SELECT count(*) AS c FROM "ProjectEmailInvite"')
            .get() as { c: number }
        ).c,
      ),
    ).toBe(1)
    age(11 * MIN)
    await grant('nobody@example.com', 'EDITOR')
    expect(sendEmail).toHaveBeenCalledTimes(2)
  })

  it('per inviter: 20 per hour', async () => {
    seedRows(20, {})
    const result = await grant('fresh@example.com', 'VIEWER')
    expect(result).toMatchObject({ error: 'RATE_LIMITED', status: 429 })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('per inviter: 100 per 24 hours, counting voided and accepted rows', async () => {
    seedRows(100, {})
    db.prepare(
      'UPDATE "ProjectEmailInvite" SET "createdAt" = "createdAt" - ?, "revokedAt" = 1',
    ).run(2 * 60 * MIN)
    const result = await grant('fresh@example.com', 'VIEWER')
    expect(result).toMatchObject({ error: 'RATE_LIMITED' })
  })

  it('per inviter: other inviters are not affected', async () => {
    seedRows(20, {})
    const other = makeUser({ email: 'o2@example.com', username: 'o2' })
    await upsertProjectMember({ projectId, userId: other.id, role: 'ADMIN' })
    const result = await grant(
      'fresh@example.com',
      'VIEWER',
      ctx({ id: other.id, email: 'o2@example.com' }),
    )
    expect(result).toEqual({ success: true, invited: true })
  })

  it('per (inviter, address): 3 per hour', async () => {
    for (let i = 0; i < 3; i++) {
      const p = makeProject({ ownerId: owner.id }).id
      seedRows(1, {
        projectId: p,
        by: admin.id,
        email: () => 'victim@example.com',
      })
    }
    const result = await grant('victim@example.com', 'VIEWER')
    expect(result).toMatchObject({ error: 'RATE_LIMITED', status: 429 })
    expect(result).toHaveProperty(
      'message',
      'Too many invites to this address recently.',
    )
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('per (inviter, address): 10 per 24 hours', async () => {
    for (let i = 0; i < 10; i++) {
      const p = makeProject({ ownerId: owner.id }).id
      seedRows(1, {
        projectId: p,
        by: admin.id,
        email: () => 'victim@example.com',
      })
    }
    age(2 * 60 * MIN)
    const result = await grant('victim@example.com', 'VIEWER')
    expect(result).toMatchObject({ error: 'RATE_LIMITED' })
  })

  it("inviter A's 3 invites do not stop inviter B's invite to the same address", async () => {
    for (let i = 0; i < 3; i++) {
      const p = makeProject({ ownerId: owner.id }).id
      seedRows(1, {
        projectId: p,
        by: owner.id,
        email: () => 'victim@example.com',
      })
    }
    expect(await grant('victim@example.com', 'VIEWER')).toEqual({
      success: true,
      invited: true,
    })
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('silent ceiling: 30 per 24 h to one address stores the row, sends nothing, replies the same', async () => {
    for (let i = 0; i < 30; i++) {
      const u = makeUser()
      const p = makeProject({ ownerId: u.id }).id
      seedRows(1, { projectId: p, by: u.id, email: () => 'victim@example.com' })
    }
    const result = await grant('victim@example.com', 'VIEWER')
    expect(result).toEqual({ success: true, invited: true })
    expect(sendEmail).not.toHaveBeenCalled()
    const row = db
      .prepare(
        'SELECT count(*) AS c FROM "ProjectEmailInvite" WHERE "projectId" = ?',
      )
      .get(projectId) as { c: number }
    expect(Number(row.c)).toBe(1)
  })

  function seedCeiling(n: number) {
    for (let i = 0; i < n; i++) {
      const u = makeUser()
      const p = makeProject({ ownerId: u.id }).id
      seedRows(1, { projectId: p, by: u.id, email: () => 'victim@example.com' })
    }
  }

  it('the ceiling hit while a sent pending invite exists keeps the old link working', async () => {
    const target = makeUser({ email: 'victim@example.com' })
    await grant('victim@example.com', 'VIEWER')
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const token = sentToken()
    age(11 * MIN)
    seedCeiling(30)
    db.prepare(
      'UPDATE "ProjectEmailInvite" SET "createdAt" = "createdAt" + ? WHERE "projectId" != ?',
    ).run(11 * MIN, projectId)
    const result = await grant('victim@example.com', 'VIEWER')
    expect(result).toEqual({ success: true, invited: true })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const rows = db
      .prepare(
        'SELECT count(*) AS c FROM "ProjectEmailInvite" WHERE "projectId" = ?',
      )
      .get(projectId) as { c: number }
    expect(Number(rows.c)).toBe(1)
    expect(
      await acceptEmailInviteHandler(
        ctx({ id: target.id, email: 'victim@example.com' }),
        { token },
      ),
    ).toMatchObject({ success: true })
  })

  it('the hourly ceiling (5 per hour across inviters) suppresses silently', async () => {
    seedCeiling(5)
    const result = await grant('victim@example.com', 'VIEWER')
    expect(result).toEqual({ success: true, invited: true })
    expect(sendEmail).not.toHaveBeenCalled()
    const list = (await listEmailInvitesHandler(asAdmin(), projectId)) as any
    expect(list.invites).toHaveLength(1)
  })

  it('a suppressed role change updates the pending role and keeps the token', async () => {
    const target = makeUser({ email: 'victim@example.com' })
    await grant('victim@example.com', 'VIEWER')
    const token = sentToken()
    age(11 * MIN)
    seedCeiling(5)
    db.prepare(
      'UPDATE "ProjectEmailInvite" SET "createdAt" = "createdAt" + ? WHERE "projectId" != ?',
    ).run(11 * MIN, projectId)
    await grant('victim@example.com', 'EDITOR')
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const result = await acceptEmailInviteHandler(
      ctx({ id: target.id, email: 'victim@example.com' }),
      { token },
    )
    expect(result).toMatchObject({ success: true, role: 'EDITOR' })
  })

  it('the limit message is the same for a registered and an unregistered recipient', async () => {
    makeUser({ email: 'known@example.com' })
    for (const email of ['known@example.com', 'ghost@example.com']) {
      for (let i = 0; i < 3; i++) {
        const p = makeProject({ ownerId: owner.id }).id
        seedRows(1, { projectId: p, by: admin.id, email: () => email })
      }
    }
    const a = await grant('known@example.com', 'VIEWER')
    const b = await grant('ghost@example.com', 'VIEWER')
    expect(a).toEqual(b)
  })

  it('a role change inside the cooldown updates the pending row; the original link accepts with the new role', async () => {
    const target = makeUser({ email: 'known@example.com' })
    await grant('known@example.com', 'VIEWER')
    const again = await grant('known@example.com', 'EDITOR')
    expect(again).toEqual({ success: true, invited: true })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const list = (await listEmailInvitesHandler(asAdmin(), projectId)) as any
    expect(list.invites).toHaveLength(1)
    expect(list.invites[0].role).toBe('EDITOR')
    const result = await acceptEmailInviteHandler(
      ctx({ id: target.id, email: 'known@example.com' }),
      { token: sentToken() },
    )
    expect(result).toMatchObject({ success: true, role: 'EDITOR' })
  })

  it('a role change inside the cooldown still obeys the role rules', async () => {
    await grant('known@example.com', 'VIEWER')
    expect(await grant('known@example.com', 'ADMIN')).toMatchObject({
      error: 'FORBIDDEN',
    })
    const list = (await listEmailInvitesHandler(asAdmin(), projectId)) as any
    expect(list.invites[0].role).toBe('VIEWER')
  })
})

describe('accept', () => {
  it('the invited user becomes a member at the invited role', async () => {
    const target = makeUser({ email: 'known@example.com' })
    await grant('known@example.com', 'EDITOR')
    const result = await acceptEmailInviteHandler(
      ctx({ id: target.id, email: 'Known@Example.com' }),
      { token: sentToken() },
    )
    expect(result).toMatchObject({ success: true, projectId, role: 'EDITOR' })
    expect(await findEffectiveRole(target.id, projectId)).toBe('EDITOR')
  })

  it('a forwarded link opened by a different user grants nothing', async () => {
    await grant('known@example.com', 'EDITOR')
    const thief = makeUser({ email: 'thief@example.com' })
    const result = await acceptEmailInviteHandler(
      ctx({ id: thief.id, email: 'thief@example.com' }),
      { token: sentToken() },
    )
    expect(result).toMatchObject({ success: false, error: 'WRONG_ACCOUNT' })
    expect(await findEffectiveRole(thief.id, projectId)).toBeNull()
  })

  it('is single-use', async () => {
    const target = makeUser({ email: 'known@example.com' })
    await grant('known@example.com', 'EDITOR')
    const c = ctx({ id: target.id, email: 'known@example.com' })
    await acceptEmailInviteHandler(c, { token: sentToken() })
    expect(
      await acceptEmailInviteHandler(c, { token: sentToken() }),
    ).toMatchObject({ success: false, error: 'EXHAUSTED' })
  })

  it('refuses an expired and a revoked invite', async () => {
    const target = makeUser({ email: 'known@example.com' })
    const c = ctx({ id: target.id, email: 'known@example.com' })
    await grant('known@example.com', 'EDITOR')
    db.prepare('UPDATE "ProjectEmailInvite" SET "expiresAt" = 1').run()
    expect(
      await acceptEmailInviteHandler(c, { token: sentToken(0) }),
    ).toMatchObject({ success: false, error: 'EXPIRED' })

    age(11 * MIN)
    await grant('known@example.com', 'EDITOR')
    const list = await listEmailInvitesHandler(asAdmin(), projectId)
    await revokeEmailInviteHandler(asAdmin(), {
      projectId,
      inviteId: (list as any).invites[0].id,
    })
    expect(
      await acceptEmailInviteHandler(c, { token: sentToken(1) }),
    ).toMatchObject({ success: false, error: 'REVOKED' })
    expect(await findEffectiveRole(target.id, projectId)).toBeNull()
  })

  it('an unknown token grants nothing', async () => {
    const target = makeUser({ email: 'known@example.com' })
    expect(
      await acceptEmailInviteHandler(
        ctx({ id: target.id, email: 'known@example.com' }),
        { token: 'nope' },
      ),
    ).toMatchObject({ success: false, error: 'INVALID' })
  })

  it('an ADMIN-invited change of an existing ADMIN is refused at accept time', async () => {
    const other = makeUser({ email: 'otheradmin@example.com' })
    await upsertProjectMember({ projectId, userId: other.id, role: 'ADMIN' })
    await grant('otheradmin@example.com', 'VIEWER')
    const result = await acceptEmailInviteHandler(
      ctx({ id: other.id, email: 'otheradmin@example.com' }),
      { token: sentToken() },
    )
    expect(result).toMatchObject({ success: false, error: 'FORBIDDEN' })
    expect(await findEffectiveRole(other.id, projectId)).toBe('ADMIN')
  })

  it('refuses when the inviter lost the ADMIN role', async () => {
    const target = makeUser({ email: 'known@example.com' })
    await grant('known@example.com', 'EDITOR')
    db.prepare('DELETE FROM "ProjectMember" WHERE "userId" = ?').run(admin.id)
    const result = await acceptEmailInviteHandler(
      ctx({ id: target.id, email: 'known@example.com' }),
      { token: sentToken() },
    )
    expect(result).toMatchObject({ success: false })
    expect(await findEffectiveRole(target.id, projectId)).toBeNull()
  })

  it('the owner guard runs again at accept time', async () => {
    await grant('known@example.com', 'EDITOR')
    db.prepare('UPDATE "Project" SET "ownerId" = ? WHERE "id" = ?').run(
      makeUser({ email: 'known@example.com', username: 'k2' }).id,
      projectId,
    )
    const ownerNow = db
      .prepare('SELECT "ownerId" FROM "Project" WHERE "id" = ?')
      .get(projectId) as { ownerId: string }
    const result = await acceptEmailInviteHandler(
      ctx({ id: ownerNow.ownerId, email: 'known@example.com' }),
      { token: sentToken() },
    )
    expect(result).toMatchObject({ success: false, error: 'FORBIDDEN' })
  })
})

describe('preview, list and revoke', () => {
  it('preview shows project and role to the right user only', async () => {
    const target = makeUser({ email: 'known@example.com' })
    await grant('known@example.com', 'VIEWER')
    expect(
      await previewEmailInviteHandler(
        ctx({ id: target.id, email: 'known@example.com' }),
        sentToken(),
      ),
    ).toMatchObject({ valid: true, projectName: 'Acme <b>', role: 'VIEWER' })
    expect(
      await previewEmailInviteHandler(
        ctx({ id: owner.id, email: ownerEmail }),
        sentToken(),
      ),
    ).toMatchObject({ valid: false, reason: 'WRONG_ACCOUNT' })
  })

  it('list shows email, role and expiry, never the hash; non-admins are refused', async () => {
    await grant('a@example.com', 'EDITOR')
    const list = (await listEmailInvitesHandler(asAdmin(), projectId)) as any
    expect(list.invites).toHaveLength(1)
    expect(Object.keys(list.invites[0]).sort()).toEqual([
      'createdAt',
      'email',
      'expiresAt',
      'id',
      'role',
    ])
    const ed = makeUser({ email: 'ed@example.com' })
    expect(
      await listEmailInvitesHandler(
        ctx({ id: ed.id, email: 'ed@example.com' }),
        projectId,
      ),
    ).toMatchObject({ error: 'FORBIDDEN' })
  })

  it('revoke removes the invite from the list', async () => {
    await grant('a@example.com', 'EDITOR')
    const id = ((await listEmailInvitesHandler(asAdmin(), projectId)) as any)
      .invites[0].id
    expect(
      await revokeEmailInviteHandler(asAdmin(), { projectId, inviteId: id }),
    ).toEqual({ success: true })
    expect(
      ((await listEmailInvitesHandler(asAdmin(), projectId)) as any).invites,
    ).toHaveLength(0)
  })
})
