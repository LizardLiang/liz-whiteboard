// src/routes/revoke.ts
// OAuth 2.0 Token Revocation endpoint (RFC 7009). Logic lives in
// src/lib/oauth/revoke-endpoint.ts (dynamic import keeps server modules out of
// the client bundle).

import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/revoke')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleRevokePost } = await import('@/lib/oauth/revoke-endpoint')
        return handleRevokePost(request)
      },
    },
  },
})
