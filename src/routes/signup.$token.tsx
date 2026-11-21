// src/routes/signup.$token.tsx
// Finish an email-link signup — public route. The link carries the token in
// the path; the page previews it (valid / expired / used), then asks for a
// password. The username is pre-filled from the register form and editable,
// so a username taken in the meantime can be replaced here.

import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { completeSignup, validateSignupToken } from './api/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { completeSignupInputSchema } from '@/data/schema'
import { useHydrated } from '@/hooks/use-hydrated'
import { AUTH_ERROR_CODES } from '@/lib/auth/errors'
import { useT } from '@/lib/i18n/use-t'
import { tError } from '@/lib/i18n/t-error'

export const Route = createFileRoute('/signup/$token')({
  head: () => ({
    meta: [{ name: 'referrer', content: 'no-referrer' }],
  }),
  component: SignupPage,
})

function SignupPage() {
  const t = useT()
  const { token } = Route.useParams()
  const hydrated = useHydrated()

  const { data: preview, isLoading } = useQuery({
    queryKey: ['signup-token', token],
    queryFn: () => validateSignupToken({ data: token }),
    retry: false,
    staleTime: Infinity,
  })

  const [username, setUsername] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [consumed, setConsumed] = useState(false)

  const shownUsername = username ?? preview?.username ?? ''

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setErrors({})

    const parsed = completeSignupInputSchema.safeParse({
      token,
      username: shownUsername,
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
      const response = await completeSignup({ data: parsed.data })
      if (response.success) {
        // Full browser navigation: the root auth guard must re-run with the
        // session cookie this response just set (see login.tsx, GH #115).
        window.location.assign(response.redirect)
        return
      }
      if (response.error === AUTH_ERROR_CODES.VALIDATION_ERROR) {
        setErrors({ username: t('auth.signup.usernameTaken') })
      } else {
        setConsumed(true)
      }
    } catch {
      setErrors({ form: t('common.somethingWentWrong') })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm">
          <noscript>
            <div className="mb-4 rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
              {t('auth.signup.noscript')}
            </div>
          </noscript>
          <p className="text-center text-sm text-muted-foreground">
            {t('auth.signup.checking')}
          </p>
        </div>
      </div>
    )
  }

  if (consumed || preview?.state !== 'valid') {
    const state = consumed ? 'invalid' : (preview?.state ?? 'invalid')
    const body =
      state === 'expired'
        ? t('auth.signup.linkExpired')
        : state === 'used'
          ? t('auth.signup.linkUsed')
          : t('auth.signup.linkInvalidBody')
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-2xl font-bold">{t('auth.signup.linkInvalid')}</h1>
          <p className="mt-4 text-muted-foreground">{body}</p>
          <p className="mt-6 text-sm">
            <Link
              to="/register"
              className="font-medium underline underline-offset-4"
            >
              {t('auth.signup.startOver')}
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
          <h1 className="text-2xl font-bold">{t('auth.signup.title')}</h1>
          <p className="text-muted-foreground mt-1">
            {t('auth.signup.subtitle')}
          </p>
        </div>

        {/* method="post" is defense in depth: a native submit never puts the
            password or signup token in a URL. The hydration gate on the
            submit button is what prevents a native submit. */}
        <form
          method="post"
          onSubmit={handleSubmit}
          aria-busy={isSubmitting || !hydrated}
          noValidate
        >
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
            <Label htmlFor="username">{t('auth.register.username')}</Label>
            <Input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              value={shownUsername}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={isSubmitting}
              className="mt-1"
              aria-describedby={errors.username ? 'username-error' : undefined}
              aria-invalid={!!errors.username}
            />
            {errors.username && (
              <p
                id="username-error"
                role="alert"
                aria-live="polite"
                className="mt-1 text-xs text-destructive"
              >
                {errors.username}
              </p>
            )}
          </div>

          <div className="mb-4">
            <Label htmlFor="password">{t('common.password')}</Label>
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
              {t('auth.signup.confirmPassword')}
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

          <Button
            type="submit"
            className="w-full"
            disabled={isSubmitting || !hydrated}
          >
            {isSubmitting
              ? t('auth.signup.submitting')
              : t('auth.signup.submit')}
          </Button>
        </form>
      </div>
    </div>
  )
}
