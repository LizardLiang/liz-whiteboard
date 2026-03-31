import { defineConfig, isRunnableDevEnvironment } from 'vite'
import type { Plugin } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'

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
          )) as { initializeSocketIO: (server: typeof httpServer) => unknown }

          collaborationModule.initializeSocketIO(httpServer)
          console.log('[socket-io] Socket.IO attached to dev HTTP server.')
        } catch (err) {
          console.error('[socket-io] Failed to initialize Socket.IO:', err)
        }
      }
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
    tanstackStart(),
    viteReact(),
    socketIOPlugin(),
  ],
})

export default config
