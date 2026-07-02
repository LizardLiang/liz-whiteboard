// @vitest-environment jsdom
// src/components/project/ProjectSharePanel.test.tsx
// Render-level tests for the project share panel (mount/open/grant flow).
// Mocks the permissions.ts server functions the same way
// src/routes/project.$projectId.test.tsx mocks projects.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProjectSharePanel } from './ProjectSharePanel'
import type { ReactNode } from 'react'

import {
  grantPermission,
  listProjectPermissions,
  revokePermission,
} from '@/routes/api/permissions'
import {
  createProjectInvite,
  listProjectInvites,
  revokeInvite,
} from '@/routes/api/invites'

vi.mock('@/routes/api/permissions', () => ({
  listProjectPermissions: vi.fn(),
  grantPermission: vi.fn(),
  updatePermission: vi.fn(),
  revokePermission: vi.fn(),
}))

vi.mock('@/routes/api/invites', () => ({
  createProjectInvite: vi.fn(),
  listProjectInvites: vi.fn(),
  revokeInvite: vi.fn(),
}))

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = createTestQueryClient()
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('ProjectSharePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default resolved value so pre-existing tests that don't care about the
    // invite-link section (which now always queries on open) don't hang.
    vi.mocked(listProjectInvites).mockResolvedValue({ invites: [] } as any)
  })

  it('does not call listProjectPermissions while closed', () => {
    render(
      <Wrapper>
        <ProjectSharePanel
          projectId="proj-1"
          open={false}
          onOpenChange={() => {}}
        />
      </Wrapper>,
    )
    expect(listProjectPermissions).not.toHaveBeenCalled()
  })

  it('loads and renders current members when opened', async () => {
    vi.mocked(listProjectPermissions).mockResolvedValue({
      owner: { id: 'owner-1', username: 'owner', email: 'owner@example.com' },
      members: [
        {
          userId: 'user-2',
          username: 'alice',
          email: 'alice@example.com',
          role: 'EDITOR',
        },
      ],
    } as any)

    render(
      <Wrapper>
        <ProjectSharePanel
          projectId="proj-1"
          open={true}
          onOpenChange={() => {}}
        />
      </Wrapper>,
    )

    await waitFor(() => {
      expect(listProjectPermissions).toHaveBeenCalledWith({ data: 'proj-1' })
    })
    expect(await screen.findByText('owner')).toBeTruthy()
    expect(await screen.findByText('alice')).toBeTruthy()
  })

  it('grants a new member by email and role', async () => {
    vi.mocked(listProjectPermissions).mockResolvedValue({
      owner: null,
      members: [],
    } as any)
    vi.mocked(grantPermission).mockResolvedValue({
      success: true,
      member: { userId: 'new-user', role: 'VIEWER' },
    } as any)

    render(
      <Wrapper>
        <ProjectSharePanel
          projectId="proj-1"
          open={true}
          onOpenChange={() => {}}
        />
      </Wrapper>,
    )

    const emailInput = await screen.findByLabelText(/email address to add/i)
    fireEvent.change(emailInput, { target: { value: 'new@example.com' } })

    const addButton = await screen.findByRole('button', { name: /^add$/i })
    fireEvent.click(addButton)

    await waitFor(() => {
      expect(grantPermission).toHaveBeenCalled()
    })
  })

  it('shows an inline error when granting fails', async () => {
    vi.mocked(listProjectPermissions).mockResolvedValue({
      owner: null,
      members: [],
    } as any)
    vi.mocked(grantPermission).mockResolvedValue({
      error: 'USER_NOT_FOUND',
      status: 404,
      message: 'No user found with that email address',
    } as any)

    render(
      <Wrapper>
        <ProjectSharePanel
          projectId="proj-1"
          open={true}
          onOpenChange={() => {}}
        />
      </Wrapper>,
    )

    const emailInput = await screen.findByLabelText(/email address to add/i)
    fireEvent.change(emailInput, { target: { value: 'missing@example.com' } })

    const addButton = await screen.findByRole('button', { name: /^add$/i })
    fireEvent.click(addButton)

    expect(
      await screen.findByText('No user found with that email address'),
    ).toBeTruthy()
  })

  it('revokes a member when the remove button is clicked', async () => {
    vi.mocked(listProjectPermissions).mockResolvedValue({
      owner: null,
      members: [
        {
          userId: 'user-2',
          username: 'alice',
          email: 'alice@example.com',
          role: 'EDITOR',
        },
      ],
    } as any)
    vi.mocked(revokePermission).mockResolvedValue({ success: true } as any)

    render(
      <Wrapper>
        <ProjectSharePanel
          projectId="proj-1"
          open={true}
          onOpenChange={() => {}}
        />
      </Wrapper>,
    )

    const removeButton = await screen.findByLabelText(/remove alice/i)
    removeButton.click()

    await waitFor(() => {
      expect(revokePermission).toHaveBeenCalledWith({
        data: { projectId: 'proj-1', userId: 'user-2' },
      })
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Invite-by-link section
  // ─────────────────────────────────────────────────────────────────────────

  it('creates an invite link and renders the token URL once', async () => {
    vi.mocked(listProjectPermissions).mockResolvedValue({
      owner: null,
      members: [],
    } as any)
    const rawToken = 'a'.repeat(64)
    vi.mocked(createProjectInvite).mockResolvedValue({
      success: true,
      invite: {
        id: 'invite-1',
        role: 'VIEWER',
        expiresAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
      token: rawToken,
    } as any)

    render(
      <Wrapper>
        <ProjectSharePanel
          projectId="proj-1"
          open={true}
          onOpenChange={() => {}}
        />
      </Wrapper>,
    )

    const createButton = await screen.findByRole('button', {
      name: /create link/i,
    })
    fireEvent.click(createButton)

    await waitFor(() => {
      expect(createProjectInvite).toHaveBeenCalledWith({
        data: { projectId: 'proj-1', role: 'VIEWER', expiresInHours: 24 * 7 },
      })
    })

    const linkInput = await screen.findByLabelText('Invite link')
    expect((linkInput as HTMLInputElement).value).toContain(
      `/invite/${rawToken}`,
    )
    expect(screen.getByText(/won't be shown again/i)).toBeTruthy()
  })

  it('revokes an outstanding invite link when the revoke button is clicked', async () => {
    vi.mocked(listProjectPermissions).mockResolvedValue({
      owner: null,
      members: [],
    } as any)
    vi.mocked(listProjectInvites).mockResolvedValue({
      invites: [
        {
          id: 'invite-1',
          role: 'EDITOR',
          maxUses: null,
          usedCount: 0,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          revokedAt: null,
          createdAt: new Date().toISOString(),
          createdByUserId: 'admin-1',
          createdByUsername: 'admin',
        },
      ],
    } as any)
    vi.mocked(revokeInvite).mockResolvedValue({ success: true } as any)

    render(
      <Wrapper>
        <ProjectSharePanel
          projectId="proj-1"
          open={true}
          onOpenChange={() => {}}
        />
      </Wrapper>,
    )

    const revokeButton = await screen.findByLabelText(
      /revoke editor invite link/i,
    )
    fireEvent.click(revokeButton)

    await waitFor(() => {
      expect(revokeInvite).toHaveBeenCalledWith({
        data: { projectId: 'proj-1', inviteId: 'invite-1' },
      })
    })
  })

  it('disables the revoke button for already-revoked links', async () => {
    vi.mocked(listProjectPermissions).mockResolvedValue({
      owner: null,
      members: [],
    } as any)
    vi.mocked(listProjectInvites).mockResolvedValue({
      invites: [
        {
          id: 'invite-1',
          role: 'VIEWER',
          maxUses: null,
          usedCount: 1,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          revokedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          createdByUserId: 'admin-1',
          createdByUsername: 'admin',
        },
      ],
    } as any)

    render(
      <Wrapper>
        <ProjectSharePanel
          projectId="proj-1"
          open={true}
          onOpenChange={() => {}}
        />
      </Wrapper>,
    )

    const revokeButton = await screen.findByLabelText(
      /revoke viewer invite link/i,
    )
    expect((revokeButton as HTMLButtonElement).disabled).toBe(true)
  })
})
