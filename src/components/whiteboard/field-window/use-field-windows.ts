// src/components/whiteboard/field-window/use-field-windows.ts
// The field window's own table list (separate from the canvas selection) and
// its window state. A pure reducer plus a hook that owns the Esc listener and
// writes the layout prefs.

import { useCallback, useEffect, useMemo, useReducer } from 'react'
import {
  getFieldWindowPrefs,
  setFieldWindowPinned,
  setFieldWindowPos,
} from './use-field-window-prefs'
import type { FieldWindowPos } from './use-field-window-prefs'

export interface FieldWindowsState {
  /** Listed tables, in the order they were added. */
  tableIds: Array<string>
  /** The tab shown in the window; null when the list is empty. */
  activeId: string | null
  pinned: boolean
  minimized: boolean
  /** Viewport position of the window's top-left; null = default anchor. */
  pos: FieldWindowPos | null
}

export type FieldWindowsAction =
  | { type: 'plainClick'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'close'; id: string }
  | { type: 'closeAll' }
  | { type: 'dismissUnpinned' }
  | { type: 'prune'; existingIds: ReadonlySet<string> }
  | { type: 'setPinned'; pinned: boolean }
  | { type: 'setMinimized'; minimized: boolean }
  | { type: 'move'; pos: FieldWindowPos }
  | { type: 'focus'; id: string }

export function createFieldWindowsState(
  seed: Partial<Pick<FieldWindowsState, 'pinned' | 'pos'>> = {},
): FieldWindowsState {
  return {
    tableIds: [],
    activeId: null,
    pinned: seed.pinned ?? false,
    minimized: false,
    pos: seed.pos ?? null,
  }
}

function withList(
  state: FieldWindowsState,
  tableIds: Array<string>,
  preferredActive: string | null,
): FieldWindowsState {
  if (tableIds.length === 0) {
    return { ...state, tableIds, activeId: null, minimized: false }
  }
  const activeId =
    preferredActive && tableIds.includes(preferredActive)
      ? preferredActive
      : tableIds[tableIds.length - 1]
  return { ...state, tableIds, activeId }
}

function removeId(state: FieldWindowsState, id: string): FieldWindowsState {
  if (!state.tableIds.includes(id)) return state
  return withList(
    state,
    state.tableIds.filter((t) => t !== id),
    state.activeId === id ? null : state.activeId,
  )
}

export function fieldWindowsReducer(
  state: FieldWindowsState,
  action: FieldWindowsAction,
): FieldWindowsState {
  switch (action.type) {
    case 'plainClick': {
      if (!state.pinned) {
        if (state.tableIds.length === 1 && state.tableIds[0] === action.id) {
          return state.activeId === action.id
            ? state
            : { ...state, activeId: action.id }
        }
        return withList(state, [action.id], action.id)
      }
      const list = state.tableIds.includes(action.id)
        ? state.tableIds
        : [...state.tableIds, action.id]
      return withList(state, list, action.id)
    }
    case 'toggle': {
      if (state.tableIds.includes(action.id)) return removeId(state, action.id)
      return withList(state, [...state.tableIds, action.id], action.id)
    }
    case 'close':
      return removeId(state, action.id)
    case 'closeAll':
      return withList(state, [], null)
    case 'dismissUnpinned':
      if (state.pinned || state.tableIds.length === 0) return state
      return withList(state, [], null)
    case 'prune': {
      const kept = state.tableIds.filter((id) => action.existingIds.has(id))
      if (kept.length === state.tableIds.length) return state
      return withList(state, kept, state.activeId)
    }
    case 'setPinned':
      return state.pinned === action.pinned
        ? state
        : { ...state, pinned: action.pinned }
    case 'setMinimized':
      return state.minimized === action.minimized
        ? state
        : { ...state, minimized: action.minimized }
    case 'move':
      if (state.pos?.x === action.pos.x && state.pos.y === action.pos.y) {
        return state
      }
      return { ...state, pos: action.pos }
    case 'focus':
      if (!state.tableIds.includes(action.id) || state.activeId === action.id) {
        return state
      }
      return { ...state, activeId: action.id }
  }
}

/** Whether a keydown target is somewhere the user is typing. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return !!target.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
  )
}

export function useFieldWindows() {
  const [state, dispatch] = useReducer(fieldWindowsReducer, undefined, () => {
    const prefs = getFieldWindowPrefs()
    return createFieldWindowsState({ pinned: prefs.pinned, pos: prefs.pos })
  })

  const open = state.tableIds.length > 0

  // One Esc listener for the whole window set. Pinned windows ignore it.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (isTypingTarget(e.target)) return
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      dispatch({ type: 'dismissUnpinned' })
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  const actions = useMemo(
    () => ({
      plainClick: (id: string) => dispatch({ type: 'plainClick', id }),
      toggle: (id: string) => dispatch({ type: 'toggle', id }),
      close: (id: string) => dispatch({ type: 'close', id }),
      closeAll: () => dispatch({ type: 'closeAll' }),
      dismissUnpinned: () => dispatch({ type: 'dismissUnpinned' }),
      prune: (existingIds: ReadonlySet<string>) =>
        dispatch({ type: 'prune', existingIds }),
      focus: (id: string) => dispatch({ type: 'focus', id }),
      setMinimized: (minimized: boolean) =>
        dispatch({ type: 'setMinimized', minimized }),
      /** In-memory move (drag frames, clamping); does not persist. */
      move: (pos: FieldWindowPos) => dispatch({ type: 'move', pos }),
    }),
    [],
  )

  const setPinned = useCallback((pinned: boolean) => {
    dispatch({ type: 'setPinned', pinned })
    setFieldWindowPinned(pinned)
  }, [])

  /** Final position of a drag or keyboard move: apply and remember it. */
  const commitPos = useCallback((pos: FieldWindowPos) => {
    dispatch({ type: 'move', pos })
    setFieldWindowPos(pos)
  }, [])

  return { state, actions, setPinned, commitPos }
}
