// Crash-proofing for Socket.IO event listeners.
//
// Socket.IO hands a listener whatever the client sent: `data` can be null or
// any JSON value, and the last argument is "the ack" even when the client
// passed a non-function (`emit('x', {}, 1)`). Listeners that call `cb?.(...)`
// or read `data.id` in a catch block then throw OUTSIDE their own try, and an
// async listener that throws is an unhandled rejection that kills the process.
//
// guardSocketHandlers wraps socket.on once per socket so that every listener
// gets (a) a function-or-undefined ack and (b) a catch-all that logs and acks
// an error. One wrapper keeps the ~40 handlers' own logic untouched.

const UNGUARDED_EVENTS = new Set(['disconnect', 'disconnecting', 'error'])
const GUARDED = Symbol.for('liz.socketGuarded')

export const UUID_PATTERN =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
export const WHITEBOARD_NAMESPACE_RE = new RegExp(
  `^/whiteboard/${UUID_PATTERN}$`,
)
export const CANVAS_NAMESPACE_RE = new RegExp(`^/canvas/${UUID_PATTERN}$`)

interface GuardableSocket {
  on: (event: string, listener: (...args: Array<any>) => any) => unknown
  emit?: (event: string, payload: unknown) => unknown
  [GUARDED]?: boolean
}

export function guardSocketHandlers(socket: any): void {
  const target = socket as GuardableSocket
  if (target[GUARDED]) return
  target[GUARDED] = true
  const originalOn = target.on.bind(target)

  target.on = (event: string, listener: (...args: Array<any>) => any) => {
    if (UNGUARDED_EVENTS.has(event)) return originalOn(event, listener)

    return originalOn(event, async (...args: Array<any>) => {
      // Everything after the payload is an ack slot: keep functions only.
      const safeArgs = args.map((arg, i) =>
        i === 0 || typeof arg === 'function' ? arg : undefined,
      )
      const ack =
        typeof args[args.length - 1] === 'function'
          ? (args[args.length - 1] as (res: unknown) => void)
          : undefined
      try {
        await listener(...safeArgs)
      } catch (error) {
        console.error(`Unhandled error in socket handler '${event}':`, error)
        try {
          ack?.({
            ok: false,
            code: 'INTERNAL_ERROR',
            message: 'Internal error',
          })
        } catch {
          // the client's ack itself failed; nothing more to do
        }
      }
    })
  }
}

/**
 * Wrap a namespace `connection` callback. Its awaited checks (requireRole,
 * session setup) can reject; an unwrapped async callback turns that into an
 * unhandled rejection that only the process backstop sees. Log it and drop
 * the socket instead.
 */
export function safeConnectionHandler<
  TSocket extends { disconnect: (close?: boolean) => unknown },
>(
  handler: (socket: TSocket) => Promise<void> | void,
): (socket: TSocket) => Promise<void> {
  return async (socket: TSocket) => {
    try {
      await handler(socket)
    } catch (error) {
      console.error('Unhandled error in socket connection handler:', error)
      try {
        socket.disconnect(true)
      } catch {
        // already closed
      }
    }
  }
}
