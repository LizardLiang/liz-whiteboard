// src/routes/register.tsx
// Registration page — public route (no auth required). The form takes email +
// username only; the emailed link sets the password (see /signup/$token).

import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { z } from 'zod'
import { registerUser } from './api/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { registerInputSchema } from '@/data/schema'
import { readAutofilledValue, useAutofillSync } from '@/hooks/use-autofill-sync'
import { sanitizeRedirect } from '@/lib/safe-redirect'
import { useHydrated } from '@/hooks/use-hydrated'
import { useT } from '@/lib/i18n/use-t'
import { tError } from '@/lib/i18n/t-error'

const searchSchema = z.object({
  redirect: z.string().optional().default('/'),
})

export const Route = createFileRoute('/register')({
  validateSearch: searchSchema,
  component: RegisterPage,
})

function RegisterPage() {
  const t = useT()
  const router = useRouter()
  const { redirect: rawRedirect } = Route.useSearch()
  // S1: reject any redirect that isn't same-origin-relative (blocks
  // "//evil.com" and "/\evil.com" open-redirect payloads) before it's ever
  // handed to router.navigate/Link.
  const redirect = sanitizeRedirect(rawRedirect)

  // Seeded from the DOM, not from ''. A browser autofill that lands before
  // hydration is only readable during the render phase — React overwrites the
  // input during the hydration commit. See src/hooks/use-autofill-sync.ts.
  const [username, setUsername] = useState(() =>
    readAutofilledValue('username'),
  )
  const [email, setEmail] = useState(() => readAutofilledValue('email'))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  // False in the server-rendered HTML and until React hydrates. A submit in
  // that window has no onSubmit handler, so the browser would run the form's
  // native submit and reload the page with the password in the URL.
  const hydrated = useHydrated()

  const usernameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)

  // Browser autofill writes the DOM value without an event React observes, and
  // usually lands before hydration. Without this the fields show credentials
  // while state stays empty. See src/hooks/use-autofill-sync.ts.
  const { onAnimationStart } = useAutofillSync({
    username: { ref: usernameRef, value: username, setValue: setUsername },
    email: { ref: emailRef, value: email, setValue: setEmail },
  })

  const validateField = (field: string, value: string): string | null => {
    const partial: Record<string, string> = { username, email }
    partial[field] = value
    const result = registerInputSchema.safeParse(partial)
    if (!result.success) {
      const fieldError = result.error.issues.find(
        (issue) => issue.path[0] === field,
      )
      return fieldError ? tError(t, fieldError) : null
    }
    return null
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setErrors({})

    // Read the form itself rather than trusting state. If autofill raced past
    // both sync points, state can still be empty while the fields are visibly
    // filled — validating '' would reject a form the user sees as complete.
    const formData = new FormData(e.currentTarget)
    const submitted = {
      username: (formData.get('username') as string | null) ?? username,
      email: (formData.get('email') as string | null) ?? email,
    }

    // Keep the controlled inputs in step with what we actually validate.
    if (submitted.username !== username) setUsername(submitted.username)
    if (submitted.email !== email) setEmail(submitted.email)

    // Client-side validation — the submit button no longer gates on emptiness,
    // so a blank submit lands here and surfaces through the same field errors.
    const result = registerInputSchema.safeParse(submitted)
    if (!result.success) {
      const fieldErrors: Record<string, string> = {}
      result.error.issues.forEach((issue) => {
        if (issue.path[0]) {
          fieldErrors[String(issue.path[0])] = tError(t, issue)
        }
      })
      setErrors(fieldErrors)
      return
    }

    setIsSubmitting(true)

    try {
      const response = await registerUser({
        data: { ...submitted, ...(redirect !== '/' ? { redirect } : {}) },
      })

      if (response.success) {
        // Same reply for a new and an existing email: the check-email page
        // always follows. The email travels in the URL so Resend can use it.
        router.navigate({
          to: '/register/check-email',
          search: { email: submitted.email, redirect },
        })
      } else {
        // The only refusal registerUser returns is the per-IP rate limit.
        setErrors({ form: t('auth.checkEmail.rateLimited') })
      }
    } catch {
      setErrors({ form: t('common.somethingWentWrong') })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        {/* Branding */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold">{t('common.appName')}</h1>
          <p className="text-muted-foreground mt-1">
            {t('auth.register.subtitle')}
          </p>
        </div>

        {/* method="post" is defense in depth: a native submit never puts
            credentials in a URL (history, server logs). It does not save the
            submit: a native POST reloads the page and loses it. The hydration
            gate on the submit button is what prevents that. */}
        <form
          method="post"
          onSubmit={handleSubmit}
          aria-busy={isSubmitting || !hydrated}
          noValidate
        >
          <noscript>
            <div className="mb-4 rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
              {t('auth.register.noscript')}
            </div>
          </noscript>
          {/* Form-level error */}
          {errors.form && (
            <div
              role="alert"
              aria-live="polite"
              className="mb-4 rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive"
            >
              {errors.form}
            </div>
          )}

          {/* Username */}
          <div className="mb-4">
            <Label htmlFor="username">{t('auth.register.username')}</Label>
            <Input
              id="username"
              name="username"
              ref={usernameRef}
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value)
                const err = validateField('username', e.target.value)
                setErrors((prev) => ({ ...prev, username: err ?? '' }))
              }}
              onAnimationStart={onAnimationStart}
              required
              disabled={isSubmitting}
              className="mt-1"
              placeholder={t('auth.register.usernamePlaceholder')}
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

          {/* Email */}
          <div className="mb-6">
            <Label htmlFor="email">{t('common.email')}</Label>
            <Input
              id="email"
              name="email"
              ref={emailRef}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                const err = validateField('email', e.target.value)
                setErrors((prev) => ({ ...prev, email: err ?? '' }))
              }}
              onAnimationStart={onAnimationStart}
              required
              disabled={isSubmitting}
              className="mt-1"
              placeholder={t('auth.login.emailPlaceholder')}
              aria-describedby={errors.email ? 'email-error' : undefined}
              aria-invalid={!!errors.email}
            />
            {errors.email && (
              <p
                id="email-error"
                role="alert"
                aria-live="polite"
                className="mt-1 text-xs text-destructive"
              >
                {errors.email}
              </p>
            )}
          </div>

          {/* Submit */}
          {/* Never gate on emptiness: browser autofill can leave state empty
              while the fields are visibly filled, which used to disable this
              button permanently and kill the Enter key with it. handleSubmit
              reads the form and surfaces field errors for an empty submit.
              It does gate on hydration: a disabled default button also blocks
              Enter-key submit, so no native submit can run before onSubmit
              exists. */}
          <Button
            type="submit"
            className="w-full"
            disabled={isSubmitting || !hydrated}
          >
            {isSubmitting
              ? t('auth.register.submitting')
              : t('auth.register.submit')}
          </Button>
        </form>

        {/* Login link */}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t('auth.register.hasAccount')}{' '}
          <Link
            to="/login"
            className="font-medium underline underline-offset-4"
          >
            {t('auth.register.logIn')}
          </Link>
        </p>
      </div>
    </div>
  )
}
