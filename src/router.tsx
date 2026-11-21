import './lib/zod-config'
import { createRouter } from '@tanstack/react-router'
import { createServerOnlyFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import * as TanstackQuery from './integrations/tanstack-query/root-provider'

// Import the generated route tree
import { CSP_NONCE_HEADER } from './lib/security-headers'
import { routeTree } from './routeTree.gen'

// Per-request CSP nonce stamped by server.prod.ts. Server only: the client
// router needs no nonce, and the header does not exist in dev.
const readCspNonce = createServerOnlyFn(
  () => getRequestHeader(CSP_NONCE_HEADER) || undefined,
)

// Create a new router instance
export const getRouter = () => {
  const rqContext = TanstackQuery.getContext()

  const router = createRouter({
    routeTree,
    context: { ...rqContext },
    defaultPreload: 'intent',
    ssr: { nonce: import.meta.env.SSR ? readCspNonce() : undefined },
    Wrap: (props: { children: React.ReactNode }) => {
      return (
        <TanstackQuery.Provider {...rqContext}>
          {props.children}
        </TanstackQuery.Provider>
      )
    },
  })

  setupRouterSsrQueryIntegration({ router, queryClient: rqContext.queryClient })

  return router
}
