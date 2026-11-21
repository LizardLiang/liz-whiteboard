// @vitest-environment jsdom
// src/routes/invite.email.$token.test.tsx
// The email-invite accept page: landing never joins; only the Accept click does.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type * as ReactRouterExports from '@tanstack/react-router'

import {
  acceptEmailInvite,
  previewEmailInvite,
} from '@/routes/api/email-invites'

vi.mock('@/routes/api/email-invites', () => ({
  acceptEmailInvite: vi.fn(),
  previewEmailInvite: vi.fn(),
}))

vi.mock('@/routes/api/auth', () => ({ getCurrentUser: vi.fn() }))

const mockNavigate = vi.fn()

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterExports>()
  return {
    ...actual,
    createFileRoute: () => () => ({
      useParams: () => ({ token: 'tok123' }),
      component: null,
    }),
    redirect: actual.redirect,
    useRouter: () => ({ navigate: mockNavigate }),
    Link: ({ to, children, ...rest }: any) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
  }
})

async function renderPage() {
  const mod = (await import('./invite.email.$token')) as unknown as {
    EmailInvitePage: () => React.JSX.Element
  }
  const Page = mod.EmailInvitePage
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Page />
    </QueryClientProvider>,
  )
}

describe('Email invite accept page', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not join on landing; Accept joins and opens the project', async () => {
    vi.mocked(previewEmailInvite).mockResolvedValue({
      valid: true,
      projectName: 'Acme',
      role: 'EDITOR',
    } as any)
    vi.mocked(acceptEmailInvite).mockResolvedValue({
      success: true,
      projectId: 'proj-1',
      role: 'EDITOR',
    } as any)

    await renderPage()
    const accept = await screen.findByRole('button', { name: /accept invite/i })
    await new Promise((r) => setTimeout(r, 50))
    expect(acceptEmailInvite).not.toHaveBeenCalled()

    fireEvent.click(accept)
    await waitFor(() => {
      expect(acceptEmailInvite).toHaveBeenCalledWith({
        data: { token: 'tok123' },
      })
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/project/proj-1' })
    })
  })

  it('a wrong account sees the reason and no Accept button', async () => {
    vi.mocked(previewEmailInvite).mockResolvedValue({
      valid: false,
      reason: 'WRONG_ACCOUNT',
      message: 'x',
    } as any)
    await renderPage()
    expect(await screen.findByText(/different email address/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /accept invite/i })).toBeNull()
  })
})
