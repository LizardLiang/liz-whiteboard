/**
 * useMinimapFocusShortcut — global keyboard shortcut (m) for the minimap.
 *
 * Registers a window-level keydown listener that toggles an enlarged,
 * focus-indicated minimap on bare `m`, and collapses it on `Escape` (only
 * while expanded). Modeled on the `z` zen-mode toggle in
 * `src/routes/whiteboard/$whiteboardId.tsx` — a global shortcut with no
 * node-selection precondition, so it deliberately does NOT use
 * `useSingleSelectedTableShortcut`.
 *
 * Guards, matching the existing bare-letter shortcuts:
 * - Ignored when any modifier (Ctrl/Cmd/Alt/Shift) is held.
 * - Ignored while focus is in an input/textarea/contenteditable element.
 * - Ignored when `suppressed` (e.g. Focus Overlay or search palette open).
 * - Ignored when `enabled` is false (e.g. the minimap is hidden).
 */

import { useEffect } from 'react'

export interface UseMinimapFocusShortcutOptions {
  /** Whether the minimap is currently expanded (controls Escape handling). */
  expanded: boolean
  /** Called on bare `m` to toggle the expanded state. */
  onToggle: () => void
  /** Called on `Escape` (while expanded) to collapse the minimap. */
  onCollapse: () => void
  /** When true, the shortcut is disabled entirely (e.g. a modal is open). */
  suppressed?: boolean
  /** When false, the shortcut does nothing (e.g. the minimap is hidden). */
  enabled?: boolean
}

export function useMinimapFocusShortcut({
  expanded,
  onToggle,
  onCollapse,
  suppressed = false,
  enabled = true,
}: UseMinimapFocusShortcutOptions): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Disabled entirely (minimap hidden) or suppressed (overlay/dialog open)
      if (!enabled || suppressed) return

      // Only bare keys — any modifier disqualifies (so Ctrl/Cmd shortcuts and
      // OS chords are never hijacked)
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return
      }

      // Skip while typing in a form field so the key types normally. Narrow to
      // an HTMLElement first — `event.target` can be `window`/`document` (no
      // `getAttribute`) when nothing is focused. The attribute check mirrors
      // `useSingleSelectedTableShortcut` and also covers environments (jsdom)
      // where `isContentEditable` isn't derived from the attribute.
      const el = event.target instanceof HTMLElement ? event.target : null
      const tag = el?.tagName
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        el?.isContentEditable ||
        el?.getAttribute('contenteditable') === 'true'
      ) {
        return
      }

      if (event.key === 'm') {
        event.preventDefault()
        onToggle()
        return
      }

      // Escape collapses only when expanded — don't swallow Escape otherwise,
      // since dialogs/overlays rely on it.
      if (event.key === 'Escape' && expanded) {
        onCollapse()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [expanded, onToggle, onCollapse, suppressed, enabled])
}
