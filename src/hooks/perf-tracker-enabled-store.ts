// src/hooks/perf-tracker-enabled-store.ts
// One shared value for "the FPS / perf panel is shown". The toolbar switch,
// the Ctrl+Shift+P hotkey and the `?perf=1` flag all drive this store.
// A switch or hotkey change persists per browser; `?perf=1` only forces the
// panel on for the page load it is in and is never written to storage.
// The in-memory value is the source of truth, so blocked storage still keeps
// the choice for the page view.

import { useSyncExternalStore } from 'react'
import { safeGetItem, safeSetItem } from '@/lib/safe-storage'

export const PERF_ENABLED_KEY = 'perf-tracker-enabled'

const listeners = new Set<() => void>()
let enabled: boolean | null = null

function readInitial(): boolean {
  if (typeof window === 'undefined') return false
  if (new URLSearchParams(window.location.search).get('perf') === '1') {
    return true
  }
  return safeGetItem(PERF_ENABLED_KEY) === 'true'
}

/** Current value, seeded from the URL flag and storage on first browser read. */
export function getPerfEnabled(): boolean {
  enabled ??= readInitial()
  return enabled
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setPerfEnabled(next: boolean) {
  enabled = next
  safeSetItem(PERF_ENABLED_KEY, String(next))
  for (const listener of listeners) listener()
}

export function togglePerfEnabled() {
  setPerfEnabled(!getPerfEnabled())
}

/** Test hook: forget the in-memory value so the next read re-seeds. */
export function resetPerfEnabledStore() {
  enabled = null
  for (const listener of listeners) listener()
}

export function usePerfEnabledValue(): boolean {
  return useSyncExternalStore(subscribe, getPerfEnabled, () => false)
}
