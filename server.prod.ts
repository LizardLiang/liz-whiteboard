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
import {
  
  
  createServer
} from 'node:http'
import { extname, join } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
// @ts-expect-error — Nitro build output has no type declarations
import { middleware } from './.output/server/index.mjs'
import { initializeSocketIO } from './src/routes/api/collaboration'
import type {IncomingMessage, ServerResponse} from 'node:http';

const port = Number(process.env.PORT) || 3000
const host = process.env.HOST || '0.0.0.0'
const publicDir = join(import.meta.dir, '.output', 'public')

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
}

async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url || '/', `http://${req.headers.host}`)
  const pathname = decodeURIComponent(url.pathname)

  // Prevent directory traversal
  if (pathname.includes('..')) return false

  const filePath = join(publicDir, pathname)
  try {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) return false

    const ext = extname(filePath)
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'
    const content = await readFile(filePath)

    // Immutable cache for hashed assets, short cache for others
    const cacheControl = pathname.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=3600'

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': content.length,
      'Cache-Control': cacheControl,
    })
    res.end(content)
    return true
  } catch {
    return false
  }
}

const server = createServer(async (req, res) => {
  // Try serving static files first (bypasses SSR auth)
  const served = await serveStatic(req, res)
  if (!served) {
    middleware(req, res)
  }
})

// Attach Socket.IO to the HTTP server (sets up namespaces, auth, etc.)
initializeSocketIO(server)

server.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`)
})
