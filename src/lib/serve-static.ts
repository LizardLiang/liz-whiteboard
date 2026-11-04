import { readFile, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

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

export async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  publicDir: string,
): Promise<boolean> {
  try {
    // URL parsing and decoding throw on a malformed request target or a bad
    // percent-escape; those requests are not static files. The Host header is
    // never read: it is attacker-controlled and unused for a path lookup.
    const url = new URL(req.url || '/', 'http://localhost')
    const pathname = decodeURIComponent(url.pathname)

    // Prevent directory traversal
    if (pathname.includes('..')) return false

    const filePath = join(publicDir, pathname)
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
