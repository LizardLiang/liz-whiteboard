// src/lib/rate-limit.ts
// Shared per-IP fixed-window rate limiter + trusted-proxy client-IP
// extraction. Used by src/routes/oauth/register.ts and
// src/routes/api/collab-token.ts (previously duplicated independently in
// each file — W5 fix).
//
// TRUST BOUNDARY: the direct TCP peer is the only address a client cannot
// forge. server.prod.ts (and the Vite dev middleware) stamp it on every
// request as the PEER_IP_HEADER, overwriting any value the client sent.
//
// X-Forwarded-For / X-Real-IP are honoured ONLY when that peer is a trusted
// proxy (env TRUSTED_PROXIES: comma list of IPs/CIDRs; default loopback plus
// the private ranges 10/8, 172.16/12, 192.168/16 that Docker networks use).
// When port 3000 is reachable directly, the peer is the attacker, is not a
// trusted proxy, and its XFF header is ignored (audit L2).
//
// With a trusted peer, XFF is walked from the right: each trusted proxy
// appends the address it saw, so the first non-trusted hop from the right is
// the real client. Anything left of it is client-controlled and ignored.
import { isIP } from 'node:net'

/** Header that carries the direct peer address, set by the server entry. */
export const PEER_IP_HEADER = 'x-liz-peer-ip'

const DEFAULT_TRUSTED_PROXIES =
  '127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16'

interface Cidr {
  version: 4 | 6
  base: bigint
  bits: number
}

function parseIp(ip: string): { version: 4 | 6; value: bigint } | null {
  let addr = ip.trim()
  if (addr.toLowerCase().startsWith('::ffff:') && isIP(addr.slice(7)) === 4) {
    addr = addr.slice(7)
  }
  const kind = isIP(addr)
  if (kind === 4) {
    const value = addr
      .split('.')
      .reduce((acc, part) => (acc << 8n) | BigInt(Number(part)), 0n)
    return { version: 4, value }
  }
  if (kind === 6) {
    let [head, tail = ''] = addr.split('::')
    if (!addr.includes('::')) {
      tail = ''
    }
    const toGroups = (part: string): Array<string> =>
      part === '' ? [] : part.split(':')
    const headGroups = toGroups(head)
    const tailGroups = addr.includes('::') ? toGroups(tail) : []
    const groups = addr.includes('::')
      ? [
          ...headGroups,
          ...Array<string>(8 - headGroups.length - tailGroups.length).fill('0'),
          ...tailGroups,
        ]
      : headGroups
    const value = groups.reduce(
      (acc, g) => (acc << 16n) | BigInt(parseInt(g, 16)),
      0n,
    )
    return { version: 6, value }
  }
  return null
}

function parseCidr(entry: string): Cidr | null {
  const [addr, len] = entry.trim().split('/')
  const parsed = parseIp(addr)
  if (!parsed) return null
  const max = parsed.version === 4 ? 32 : 128
  const bits = len === undefined ? max : Number(len)
  if (!Number.isInteger(bits) || bits < 0 || bits > max) return null
  return { version: parsed.version, base: parsed.value, bits }
}

function ipInCidr(ip: string, cidr: Cidr): boolean {
  const parsed = parseIp(ip)
  if (!parsed || parsed.version !== cidr.version) return false
  const total = cidr.version === 4 ? 32 : 128
  const shift = BigInt(total - cidr.bits)
  return parsed.value >> shift === cidr.base >> shift
}

function trustedProxyList(): Array<Cidr> {
  const raw = process.env.TRUSTED_PROXIES?.trim() || DEFAULT_TRUSTED_PROXIES
  return raw
    .split(',')
    .map(parseCidr)
    .filter((c): c is Cidr => c !== null)
}

function isTrustedProxy(ip: string, list: Array<Cidr>): boolean {
  return list.some((cidr) => ipInCidr(ip, cidr))
}

export function extractClientIp(request: Request): string {
  const peer = request.headers.get(PEER_IP_HEADER)?.trim()
  // No peer stamp (unit tests, unknown host): forwarded headers cannot be
  // trusted, so the request gets the shared 'unknown' bucket.
  if (!peer) return 'unknown'

  const trusted = trustedProxyList()
  if (!isTrustedProxy(peer, trusted)) return peer

  const xff = request.headers.get('x-forwarded-for')
  const hops = (xff ?? '')
    .split(',')
    .map((hop) => hop.trim())
    .filter((hop) => parseIp(hop) !== null)
  for (let i = hops.length - 1; i >= 0; i--) {
    if (!isTrustedProxy(hops[i], trusted)) return hops[i]
  }
  if (hops.length > 0) return hops[0]

  const realIp = request.headers.get('x-real-ip')?.trim()
  if (realIp && parseIp(realIp)) return realIp
  return peer
}

interface RateLimitEntry {
  count: number
  windowStart: number
}

export interface RateLimiter {
  /** Returns true if `ip` is within the configured limit, false if it exceeds it. */
  check: (ip: string) => boolean
  /** Clears all tracked windows. For tests only. */
  reset: () => void
}

/**
 * Create an in-process fixed-window rate limiter (resets on restart).
 * Each call to check() with the same `ip` within `windowMs` of the first
 * call increments a counter; once the counter exceeds `max`, check()
 * returns false until the window rolls over.
 */
export function createFixedWindowRateLimiter(opts: {
  max: number
  windowMs: number
}): RateLimiter {
  const map = new Map<string, RateLimitEntry>()

  return {
    check(ip: string): boolean {
      const now = Date.now()
      const entry = map.get(ip)
      if (!entry || now - entry.windowStart >= opts.windowMs) {
        map.set(ip, { count: 1, windowStart: now })
        return true
      }
      entry.count += 1
      return entry.count <= opts.max
    },
    reset(): void {
      map.clear()
    },
  }
}
