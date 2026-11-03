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
import { getMcpEndpointUrl } from '@/lib/server-functions'
import { McpConnectPanel } from '@/components/mcp/McpConnectPanel'
import { useI18n } from '@/lib/i18n/use-t'
import { formatDate } from '@/lib/i18n/translate'

export const Route = createFileRoute('/settings/connections')({
  component: ConnectionsPage,
})

function ConnectionsPage() {
  const { t, locale } = useI18n()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['connected-apps'],
    queryFn: () => listConnectedApps(),
  })

  // Same query key/options as the toolbar's mount (ReactFlowWhiteboard.tsx)
  // so both share the one cached fetch — reuses the existing auth-gated
  // getMcpEndpointUrl() server fn rather than adding a second one.
  const { data: mcpEndpointUrl } = useQuery({
    queryKey: ['mcp-endpoint-url'],
    queryFn: () => getMcpEndpointUrl(),
    staleTime: Infinity,
    gcTime: Infinity,
  })

  const revokeMutation = useMutation({
    mutationFn: (clientId: string) =>
      revokeConnectedApp({ data: { clientId } }),
    onSuccess: () => {
      toast.success(t('settings.connections.revoked'))
      queryClient.invalidateQueries({ queryKey: ['connected-apps'] })
    },
    onError: () => {
      toast.error(t('settings.connections.revokeFailed'))
    },
  })

  // Narrow away the requireAuth() session-expired shape (SessionExpiredModal,
  // mounted at the root, already handles surfacing that case globally).
  const apps: Array<ConnectedApp> =
    data && !isUnauthorizedError(data) ? data.apps : []

  // Same AuthErrorResponse-narrowing pattern as ReactFlowWhiteboard.tsx's own
  // mcpEndpointUrl usage — getMcpEndpointUrl() resolves to a session-expired
  // shape rather than throwing on an expired session.
  const resolvedMcpEndpointUrl =
    mcpEndpointUrl && !isUnauthorizedError(mcpEndpointUrl)
      ? mcpEndpointUrl
      : undefined

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">{t('settings.connections.title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('settings.connections.description')}
      </p>

      {resolvedMcpEndpointUrl && (
        <div className="mt-6 rounded-lg border p-4">
          <h2 className="text-sm font-semibold">
            {t('settings.connections.connectMcp')}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('settings.connections.connectMcpHint')}
          </p>
          <div className="mt-3">
            <McpConnectPanel endpointUrl={resolvedMcpEndpointUrl} />
          </div>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : apps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('settings.connections.empty')}
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
                      {t('settings.connections.granted', {
                        date: formatDate(locale, app.grantedAt, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        }),
                      })}
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={revokeMutation.isPending}
                    onClick={() => revokeMutation.mutate(app.clientId)}
                  >
                    {t('settings.connections.revoke')}
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
