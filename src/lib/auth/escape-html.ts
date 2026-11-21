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

/** Build the password-reset email HTML; every interpolated value is escaped. */
export function buildResetEmailHtml(parts: {
  intro: string
  link: string
  outro: string
}): string {
  const intro = escapeHtml(parts.intro)
  const link = escapeHtml(parts.link)
  const outro = escapeHtml(parts.outro)
  return `<p>${intro}</p><p><a href="${link}">${link}</a></p><p>${outro}</p>`
}
