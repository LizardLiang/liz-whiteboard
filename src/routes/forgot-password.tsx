// src/routes/forgot-password.tsx
// Forgot-password request page — public route (no auth required). Protected
// by Cloudflare Turnstile; always shows the same generic message regardless
// of whether the submitted email matches an account (anti-enumeration).

import { Link, createFileRoute } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { getTurnstileSiteKey, requestPasswordReset } from './api/auth'
import type { TurnstileWidgetHandle } from '@/components/auth/TurnstileWidget'
import { TurnstileWidget } from '@/components/auth/TurnstileWidget'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { readAutofilledValue, useAutofillSync } from '@/hooks/use-autofill-sync'

export const Route = createFileRoute('/forgot-password')({
  loader: async () => {
    const { siteKey } = await getTurnstileSiteKey()
    return { siteKey }
  },
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const { siteKey } = Route.useLoaderData()
  const widgetRef = useRef<TurnstileWidgetHandle>(null)
  const emailRef = useRef<HTMLInputElement>(null)

  // Seeded from the DOM, not from ''. A browser autofill that lands before
  // hydration is only readable during the render phase — React overwrites
  // the input during the hydration commit. See src/hooks/use-autofill-sync.ts.
  const [email, setEmail] = useState(() => readAutofilledValue('email'))
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submittedMessage, setSubmittedMessage] = useState<string | null>(null)

  // Browser autofill writes the DOM value without an event React observes,
  // and usually lands before hydration. Without this the field shows an
  // email while state stays empty. See src/hooks/use-autofill-sync.ts.
  const { onAnimationStart } = useAutofillSync({
    email: { ref: emailRef, value: email, setValue: setEmail },
  })

  const resetWidget = () => {
    widgetRef.current?.reset()
    setTurnstileToken(null)
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!turnstileToken) return

    // Read the form itself rather than trusting state. If autofill raced
    // past both sync points, state can still be empty while the field holds
    // a real email — submitting '' would fail validation for no visible
    // reason.
    const formData = new FormData(e.currentTarget)
    const submittedEmail = (formData.get('email') as string | null) ?? email
    if (submittedEmail !== email) setEmail(submittedEmail)

    setError(null)
    setIsSubmitting(true)

    try {
      const result = await requestPasswordReset({
        data: { email: submittedEmail, turnstileToken },
      })

      if (result.success) {
        setSubmittedMessage(result.message)
      } else if (result.error === 'RATE_LIMITED') {
        setError('Too many requests, try again later.')
        resetWidget()
      } else {
        // CAPTCHA_FAILED
        setError('Verification failed. Please try again.')
        resetWidget()
      }
    } catch {
      setError('Something went wrong. Please try again.')
      resetWidget()
    } finally {
      setIsSubmitting(false)
    }
  }

  if (submittedMessage) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-2xl font-bold">Check your email</h1>
          <p className="mt-4 text-muted-foreground">{submittedMessage}</p>
          <p className="mt-6 text-sm">
            <Link
              to="/login"
              className="font-medium underline underline-offset-4"
            >
              Back to sign in
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
          <h1 className="text-2xl font-bold">Forgot your password?</h1>
          <p className="text-muted-foreground mt-1">
            Enter your email and we&apos;ll send you a reset link.
          </p>
        </div>

        <form onSubmit={handleSubmit} aria-busy={isSubmitting} noValidate>
          {error && (
            <div
              role="alert"
              aria-live="polite"
              className="mb-4 rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}

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

          <div className="mb-6">
            {siteKey ? (
              <TurnstileWidget
                ref={widgetRef}
                siteKey={siteKey}
                onVerify={setTurnstileToken}
                onExpire={() => setTurnstileToken(null)}
                onError={() => setTurnstileToken(null)}
              />
            ) : (
              <p className="text-xs text-destructive">
                Verification is not configured. Contact your administrator.
              </p>
            )}
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={isSubmitting || !turnstileToken}
          >
            {isSubmitting ? 'Sending...' : 'Send reset link'}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Remembered your password?{' '}
          <Link
            to="/login"
            className="font-medium underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
