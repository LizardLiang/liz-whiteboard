// src/hooks/use-column-draft-persistence.test.ts
// Suite 12 — Column-Form Draft Restore (SEC-MODAL-05)
// TC-DRAFT-01..05 and TC-MODAL-05
//
// Tests useColumnDraftPersistence hook via renderHook.
// Uses jsdom's real sessionStorage (cleared between tests).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { useColumnDraftPersistence } from './use-column-draft-persistence'

// ─────────────────────────────────────────────────────────────────────────────
// Setup: use jsdom's real sessionStorage, clear between tests
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  window.sessionStorage.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-DRAFT-01: column-form changes written to sessionStorage with correct key
// Req: SEC-MODAL-05, AD-4
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-DRAFT-01: saveDraft writes to sessionStorage with correct key', () => {
  it('writes to sessionStorage keyed draft:wbId:colId after debounce', () => {
    const { result } = renderHook(() =>
      useColumnDraftPersistence('wb-1', 'col-1'),
    )

    act(() => {
      result.current.saveDraft({ name: 'new_name', dataType: 'text' })
    })

    // Before debounce timer fires: nothing written yet
    expect(window.sessionStorage.getItem('draft:wb-1:col-1')).toBeNull()

    // Advance debounce timer (500ms)
    act(() => {
      vi.advanceTimersByTime(600)
    })

    const raw = window.sessionStorage.getItem('draft:wb-1:col-1')
    expect(raw).toBeTruthy()

    const parsed = JSON.parse(raw!)
    expect(parsed.values).toMatchObject({ name: 'new_name', dataType: 'text' })
    expect(typeof parsed.savedAt).toBe('number')
  })

  it('uses the correct key format draft:whiteboardId:columnId', () => {
    const { result } = renderHook(() =>
      useColumnDraftPersistence('wb-abc', 'col-xyz'),
    )

    act(() => {
      result.current.saveDraft({ name: 'my_col' })
    })

    act(() => {
      vi.advanceTimersByTime(600)
    })

    expect(window.sessionStorage.getItem('draft:wb-abc:col-xyz')).toBeTruthy()
    // Must NOT write to a different key
    expect(
      window.sessionStorage.getItem('draft:wb-abc:col-xyz-other'),
    ).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-DRAFT-02: draft read and prefilled into form on mount
// Req: SEC-MODAL-05
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-DRAFT-02: draft read and restored on mount', () => {
  it('reads existing draft from sessionStorage on mount', () => {
    // Pre-seed sessionStorage
    const payload = {
      values: { name: 'draft_name', dataType: 'TEXT' },
      savedAt: Date.now(),
    }
    window.sessionStorage.setItem('draft:wb-1:col-1', JSON.stringify(payload))

    const { result } = renderHook(() =>
      useColumnDraftPersistence('wb-1', 'col-1'),
    )

    expect(result.current.draft).not.toBeNull()
    expect(result.current.draft).toMatchObject({
      name: 'draft_name',
      dataType: 'TEXT',
    })
  })

  it('returns null draft when no sessionStorage entry exists', () => {
    // sessionStorage is cleared in beforeEach — no entry
    const { result } = renderHook(() =>
      useColumnDraftPersistence('wb-1', 'col-1'),
    )

    expect(result.current.draft).toBeNull()
  })

  it('discards draft older than 30 minutes TTL', () => {
    const thirtyOneMinutesAgo = Date.now() - 31 * 60 * 1000
    const payload = {
      values: { name: 'stale_draft' },
      savedAt: thirtyOneMinutesAgo,
    }
    window.sessionStorage.setItem('draft:wb-1:col-1', JSON.stringify(payload))

    const { result } = renderHook(() =>
      useColumnDraftPersistence('wb-1', 'col-1'),
    )

    expect(result.current.draft).toBeNull()
    // TTL-expired draft should have been removed from sessionStorage
    expect(window.sessionStorage.getItem('draft:wb-1:col-1')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-DRAFT-03: applyDraft keeps values; discardDraft clears form + removes key
// Req: SEC-MODAL-05
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-DRAFT-03: applyDraft and discardDraft behaviour', () => {
  it('applyDraft keeps draft in state (sessionStorage key preserved until save)', () => {
    const payload = {
      values: { name: 'draft_name', dataType: 'TEXT' },
      savedAt: Date.now(),
    }
    window.sessionStorage.setItem('draft:wb-1:col-1', JSON.stringify(payload))

    const { result } = renderHook(() =>
      useColumnDraftPersistence('wb-1', 'col-1'),
    )

    expect(result.current.draft).not.toBeNull()

    act(() => {
      result.current.applyDraft()
    })

    // Draft should still be present (user hasn't saved yet)
    expect(result.current.draft).not.toBeNull()
    // sessionStorage key must still exist
    expect(window.sessionStorage.getItem('draft:wb-1:col-1')).toBeTruthy()
  })

  it('discardDraft clears state and removes sessionStorage key', () => {
    const payload = {
      values: { name: 'draft_name', dataType: 'TEXT' },
      savedAt: Date.now(),
    }
    window.sessionStorage.setItem('draft:wb-1:col-1', JSON.stringify(payload))

    const { result } = renderHook(() =>
      useColumnDraftPersistence('wb-1', 'col-1'),
    )

    expect(result.current.draft).not.toBeNull()

    act(() => {
      result.current.discardDraft()
    })

    // State cleared
    expect(result.current.draft).toBeNull()
    // sessionStorage entry removed
    expect(window.sessionStorage.getItem('draft:wb-1:col-1')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-DRAFT-04: draft key deleted on successful save (clearDraft)
// Req: SEC-MODAL-05
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-DRAFT-04: clearDraft removes key on successful save', () => {
  it('clearDraft removes the sessionStorage entry after successful save', () => {
    const payload = {
      values: { name: 'ready_to_save', dataType: 'int' },
      savedAt: Date.now(),
    }
    window.sessionStorage.setItem(
      'draft:wb-save:col-save',
      JSON.stringify(payload),
    )

    const { result } = renderHook(() =>
      useColumnDraftPersistence('wb-save', 'col-save'),
    )

    // Draft is present
    expect(result.current.draft).not.toBeNull()

    act(() => {
      result.current.clearDraft()
    })

    // State cleared
    expect(result.current.draft).toBeNull()
    // sessionStorage entry removed
    expect(window.sessionStorage.getItem('draft:wb-save:col-save')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-DRAFT-05: different columns use non-colliding keys
// Req: AD-4
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-DRAFT-05: different columns use non-colliding keys', () => {
  it('drafts for col-1 and col-2 are stored under distinct keys', () => {
    const { result: hook1 } = renderHook(() =>
      useColumnDraftPersistence('wb-1', 'col-1'),
    )
    const { result: hook2 } = renderHook(() =>
      useColumnDraftPersistence('wb-1', 'col-2'),
    )

    act(() => {
      hook1.current.saveDraft({ name: 'column_one_draft' })
    })
    act(() => {
      hook2.current.saveDraft({ name: 'column_two_draft' })
    })

    // Advance debounce timer
    act(() => {
      vi.advanceTimersByTime(600)
    })

    // Each gets its own key
    const raw1 = window.sessionStorage.getItem('draft:wb-1:col-1')
    const raw2 = window.sessionStorage.getItem('draft:wb-1:col-2')
    expect(raw1).toBeTruthy()
    expect(raw2).toBeTruthy()

    const parsed1 = JSON.parse(raw1!)
    const parsed2 = JSON.parse(raw2!)

    expect(parsed1.values.name).toBe('column_one_draft')
    expect(parsed2.values.name).toBe('column_two_draft')
    expect(parsed1.values.name).not.toBe(parsed2.values.name)
  })

  it('restoring hook for col-1 does not prefill with col-2 draft', () => {
    // Seed col-2 draft only
    window.sessionStorage.setItem(
      'draft:wb-1:col-2',
      JSON.stringify({ values: { name: 'col2_draft' }, savedAt: Date.now() }),
    )

    const { result } = renderHook(() =>
      useColumnDraftPersistence('wb-1', 'col-1'),
    )

    // hook for col-1 should NOT have a draft (only col-2 has one)
    expect(result.current.draft).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-MODAL-05: draft persists through session_expired → re-auth flow
// Req: SEC-MODAL-05, PRD §5.1 step 4
//
// Draft written before session_expired must survive unmount and be available
// when the form component remounts after re-auth.
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-MODAL-05: draft persists through session_expired → re-auth cycle', () => {
  it('draft written before session_expired is available after re-auth (remount)', () => {
    // Step 1: user fills in form — saveDraft called
    const { result: initialHook, unmount } = renderHook(() =>
      useColumnDraftPersistence('wb-modal', 'col-modal'),
    )

    act(() => {
      initialHook.current.saveDraft({
        name: 'important_column',
        dataType: 'uuid',
      })
    })

    // Advance debounce — draft written to sessionStorage
    act(() => {
      vi.advanceTimersByTime(600)
    })

    // Confirm written
    expect(
      window.sessionStorage.getItem('draft:wb-modal:col-modal'),
    ).toBeTruthy()

    // Step 2: session_expired → component unmounts (redirect to login)
    unmount()

    // sessionStorage survives unmount (it's browser-session scoped, not component-scoped)
    expect(
      window.sessionStorage.getItem('draft:wb-modal:col-modal'),
    ).toBeTruthy()

    // Step 3: re-auth → form remounts
    const { result: restoredHook } = renderHook(() =>
      useColumnDraftPersistence('wb-modal', 'col-modal'),
    )

    // Draft restored on mount
    expect(restoredHook.current.draft).not.toBeNull()
    expect(restoredHook.current.draft).toMatchObject({
      name: 'important_column',
      dataType: 'uuid',
    })
  })

  it('draft is NOT cleared by unmount — it persists in sessionStorage', () => {
    const { result, unmount } = renderHook(() =>
      useColumnDraftPersistence('wb-persist', 'col-persist'),
    )

    act(() => {
      result.current.saveDraft({ name: 'will_survive_unmount' })
    })

    act(() => {
      vi.advanceTimersByTime(600)
    })

    expect(
      window.sessionStorage.getItem('draft:wb-persist:col-persist'),
    ).toBeTruthy()

    // Unmount (simulates teardown on session_expired)
    unmount()

    // sessionStorage entry must still exist
    expect(
      window.sessionStorage.getItem('draft:wb-persist:col-persist'),
    ).toBeTruthy()
  })
})
