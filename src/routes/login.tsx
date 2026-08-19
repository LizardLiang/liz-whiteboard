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

const searchSchema = z.object({
  redirect: z.string().optional().default('/'),
})

export const Route = createFileRoute('/login')({
  validateSearch: searchSchema,
  component: LoginPage,
})

function LoginPage() {
  const { redirect: rawRedirect } = Route.useSearch()
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
      setError('Enter your email and password.')
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
        setError(result.message)
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        {/* Branding */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold">ER Whiteboard</h1>
          <p className="text-muted-foreground mt-1">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} aria-busy={isSubmitting} noValidate>
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
            <Label htmlFor="email">Email</Label>
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
              placeholder="you@example.com"
            />
          </div>

          {/* Password */}
          <div className="mb-4">
            <Label htmlFor="password">Password</Label>
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
              placeholder="Your password"
            />
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
              Remember me for 30 days
            </Label>
          </div>

          {/* Submit */}
          {/* Never gate on emptiness: browser autofill can leave state empty
              while the fields are visibly filled, which used to disable this
              button permanently and kill the Enter key with it. handleSubmit
              reads the form and reports an empty submit instead. */}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>

        {/* Register link */}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link
            to="/register"
            className="font-medium underline underline-offset-4"
          >
            Register
          </Link>
        </p>
      </div>
    </div>
  )
}
