// src/routes/invite.$token.tsx
// Invite landing/redeem page — public route (no auth required to view the
// preview; redeeming the invite requires the visitor to be logged in).

import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getInvitePreview, redeemInvite } from '@/routes/api/invites'
import { getCurrentUser } from '@/routes/api/auth'
import { InviteInvalid } from '@/components/project/InviteInvalid'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/invite/$token')({
  component: InvitePage,
})

const ROLE_LABELS: Record<string, string> = {
  VIEWER: 'Viewer',
  EDITOR: 'Editor',
  ADMIN: 'Admin',
}

export function InvitePage() {
  const { token } = Route.useParams()
  const router = useRouter()

  // Public endpoint that resolves (never throws FORBIDDEN), so no
  // isThrownForbiddenError/classifyQueryFailure handling is needed here —
  // but retry:false is still set (cheap, avoids a multi-retry spinner delay
  // before an error state, the same class of problem called out for the
  // whiteboard/project routes' thrown-error queries).
  const {
    data: preview,
    isLoading: isPreviewLoading,
    isError: isPreviewError,
  } = useQuery({
    queryKey: ['invite-preview', token],
    queryFn: () => getInvitePreview({ data: token }),
    retry: false,
  })

  // No established client-side call site for getCurrentUser exists yet in
  // this codebase (it is otherwise only read server-side in __root.tsx's
  // beforeLoad, which this public route intentionally bypasses) — this is a
  // plain, self-contained read of the resolved-value response.
  const { data: currentUser, isLoading: isUserLoading } = useQuery({
    queryKey: ['current-user'],
    queryFn: () => getCurrentUser(),
    retry: false,
  })

  const redeemMutation = useMutation({
    mutationFn: () => redeemInvite({ data: { token } }),
    onSuccess: (result) => {
      if (result.success) {
        router.navigate({ to: `/project/${result.projectId}` })
        return
      }
      toast.error(result.message)
    },
    onError: () => {
      toast.error('Something went wrong accepting this invite.')
    },
  })

  if (isPreviewLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading invite...</p>
      </div>
    )
  }

  if (isPreviewError || !preview) {
    return (
      <div className="container mx-auto px-4 py-8">
        <InviteInvalid />
      </div>
    )
  }

  if (!preview.valid) {
    return (
      <div className="container mx-auto px-4 py-8">
        <InviteInvalid reason={preview.reason} />
      </div>
    )
  }

  const roleLabel = ROLE_LABELS[preview.role] ?? preview.role

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-bold">You've been invited</h1>
        <p className="mt-2 text-muted-foreground">
          Join <span className="font-semibold">{preview.projectName}</span> as{' '}
          <span className="font-semibold">{roleLabel}</span>
        </p>

        {isUserLoading ? (
          <p className="mt-6 text-sm text-muted-foreground">
            Checking your account...
          </p>
        ) : currentUser ? (
          <Button
            className="mt-6 w-full"
            onClick={() => redeemMutation.mutate()}
            disabled={redeemMutation.isPending}
          >
            {redeemMutation.isPending ? 'Accepting...' : 'Accept invite'}
          </Button>
        ) : (
          // S1 note: this redirect is always same-origin-relative by
          // construction — the "/invite/" prefix is a literal, not derived
          // from `token`, so the resulting string can never become
          // protocol-relative ("//host/...") regardless of token content.
          // No sanitizeRedirect() call needed here (unlike register.tsx/
          // login.tsx, which forward a caller-supplied search param).
          <div className="mt-6 flex flex-col gap-2">
            <Button asChild className="w-full">
              <Link to="/login" search={{ redirect: `/invite/${token}` }}>
                Sign in
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link to="/register" search={{ redirect: `/invite/${token}` }}>
                Create account
              </Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
