// src/routes/login.tsx
// Login page — public route (no auth required)

import { Link, createFileRoute } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { z } from 'zod'
import { loginUser } from './api/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { readAutofilledValue, useAutofillSync } from '@/hooks/use-autofill-sync'
import { sanitizeRedirect } from '@/lib/safe-redirect'
import { useHydrated } from '@/hooks/use-hydrated'
import { useT } from '@/lib/i18n/use-t'
import { tError } from '@/lib/i18n/t-error'

const searchSchema = z.object({
  redirect: z.string().optional().default('/'),
  // Set by reset-password.tsx's post-reset redirect
  // ('/login?reset=success'). A non-numeric token on purpose: the router's
  // own search parser reads a bare numeral like "1" as the number 1 rather
  // than the string "1", which fails z.string() and, once coerced back to a
  // string, gets JSON-re-encoded on the next URL write. "success" parses as
  // a plain string on both the initial read and every later re-serialization.
  reset: z.string().optional(),
})

export const Route = createFileRoute('/login')({
  validateSearch: searchSchema,
  component: LoginPage,
})

function LoginPage() {
  const t = useT()
  const { redirect: rawRedirect, reset } = Route.useSearch()
  // S1: reject any redirect that isn't same-origin-relative (blocks
  // "//evil.com" and "/\evil.com" open-redirect payloads) before it's ever
  // handed to window.location.assign, which — unlike router.navigate — honors
  // absolute and protocol-relative URLs (GH #115 blocker).
  const redirect = sanitizeRedirect(rawRedirect)

  // Seeded from the DOM, not from ''. A browser autofill that lands before
  // hydration is only readable during the render phase — React overwrites the
  // input during the hydration commit. See src/hooks/use-autofill-sync.ts.
  const [email, setEmail] = useState(() => readAutofilledValue('email'))
  const [password, setPassword] = useState(() =>
    readAutofilledValue('password'),
  )
  const [rememberMe, setRememberMe] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  // False in the server-rendered HTML and until React hydrates. A submit in
  // that window has no onSubmit handler, so the browser would run the form's
  // native submit and reload /login — the user had to log in twice.
  const hydrated = useHydrated()

  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  // Browser autofill writes the DOM value without an event React observes, and
  // usually lands before hydration. Without this the fields show credentials
  // while state stays empty. See src/hooks/use-autofill-sync.ts.
  const { onAnimationStart } = useAutofillSync({
    email: { ref: emailRef, value: email, setValue: setEmail },
    password: { ref: passwordRef, value: password, setValue: setPassword },
  })

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    // Read the form itself rather than trusting state. If autofill raced past
    // both sync points, state can still be empty while the fields hold real
    // credentials — submitting '' would fail the login for no visible reason.
    const formData = new FormData(e.currentTarget)
    const submittedEmail = (formData.get('email') as string | null) ?? email
    const submittedPassword =
      (formData.get('password') as string | null) ?? password

    // The submit button no longer gates on emptiness (an autofilled-but-
    // desynced form left it disabled forever, with Enter dead too), so an
    // empty submit reaches here and must produce a message instead of silence.
    if (!submittedEmail || !submittedPassword) {
      setError(t('auth.login.emptyFields'))
      return
    }

    // Keep the controlled inputs in step with what we actually submitted.
    if (submittedEmail !== email) setEmail(submittedEmail)
    if (submittedPassword !== password) setPassword(submittedPassword)

    setError(null)
    setIsSubmitting(true)

    try {
      const result = await loginUser({
        data: {
          email: submittedEmail,
          password: submittedPassword,
          rememberMe,
        },
      })

      if (result.success) {
        // A full browser navigation re-runs the root beforeLoad auth guard
        // server-side with the freshly-set session_token cookie, so the
        // destination route evaluates as authenticated. A client-side
        // router.navigate does NOT re-run the (already-matched) root guard, so
        // its cached unauthenticated context bounces back to /login (GH #115).
        // /authorize additionally needs this so its server-only GET handler runs.
        const target = redirect || '/'
        window.location.assign(target)
      } else {
        setError(tError(t, result))
      }
    } catch {
      setError(t('common.somethingWentWrong'))
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
            {t('auth.login.subtitle')}
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
              {t('auth.login.noscript')}
            </div>
          </noscript>
          {/* Post-reset confirmation banner */}
          {reset === 'success' && (
            <div
              role="status"
              aria-live="polite"
              className="mb-4 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800 dark:bg-green-950 dark:border-green-800 dark:text-green-200"
            >
              {t('auth.login.resetSuccess')}
            </div>
          )}

          {/* Error message */}
          {error && (
            <div
              role="alert"
              aria-live="polite"
              className="mb-4 rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}

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
              onChange={(e) => setEmail(e.target.value)}
              onAnimationStart={onAnimationStart}
              required
              disabled={isSubmitting}
              className="mt-1"
              placeholder={t('auth.login.emailPlaceholder')}
            />
          </div>

          {/* Password */}
          <div className="mb-4">
            <Label htmlFor="password">{t('common.password')}</Label>
            <Input
              id="password"
              name="password"
              ref={passwordRef}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onAnimationStart={onAnimationStart}
              required
              disabled={isSubmitting}
              className="mt-1"
              placeholder={t('auth.login.passwordPlaceholder')}
            />
            <p className="mt-1 text-right text-sm">
              <Link
                to="/forgot-password"
                className="font-medium underline underline-offset-4"
              >
                {t('auth.login.forgotPassword')}
              </Link>
            </p>
          </div>

          {/* Remember me */}
          <div className="mb-6 flex items-center gap-2">
            <Switch
              id="remember-me"
              checked={rememberMe}
              onCheckedChange={setRememberMe}
              disabled={isSubmitting}
            />
            <Label htmlFor="remember-me" className="cursor-pointer">
              {t('auth.login.rememberMe')}
            </Label>
          </div>

          {/* Submit */}
          {/* Never gate on emptiness: browser autofill can leave state empty
              while the fields are visibly filled, which used to disable this
              button permanently and kill the Enter key with it. handleSubmit
              reads the form and reports an empty submit instead.
              It does gate on hydration: a disabled default button also blocks
              Enter-key submit, so no native submit can run before onSubmit
              exists. */}
          <Button
            type="submit"
            className="w-full"
            disabled={isSubmitting || !hydrated}
          >
            {isSubmitting ? t('auth.login.submitting') : t('auth.login.submit')}
          </Button>
        </form>

        {/* Register link */}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t('auth.login.noAccount')}{' '}
          <Link
            to="/register"
            className="font-medium underline underline-offset-4"
          >
            {t('auth.login.register')}
          </Link>
        </p>
      </div>
    </div>
  )
}
