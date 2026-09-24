// src/lib/auth/turnstile.ts
// Server-side verification of a Cloudflare Turnstile response token
// (forgot-password form). Fails closed: a missing token, a
// missing secret, a network error, or a non-success verdict all return
// false. Dev/e2e use Cloudflare's published always-pass test keys (site
// 1x00000000000000000000AA / secret 1x0000000000000000000000000000000AA).

const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const VERIFY_TIMEOUT_MS = 5000

interface TurnstileVerifyResponse {
  success: boolean
}

/**
 * Verify a Turnstile response token against Cloudflare's siteverify endpoint.
 *
 * @param token - The `cf-turnstile-response` token from the client widget
 * @param ip - The caller's IP (passed to Cloudflare as `remoteip`)
 * @returns true only on an explicit `success: true` verdict
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  ip: string,
): Promise<boolean> {
  if (!token) return false

  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return false

  const body = new URLSearchParams({
    secret,
    response: token,
    remoteip: ip,
  })

  let response: Response
  try {
    response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    })
  } catch {
    // Network error / timeout — fail closed.
    return false
  }

  if (!response.ok) return false

  let data: TurnstileVerifyResponse
  try {
    data = (await response.json()) as TurnstileVerifyResponse
  } catch {
    return false
  }

  return data.success === true
}
