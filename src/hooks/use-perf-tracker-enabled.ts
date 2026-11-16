// src/hooks/use-perf-tracker-enabled.ts
// Decides whether the in-app PerfTrackerPanel is mounted. Three entry points
// drive one shared store (perf-tracker-enabled-store.ts): the toolbar "Show
// FPS" switch, a `?perf=1` query flag (works in the production bundle) and a
// `Ctrl+Shift+P` hotkey toggle.
//
// NOTE on the hotkey: `Ctrl+Shift+P` collides with the browser/DevTools command
// palette when DevTools is focused — `preventDefault()` only mitigates the
// in-page case. The query flag is the collision-free alternative.
import { useEffect } from 'react'
import {
  togglePerfEnabled,
  usePerfEnabledValue,
} from './perf-tracker-enabled-store'

/**
 * Returns whether the performance tracker UI should be shown, and installs the
 * `Ctrl+Shift+P` hotkey. Mount it once per board.
 */
export function usePerfTrackerEnabled(): boolean {
  const enabled = usePerfEnabledValue()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // e.code === 'KeyP' is layout-independent (unlike e.key, which is 'P'
      // vs 'p' depending on Shift/CapsLock).
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyP') {
        e.preventDefault()
        togglePerfEnabled()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return enabled
}
