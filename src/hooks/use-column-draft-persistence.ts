// src/hooks/use-column-draft-persistence.ts
// SEC-MODAL-05: sessionStorage draft persistence for in-flight column-edit modal values.
// Persists to sessionStorage keyed by `draft:${whiteboardId}:${columnId}` — 200-byte budget per AD-4.
// On modal re-mount after re-auth (sessionExpired false→true→false), exposes draft
// so the column-edit modal can offer Apply/Discard.

import { useCallback, useEffect, useRef, useState } from 'react'

const DRAFT_TTL_MS = 30 * 60 * 1000 // 30 minutes; drafts older than this are discarded

interface DraftPayload {
  values: Record<string, unknown>
  savedAt: number
}

function buildKey(whiteboardId: string, columnId: string): string {
  return `draft:${whiteboardId}:${columnId}`
}

function readDraft(key: string): Record<string, unknown> | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const parsed: DraftPayload = JSON.parse(raw)
    if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
      sessionStorage.removeItem(key)
      return null
    }
    return parsed.values
  } catch {
    return null
  }
}

function writeDraft(key: string, values: Record<string, unknown>): void {
  try {
    const payload: DraftPayload = { values, savedAt: Date.now() }
    sessionStorage.setItem(key, JSON.stringify(payload))
  } catch {
    // sessionStorage may be unavailable (private browsing, quota exceeded) — silently ignore
  }
}

function removeDraft(key: string): void {
  try {
    sessionStorage.removeItem(key)
  } catch {
    // ignore
  }
}

export interface UseColumnDraftPersistenceReturn {
  /** The persisted draft values, if any (null = no draft). */
  draft: Record<string, unknown> | null
  /** Write form values to sessionStorage (debounced 500ms). */
  saveDraft: (values: Record<string, unknown>) => void
  /** Apply the draft — keep values in state, leave sessionStorage key until save. */
  applyDraft: () => void
  /** Discard the draft — clear state and remove sessionStorage key. */
  discardDraft: () => void
  /** Delete the draft key after a successful save. */
  clearDraft: () => void
}

/**
 * Manages sessionStorage draft persistence for column-edit modal form values.
 * Keyed by `draft:${whiteboardId}:${columnId}` so concurrent modals on different
 * columns or whiteboards never collide.
 *
 * Usage:
 * - Call `saveDraft(values)` on every form change (debounced internally).
 * - On modal mount: check `draft !== null` — if so, offer Apply/Discard banner.
 * - On successful save: call `clearDraft()` to remove the sessionStorage entry.
 */
export function useColumnDraftPersistence(
  whiteboardId: string,
  columnId: string,
): UseColumnDraftPersistenceReturn {
  const key = buildKey(whiteboardId, columnId)
  const [draft, setDraft] = useState<Record<string, unknown> | null>(() =>
    readDraft(key),
  )
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clean up debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  const saveDraft = useCallback(
    (values: Record<string, unknown>) => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = setTimeout(() => {
        writeDraft(key, values)
        // Update local state so the banner appears on the same session
        setDraft(values)
      }, 500)
    },
    [key],
  )

  const applyDraft = useCallback(() => {
    // Keep draft in state (user will see the values) — sessionStorage kept until save
    // The caller is responsible for applying draft values to form fields
  }, [])

  const discardDraft = useCallback(() => {
    removeDraft(key)
    setDraft(null)
  }, [key])

  const clearDraft = useCallback(() => {
    removeDraft(key)
    setDraft(null)
  }, [key])

  return { draft, saveDraft, applyDraft, discardDraft, clearDraft }
}
