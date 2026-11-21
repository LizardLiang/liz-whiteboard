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
// X-Forwarded-For (and X-Real-IP, only when TRUSTED_PROXIES is set) are
// honoured ONLY when that peer is a trusted proxy (env TRUSTED_PROXIES: comma list of IPs/CIDRs; default loopback plus
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

interface PeerStampTarget {
  headers: Record<string, string | Array<string> | undefined>
  rawHeaders: Array<string>
  socket: { remoteAddress?: string }
}

/**
 * Record the direct TCP peer as PEER_IP_HEADER on a Node request, replacing any
 * value the client sent. It writes `rawHeaders` as well as `headers`: srvx
 * builds the web Request that reaches the server functions from `rawHeaders`,
 * so a stamp on `headers` alone is lost in the Vite dev server.
 */
export function stampPeerIp(req: PeerStampTarget): void {
  const peer = req.socket.remoteAddress ?? ''
  req.headers[PEER_IP_HEADER] = peer
  for (let i = req.rawHeaders.length - 2; i >= 0; i -= 2) {
    if (req.rawHeaders[i].toLowerCase() === PEER_IP_HEADER) {
      req.rawHeaders.splice(i, 2)
    }
  }
  req.rawHeaders.push(PEER_IP_HEADER, peer)
}

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
    const [head, tail = ''] = addr.split('::')
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
  const parts = entry.trim().split('/')
  const addr = parts[0]
  const len = parts.at(1)
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
  // Every hop is a trusted proxy: the rightmost was appended by the nearest
  // proxy; everything to its left is client-controlled.
  if (hops.length > 0) return hops[hops.length - 1]

  // X-Real-IP is a single client-settable value: honour it only when the
  // operator pinned the proxy list explicitly.
  if (process.env.TRUSTED_PROXIES?.trim()) {
    const realIp = request.headers.get('x-real-ip')?.trim()
    if (realIp && parseIp(realIp)) return realIp
  }
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
  /** Number of tracked keys. For tests only. */
  size: () => number
}

/** Default cap on tracked keys per limiter, sized well above normal traffic. */
export const RATE_LIMIT_MAX_KEYS = 10_000

/**
 * Collapse an IPv6 address to its /64 prefix so one host (which controls a
 * whole /64) cannot mint unlimited keys. IPv4, IPv4-mapped IPv6 and any
 * non-IP key (an email, 'unknown') are returned unchanged.
 */
export function normalizeRateLimitKey(key: string): string {
  const parsed = parseIp(key)
  if (parsed?.version !== 6) return key
  return `v6/64:${(parsed.value >> 64n).toString(16)}`
}

/** Overflow shards used when every tracked key is blocked. */
export const RATE_LIMIT_OVERFLOW_SHARDS = 64

/** Entries examined from the least-recently-used end per new key at the cap. */
const EVICTION_SCAN_LIMIT = 256

/** Stable shard index (FNV-1a) for a normalized key. */
export function overflowShardIndex(key: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % RATE_LIMIT_OVERFLOW_SHARDS
}

/**
 * Create an in-process fixed-window rate limiter (resets on restart).
 * Each call to check() with the same key within `windowMs` of the first
 * call increments a counter; once the counter exceeds `max`, check()
 * returns false until the window rolls over. IPv6 keys share a window per /64.
 *
 * Memory is bounded: the map never holds more than `maxKeys` keys. Entries are
 * re-inserted on every touch, so Map order is least-recently-used first. For a
 * new key at the cap, a bounded scan from the LRU end deletes expired windows
 * and picks the first live entry with count === 1 (and below max) as the
 * eviction candidate. An entry with count >= 2 is never evicted before its
 * window ends, so flooding new keys cannot reset a key that has spent budget. If no candidate exists (every
 * scanned entry has count >= 2), the key falls into one of 64 overflow shards that
 * each apply the normal max/window; one shard's flood leaves the others usable.
 */
export function createFixedWindowRateLimiter(opts: {
  max: number
  windowMs: number
  maxKeys?: number
}): RateLimiter {
  const map = new Map<string, RateLimitEntry>()
  const maxKeys = opts.maxKeys ?? RATE_LIMIT_MAX_KEYS
  const shards: Array<RateLimitEntry | null> = new Array<RateLimitEntry | null>(
    RATE_LIMIT_OVERFLOW_SHARDS,
  ).fill(null)

  /** Free one slot. Returns false when no entry may be evicted. */
  function makeRoom(now: number): boolean {
    let candidate: string | null = null
    let scanned = 0
    for (const [key, entry] of map) {
      if (scanned++ >= EVICTION_SCAN_LIMIT) break
      if (now - entry.windowStart >= opts.windowMs) {
        map.delete(key)
      } else if (candidate === null && entry.count === 1 && opts.max > 1) {
        candidate = key
      }
    }
    if (map.size < maxKeys) return true
    if (candidate === null) return false
    map.delete(candidate)
    return true
  }

  function checkShard(key: string, now: number): boolean {
    const i = overflowShardIndex(key)
    const shard = shards[i]
    if (!shard || now - shard.windowStart >= opts.windowMs) {
      shards[i] = { count: 1, windowStart: now }
      return true
    }
    shard.count += 1
    return shard.count <= opts.max
  }

  return {
    check(rawKey: string): boolean {
      const key = normalizeRateLimitKey(rawKey)
      const now = Date.now()
      const entry = map.get(key)
      if (!entry) {
        if (map.size >= maxKeys && !makeRoom(now)) return checkShard(key, now)
        map.set(key, { count: 1, windowStart: now })
        return true
      }
      map.delete(key)
      if (now - entry.windowStart >= opts.windowMs) {
        map.set(key, { count: 1, windowStart: now })
        return true
      }
      entry.count += 1
      map.set(key, entry)
      return entry.count <= opts.max
    },
    reset(): void {
      map.clear()
      shards.fill(null)
    },
    size(): number {
      return map.size
    },
  }
}
