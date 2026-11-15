// src/components/whiteboard/field-window/use-field-window-prefs.ts
// Per-browser layout preferences of the field window: pin, tabs-or-windows
// mode, and the dragged viewport position. Table ids are never stored.
// Modelled on src/hooks/use-navigator-pin.ts: the in-memory value is the
// source of truth, so blocked storage still keeps the layout for the page view.

import { useSyncExternalStore } from 'react'
import { safeGetItem, safeSetItem } from '@/lib/safe-storage'

export type FieldWindowMode = 'tabs' | 'windows'
export interface FieldWindowPos {
  x: number
  y: number
}
export interface FieldWindowPrefs {
  pinned: boolean
  mode: FieldWindowMode
  pos: FieldWindowPos | null
  /** The tour has started once in this browser; it never auto-starts again. */
  tourSeen: boolean
}

export const PINNED_KEY = 'fields-window-pinned'
export const MODE_KEY = 'fields-window-mode'
export const POS_KEY = 'fields-window-pos'
export const TOUR_SEEN_KEY = 'fields-window-tour-seen'

const DEFAULT_PREFS: FieldWindowPrefs = {
  pinned: false,
  mode: 'tabs',
  pos: null,
  tourSeen: false,
}

const listeners = new Set<() => void>()
let prefs: FieldWindowPrefs | null = null

function parsePos(raw: string | null): FieldWindowPos | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (
      typeof value === 'object' &&
      value !== null &&
      'x' in value &&
      'y' in value &&
      typeof value.x === 'number' &&
      typeof value.y === 'number' &&
      Number.isFinite(value.x) &&
      Number.isFinite(value.y)
    ) {
      return { x: value.x, y: value.y }
    }
  } catch {
    // A corrupt stored value is treated as unset.
  }
  return null
}

function readStored(): FieldWindowPrefs {
  return {
    pinned: safeGetItem(PINNED_KEY) === 'true',
    mode: safeGetItem(MODE_KEY) === 'windows' ? 'windows' : 'tabs',
    pos: parsePos(safeGetItem(POS_KEY)),
    tourSeen: safeGetItem(TOUR_SEEN_KEY) === 'true',
  }
}

/** Current prefs, seeded from storage on first read in the browser. */
export function getFieldWindowPrefs(): FieldWindowPrefs {
  prefs ??= readStored()
  return prefs
}

function getServerSnapshot(): FieldWindowPrefs {
  return DEFAULT_PREFS
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function emit() {
  for (const listener of listeners) listener()
}

/** A rejected storage write leaves the in-memory value serving this page view. */
export function setFieldWindowPinned(pinned: boolean) {
  prefs = { ...getFieldWindowPrefs(), pinned }
  safeSetItem(PINNED_KEY, String(pinned))
  emit()
}

export function setFieldWindowMode(mode: FieldWindowMode) {
  prefs = { ...getFieldWindowPrefs(), mode }
  safeSetItem(MODE_KEY, mode)
  emit()
}

export function setFieldWindowPos(pos: FieldWindowPos) {
  prefs = { ...getFieldWindowPrefs(), pos }
  safeSetItem(POS_KEY, JSON.stringify(pos))
  emit()
}

export function setFieldWindowTourSeen() {
  prefs = { ...getFieldWindowPrefs(), tourSeen: true }
  safeSetItem(TOUR_SEEN_KEY, 'true')
  emit()
}

/** Test hook: forget the in-memory value so the next read re-seeds from storage. */
export function resetFieldWindowPrefs() {
  prefs = null
  emit()
}

export function useFieldWindowPrefs(): FieldWindowPrefs {
  return useSyncExternalStore(subscribe, getFieldWindowPrefs, getServerSnapshot)
}
