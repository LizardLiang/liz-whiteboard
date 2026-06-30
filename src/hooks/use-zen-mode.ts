// src/hooks/use-zen-mode.ts
// Hook to manage "zen mode" — hides all UI chrome so only the canvas is visible

import { useCallback, useEffect, useState } from 'react'

/**
 * Local storage key for zen-mode preference
 */
const ZEN_MODE_KEY = 'liz-whiteboard:zen-mode'

/**
 * Custom event dispatched on `window` whenever zen mode toggles, so every hook
 * instance in the same tab stays in sync. The native `storage` event only fires
 * in *other* tabs, so it cannot keep sibling components in the current tab synced.
 */
const ZEN_MODE_CHANGE_EVENT = 'zen-mode-change'

function readZenMode(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(ZEN_MODE_KEY) === 'true'
}

/**
 * Hook to manage zen mode.
 *
 * Zen mode hides every layer of UI chrome (global header/sidebar, whiteboard
 * name bar, mode tabs, and toolbar) so only the bare canvas fills the viewport.
 * State is persisted in localStorage and synchronised across every component in
 * the tab via a custom `window` event.
 *
 * @returns Zen mode state and toggle helpers
 *
 * @example
 * ```tsx
 * const { isZenMode, toggleZenMode, exitZenMode } = useZenMode()
 * ```
 */
export function useZenMode() {
  const [isZenMode, setIsZenMode] = useState<boolean>(readZenMode)

  /**
   * Persist a new value and notify every other hook instance in this tab.
   */
  const setZenMode = useCallback((enabled: boolean) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(ZEN_MODE_KEY, String(enabled))
      window.dispatchEvent(new CustomEvent(ZEN_MODE_CHANGE_EVENT))
    }
    setIsZenMode(enabled)
  }, [])

  const toggleZenMode = useCallback(() => {
    setZenMode(!readZenMode())
  }, [setZenMode])

  const exitZenMode = useCallback(() => {
    setZenMode(false)
  }, [setZenMode])

  /**
   * Stay in sync with toggles from sibling components (custom event, same tab)
   * and from other tabs (native storage event).
   */
  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleChange = () => setIsZenMode(readZenMode())
    const handleStorage = (event: StorageEvent) => {
      if (event.key === ZEN_MODE_KEY) setIsZenMode(readZenMode())
    }

    window.addEventListener(ZEN_MODE_CHANGE_EVENT, handleChange)
    window.addEventListener('storage', handleStorage)

    return () => {
      window.removeEventListener(ZEN_MODE_CHANGE_EVENT, handleChange)
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  return { isZenMode, toggleZenMode, exitZenMode }
}
