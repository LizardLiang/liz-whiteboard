// src/routes/token.ts
// OAuth 2.1 /token endpoint — authorization_code and refresh_token grants.
// The logic lives in src/lib/oauth/token-endpoint.ts (dynamic import: server
// modules must not be bundled into the client).

import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/token')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleTokenPost } = await import('@/lib/oauth/token-endpoint')
        return handleTokenPost(request)
      },
    },
  },
})
