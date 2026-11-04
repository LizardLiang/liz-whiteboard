/**
 * Custom production server for liz-whiteboard.
 * Wraps the Nitro middleware with a Node.js HTTP server
 * and attaches Socket.IO for real-time collaboration.
 *
 * Static assets from .output/public/ are served directly
 * before hitting the Nitro SSR handler, so they bypass auth.
 *
 * Usage: bun run server.prod.ts
 */
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error — Nitro build output has no type declarations
import { middleware } from './.output/server/index.mjs'
import { initializeSocketIO } from './src/routes/api/collaboration'
import { serveStatic } from './src/lib/serve-static'
import { PEER_IP_HEADER } from './src/lib/rate-limit'
import {
  buildSecurityHeaders,
  checkBodyLimit,
  maxBodyBytes,
} from './src/lib/security-headers'

const port = Number(process.env.PORT) || 3000
const host = process.env.HOST || '0.0.0.0'
// import.meta.dir is a Bun-only ImportMeta extension (no ambient types
// installed for it — see e2e/bun-sqlite.d.ts for why bun-types isn't
// pulled in globally). import.meta.url + fileURLToPath is the portable,
// standard-ESM equivalent Bun also supports.
const scriptDir = dirname(fileURLToPath(import.meta.url))
const publicDir = join(scriptDir, '.output', 'public')

const securityHeaders = buildSecurityHeaders()
const bodyLimit = maxBodyBytes()

const server = createServer(async (req, res) => {
  try {
    // Stamp the TCP peer address, overwriting anything the client sent, so
    // extractClientIp() can tell whether X-Forwarded-For comes from a trusted
    // proxy (src/lib/rate-limit.ts).
    req.headers[PEER_IP_HEADER] = req.socket.remoteAddress ?? ''

    // Security headers on every response (static and SSR, errors included).
    for (const [name, value] of Object.entries(securityHeaders)) {
      res.setHeader(name, value)
    }

    // Bound the request body before anything reads it.
    const verdict = checkBodyLimit(req.method ?? 'GET', req.headers, bodyLimit)
    if (verdict !== 'ok') {
      res.writeHead(verdict === 'too-large' ? 413 : 411, {
        'Content-Type': 'text/plain',
        Connection: 'close',
      })
      res.end(verdict === 'too-large' ? 'Payload Too Large' : 'Length Required')
      req.resume()
      return
    }

    // Try serving static files first (bypasses SSR auth)
    const served = await serveStatic(req, res, publicDir)
    if (!served) {
      await middleware(req, res)
    }
  } catch (error) {
    console.error('Request handler failed:', error)
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
    }
    if (!res.writableEnded) res.end('Internal Server Error')
  }
})

// Backstop only: the handlers above catch their own errors. A stray rejection
// from any other async path must not take the whole server down.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason)
})
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error)
})

// Attach Socket.IO to the HTTP server (sets up namespaces, auth, etc.)
initializeSocketIO(server)

server.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`)
})
