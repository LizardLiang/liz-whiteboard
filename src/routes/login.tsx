// src/routes/login.tsx
// Login page — public route (no auth required)

import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { loginUser } from './api/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      const result = await loginUser({ data: { email, password, rememberMe } })

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
        setError(result.message || 'Invalid email or password')
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
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
          <Button
            type="submit"
            className="w-full"
            disabled={isSubmitting || !email || !password}
          >
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
