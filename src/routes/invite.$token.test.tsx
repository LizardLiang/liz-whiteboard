// @vitest-environment jsdom
// src/routes/invite.$token.test.tsx
// Render-level tests for the invite landing/redeem page. Mocks
// createFileRoute/Link/useRouter the same way
// project.$projectId.folder.$folderId.forbidden.test.tsx mocks router
// internals, and mocks the invites.ts/auth.ts server functions the same way
// ProjectSharePanel.test.tsx mocks permissions.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type * as ReactRouterExports from '@tanstack/react-router'

import { getInvitePreview, redeemInvite } from '@/routes/api/invites'
import { getCurrentUser } from '@/routes/api/auth'

vi.mock('@/routes/api/invites', () => ({
  getInvitePreview: vi.fn(),
  redeemInvite: vi.fn(),
}))

vi.mock('@/routes/api/auth', () => ({
  getCurrentUser: vi.fn(),
}))

const mockNavigate = vi.fn()

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterExports>()
  return {
    ...actual,
    createFileRoute: () => () => ({
      useParams: () => ({ token: 'abc123' }),
      component: null,
    }),
    useRouter: () => ({ navigate: mockNavigate }),
    Link: ({ to, search, children, ...rest }: any) => {
      const qs = search
        ? `?${new URLSearchParams(search as Record<string, string>).toString()}`
        : ''
      return (
        <a href={`${to}${qs}`} {...rest}>
          {children}
        </a>
      )
    },
  }
})

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

async function importInvitePage() {
  const mod = (await import('./invite.$token')) as unknown as {
    InvitePage: () => React.JSX.Element
  }
  return mod.InvitePage
}

function renderInvitePage(Component: () => React.JSX.Element) {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <Component />
    </QueryClientProvider>,
  )
}

describe('Invite landing page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('logged-out state renders sign-in/register CTAs with the redirect search param', async () => {
    vi.mocked(getInvitePreview).mockResolvedValue({
      valid: true,
      projectName: 'Test Project',
      role: 'EDITOR',
    } as any)
    vi.mocked(getCurrentUser).mockResolvedValue(null as any)

    const InvitePage = await importInvitePage()
    renderInvitePage(InvitePage)

    await waitFor(() => {
      expect(screen.getByText(/you've been invited/i)).toBeTruthy()
    })
    expect(screen.getByText('Test Project')).toBeTruthy()

    const signInLink = screen.getByText(/sign in/i).closest('a')
    const registerLink = screen.getByText(/create account/i).closest('a')
    expect(signInLink?.getAttribute('href')).toBe(
      `/login?redirect=${encodeURIComponent('/invite/abc123')}`,
    )
    expect(registerLink?.getAttribute('href')).toBe(
      `/register?redirect=${encodeURIComponent('/invite/abc123')}`,
    )
  })

  it('logged-in + valid state renders the accept button and redirects on success', async () => {
    vi.mocked(getInvitePreview).mockResolvedValue({
      valid: true,
      projectName: 'Test Project',
      role: 'EDITOR',
    } as any)
    vi.mocked(getCurrentUser).mockResolvedValue({
      user: { id: 'user-1', username: 'alice', email: 'alice@example.com' },
    } as any)
    vi.mocked(redeemInvite).mockResolvedValue({
      success: true,
      projectId: 'proj-1',
      role: 'EDITOR',
    } as any)

    const InvitePage = await importInvitePage()
    renderInvitePage(InvitePage)

    const acceptButton = await screen.findByRole('button', {
      name: /accept invite/i,
    })
    fireEvent.click(acceptButton)

    await waitFor(() => {
      expect(redeemInvite).toHaveBeenCalledWith({ data: { token: 'abc123' } })
    })
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/project/proj-1' })
    })
  })

  it('invalid/expired/revoked states render InviteInvalid with no accept button offered', async () => {
    vi.mocked(getInvitePreview).mockResolvedValue({
      valid: false,
      reason: 'EXPIRED',
    } as any)
    vi.mocked(getCurrentUser).mockResolvedValue(null as any)

    const InvitePage = await importInvitePage()
    renderInvitePage(InvitePage)

    await waitFor(() => {
      expect(screen.getByText(/expired/i)).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: /accept invite/i })).toBeNull()
    expect(screen.queryByText(/sign in/i)).toBeNull()
  })
})
