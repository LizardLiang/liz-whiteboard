import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
  redirect,
  useRouterState,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import { Header } from '../components/layout/Header'
import { Sidebar } from '../components/layout/Sidebar'
import { ThemeProvider } from '../hooks/use-theme'
import { useZenMode } from '../hooks/use-zen-mode'
import { Toaster } from '../components/ui/sonner'
import { AuthProvider } from '../components/auth/AuthContext'
import { SessionExpiredModal } from '../components/auth/SessionExpiredModal'

import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'

import appCss from '../styles.css?url'

import { getCurrentUser } from './api/auth'
import type { QueryClient } from '@tanstack/react-query'

interface MyRouterContext {
  queryClient: QueryClient
  user?: { id: string; username: string; email: string }
}

// Routes that do not require authentication
// '/invite' is public because invite links are designed to be opened by
// logged-out visitors (see src/routes/invite.$token.tsx) — the landing page
// itself does its own client-side getCurrentUser check to decide whether to
// show sign-in/register CTAs or an "Accept invite" button. Actually
// redeeming the invite still requires auth (enforced server-side by
// redeemInvite's requireAuth wrapper).
// '/share' is public (GH #109) — read-only whiteboard share links are
// designed to be opened by anyone holding the URL, with no session at all
// (see src/routes/share.$token.tsx). Unlike '/invite', there is no
// authenticated follow-up action on this route; it only ever reads via the
// unauthenticated getSharedWhiteboard server fn.
const PUBLIC_PATHS = ['/login', '/register', '/invite', '/share']

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'ER Whiteboard - Collaborative Diagram Editor',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),

  beforeLoad: async ({ location }) => {
    // Allow public routes without auth
    if (PUBLIC_PATHS.some((p) => location.pathname.startsWith(p))) {
      return
    }

    // Check current session
    const result = await getCurrentUser()
    if (!result) {
      throw redirect({
        to: '/login',
        search: { redirect: location.pathname },
      })
    }

    return { user: result.user }
  },

  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isPublicRoute = PUBLIC_PATHS.some((p) => pathname.startsWith(p))
  const { isZenMode } = useZenMode()

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>
            {isPublicRoute ? (
              // Public routes: render content only (no header/sidebar)
              <main>{children}</main>
            ) : isZenMode ? (
              // Zen mode: hide the global shell, canvas fills the viewport
              <main className="h-screen overflow-auto">{children}</main>
            ) : (
              // Authenticated routes: render full shell
              <div className="flex h-screen flex-col">
                <Header />
                <div className="flex flex-1 overflow-hidden">
                  <Sidebar />
                  <main className="flex-1 overflow-auto">{children}</main>
                </div>
              </div>
            )}
            <SessionExpiredModal />
            <Toaster />
            {import.meta.env.DEV && (
              <TanStackDevtools
                config={{
                  position: 'bottom-right',
                }}
                plugins={[
                  {
                    name: 'Tanstack Router',
                    render: <TanStackRouterDevtoolsPanel />,
                  },
                  TanStackQueryDevtools,
                ]}
              />
            )}
          </AuthProvider>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}
