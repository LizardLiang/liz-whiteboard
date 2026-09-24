// src/lib/email/resend.ts
// Thin wrapper over the Resend HTTP API (no `resend` npm dependency — raw
// fetch, per CLAUDE.md's shadcn/Tailwind-only UI rule extended to this
// feature's third-party integrations). Used by requestPasswordReset
// to deliver the forgot-password reset-link email.

const RESEND_API_URL = 'https://api.resend.com/emails'

export interface SendEmailParams {
  to: string
  subject: string
  html: string
  text: string
}

/**
 * Send an email via the Resend API.
 *
 * When `RESEND_API_KEY` is unset outside production, logs the email text
 * (including any link it carries) to the console instead of sending, so a
 * developer can complete the flow without a real API key. When the key is
 * unset in production, logs an error and sends nothing. Resend errors (bad
 * response, network failure) are always logged and never thrown — callers
 * fire this without awaiting it.
 *
 * @param params - Recipient, subject, and both email bodies
 */
export async function sendEmail(params: SendEmailParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(
        `[email] RESEND_API_KEY not set — logging instead of sending.\nTo: ${params.to}\nSubject: ${params.subject}\n${params.text}`,
      )
      return
    }
    console.error('[email] RESEND_API_KEY is not set — email not sent.')
    return
  }

  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
      }),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      console.error(`[email] Resend API error ${response.status}: ${body}`)
    }
  } catch (err) {
    console.error('[email] Resend request failed:', err)
  }
}
