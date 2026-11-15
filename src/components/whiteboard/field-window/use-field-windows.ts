// src/components/whiteboard/field-window/use-field-windows.ts
// The field window's own table list (separate from the canvas selection) and
// its window state. A pure reducer plus a hook that owns the Esc listener and
// writes the layout prefs.

import { useCallback, useEffect, useMemo, useReducer } from 'react'
import {
  getFieldWindowPrefs,
  setFieldWindowMode,
  setFieldWindowPinned,
  setFieldWindowPos,
} from './use-field-window-prefs'
import type { FieldWindowMode, FieldWindowPos } from './use-field-window-prefs'

/** One window of windows mode. */
export interface FieldWindowEntry {
  pinned: boolean
  minimized: boolean
  /** Dragged viewport position; null = cascaded default for its slot. */
  pos: FieldWindowPos | null
  /** Stacking order; the highest value is in front. */
  z: number
  /** Cascade step (see CASCADE_STEP_PX) assigned when the window opens. */
  slot: number
}

export interface FieldWindowsState {
  mode: FieldWindowMode
  /** Listed tables, in the order they were added. */
  tableIds: Array<string>
  /**
   * Tabs mode: the tab shown. Windows mode: the front-most window.
   * Null when the list is empty.
   */
  activeId: string | null
  /**
   * Tabs mode: the one window's pin. Windows mode: the last pin choice, which
   * the first window of a new set starts with (each window owns its own pin).
   */
  pinned: boolean
  minimized: boolean
  /**
   * Viewport position of the tabs window's top-left; null = default anchor.
   * In windows mode it is the cascade origin.
   */
  pos: FieldWindowPos | null
  /** Windows mode only: one entry per listed table. Empty in tabs mode. */
  windows: Record<string, FieldWindowEntry>
  nextZ: number
  nextSlot: number
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
  | { type: 'setMode'; mode: FieldWindowMode; frontPos?: FieldWindowPos | null }
  | { type: 'setWindowPinned'; id: string; pinned: boolean }
  | { type: 'setWindowMinimized'; id: string; minimized: boolean }
  | { type: 'moveWindow'; id: string; pos: FieldWindowPos }

export function createFieldWindowsState(
  seed: Partial<Pick<FieldWindowsState, 'pinned' | 'pos' | 'mode'>> = {},
): FieldWindowsState {
  return {
    mode: seed.mode ?? 'tabs',
    windows: {},
    nextZ: 1,
    nextSlot: 0,
    tableIds: [],
    activeId: null,
    pinned: seed.pinned ?? false,
    minimized: false,
    pos: seed.pos ?? null,
  }
}

function frontId(
  windows: Record<string, FieldWindowEntry>,
  ids: Array<string>,
) {
  let best: string | null = null
  for (const id of ids) {
    if (best === null || windows[id].z > windows[best].z) best = id
  }
  return best
}

function withList(
  state: FieldWindowsState,
  tableIds: Array<string>,
  preferredActive: string | null,
): FieldWindowsState {
  const windows =
    state.mode === 'windows'
      ? Object.fromEntries(
          tableIds.flatMap((id) =>
            id in state.windows ? [[id, state.windows[id]] as const] : [],
          ),
        )
      : state.windows
  if (tableIds.length === 0) {
    return { ...state, tableIds, windows, activeId: null, minimized: false }
  }
  let activeId: string | null =
    preferredActive && tableIds.includes(preferredActive)
      ? preferredActive
      : null
  if (activeId === null) {
    activeId =
      state.mode === 'windows'
        ? frontId(windows, tableIds)
        : tableIds[tableIds.length - 1]
  }
  return { ...state, tableIds, windows, activeId }
}

function removeId(state: FieldWindowsState, id: string): FieldWindowsState {
  if (!state.tableIds.includes(id)) return state
  return withList(
    state,
    state.tableIds.filter((t) => t !== id),
    state.activeId === id ? null : state.activeId,
  )
}

/** Open a window for `id` (windows mode) on top of the others. */
function addWindow(
  state: FieldWindowsState,
  id: string,
  pinned: boolean,
): FieldWindowsState {
  return {
    ...state,
    windows: {
      ...state.windows,
      [id]: {
        pinned,
        minimized: false,
        pos: null,
        z: state.nextZ,
        slot: state.nextSlot,
      },
    },
    nextZ: state.nextZ + 1,
    nextSlot: state.nextSlot + 1,
  }
}

function raiseWindow(state: FieldWindowsState, id: string): FieldWindowsState {
  const entry = state.windows[id] as FieldWindowEntry | undefined
  if (!entry) return state
  if (entry.z === state.nextZ - 1) {
    return state.activeId === id ? state : { ...state, activeId: id }
  }
  return {
    ...state,
    activeId: id,
    windows: { ...state.windows, [id]: { ...entry, z: state.nextZ } },
    nextZ: state.nextZ + 1,
  }
}

function patchWindow(
  state: FieldWindowsState,
  id: string,
  patch: Partial<FieldWindowEntry>,
): FieldWindowsState {
  const entry = state.windows[id] as FieldWindowEntry | undefined
  if (!entry) return state
  const changed = (Object.keys(patch) as Array<keyof FieldWindowEntry>).some(
    (k) => {
      const a = entry[k]
      const b = patch[k]
      if (typeof a === 'object' && a !== null && typeof b === 'object') {
        return JSON.stringify(a) !== JSON.stringify(b)
      }
      return a !== b
    },
  )
  if (!changed) return state
  return {
    ...state,
    windows: { ...state.windows, [id]: { ...entry, ...patch } },
  }
}

function switchMode(
  state: FieldWindowsState,
  mode: FieldWindowMode,
  frontPos: FieldWindowPos | null | undefined,
): FieldWindowsState {
  if (state.mode === mode) return state
  if (mode === 'windows') {
    const windows: Record<string, FieldWindowEntry> = {}
    state.tableIds.forEach((id, i) => {
      windows[id] = {
        pinned: state.pinned,
        minimized: false,
        pos: null,
        z: i + 1,
        slot: i,
      }
    })
    const next: FieldWindowsState = {
      ...state,
      mode,
      windows,
      minimized: false,
      nextZ: state.tableIds.length + 1,
      nextSlot: state.tableIds.length,
    }
    return state.activeId ? raiseWindow(next, state.activeId) : next
  }
  const front = frontId(state.windows, state.tableIds)
  const anyPinned = state.tableIds.some((id) => state.windows[id].pinned)
  return {
    ...state,
    mode,
    windows: {},
    activeId: front,
    pinned: state.tableIds.length > 0 ? anyPinned : state.pinned,
    minimized: false,
    pos: frontPos ?? (front ? state.windows[front].pos : null) ?? state.pos,
    nextZ: 1,
    nextSlot: 0,
  }
}

export function fieldWindowsReducer(
  state: FieldWindowsState,
  action: FieldWindowsAction,
): FieldWindowsState {
  switch (action.type) {
    case 'plainClick': {
      if (state.mode === 'windows') {
        // Each window owns its pin: pinned windows stay, others are replaced.
        const ids = state.tableIds.filter(
          (t) => state.windows[t].pinned || t === action.id,
        )
        let next = state
        if (!ids.includes(action.id)) {
          next = addWindow(next, action.id, state.pinned && ids.length === 0)
          ids.push(action.id)
        }
        return raiseWindow(withList(next, ids, action.id), action.id)
      }
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
      if (state.mode === 'windows') {
        const next = addWindow(
          state,
          action.id,
          state.pinned && state.tableIds.length === 0,
        )
        return withList(next, [...state.tableIds, action.id], action.id)
      }
      return withList(state, [...state.tableIds, action.id], action.id)
    }
    case 'close':
      return removeId(state, action.id)
    case 'closeAll':
      return withList(state, [], null)
    case 'dismissUnpinned':
      if (state.mode === 'windows') {
        const ids = state.tableIds.filter((t) => state.windows[t].pinned)
        return ids.length === state.tableIds.length
          ? state
          : withList(state, ids, state.activeId)
      }
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
      if (state.mode === 'windows') return raiseWindow(state, action.id)
      if (!state.tableIds.includes(action.id) || state.activeId === action.id) {
        return state
      }
      return { ...state, activeId: action.id }
    case 'setMode':
      return switchMode(state, action.mode, action.frontPos)
    case 'setWindowPinned': {
      const next = patchWindow(state, action.id, { pinned: action.pinned })
      return next === state || next.pinned === action.pinned
        ? next
        : { ...next, pinned: action.pinned }
    }
    case 'setWindowMinimized':
      return patchWindow(state, action.id, { minimized: action.minimized })
    case 'moveWindow':
      return patchWindow(state, action.id, { pos: action.pos })
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
    return createFieldWindowsState({
      pinned: prefs.pinned,
      pos: prefs.pos,
      mode: prefs.mode,
    })
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
      setWindowMinimized: (id: string, minimized: boolean) =>
        dispatch({ type: 'setWindowMinimized', id, minimized }),
      moveWindow: (id: string, pos: FieldWindowPos) =>
        dispatch({ type: 'moveWindow', id, pos }),
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

  const setWindowPinned = useCallback((id: string, pinned: boolean) => {
    dispatch({ type: 'setWindowPinned', id, pinned })
    setFieldWindowPinned(pinned)
  }, [])

  /** Final position of a window in windows mode; also remembered per browser. */
  const commitWindowPos = useCallback((id: string, pos: FieldWindowPos) => {
    dispatch({ type: 'moveWindow', id, pos })
    setFieldWindowPos(pos)
  }, [])

  /** Switch tabs / windows mode and remember the choice. */
  const switchModeTo = useCallback((mode: FieldWindowMode) => {
    // Going back to one window: it takes the front-most window's screen spot.
    let frontPos: FieldWindowPos | null = null
    if (mode === 'tabs') {
      let bestZ = -1
      for (const el of document.querySelectorAll<HTMLElement>(
        '[data-field-window]',
      )) {
        const z = Number(el.style.zIndex) || 0
        if (z > bestZ) {
          bestZ = z
          const rect = el.getBoundingClientRect()
          frontPos = { x: Math.round(rect.left), y: Math.round(rect.top) }
        }
      }
    }
    dispatch({ type: 'setMode', mode, frontPos })
    setFieldWindowMode(mode)
  }, [])

  return {
    state,
    actions,
    setPinned,
    commitPos,
    setWindowPinned,
    commitWindowPos,
    switchMode: switchModeTo,
  }
}
