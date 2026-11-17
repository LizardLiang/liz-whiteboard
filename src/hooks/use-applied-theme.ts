// src/hooks/use-applied-theme.ts
// The theme class that is actually on <html> right now ('light' | 'dark').

import { useSyncExternalStore } from 'react'

type AppliedTheme = 'light' | 'dark'

function read(): AppliedTheme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })
  return () => observer.disconnect()
}

/**
 * Follows the class on <html> instead of `useTheme().resolvedTheme`.
 *
 * `ThemeProvider` writes the class in a passive effect. React runs a child's
 * effects before its parent's, so an effect that reads `--rf-*` CSS variables
 * (the node canvas paints them with `getComputedStyle`) and depends on
 * `resolvedTheme` runs BEFORE the class changes and paints the previous
 * theme. This hook changes only after the class is written, whichever code
 * wrote it (toggle, system preference change, another tab).
 */
export function useAppliedTheme(): AppliedTheme {
  return useSyncExternalStore(subscribe, read, () => 'light')
}
