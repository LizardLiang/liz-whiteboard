// src/lib/auth/socket-handshake.ts
// Socket.IO handshake authentication, shared by every collaboration namespace.
//
// Extracted from `setupWhiteboardNamespace` in src/routes/api/collaboration.ts
// when the canvas engine added a second namespace (`/canvas/:boardId`,
// Wave 4). The body is unchanged; what changed is that there is now exactly
// ONE copy of it. Two namespaces each with their own handshake check is how a
// fix lands on one path and not the other.
//
// This middleware authenticates only. Project-level RBAC is a separate,
// per-namespace step (`requireRole` / `requireCanvasBoardRole`) — an
// authenticated user is not thereby authorised for any particular board.

import { parseSessionCookie } from '@/lib/auth/cookies'
import { validateSessionToken } from '@/lib/auth/session'
import { validateCollabToken } from '@/lib/oauth/collab-verify'

/** The minimum socket surface this middleware touches. */
export interface HandshakeSocket {
  handshake: {
    auth: unknown
    headers: { cookie?: string }
  }
  data: Record<string, unknown>
}

/**
 * Authenticate a Socket.IO connection attempt.
 *
 * Two auth paths (in priority order):
 *
 * 1. JWT path (MCP server): the MCP backend sends a short-lived
 *    collab-audience JWT in socket.handshake.auth.token (set via socket.io
 *    SetAuth on the Go socket.io-client-go). The JWT was issued by
 *    /api/collab-token and has: iss=AS issuer, aud=COLLAB_RESOURCE_URI,
 *    sub=User.id, exp=now+120s. On success: socket.data.userId=sub,
 *    socket.data.sessionExpiresAt=exp*1000.
 *
 * 2. Cookie path (browser app): reads the session_token cookie from the
 *    handshake headers and validates via validateSessionToken.
 *
 * The two paths are mutually exclusive per connection; the JWT path is tried
 * first.
 */
export async function authenticateSocketHandshake(
  socket: HandshakeSocket,
  next: (err?: Error) => void,
): Promise<void> {
  try {
    // --- JWT path (MCP server) ---
    // No `?.` on `.auth` itself (process note, Hermes code review round
    // on the shapes-and-connectors feature: this line's prior `?.` was
    // removed in that same commit without a documented reason, which is
    // the actual issue being fixed here — the removal itself was already
    // correct). `socket.handshake.auth` is provably always an object,
    // never null/undefined: socket.io-client's `connect(name, auth = {})`
    // (socket.io/dist/client.js) defaults it whenever a client omits the
    // `auth` option, which is exactly the cookie-path (browser) case this
    // comment used to claim was unsafe; and socket.io-parser's
    // `isPayloadValid` rejects a `null` CONNECT payload before it ever
    // reaches this handler. `.token` on that object is always a safe
    // property read.
    const authToken = (socket.handshake.auth as Record<string, unknown>).token
    if (authToken && typeof authToken === 'string') {
      try {
        const payload = await validateCollabToken(authToken)
        socket.data.userId = payload.sub
        socket.data.sessionId = '' // no DB session for JWT auth path
        socket.data.sessionExpiresAt = payload.exp * 1000
        return next()
      } catch (jwtErr) {
        // JWT present but invalid — reject immediately rather than falling
        // through to cookie path. A caller that sends auth.token but has an
        // invalid JWT should not silently succeed via cookie.
        console.warn('[collab] JWT auth failed:', jwtErr)
        return next(new Error('UNAUTHORIZED'))
      }
    }

    // --- Cookie path (browser app) ---
    const cookieHeader = socket.handshake.headers.cookie ?? ''
    const token = parseSessionCookie(cookieHeader)
    if (!token) {
      return next(new Error('UNAUTHORIZED'))
    }

    const authResult = await validateSessionToken(token)
    if (!authResult) {
      return next(new Error('UNAUTHORIZED'))
    }

    // Attach auth data to socket for use in event handlers
    socket.data.userId = authResult.user.id
    socket.data.sessionId = authResult.session.id
    socket.data.sessionExpiresAt = authResult.session.expiresAt.getTime()
    next()
  } catch {
    next(new Error('UNAUTHORIZED'))
  }
}

/**
 * True when the handshake-issued session has expired, or when there is no
 * usable expiry at all.
 *
 * In-memory comparison against the expiry the middleware above attached — no
 * database round-trip. Shared by every namespace so one mutation path cannot
 * end up without the check.
 *
 * The `typeof` test is the whole point of the rewrite: `Date.now() >
 * undefined` is `false`, so a socket that reached a handler without an expiry
 * would be treated as having a VALID session. Unreachable today — every path
 * through the middleware above sets one — but this is an exported auth
 * primitive shared across namespaces, and its entire job is to fail closed.
 * A future namespace that forgets to run the middleware must be denied, not
 * admitted.
 */
export function isSocketSessionExpired(socket: {
  data: Record<string, unknown>
}): boolean {
  const expiresAt = socket.data.sessionExpiresAt
  // Number.isFinite, not typeof: NaN IS a number, and `Date.now() > NaN` is
  // false, so a typeof check alone still admits it. (Found by the NaN case in
  // this function's own test.)
  return !Number.isFinite(expiresAt) || Date.now() > (expiresAt as number)
}
