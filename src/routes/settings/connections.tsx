// src/routes/settings/connections.tsx
// Connected-apps settings page (first /settings route) — lists the current
// user's approved (untrusted, DCR-registered) OAuth clients and lets them
// revoke access. Not in __root.tsx's PUBLIC_PATHS, so the root beforeLoad
// auth guard applies normally: an unauthenticated visitor is redirected to
// /login before this component renders (same as every other authenticated
// page in the app — no extra guard needed here).

import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { ConnectedApp } from '@/lib/oauth/connections-handlers'
import {
  listConnectedApps,
  revokeConnectedApp,
} from '@/routes/api/oauth-connections'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { isUnauthorizedError } from '@/lib/auth/errors'

export const Route = createFileRoute('/settings/connections')({
  component: ConnectionsPage,
})

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function ConnectionsPage() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['connected-apps'],
    queryFn: () => listConnectedApps(),
  })

  const revokeMutation = useMutation({
    mutationFn: (clientId: string) =>
      revokeConnectedApp({ data: { clientId } }),
    onSuccess: () => {
      toast.success('Access revoked')
      queryClient.invalidateQueries({ queryKey: ['connected-apps'] })
    },
    onError: () => {
      toast.error('Something went wrong revoking access.')
    },
  })

  // Narrow away the requireAuth() session-expired shape (SessionExpiredModal,
  // mounted at the root, already handles surfacing that case globally).
  const apps: Array<ConnectedApp> =
    data && !isUnauthorizedError(data) ? data.apps : []

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Connected applications</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Applications you've approved to access your ER Whiteboard account via
        OAuth. Revoking access here stops a client's next token refresh — an
        already-issued access token remains valid for up to 1 hour.
      </p>

      <div className="mt-6 space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : apps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No connected applications yet.
          </p>
        ) : (
          apps.map((app) => (
            <Card key={app.clientId}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    {/* clientName is attacker-controlled (open DCR) — plain
                        text node only, never dangerouslySetInnerHTML. */}
                    <CardTitle>{app.clientName}</CardTitle>
                    <CardDescription>
                      Granted {formatDate(app.grantedAt)}
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={revokeMutation.isPending}
                    onClick={() => revokeMutation.mutate(app.clientId)}
                  >
                    Revoke
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1">
                  {app.scopes.map((scope) => (
                    <Badge key={scope} variant="secondary">
                      {scope}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
