// src/hooks/use-navigator-pin.ts
// Per-browser preference: keep the project navigator docked beside a board

import { useSyncExternalStore } from 'react'
import { safeGetItem, safeSetItem } from '@/lib/safe-storage'

const NAVIGATOR_PIN_KEY = 'navigator-pinned'

type Listener = () => void

const listeners = new Set<Listener>()

function readStored(): boolean {
  return safeGetItem(NAVIGATOR_PIN_KEY) === 'true'
}

/**
 * The in-memory value is the source of truth for every hook instance, so a
 * blocked or failing localStorage never makes the pin read back as unpinned.
 * It is seeded from storage on first use in the browser. Persistence is best
 * effort, and the pin then lasts until the page is reloaded.
 */
let pinned: boolean | null = null

function getSnapshot(): boolean {
  pinned ??= readStored()
  return pinned
}

function getServerSnapshot(): boolean {
  return false
}

function emit() {
  for (const listener of listeners) listener()
}

function handleStorage(event: StorageEvent) {
  if (event.storageArea !== localStorage) return
  // A null key means the whole storage area was cleared.
  if (event.key !== null && event.key !== NAVIGATOR_PIN_KEY) return
  const next = event.key === null ? false : event.newValue === 'true'
  if (next === pinned) return
  pinned = next
  emit()
}

function subscribe(listener: Listener): () => void {
  if (listeners.size === 0) window.addEventListener('storage', handleStorage)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      window.removeEventListener('storage', handleStorage)
    }
  }
}

/** Set the pin for every hook instance and persist it where storage allows. */
export function setNavigatorPinned(next: boolean) {
  pinned = next
  // A rejected write leaves the in-memory value serving this page view.
  safeSetItem(NAVIGATOR_PIN_KEY, String(next))
  emit()
}

/**
 * Whether the project navigator stays docked on board routes.
 * Persisted in localStorage when available and synchronised across components
 * and tabs.
 */
export function useNavigatorPin() {
  const isPinned = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  )
  return { isPinned, setPinned: setNavigatorPinned }
}
