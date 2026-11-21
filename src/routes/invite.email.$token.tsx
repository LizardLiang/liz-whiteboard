// src/routes/invite.email.$token.tsx
// Accept page for a grant-by-email invite. The invite is bound to an email
// address, so the visitor must be logged in: a logged-out visitor is sent to
// /login?redirect=… (and can register through the email-link signup, which
// carries the return path). Landing here never joins the project; only the
// explicit Accept click does.

import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  acceptEmailInvite,
  previewEmailInvite,
} from '@/routes/api/email-invites'
import { getCurrentUser } from '@/routes/api/auth'
import { InviteInvalid } from '@/components/project/InviteInvalid'
import { Button } from '@/components/ui/button'
import { isUnauthorizedError } from '@/lib/auth/errors'
import { useT } from '@/lib/i18n/use-t'
import { tError } from '@/lib/i18n/t-error'

export const Route = createFileRoute('/invite/email/$token')({
  head: () => ({
    meta: [{ name: 'referrer', content: 'no-referrer' }],
  }),
  beforeLoad: async ({ params }) => {
    const current = await getCurrentUser()
    if (!current) {
      throw redirect({
        to: '/login',
        search: { redirect: `/invite/email/${params.token}` },
      })
    }
  },
  component: EmailInvitePage,
})

const ROLE_KEYS = ['VIEWER', 'EDITOR', 'ADMIN'] as const

export function EmailInvitePage() {
  const t = useT()
  const { token } = Route.useParams()
  const router = useRouter()

  const {
    data: preview,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['email-invite-preview', token],
    queryFn: () => previewEmailInvite({ data: { token } }),
    retry: false,
  })

  const acceptMutation = useMutation({
    mutationFn: () => acceptEmailInvite({ data: { token } }),
    onSuccess: (result) => {
      if (isUnauthorizedError(result)) {
        toast.error(t('errors.sessionExpired'))
        return
      }
      if ('success' in result && result.success) {
        router.navigate({ to: `/project/${result.projectId}` })
        return
      }
      toast.error(tError(t, result))
    },
    onError: () => {
      toast.error(t('invite.acceptFailed'))
    },
  })

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">{t('invite.loading')}</p>
      </div>
    )
  }

  if (isError || !preview || !('valid' in preview) || !preview.valid) {
    const reason =
      preview && 'valid' in preview && !preview.valid
        ? preview.reason
        : undefined
    return (
      <div className="container mx-auto px-4 py-8">
        <InviteInvalid reason={reason} />
      </div>
    )
  }

  const roleKey = ROLE_KEYS.find((r) => r === preview.role)
  const roleLabel = roleKey ? t(`invite.roles.${roleKey}`) : preview.role

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-bold">{t('invite.title')}</h1>
        <p className="mt-2 text-muted-foreground">
          {t('invite.joinPrefix')}{' '}
          <span className="font-semibold">{preview.projectName}</span>{' '}
          {t('invite.joinAs')}{' '}
          <span className="font-semibold">{roleLabel}</span>
        </p>
        <Button
          className="mt-6 w-full"
          onClick={() => acceptMutation.mutate()}
          disabled={acceptMutation.isPending}
        >
          {acceptMutation.isPending
            ? t('invite.accepting')
            : t('invite.accept')}
        </Button>
      </div>
    </div>
  )
}
