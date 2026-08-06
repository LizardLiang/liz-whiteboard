// src/lib/copy-text.ts
// Clipboard helper that also works over a plain-HTTP LAN origin.
//
// `navigator.clipboard` only exists in a "secure context" (https, or
// localhost) — it is `undefined` on a plain-HTTP LAN address, which is how
// this project is normally developed and used (see CLAUDE.md / project
// memory). Every existing `navigator.clipboard.writeText(...)` call site in
// this app therefore silently failed there: `navigator.clipboard` is
// `undefined`, so calling `.writeText` throws a TypeError, and callers that
// didn't await/catch it showed a false-positive success toast anyway.
//
// copyText() fixes this: it prefers the async Clipboard API when available,
// and falls back to the legacy hidden-textarea + `document.execCommand
// ('copy')` trick — the only copy mechanism available on a non-secure
// origin. It returns a boolean (never throws) so callers can toast
// truthfully instead of assuming success.
export async function copyText(text: string): Promise<boolean> {
  if (
    typeof navigator !== 'undefined' &&
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- lib.dom types navigator.clipboard as always defined, but it is genuinely `undefined` at runtime outside a secure context (e.g. plain-HTTP LAN) — that's the exact case this helper exists for.
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Some browsers expose `navigator.clipboard` but still reject
      // writeText outside a secure context or a user-gesture handler — fall
      // through to the execCommand fallback rather than reporting failure.
    }
  }

  return copyViaExecCommand(text)
}

function copyViaExecCommand(text: string): boolean {
  if (typeof document === 'undefined') return false

  const textarea = document.createElement('textarea')
  textarea.value = text
  // Keep it out of the visible viewport and the tab order, but still
  // selectable/focusable — execCommand('copy') requires a real selection.
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '-9999px'
  textarea.setAttribute('readonly', '')
  textarea.setAttribute('aria-hidden', 'true')

  document.body.appendChild(textarea)
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)

  let succeeded = false
  try {
    succeeded = document.execCommand('copy')
  } catch {
    succeeded = false
  } finally {
    document.body.removeChild(textarea)
  }

  return succeeded
}
