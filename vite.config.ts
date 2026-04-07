import { defineConfig, isRunnableDevEnvironment } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

/**
 * Vite plugin that attaches Socket.IO to the dev server's HTTP server.
 *
 * TanStack Start uses Vite's environment API. The underlying Node.js HTTP
 * server is exposed as `viteDevServer.httpServer`. We import the
 * collaboration module through the SSR environment runner (same pattern
 * used by TanStack Start's own dev-server plugin) so Prisma and other
 * server-only imports resolve correctly.
 *
 * The returned function from `configureServer` is the "post-middleware"
 * hook — it runs AFTER all other plugins' middleware is registered, which
 * ensures the HTTP server is fully configured before Socket.IO attaches.
 */
function socketIOPlugin(): Plugin {
  return {
    name: 'socket-io',
    configureServer(viteDevServer) {
      return async () => {
        const { httpServer } = viteDevServer

        if (!httpServer) {
          console.warn(
            '[socket-io] httpServer is not available (middleware mode?). Socket.IO not initialized.',
          )
          return
        }

        // Find the SSR server environment so we can import server-side modules
        // through the module runner (honours path aliases and server-only deps).
        // TanStack Start 1.132 names this environment "ssr" (not "server") for
        // backwards compatibility with plugins that don't understand the new
        // Vite Environment API.
        const serverEnvName = 'ssr'
        const serverEnv = viteDevServer.environments[serverEnvName]

        if (!serverEnv || !isRunnableDevEnvironment(serverEnv)) {
          console.warn(
            '[socket-io] Server environment not found or not runnable. Socket.IO not initialized.',
          )
          return
        }

        try {
          // Import the collaboration module in the SSR context.
          // The path must be absolute so the module runner can resolve it.
          const collaborationModule = (await serverEnv.runner.import(
            '/src/routes/api/collaboration.ts',
          ))

          collaborationModule.initializeSocketIO(httpServer)
          console.log('[socket-io] Socket.IO attached to dev HTTP server.')
        } catch (err) {
          console.error('[socket-io] Failed to initialize Socket.IO:', err)
        }
      }
    },
  }
}

/**
 * Workaround for TanStack Start 1.133.x + Vite 7.x bug:
 * `loadVirtualModule.js` imports `tanstack-start-injected-head-scripts:v`
 * on the client side, but the resolver only applies to server environments.
 * This stub resolves it on the client so hydration isn't blocked.
 */
function tanstackStartClientVirtualModules(): Plugin {
  const virtualModules: Record<string, string> = {
    'tanstack-start-injected-head-scripts:v':
      'export const injectedHeadScripts = undefined;',
    'tanstack-start-manifest:v': 'export default {};',
    '#tanstack-start-server-fn-manifest': 'export default {};',
  }
  const resolvedPrefix = '\0tanstack-client-virtual:'

  return {
    name: 'tanstack-start-client-virtual-modules',
    applyToEnvironment: (env) => env.config.consumer === 'client',
    resolveId: {
      filter: {
        id: /^(tanstack-start-(injected-head-scripts|manifest):v|#tanstack-start-server-fn-manifest)$/,
      },
      handler(id) {
        if (id in virtualModules) return resolvedPrefix + id
        return null
      },
    },
    load: {
      filter: { id: /^\0tanstack-client-virtual:/ },
      handler(id) {
        const originalId = id.slice(resolvedPrefix.length)
        return virtualModules[originalId] || null
      },
    },
  }
}

const config = defineConfig({
  plugins: [
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    tanstackStartClientVirtualModules(),
    tanstackStart(),
    viteReact(),
    socketIOPlugin(),
  ],
})

export default config
