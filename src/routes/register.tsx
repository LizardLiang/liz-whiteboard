// src/routes/register.tsx
// Registration page — public route (no auth required)

import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { registerInputSchema } from '@/data/schema'
import { registerUser } from './api/auth'

export const Route = createFileRoute('/register')({
  component: RegisterPage,
})

function RegisterPage() {
  const router = useRouter()

  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const validateField = (field: string, value: string): string | null => {
    const partial: Record<string, string> = { username, email, password }
    partial[field] = value
    const result = registerInputSchema.safeParse(partial)
    if (!result.success) {
      const fieldError = result.error.issues.find(
        (issue) => issue.path[0] === field,
      )
      return fieldError?.message ?? null
    }
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrors({})
    setSuccessMessage(null)

    // Client-side validation
    const result = registerInputSchema.safeParse({ username, email, password })
    if (!result.success) {
      const fieldErrors: Record<string, string> = {}
      result.error.issues.forEach((issue) => {
        if (issue.path[0]) {
          fieldErrors[String(issue.path[0])] = issue.message
        }
      })
      setErrors(fieldErrors)
      return
    }

    setIsSubmitting(true)

    try {
      const response = await registerUser({
        data: { username, email, password },
      })

      if (response.newUser) {
        // Genuine new user: auto-logged in, redirect to app
        router.navigate({ to: response.redirect || '/' })
      } else {
        // Duplicate email (anti-enumeration): show success message, redirect to login
        setSuccessMessage(response.message || 'Registration successful. Please log in.')
        setTimeout(() => {
          router.navigate({ to: '/login' })
        }, 2000)
      }
    } catch {
      setErrors({ form: 'Something went wrong. Please try again.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (successMessage) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm text-center">
          <div className="mb-4 rounded-md bg-green-50 border border-green-200 px-4 py-6 text-sm text-green-800 dark:bg-green-950 dark:border-green-800 dark:text-green-200">
            <p className="font-medium">{successMessage}</p>
            <p className="mt-1 text-xs text-muted-foreground">Redirecting to login...</p>
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
          <h1 className="text-2xl font-bold">ER Whiteboard</h1>
          <p className="text-muted-foreground mt-1">Create your account</p>
        </div>

        <form onSubmit={handleSubmit} aria-busy={isSubmitting} noValidate>
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
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value)
                const err = validateField('username', e.target.value)
                setErrors((prev) => ({ ...prev, username: err ?? '' }))
              }}
              required
              disabled={isSubmitting}
              className="mt-1"
              placeholder="your_username"
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
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                const err = validateField('email', e.target.value)
                setErrors((prev) => ({ ...prev, email: err ?? '' }))
              }}
              required
              disabled={isSubmitting}
              className="mt-1"
              placeholder="you@example.com"
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
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                const err = validateField('password', e.target.value)
                setErrors((prev) => ({ ...prev, password: err ?? '' }))
              }}
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

          {/* Submit */}
          <Button
            type="submit"
            className="w-full"
            disabled={isSubmitting || !username || !email || !password}
          >
            {isSubmitting ? 'Creating account...' : 'Create account'}
          </Button>
        </form>

        {/* Login link */}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link to="/login" className="font-medium underline underline-offset-4">
            Log in
          </Link>
        </p>
      </div>
    </div>
  )
}
