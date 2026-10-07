// src/hooks/use-navigator-pin.ts
// Per-browser preference: keep the project navigator docked beside a board

import { useCallback, useEffect, useState } from 'react'

const NAVIGATOR_PIN_KEY = 'navigator-pinned'

/**
 * Custom event dispatched on `window` whenever the pin changes, so every hook
 * instance in the same tab stays in sync. The native `storage` event only
 * fires in other tabs.
 */
const NAVIGATOR_PIN_CHANGE_EVENT = 'navigator-pin-change'

function readPinned(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(NAVIGATOR_PIN_KEY) === 'true'
  } catch {
    // Storage blocked (private mode): treat as unpinned.
    return false
  }
}

/**
 * Whether the project navigator stays docked on board routes.
 * Persisted in localStorage and synchronised across components and tabs.
 */
export function useNavigatorPin() {
  // Start unpinned on the server and first client render so hydration matches,
  // then adopt the stored value.
  const [isPinned, setIsPinnedState] = useState<boolean>(false)

  const setPinned = useCallback((pinned: boolean) => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(NAVIGATOR_PIN_KEY, String(pinned))
      } catch {
        // Storage blocked: the pin lasts for this page view only.
      }
      window.dispatchEvent(new CustomEvent(NAVIGATOR_PIN_CHANGE_EVENT))
    }
    setIsPinnedState(pinned)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const sync = () => setIsPinnedState(readPinned())
    const handleStorage = (event: StorageEvent) => {
      if (event.key === NAVIGATOR_PIN_KEY) sync()
    }

    sync()
    window.addEventListener(NAVIGATOR_PIN_CHANGE_EVENT, sync)
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener(NAVIGATOR_PIN_CHANGE_EVENT, sync)
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  return { isPinned, setPinned }
}
