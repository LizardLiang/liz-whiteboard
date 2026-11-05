// src/routes/register.tsx
// Registration page — public route (no auth required)

import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { z } from 'zod'
import { registerUser } from './api/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { registerInputSchema } from '@/data/schema'
import { readAutofilledValue, useAutofillSync } from '@/hooks/use-autofill-sync'
import { AUTH_ERROR_CODES } from '@/lib/auth/errors'
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
  const [password, setPassword] = useState(() =>
    readAutofilledValue('password'),
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  // False in the server-rendered HTML and until React hydrates. A submit in
  // that window has no onSubmit handler, so the browser would run the form's
  // native submit and reload the page with the password in the URL.
  const hydrated = useHydrated()

  const usernameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  // Browser autofill writes the DOM value without an event React observes, and
  // usually lands before hydration. Without this the fields show credentials
  // while state stays empty. See src/hooks/use-autofill-sync.ts.
  const { onAnimationStart } = useAutofillSync({
    username: { ref: usernameRef, value: username, setValue: setUsername },
    email: { ref: emailRef, value: email, setValue: setEmail },
    password: { ref: passwordRef, value: password, setValue: setPassword },
  })

  const validateField = (field: string, value: string): string | null => {
    const partial: Record<string, string> = { username, email, password }
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
    setSuccessMessage(null)

    // Read the form itself rather than trusting state. If autofill raced past
    // both sync points, state can still be empty while the fields are visibly
    // filled — validating '' would reject a form the user sees as complete.
    const formData = new FormData(e.currentTarget)
    const submitted = {
      username: (formData.get('username') as string | null) ?? username,
      email: (formData.get('email') as string | null) ?? email,
      password: (formData.get('password') as string | null) ?? password,
    }

    // Keep the controlled inputs in step with what we actually validate.
    if (submitted.username !== username) setUsername(submitted.username)
    if (submitted.email !== email) setEmail(submitted.email)
    if (submitted.password !== password) setPassword(submitted.password)

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
        data: submitted,
      })

      if (response.newUser) {
        // Genuine new user: auto-logged in, redirect to the caller-provided
        // target (e.g. an invite link) if present, else the server's default.
        const target = redirect !== '/' ? redirect : response.redirect
        router.navigate({ to: target })
      } else if (response.error === AUTH_ERROR_CODES.RATE_LIMITED) {
        setErrors({ form: 'Too many attempts. Please try again later.' })
      } else if (response.error === AUTH_ERROR_CODES.VALIDATION_ERROR) {
        // Server-side field validation error (e.g. username already taken)
        if (Object.keys(response.fields).length > 0) {
          setErrors(
            Object.fromEntries(
              Object.entries(response.fields as Record<string, string>).map(
                ([field, message]) => [field, tError(t, { message })],
              ),
            ),
          )
        } else {
          setErrors({
            form: t('auth.register.validationFailed'),
          })
        }
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- exhaustive per today's registerUser union, but kept as a deliberate defensive fallback: if the response shape ever diverges from this assumption (e.g. a future branch added server-side), we must not silently fall into "success" (see the final else's "do not show false success").
      } else if (response.success === true) {
        // Duplicate email (anti-enumeration): show success message, redirect to login
        setSuccessMessage(response.message)
        setTimeout(() => {
          router.navigate({ to: '/login', search: { redirect } })
        }, 2000)
      } else {
        // Unrecognized response — do not show false success
        setErrors({ form: t('common.somethingWentWrong') })
      }
    } catch {
      setErrors({ form: t('common.somethingWentWrong') })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (successMessage) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm text-center">
          <div className="mb-4 rounded-md bg-green-50 border border-green-200 px-4 py-6 text-sm text-green-800 dark:bg-green-950 dark:border-green-800 dark:text-green-200">
            <p className="font-medium">
              {tError(t, { message: successMessage })}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('auth.register.redirecting')}
            </p>
          </div>
        </div>
      </div>
    )
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
          <div className="mb-4">
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

          {/* Password */}
          <div className="mb-6">
            <Label htmlFor="password">{t('common.password')}</Label>
            <Input
              id="password"
              name="password"
              ref={passwordRef}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                const err = validateField('password', e.target.value)
                setErrors((prev) => ({ ...prev, password: err ?? '' }))
              }}
              onAnimationStart={onAnimationStart}
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
