// src/lib/oauth/ssrf-guard.ts
// SSRF guard for outbound fetches to caller-supplied origins.
//
// WHY THIS EXISTS (mcp-oauth-open-cimd, 2026-08-19): CIMD resolution used to
// fetch only claude.ai/claude.com, so the origin allowlist WAS the SSRF
// control. Open resolution removed that — src/lib/oauth/cimd.ts now fetches
// whatever https origin a client names in its client_id — so the control has
// to be explicit. MCP spec 2026-07-28 lists SSRF protection as a hard
// requirement for any AS that fetches client metadata.
//
// TECHNIQUE (tactical plan F3): pre-flight DNS lookup + IP-range denylist.
// The alternative — resolving once and pinning the connection to the vetted
// IP — needs a custom fetch dispatcher, which is undici-only; this app runs
// Node in dev and Bun in prod (oven/bun:1, see Dockerfile), so a
// dispatcher-based guard would not exist in production. The accepted cost is
// a DNS-rebinding TOCTOU window between this lookup and fetch's own
// resolution. Two things bound the payoff: redirects are never followed
// (`redirect: 'manual'` in cimd.ts) and the document must self-reference the
// exact URL it was fetched from, so a rebound host cannot vouch for another
// identity — it can only reveal that something answered.
//
// This module performs DNS only. It never opens a connection.

import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'
import { getCimdTestOrigins } from './cimd-origins'

/**
 * Hostname suffixes that never resolve to a public host. Blocked before DNS
 * so a split-horizon resolver can't answer for them.
 */
const BLOCKED_SUFFIXES = ['.local', '.internal', '.localhost', '.home.arpa']

/** Bare hostnames with no dot (e.g. `db`, `redis`) — container/LAN names. */
function isBareHostname(hostname: string): boolean {
  return !hostname.includes('.')
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    value = value * 256 + octet
  }
  return value
}

/** CIDR ranges that must never be fetched. */
const BLOCKED_V4_RANGES: Array<{ base: string; bits: number; label: string }> =
  [
    { base: '0.0.0.0', bits: 8, label: 'this-network' },
    { base: '10.0.0.0', bits: 8, label: 'private' },
    { base: '100.64.0.0', bits: 10, label: 'carrier-grade NAT' },
    { base: '127.0.0.0', bits: 8, label: 'loopback' },
    { base: '169.254.0.0', bits: 16, label: 'link-local' },
    { base: '172.16.0.0', bits: 12, label: 'private' },
    { base: '192.0.0.0', bits: 24, label: 'IETF protocol assignments' },
    { base: '192.168.0.0', bits: 16, label: 'private' },
    { base: '198.18.0.0', bits: 15, label: 'benchmarking' },
    { base: '224.0.0.0', bits: 4, label: 'multicast' },
    { base: '240.0.0.0', bits: 4, label: 'reserved' },
  ]

function blockedV4Reason(ip: string): string | null {
  const value = ipv4ToInt(ip)
  if (value === null) return 'unparsable IPv4 address'
  for (const range of BLOCKED_V4_RANGES) {
    const base = ipv4ToInt(range.base)
    if (base === null) continue
    // >>> 0 keeps the mask unsigned; a /0 shift would be a no-op in JS.
    const mask = range.bits === 0 ? 0 : (0xffffffff << (32 - range.bits)) >>> 0
    if ((value & mask) >>> 0 === (base & mask) >>> 0) return range.label
  }
  return null
}

/**
 * Expand an IPv6 literal to its 16 bytes. Handles `::` compression and a
 * trailing dotted-quad (`::ffff:127.0.0.1`). Returns null if unparsable.
 */
function expandIpv6(ip: string): Uint8Array | null {
  let text = ip.toLowerCase()
  // Strip a zone id (fe80::1%eth0) — the address is what matters.
  const zone = text.indexOf('%')
  if (zone !== -1) text = text.slice(0, zone)

  const bytes = new Uint8Array(16)
  let tail: Array<number> = []

  // A trailing dotted-quad occupies the last 4 bytes.
  const lastColon = text.lastIndexOf(':')
  const maybeV4 = text.slice(lastColon + 1)
  if (maybeV4.includes('.')) {
    const value = ipv4ToInt(maybeV4)
    if (value === null) return null
    tail = [
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ]
    text = text.slice(0, lastColon + 1) + '0'
  }

  const halves = text.split('::')
  if (halves.length > 2) return null

  const parseGroups = (segment: string): Array<number> | null => {
    if (segment === '') return []
    const groups: Array<number> = []
    for (const group of segment.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null
      groups.push(parseInt(group, 16))
    }
    return groups
  }

  const head = parseGroups(halves[0])
  const rest = halves.length === 2 ? parseGroups(halves[1]) : []
  if (head === null || rest === null) return null

  // When a dotted-quad was consumed, its placeholder group is dropped and the
  // four literal bytes are appended instead.
  const groupBytes: Array<number> = []
  const pushGroup = (g: number) => groupBytes.push((g >>> 8) & 0xff, g & 0xff)
  head.forEach(pushGroup)

  if (halves.length === 2) {
    const restBytes: Array<number> = []
    rest.forEach((g) => restBytes.push((g >>> 8) & 0xff, g & 0xff))
    const withTail =
      tail.length > 0 ? restBytes.slice(0, -2).concat(tail) : restBytes
    const gapLength = 16 - groupBytes.length - withTail.length
    if (gapLength < 0) return null
    bytes.set(groupBytes, 0)
    bytes.set(withTail, 16 - withTail.length)
    return bytes
  }

  const withTail =
    tail.length > 0 ? groupBytes.slice(0, -2).concat(tail) : groupBytes
  if (withTail.length !== 16) return null
  bytes.set(withTail, 0)
  return bytes
}

function blockedV6Reason(ip: string): string | null {
  const bytes = expandIpv6(ip)
  if (!bytes) return 'unparsable IPv6 address'

  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) both embed a v4
  // address in the last four bytes — the v4 denylist is the real check.
  const isV4Mapped =
    bytes.slice(0, 10).every((b) => b === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff
  const isNat64 =
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b
  if (isV4Mapped || isNat64) {
    const embedded = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`
    const reason = blockedV4Reason(embedded)
    return reason === null ? null : `IPv4-in-IPv6 ${reason}`
  }

  if (bytes.every((b) => b === 0)) return 'unspecified'
  if (bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1)
    return 'loopback'
  if ((bytes[0] & 0xfe) === 0xfc) return 'unique-local'
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return 'link-local'
  if (bytes[0] === 0xff) return 'multicast'

  return null
}

/** Whether a resolved address is in a range we refuse to fetch. */
export function blockedAddressReason(address: string): string | null {
  const family = isIP(address)
  if (family === 4) return blockedV4Reason(address)
  if (family === 6) return blockedV6Reason(address)
  return 'not an IP address'
}

export interface HostCheckResult {
  allowed: boolean
  /** Human-readable refusal reason; null when allowed. */
  reason: string | null
}

/**
 * Decide whether `hostname` may be fetched.
 *
 * `origin` is the full origin the hostname came from, used only to honour the
 * CIMD_TEST_ORIGINS exemption (non-production only — see cimd-origins.ts).
 */
export async function checkPublicHost(
  hostname: string,
  origin: string,
): Promise<HostCheckResult> {
  if (getCimdTestOrigins().includes(origin)) {
    return { allowed: true, reason: null }
  }

  // An IP literal as a client_id host is never a legitimate CIMD publisher and
  // sidesteps the DNS check entirely — refuse both families outright.
  if (isIP(hostname) !== 0) {
    return { allowed: false, reason: 'client_id host is an IP literal' }
  }

  const lower = hostname.toLowerCase()
  if (isBareHostname(lower)) {
    return { allowed: false, reason: 'client_id host has no public suffix' }
  }
  for (const suffix of BLOCKED_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      return { allowed: false, reason: `client_id host ends in ${suffix}` }
    }
  }

  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(lower, { all: true })
  } catch {
    return { allowed: false, reason: 'DNS lookup failed' }
  }

  if (addresses.length === 0) {
    return { allowed: false, reason: 'DNS returned no addresses' }
  }

  // ANY blocked address disqualifies the host. A host that answers with both
  // a public and a private record is exactly the split-horizon case this
  // guard exists to stop — the public record must not launder the private one.
  for (const { address } of addresses) {
    const reason = blockedAddressReason(address)
    if (reason !== null) {
      return { allowed: false, reason: `resolves to ${reason} address` }
    }
  }

  return { allowed: true, reason: null }
}
