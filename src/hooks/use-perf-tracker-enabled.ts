// src/hooks/use-perf-tracker-enabled.ts
// Decides whether the in-app PerfTrackerPanel is mounted. Two entry points, per
// the locked decision (tactical plan §1): a `?perf=1` query flag (works in the
// production bundle) and a `Ctrl+Shift+P` hotkey toggle.
//
// NOTE on the hotkey: `Ctrl+Shift+P` collides with the browser/DevTools command
// palette when DevTools is focused — `preventDefault()` only mitigates the
// in-page case. The query flag is the collision-free alternative.
import { useEffect, useState } from 'react'

function initialEnabled(): boolean {
  if (typeof window === 'undefined') return false // SSR-safe
  return new URLSearchParams(window.location.search).get('perf') === '1'
}

/**
 * Returns whether the performance tracker UI should be shown. Starts from the
 * `?perf=1` query flag and toggles on `Ctrl+Shift+P`.
 */
export function usePerfTrackerEnabled(): boolean {
  const [enabled, setEnabled] = useState<boolean>(initialEnabled)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const onKeyDown = (e: KeyboardEvent) => {
      // e.code === 'KeyP' is layout-independent (unlike e.key, which is 'P'
      // vs 'p' depending on Shift/CapsLock).
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyP') {
        e.preventDefault()
        setEnabled((prev) => !prev)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return enabled
}
