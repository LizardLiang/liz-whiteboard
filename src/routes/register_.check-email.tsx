// src/routes/register_.check-email.tsx
// "Check your email" screen shown after the register form, with Resend. The
// trailing underscore on `register_` keeps this route from nesting under
// /register. The screen is the same for a new and an existing email.

import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { resendSignupEmail } from './api/auth'
import { Button } from '@/components/ui/button'
import { useHydrated } from '@/hooks/use-hydrated'
import { useT } from '@/lib/i18n/use-t'
import { sanitizeRedirect } from '@/lib/safe-redirect'

const searchSchema = z.object({
  email: z.string().optional().default(''),
  redirect: z.string().optional().default('/'),
})

export const Route = createFileRoute('/register_/check-email')({
  validateSearch: searchSchema,
  component: CheckEmailPage,
})

function CheckEmailPage() {
  const t = useT()
  const { email, redirect: rawRedirect } = Route.useSearch()
  const redirect = sanitizeRedirect(rawRedirect)
  const hydrated = useHydrated()
  const [isSending, setIsSending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleResend = async () => {
    setNotice(null)
    setError(null)
    setIsSending(true)
    try {
      const result = await resendSignupEmail({
        data: { email, ...(redirect !== '/' ? { redirect } : {}) },
      })
      if (result.success) {
        setNotice(t('auth.checkEmail.resent'))
      } else {
        // The only refusal resendSignupEmail returns is the per-IP rate limit.
        setError(t('auth.checkEmail.rateLimited'))
      }
    } catch {
      setError(t('common.somethingWentWrong'))
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-bold">{t('auth.checkEmail.title')}</h1>
        <p className="mt-4 text-muted-foreground">
          {email
            ? t('auth.checkEmail.bodyWithEmail', { email })
            : t('auth.checkEmail.body')}
        </p>

        {notice && (
          <p
            role="status"
            aria-live="polite"
            className="mt-4 text-sm text-muted-foreground"
          >
            {notice}
          </p>
        )}
        {error && (
          <p
            role="alert"
            aria-live="polite"
            className="mt-4 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        {email && (
          <Button
            type="button"
            variant="outline"
            className="mt-6 w-full"
            onClick={() => void handleResend()}
            disabled={isSending || !hydrated}
          >
            {isSending
              ? t('auth.checkEmail.resending')
              : t('auth.checkEmail.resend')}
          </Button>
        )}

        <p className="mt-6 text-sm">
          <Link
            to="/login"
            className="font-medium underline underline-offset-4"
          >
            {t('auth.checkEmail.backToSignIn')}
          </Link>
        </p>
      </div>
    </div>
  )
}
