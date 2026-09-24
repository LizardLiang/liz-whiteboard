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
        if (issue.path[0]) fieldErrors[String(issue.path[0])] = issue.message
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
        setErrors({ form: 'This link is invalid or has expired.' })
      }
    } catch {
      setErrors({ form: 'Something went wrong. Please try again.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!token || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground">
          {isLoading ? 'Checking your link...' : ''}
        </p>
      </div>
    )
  }

  if (!validation?.valid) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-2xl font-bold">Link invalid</h1>
          <p className="mt-4 text-muted-foreground">
            This link is invalid or has expired.
          </p>
          <p className="mt-6 text-sm">
            <Link
              to="/forgot-password"
              className="font-medium underline underline-offset-4"
            >
              Request a new link
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
          <h1 className="text-2xl font-bold">Set a new password</h1>
        </div>

        <form onSubmit={handleSubmit} aria-busy={isSubmitting} noValidate>
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
            <Label htmlFor="password">New password</Label>
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
              placeholder="At least 8 characters"
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
            <Label htmlFor="confirmPassword">Confirm password</Label>
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

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Updating...' : 'Update password'}
          </Button>
        </form>
      </div>
    </div>
  )
}
