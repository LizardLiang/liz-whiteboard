// src/lib/oauth/consent-handlers.ts
// Consent server-fn HANDLER LOGIC for the /oauth/consent page — deliberately
// kept out of src/routes/api/oauth-consent.ts. Follows the exact split
// documented in src/lib/invite/handlers.ts: the route file's createServerFn
// wrappers are the only thing a client component imports, so this module
// (and its node:crypto/@/db-touching imports, via grants.ts/pending-
// consent.ts/codes.ts) never gets pulled into the client bundle.
//
// SECURITY: every handler re-checks that the authenticated caller (from the
// session cookie, via requireAuth) matches the userId the pending consent
// request was created for at /authorize time. A request_id is single-use and
// opaque, but this closes the (already narrow) window where a browser tab
// could be handed off between accounts mid-flow.

import type { AuthContext } from '@/lib/auth/middleware'
import type { ConsentRequestId } from '@/data/schema'

export interface ConsentRequestView {
  valid: true
  clientName: string
  redirectUri: string
  scopes: Array<string>
}

export interface ConsentRequestInvalid {
  valid: false
  message: string
}

/**
 * Non-destructive read for the consent page's loader — resolves request_id
 * to the client name / redirect URI / scopes to display, without consuming
 * the pending request (a page reload must still show the same prompt).
 */
export async function getConsentRequestHandler(
  { user }: AuthContext,
  data: ConsentRequestId,
): Promise<ConsentRequestView | ConsentRequestInvalid> {
  const { peekPendingConsent } = await import('./pending-consent')
  const pending = peekPendingConsent(data.requestId)

  if (!pending || pending.userId !== user.id) {
    return {
      valid: false,
      message:
        'This consent request has expired or is invalid. Please try connecting again from your client.',
    }
  }

  return {
    valid: true,
    clientName: pending.clientName,
    redirectUri: pending.redirectUri,
    scopes: pending.scope.split(' ').filter(Boolean),
  }
}

export interface ConsentActionResult {
  success: boolean
  redirectUrl?: string
  message?: string
}

/**
 * Approve: consume the pending request, persist the grant, issue an
 * authorization code, and return the client's redirect_uri with the code
 * attached — same shape /authorize itself would have redirected to had this
 * client been trusted.
 */
export async function approveConsentHandler(
  { user }: AuthContext,
  data: ConsentRequestId,
): Promise<ConsentActionResult> {
  // S2 fix: peek + verify userId BEFORE consuming. Consuming first would let
  // a second logged-in user who merely learns another user's request_id
  // destroy that pending request (denial of service) without ever passing
  // the userId check — since consume deletes unconditionally on lookup.
  const { peekPendingConsent, consumePendingConsent } = await import(
    './pending-consent'
  )
  const peeked = peekPendingConsent(data.requestId)

  if (!peeked || peeked.userId !== user.id) {
    return {
      success: false,
      message:
        'This consent request has expired or is invalid. Please try connecting again from your client.',
    }
  }

  const pending = consumePendingConsent(data.requestId)
  if (!pending) {
    return {
      success: false,
      message:
        'This consent request has expired or is invalid. Please try connecting again from your client.',
    }
  }

  const { upsertGrant } = await import('./grants')
  upsertGrant(user.id, pending.clientId, pending.scope)

  const { getOAuthConfig } = await import('./config')
  const { issueAuthCode } = await import('./codes')
  const config = getOAuthConfig()

  const code = issueAuthCode(
    {
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      userId: user.id,
      codeChallenge: pending.codeChallenge,
      codeChallengeMethod: pending.codeChallengeMethod,
      resource: pending.resource,
      scope: pending.scope,
    },
    config,
  )

  const { markAuthorized } = await import('./clients')
  markAuthorized(pending.clientId)

  console.log(
    `[oauth/consent] Approved client=${pending.clientId} user=${user.id} scope=${pending.scope}`,
  )

  const redirectUrl = new URL(pending.redirectUri)
  redirectUrl.searchParams.set('code', code)
  if (pending.state) redirectUrl.searchParams.set('state', pending.state)

  return { success: true, redirectUrl: redirectUrl.toString() }
}

/**
 * Deny: consume the pending request and return the client's redirect_uri
 * with an `access_denied` error attached (RFC 6749 §4.1.2.1) — no grant is
 * persisted, no code is issued.
 */
export async function denyConsentHandler(
  { user }: AuthContext,
  data: ConsentRequestId,
): Promise<ConsentActionResult> {
  // S2 fix: peek + verify userId BEFORE consuming — see approveConsentHandler.
  const { peekPendingConsent, consumePendingConsent } = await import(
    './pending-consent'
  )
  const peeked = peekPendingConsent(data.requestId)

  if (!peeked || peeked.userId !== user.id) {
    return {
      success: false,
      message:
        'This consent request has expired or is invalid. Please try connecting again from your client.',
    }
  }

  const pending = consumePendingConsent(data.requestId)
  if (!pending) {
    return {
      success: false,
      message:
        'This consent request has expired or is invalid. Please try connecting again from your client.',
    }
  }

  console.log(
    `[oauth/consent] Denied client=${pending.clientId} user=${user.id}`,
  )

  const redirectUrl = new URL(pending.redirectUri)
  redirectUrl.searchParams.set('error', 'access_denied')
  redirectUrl.searchParams.set(
    'error_description',
    'The user denied the authorization request.',
  )
  if (pending.state) redirectUrl.searchParams.set('state', pending.state)

  return { success: true, redirectUrl: redirectUrl.toString() }
}
