// src/routes/reset-password.tsx
// Set a new password from a reset-link token — public route (no auth
// required). The token comes from `?token=`; validity is checked once via
// validateResetToken before the password form is shown, so an invalid link
// never renders a form the server would reject anyway.

import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'
import { resetPassword, validateResetToken } from './api/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { resetPasswordInputSchema } from '@/data/schema'
import { useHydrated } from '@/hooks/use-hydrated'
import { useT } from '@/lib/i18n/use-t'
import { tError } from '@/lib/i18n/t-error'

const searchSchema = z.object({
  token: z.string().optional().default(''),
})

export const Route = createFileRoute('/reset-password')({
  validateSearch: searchSchema,
  head: () => ({
    meta: [{ name: 'referrer', content: 'no-referrer' }],
  }),
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const t = useT()
  const { token } = Route.useSearch()

  const { data: validation, isLoading } = useQuery({
    queryKey: ['reset-token-valid', token],
    queryFn: () => validateResetToken({ data: token }),
    enabled: token.length > 0,
    retry: false,
  })

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  // The form only renders after the client-side token check, so it is not in
  // the server HTML today. This gate keeps it safe if that ever changes: a
  // submit before hydration has no onSubmit handler and would run the
  // browser's native submit.
  const hydrated = useHydrated()

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setErrors({})

    const parsed = resetPasswordInputSchema.safeParse({
      token,
      password,
      confirmPassword,
    })
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {}
      parsed.error.issues.forEach((issue) => {
        if (issue.path[0]) fieldErrors[String(issue.path[0])] = tError(t, issue)
      })
      setErrors(fieldErrors)
      return
    }

    setIsSubmitting(true)
    try {
      const response = await resetPassword({ data: parsed.data })
      if (response.success) {
        // Full browser navigation: the reset just cleared this browser's own
        // session cookie server-side (as well as every other session), so a
        // real reload — not a client-side router.navigate — is what makes
        // /login's own beforeLoad/UI reflect the now-signed-out state,
        // mirroring login.tsx's identical reasoning for its own redirect.
        window.location.assign(response.redirect)
      } else {
        setErrors({ form: t('errors.linkInvalidOrExpired') })
      }
    } catch {
      setErrors({ form: t('common.somethingWentWrong') })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!token || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground">
          {isLoading ? t('auth.reset.checking') : ''}
        </p>
      </div>
    )
  }

  if (!validation?.valid) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-2xl font-bold">{t('auth.reset.linkInvalid')}</h1>
          <p className="mt-4 text-muted-foreground">
            {t('errors.linkInvalidOrExpired')}
          </p>
          <p className="mt-6 text-sm">
            <Link
              to="/forgot-password"
              className="font-medium underline underline-offset-4"
            >
              {t('auth.reset.requestNew')}
            </Link>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold">{t('auth.reset.title')}</h1>
        </div>

        {/* method="post" is defense in depth: a native submit never puts the
            password or reset token in a URL (history, server logs). It does
            not save the submit: a native POST reloads the page and loses it.
            The hydration gate on the submit button is what prevents that. */}
        <form
          method="post"
          onSubmit={handleSubmit}
          aria-busy={isSubmitting || !hydrated}
          noValidate
        >
          <noscript>
            <div className="mb-4 rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
              {t('auth.reset.noscript')}
            </div>
          </noscript>
          {errors.form && (
            <div
              role="alert"
              aria-live="polite"
              className="mb-4 rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive"
            >
              {errors.form}
            </div>
          )}

          <div className="mb-4">
            <Label htmlFor="password">{t('auth.reset.newPassword')}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isSubmitting}
              className="mt-1"
              placeholder={t('auth.register.passwordPlaceholder')}
              aria-describedby={errors.password ? 'password-error' : undefined}
              aria-invalid={!!errors.password}
            />
            {errors.password && (
              <p
                id="password-error"
                role="alert"
                aria-live="polite"
                className="mt-1 text-xs text-destructive"
              >
                {errors.password}
              </p>
            )}
          </div>

          <div className="mb-6">
            <Label htmlFor="confirmPassword">
              {t('auth.reset.confirmPassword')}
            </Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              disabled={isSubmitting}
              className="mt-1"
              aria-describedby={
                errors.confirmPassword ? 'confirm-password-error' : undefined
              }
              aria-invalid={!!errors.confirmPassword}
            />
            {errors.confirmPassword && (
              <p
                id="confirm-password-error"
                role="alert"
                aria-live="polite"
                className="mt-1 text-xs text-destructive"
              >
                {errors.confirmPassword}
              </p>
            )}
          </div>

          {/* A disabled default button also blocks Enter-key submit, so no
              native submit can run before onSubmit exists. */}
          <Button
            type="submit"
            className="w-full"
            disabled={isSubmitting || !hydrated}
          >
            {isSubmitting ? t('auth.reset.submitting') : t('auth.reset.submit')}
          </Button>
        </form>
      </div>
    </div>
  )
}
