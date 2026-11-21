// src/lib/auth/escape-html.ts
// HTML escaping for values interpolated into email HTML bodies.

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch])
}

/** Build an email body with one link; every interpolated value is escaped. */
export function buildLinkEmailHtml(parts: {
  intro: string
  link: string
  outro: string
}): string {
  const intro = escapeHtml(parts.intro)
  const link = escapeHtml(parts.link)
  const outro = escapeHtml(parts.outro)
  return `<p>${intro}</p><p><a href="${link}">${link}</a></p><p>${outro}</p>`
}

/** Build the password-reset email HTML; every interpolated value is escaped. */
export function buildResetEmailHtml(parts: {
  intro: string
  link: string
  outro: string
}): string {
  return buildLinkEmailHtml(parts)
}

/** Build the "you already have an account" email HTML; all values escaped. */
export function buildAccountExistsEmailHtml(parts: {
  intro: string
  loginLink: string
  resetLink: string
  outro: string
}): string {
  const intro = escapeHtml(parts.intro)
  const loginLink = escapeHtml(parts.loginLink)
  const resetLink = escapeHtml(parts.resetLink)
  const outro = escapeHtml(parts.outro)
  return `<p>${intro}</p><p><a href="${loginLink}">${loginLink}</a></p><p><a href="${resetLink}">${resetLink}</a></p><p>${outro}</p>`
}

/** Build the project-invite email HTML: accept link plus a register hint; all values escaped. */
export function buildEmailInviteHtml(parts: {
  intro: string
  link: string
  registerHint: string
  registerLink: string
  outro: string
}): string {
  const intro = escapeHtml(parts.intro)
  const link = escapeHtml(parts.link)
  const registerHint = escapeHtml(parts.registerHint)
  const registerLink = escapeHtml(parts.registerLink)
  const outro = escapeHtml(parts.outro)
  return `<p>${intro}</p><p><a href="${link}">${link}</a></p><p>${registerHint}</p><p><a href="${registerLink}">${registerLink}</a></p><p>${outro}</p>`
}
