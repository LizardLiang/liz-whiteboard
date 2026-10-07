// src/hooks/use-navigator-pin.ts
// Per-browser preference: keep the project navigator docked beside a board

import { useSyncExternalStore } from 'react'

const NAVIGATOR_PIN_KEY = 'navigator-pinned'

type Listener = () => void

const listeners = new Set<Listener>()

function readStored(): boolean {
  try {
    return localStorage.getItem(NAVIGATOR_PIN_KEY) === 'true'
  } catch {
    // Storage blocked (private mode): no stored preference.
    return false
  }
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
  try {
    localStorage.setItem(NAVIGATOR_PIN_KEY, String(next))
  } catch {
    // Storage blocked: the in-memory value still serves this page view.
  }
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

/** Forget the in-memory value so the next read comes from storage again. */
export function resetNavigatorPinForTests() {
  pinned = null
  emit()
}
