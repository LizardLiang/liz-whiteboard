import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import * as esbuild from 'esbuild'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Plugin } from 'vite'

/**
 * Vite plugin that attaches Socket.IO to the dev server's HTTP server.
 *
 * Nitro (used by TanStack Start) runs server code in a Node.js Worker thread
 * via the `node-worker` env-runner, so the Worker's module scope is isolated
 * from the main thread. The Vite `ssr` environment no longer exists (replaced
 * by Nitro's `FetchableDevEnvironment`), and globalThis is not shared across
 * thread boundaries.
 *
 * The only clean way to call `initializeSocketIO(httpServer)` from the main
 * thread is to bundle `collaboration.ts` with esbuild (which resolves `@/`
 * tsconfig path aliases) and import the resulting plain-ESM bundle directly.
 * npm packages are kept external so the installed versions are used at runtime.
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

        const root = process.cwd()
        const outDir = join(root, 'node_modules', '.cache', 'socket-io-dev')
        const outFile = join(outDir, 'collaboration.mjs')

        try {
          mkdirSync(outDir, { recursive: true })

          // Bundle collaboration.ts so @/ path aliases are resolved at build time.
          // npm packages stay external — Node.js will resolve them from node_modules.
          await esbuild.build({
            entryPoints: [join(root, 'src/routes/api/collaboration.ts')],
            outfile: outFile,
            bundle: true,
            format: 'esm',
            platform: 'node',
            target: 'node20',
            packages: 'external',
            tsconfig: join(root, 'tsconfig.json'),
            logLevel: 'silent',
          })

          // Cache-bust the import so restarting the dev server picks up changes.
          const collaborationModule = await import(
            `${pathToFileURL(outFile).href}?t=${Date.now()}`
          )
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
