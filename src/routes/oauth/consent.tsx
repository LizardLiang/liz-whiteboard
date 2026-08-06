// src/routes/oauth/consent.tsx
// OAuth consent screen — shown when an untrusted (DCR-registered) client
// reaches /authorize without a covering grant (src/routes/authorize.ts).
// Public route in the sense that it's reachable without being logged in
// (not in __root.tsx's PUBLIC_PATHS), which means the root beforeLoad auth
// guard applies normally: an unauthenticated visitor is bounced to /login
// before this component ever renders — consent is never shown to a
// logged-out user (the same guarantee /authorize's own session check
// provides on the way in).
//
// SECURITY: client_name and redirect_uri are attacker-controlled (any caller
// can register a DCR client with an arbitrary name via the open
// /oauth/register endpoint). Both are rendered as plain React text nodes
// below — React escapes text-node children by default, and this file never
// uses dangerouslySetInnerHTML.

import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z } from 'zod'
import type { AuthErrorResponse } from '@/lib/auth/errors'
import type { ConsentActionResult } from '@/lib/oauth/consent-handlers'
import { approveConsent, denyConsent, getConsentRequest } from '@/routes/api/oauth-consent'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { isUnauthorizedError } from '@/lib/auth/errors'

const searchSchema = z.object({
  request_id: z.string().min(1),
})

export const Route = createFileRoute('/oauth/consent')({
  validateSearch: searchSchema,
  component: ConsentPage,
})

function ConsentPage() {
  const { request_id: requestId } = Route.useSearch()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['oauth-consent-request', requestId],
    queryFn: () => getConsentRequest({ data: { requestId } }),
    retry: false,
  })

  const approveMutation = useMutation({
    mutationFn: () => approveConsent({ data: { requestId } }),
    onSuccess: (result) => navigateOnResult(result),
    onError: () => toast.error('Something went wrong approving this request.'),
  })

  const denyMutation = useMutation({
    mutationFn: () => denyConsent({ data: { requestId } }),
    onSuccess: (result) => navigateOnResult(result),
    onError: () => toast.error('Something went wrong denying this request.'),
  })

  function navigateOnResult(result: ConsentActionResult | AuthErrorResponse) {
    if (isUnauthorizedError(result)) return
    if (result.success && result.redirectUrl) {
      // A full navigation — the client's redirect_uri is a different origin
      // (or at least a different app), so this must leave the SPA entirely
      // rather than use the client-side router (mirrors login.tsx's
      // window.location.assign for the same reason).
      window.location.assign(result.redirectUrl)
      return
    }
    // W5 fix: `{ success: false, message }` (expired/consumed/user-mismatched
    // request — see consent-handlers.ts) was previously discarded here, so
    // the button just silently stopped spinning with no feedback. Surface it.
    toast.error(
      result.message ??
        'This consent request has expired or is invalid. Please try connecting again from your client.',
    )
  }

  const isPending = approveMutation.isPending || denyMutation.isPending

  // Narrow away the requireAuth() session-expired shape before touching the
  // consent-request-specific fields below (SessionExpiredModal, mounted at
  // the root, already handles surfacing that case globally).
  const view = data && !isUnauthorizedError(data) ? data : null

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        {isLoading ? (
          <p className="text-center text-sm text-muted-foreground">
            Loading request...
          </p>
        ) : isError || !view || !view.valid ? (
          <Card>
            <CardHeader>
              <CardTitle>Consent request unavailable</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {view && !view.valid
                  ? view.message
                  : 'This consent request has expired or is invalid. Please try connecting again from your client.'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Authorize application</CardTitle>
              <CardDescription>
                {/* client_name is attacker-controlled (open DCR) — plain text
                    node only, never dangerouslySetInnerHTML. */}
                <span className="font-semibold text-foreground">
                  {view.clientName}
                </span>{' '}
                wants to access your ER Whiteboard account.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                This application is not verified by ER Whiteboard. Only
                approve it if you trust the client that sent you here.
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Requesting access to
                </p>
                <ul className="mt-1 list-disc pl-5 text-sm">
                  {view.scopes.map((scope) => (
                    <li key={scope}>{scope}</li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Redirect URI
                </p>
                {/* redirect_uri is also attacker-controlled — plain text node. */}
                <p className="mt-1 break-all text-sm text-foreground">
                  {view.redirectUri}
                </p>
              </div>
            </CardContent>
            <CardFooter className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                disabled={isPending}
                onClick={() => denyMutation.mutate()}
              >
                {denyMutation.isPending ? 'Denying...' : 'Deny'}
              </Button>
              <Button
                className="flex-1"
                disabled={isPending}
                onClick={() => approveMutation.mutate()}
              >
                {approveMutation.isPending ? 'Approving...' : 'Approve'}
              </Button>
            </CardFooter>
          </Card>
        )}
      </div>
    </div>
  )
}
