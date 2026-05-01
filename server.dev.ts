/**
 * Standalone Socket.IO dev server.
 *
 * Run alongside `bun run dev` (Vite) so Socket.IO is available in development.
 * Vite proxies /socket.io/* to this process (see vite.config.ts server.proxy).
 *
 * Usage: bun run dev:server
 */
import { createServer } from 'node:http'
import { initializeSocketIO } from './src/routes/api/collaboration'

const PORT = Number(process.env.SOCKET_IO_DEV_PORT) || 3010

const httpServer = createServer((_req, res) => {
  // Health check — Vite proxy only forwards /socket.io/* traffic here.
  res.writeHead(200)
  res.end('socket-io-dev ok')
})

initializeSocketIO(httpServer)

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[socket-io-dev] Socket.IO listening on port ${PORT}`)
})
