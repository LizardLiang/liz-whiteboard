import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import { version } from './package.json'
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

        // Socket.IO in dev is handled by the standalone server.dev.ts process.
        // Vite proxies /socket.io/* to it (see server.proxy config below).
        console.log('[socket-io] Dev mode: Socket.IO runs via server.dev.ts (proxied from Vite).')
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

const SOCKET_IO_DEV_PORT = 3010

const config = defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    proxy: {
      '/socket.io': {
        target: `http://localhost:${SOCKET_IO_DEV_PORT}`,
        ws: true,
        changeOrigin: true,
      },
    },
  },
  plugins: [
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    tanstackStartClientVirtualModules(),
    tanstackStart({
      router: {
        routeFileIgnorePattern:
          '\\.(test|spec)\\.(ts|tsx)$|^(auth|collaboration|columns|folders|permissions|projects|relationships|tables|whiteboards)\\.ts$',
      },
    }),
    nitro({ preset: 'node_middleware' }),
    viteReact(),
    socketIOPlugin(),
  ],
})

export default config
