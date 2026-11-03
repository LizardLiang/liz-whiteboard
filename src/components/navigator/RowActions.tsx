// src/components/navigator/RowActions.tsx
// Hover/focus action buttons for a navigator row, shown as a vertical column
// just outside the navigator panel's right edge so the row name stays fully
// visible. One component serves the project, folder, whiteboard and canvas
// board rows.
//
// The column renders through a portal: the desktop aside uses backdrop-filter
// and the projects list scrolls (both clip or re-anchor in-row positioning).
// Inside a Sheet the portal target is the dialog itself, because a modal
// dialog marks everything outside its content inert.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, ReactNode } from 'react'

/** Delay before the column hides, so the pointer can cross the gap to it. */
const HIDE_DELAY_MS = 150
/** Space between the panel's right edge and the column. */
const GAP_PX = 6
const VIEWPORT_MARGIN_PX = 4

/** Shared look for the column's buttons: clear hover and focus feedback. */
export const ROW_ACTION_BUTTON_CLASS =
  'h-6 w-6 cursor-pointer p-0 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground dark:hover:bg-accent'
export const ROW_ACTION_DELETE_CLASS =
  'h-6 w-6 cursor-pointer p-0 text-destructive hover:bg-destructive/15 hover:text-destructive focus-visible:bg-destructive/15 focus-visible:text-destructive dark:hover:bg-destructive/25'

const SWITCH_DELAY_MS = 120

interface ActiveRow {
  close: () => void
  pinned: () => boolean
}

/** The one row whose column is open; opening another closes it. */
let activeRow: ActiveRow | null = null

interface RowActionsContextValue {
  /** Keeps the column open while a menu opened from it is open. */
  setMenuOpen: (open: boolean) => void
}

const RowActionsContext = createContext<RowActionsContextValue | null>(null)

/** For menus rendered inside the column; null outside a RowActions. */
export function useRowActionsMenu() {
  return useContext(RowActionsContext)
}

interface Position {
  left: number
  top: number
  inView: boolean
}

function findScrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement
  while (node) {
    const overflowY = getComputedStyle(node).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return node
    node = node.parentElement
  }
  return null
}

function getHost(anchor: HTMLElement | null): HTMLElement {
  return (
    (anchor?.closest('[role="dialog"]') as HTMLElement | null) ?? document.body
  )
}

interface RowActionsProps {
  children: ReactNode
}

/**
 * Render as a child of the row's wrapper element. The column opens while that
 * wrapper is hovered or holds focus.
 */
export function RowActions({ children }: RowActionsProps) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const columnRef = useRef<HTMLDivElement>(null)
  const flags = useRef({ row: false, column: false, focus: false, menu: false })
  const timer = useRef<number | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const openRef = useRef(false)
  const api = useRef<ActiveRow>({
    close: () => {
      window.clearTimeout(timer.current)
      openRef.current = false
      if (activeRow === api.current) activeRow = null
      setOpen(false)
    },
    pinned: () => {
      const f = flags.current
      return f.column || f.menu || f.focus
    },
  })
  const [position, setPosition] = useState<Position | null>(null)

  const sync = useCallback(() => {
    window.clearTimeout(timer.current)
    const f = flags.current
    const wanted = f.row || f.column || f.focus || f.menu
    if (!wanted) {
      if (openRef.current) {
        timer.current = window.setTimeout(() => {
          api.current.close()
        }, HIDE_DELAY_MS)
      }
      return
    }
    if (openRef.current) return
    const openNow = () => {
      if (activeRow && activeRow !== api.current) {
        if (activeRow.pinned()) return
        activeRow.close()
      }
      activeRow = api.current
      openRef.current = true
      setOpen(true)
    }
    // Switching from another row's column waits briefly, so a pointer
    // crossing rows on its way to a column does not steal it.
    if (activeRow && activeRow !== api.current) {
      timer.current = window.setTimeout(openNow, SWITCH_DELAY_MS)
    } else {
      openNow()
    }
  }, [])

  useEffect(() => {
    const row = anchorRef.current?.parentElement
    if (!row) return
    const f = flags.current
    const handle = api.current
    const onEnter = () => {
      f.row = true
      sync()
    }
    const onLeave = () => {
      f.row = false
      sync()
    }
    // Keyboard focus only: a mouse click leaves focus on the row, which
    // would keep the column open after the pointer has gone.
    const onFocusIn = (e: FocusEvent) => {
      if (!(e.target as Element).matches(':focus-visible')) return
      f.focus = true
      sync()
    }
    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null
      if (next && (row.contains(next) || columnRef.current?.contains(next))) {
        return
      }
      f.focus = false
      sync()
    }
    row.addEventListener('pointerenter', onEnter)
    row.addEventListener('pointerleave', onLeave)
    row.addEventListener('focusin', onFocusIn)
    row.addEventListener('focusout', onFocusOut)
    return () => {
      row.removeEventListener('pointerenter', onEnter)
      row.removeEventListener('pointerleave', onLeave)
      row.removeEventListener('focusin', onFocusIn)
      row.removeEventListener('focusout', onFocusOut)
      window.clearTimeout(timer.current)
      if (activeRow === handle) activeRow = null
    }
  }, [sync])

  const measure = useCallback(() => {
    const row = anchorRef.current?.parentElement
    if (!row) return
    const host = getHost(row)
    const inDialog = host !== document.body
    const panel = inDialog ? host : (row.closest('aside') ?? row)
    const rowRect = row.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    const clip = findScrollParent(row)?.getBoundingClientRect()
    const inView =
      !clip || (rowRect.bottom > clip.top && rowRect.top < clip.bottom)

    const height = columnRef.current?.offsetHeight ?? 0
    const maxTop = window.innerHeight - height - VIEWPORT_MARGIN_PX
    const top = Math.max(VIEWPORT_MARGIN_PX, Math.min(rowRect.top, maxTop))
    // The wrapper starts at the panel edge; its left padding is the gap.
    const left = panelRect.right

    if (inDialog) {
      const hostRect = host.getBoundingClientRect()
      setPosition({
        left: left - hostRect.left - host.clientLeft,
        top: top - hostRect.top - host.clientTop,
        inView,
      })
    } else {
      setPosition({ left, top, inView })
    }
  }, [])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    measure()
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [open, measure])

  const contextValue = useMemo<RowActionsContextValue>(
    () => ({
      setMenuOpen: (menuOpen) => {
        flags.current.menu = menuOpen
        sync()
      },
    }),
    [sync],
  )

  const host = open ? getHost(anchorRef.current) : null
  const style: CSSProperties = position
    ? {
        left: position.left,
        top: position.top,
        visibility: position.inView ? 'visible' : 'hidden',
      }
    : { left: 0, top: 0, visibility: 'hidden' }

  return (
    <>
      <span ref={anchorRef} hidden aria-hidden="true" />
      {host &&
        createPortal(
          <RowActionsContext.Provider value={contextValue}>
            {/* The wrapper's left padding is the invisible bridge the pointer
                crosses between the panel edge and the visible column. */}
            <div
              data-testid="row-actions"
              className={`${host === document.body ? 'fixed' : 'absolute'} pointer-events-auto z-50`}
              style={{ ...style, paddingLeft: GAP_PX }}
              onPointerEnter={() => {
                flags.current.column = true
                sync()
              }}
              onPointerLeave={() => {
                flags.current.column = false
                sync()
              }}
              onFocus={(e) => {
                if (!(e.target as Element).matches(':focus-visible')) return
                flags.current.focus = true
                sync()
              }}
              onBlur={(e) => {
                const next = e.relatedTarget as Node | null
                const row = anchorRef.current?.parentElement
                if (
                  next &&
                  (e.currentTarget.contains(next) || row?.contains(next))
                ) {
                  return
                }
                flags.current.focus = false
                sync()
              }}
            >
              <div
                ref={columnRef}
                data-testid="row-actions-column"
                className="flex flex-col gap-1 rounded-md border bg-popover p-0.5 shadow-md"
              >
                {children}
              </div>
            </div>
          </RowActionsContext.Provider>,
          host,
        )}
    </>
  )
}
