// src/lib/auth/signup-flow.ts
// Issues the email for a signup attempt. A new email gets a signup link; an
// email that already has an account gets "you already have an account" with
// login and reset links. Both paths run the same DB work (user lookup, token
// generation and hash, one row insert under the same limits) and both send
// without awaiting, so the register reply does not depend on which case ran.

import type { Locale } from '@/lib/i18n/resolve-locale'
import { findUserByEmail } from '@/data/user'
import {
  findLatestSignupTokenForEmail,
  tryCreateSignupToken,
} from '@/data/signup-token'
import {
  buildAccountExistsEmailHtml,
  buildLinkEmailHtml,
} from '@/lib/auth/escape-html'
import { generateSignupToken, hashSignupToken } from '@/lib/auth/signup-token'
import { resolveBaseUrl } from '@/lib/email/base-url'
import { sendEmail } from '@/lib/email/resend'
import { translate } from '@/lib/i18n/translate'

export async function issueSignupEmail(params: {
  email: string
  /** The username from the register form; null on a resend. */
  username: string | null
  /** Same-origin return path (an invite link), or null. */
  redirectTo: string | null
  locale: Locale
  requestOrigin: string | null
}): Promise<void> {
  const { email, locale } = params
  const user = await findUserByEmail(email)

  let username = params.username
  let redirectTo = params.redirectTo
  if (username === null) {
    const latest = findLatestSignupTokenForEmail(email)
    if (!latest && !user) return
    // A resend takes only the username from the newest row; it never copies
    // a return path another request stored.
    username = latest?.username ?? ''
    redirectTo = null
  }

  const rawToken = generateSignupToken()
  const created = tryCreateSignupToken({
    email,
    username,
    redirectTo,
    tokenHash: hashSignupToken(rawToken),
    voided: user !== null,
  })
  if (!created) return

  const baseUrl = resolveBaseUrl(params.requestOrigin)
  if (!baseUrl) {
    console.error('[signup] APP_BASE_URL is not set — signup email not sent.')
    return
  }

  const message = user
    ? buildAccountExistsMessage(baseUrl, redirectTo, locale)
    : buildSignupMessage(baseUrl, rawToken, locale)

  void sendEmail({ to: email, ...message }).catch((err: unknown) => {
    console.error('[signup] sendEmail failed:', err)
  })
}

function buildSignupMessage(baseUrl: string, rawToken: string, locale: Locale) {
  const link = `${baseUrl}/signup/${rawToken}`
  return {
    subject: translate(locale, 'email.signupSubject'),
    text: translate(locale, 'email.signupText', { link }),
    html: buildLinkEmailHtml({
      intro: translate(locale, 'email.signupHtmlIntro'),
      link,
      outro: translate(locale, 'email.signupHtmlOutro'),
    }),
  }
}

function buildAccountExistsMessage(
  baseUrl: string,
  redirectTo: string | null,
  locale: Locale,
) {
  const loginLink = redirectTo
    ? `${baseUrl}/login?redirect=${encodeURIComponent(redirectTo)}`
    : `${baseUrl}/login`
  const resetLink = `${baseUrl}/forgot-password`
  return {
    subject: translate(locale, 'email.existsSubject'),
    text: translate(locale, 'email.existsText', { loginLink, resetLink }),
    html: buildAccountExistsEmailHtml({
      intro: translate(locale, 'email.existsHtmlIntro'),
      loginLink,
      resetLink,
      outro: translate(locale, 'email.existsHtmlOutro'),
    }),
  }
}
