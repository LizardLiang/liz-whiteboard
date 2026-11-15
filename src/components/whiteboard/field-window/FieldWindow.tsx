// src/components/whiteboard/field-window/FieldWindow.tsx
// Floating, non-modal field window. It uses `position: fixed` inside the
// portal layer of FieldWindows.tsx, so its position is in viewport
// coordinates and no transformed ancestor (the React Flow viewport, zen mode)
// can shift it.
// A plain fixed panel rather than shadcn Sheet: Sheet is a modal Radix Dialog
// whose overlay blocks the canvas, and the user must be able to click another
// table while this stays open.
// Tabs mode: one window, one tab per listed table. Windows mode: one window
// per table (items holds one entry), placed by the cascade when it has no
// dragged position.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { MinusIcon, PinIcon, PinOffIcon, XIcon } from 'lucide-react'
import { FieldsGrid } from './FieldsGrid'
import type { FieldsGridTable } from './FieldsGrid'
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react'
import type { FieldWindowMode, FieldWindowPos } from './use-field-window-prefs'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n/use-t'
import { cn } from '@/lib/utils'

export interface FieldWindowItem {
  id: string
  table: FieldsGridTable
}

export interface FieldWindowProps {
  items: Array<FieldWindowItem>
  activeId: string | null
  pinned: boolean
  minimized: boolean
  pos: FieldWindowPos | null
  mode: FieldWindowMode
  onModeChange: (mode: FieldWindowMode) => void
  /** Windows mode: stacking order. */
  zIndex?: number
  /** Windows mode: top-left used while `pos` is null (the 24 px cascade). */
  cascadePos?: FieldWindowPos
  /** Windows mode: pressing the window brings it to the front. */
  onRaise?: () => void
  onFocus: (id: string) => void
  onCloseTable: (id: string) => void
  onCloseAll: () => void
  onTogglePin: () => void
  onMinimizedChange: (minimized: boolean) => void
  /** In-memory position update (clamping); not remembered. */
  onMove: (pos: FieldWindowPos) => void
  /** Final position of a drag or keyboard move; remembered per browser. */
  onMoveEnd: (pos: FieldWindowPos) => void
}

const DRAG_THRESHOLD_PX = 4
const KEY_STEP_PX = 16
const KEY_STEP_SHIFT_PX = 64
const EDGE_PX = 8
/** Default anchor: right 12 px, below the 64 px app header. */
const DEFAULT_RIGHT_PX = 12
const DEFAULT_TOP_PX = 76

/** Keep a w x h box fully inside the viewport (top-left 8 px if it cannot fit). */
export function clampToViewport(
  pos: FieldWindowPos,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): FieldWindowPos {
  const maxX = viewportWidth - width
  const maxY = viewportHeight - height
  return {
    x: maxX < 0 ? EDGE_PX : Math.round(Math.min(Math.max(pos.x, 0), maxX)),
    y: maxY < 0 ? EDGE_PX : Math.round(Math.min(Math.max(pos.y, 0), maxY)),
  }
}

interface DragState {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
  moved: boolean
  last: FieldWindowPos
}

/** Pointer drag + arrow-key move for a fixed element, clamped to the viewport. */
function useViewportMove(options: {
  ref: RefObject<HTMLElement | null>
  pos: FieldWindowPos | null
  excludeSelector: string
  onMoveEnd: (pos: FieldWindowPos) => void
  onTap?: () => void
}) {
  const { ref, pos, excludeSelector, onMoveEnd, onTap } = options
  const dragRef = useRef<DragState | null>(null)
  const [live, setLive] = useState<FieldWindowPos | null>(null)

  const clampFor = useCallback(
    (next: FieldWindowPos) => {
      const rect = ref.current?.getBoundingClientRect()
      if (!rect) return next
      return clampToViewport(
        next,
        rect.width,
        rect.height,
        window.innerWidth,
        window.innerHeight,
      )
    },
    [ref],
  )

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    if (e.target instanceof Element && e.target.closest(excludeSelector)) return
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: rect.left,
      originY: rect.top,
      moved: false,
      last: { x: rect.left, y: rect.top },
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
    drag.moved = true
    drag.last = clampFor({ x: drag.originX + dx, y: drag.originY + dy })
    setLive(drag.last)
  }

  const finish = (e: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    setLive(null)
    if (drag.moved) onMoveEnd(drag.last)
    else if (!cancelled) onTap?.()
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return
    const step = e.shiftKey ? KEY_STEP_SHIFT_PX : KEY_STEP_PX
    const delta: Record<string, FieldWindowPos | undefined> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    }
    const d = delta[e.key]
    if (!d) return
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    e.preventDefault()
    e.stopPropagation()
    const from = pos ?? { x: rect.left, y: rect.top }
    onMoveEnd(clampFor({ x: from.x + d.x, y: from.y + d.y }))
  }

  return {
    live,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (e: ReactPointerEvent<HTMLElement>) => finish(e, false),
      onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => finish(e, true),
      onKeyDown,
    },
  }
}

export function FieldWindow(props: FieldWindowProps) {
  const {
    items,
    pinned,
    minimized,
    pos,
    mode,
    onModeChange,
    zIndex,
    cascadePos,
    onRaise,
    onFocus,
    onCloseTable,
    onCloseAll,
    onTogglePin,
    onMinimizedChange,
    onMove,
    onMoveEnd,
  } = props
  const { t } = useI18n()
  const ref = useRef<HTMLElement | null>(null)
  const tablistRef = useRef<HTMLDivElement | null>(null)

  const active = items.find((i) => i.id === props.activeId) ?? items.at(-1)
  const activeKey = active?.id ?? null

  // Keep the window (or its block) inside the viewport after a position,
  // size or content change, and when the browser window resizes.
  const clampNow = useCallback(() => {
    const el = ref.current
    if (!el || !pos) return
    const rect = el.getBoundingClientRect()
    const next = clampToViewport(
      pos,
      rect.width,
      rect.height,
      window.innerWidth,
      window.innerHeight,
    )
    if (next.x !== pos.x || next.y !== pos.y) onMove(next)
  }, [pos, onMove])

  const count = items.length
  useLayoutEffect(() => {
    if (count === 0) return
    clampNow()
  }, [clampNow, minimized, activeKey, count])

  useEffect(() => {
    if (count === 0) return
    window.addEventListener('resize', clampNow)
    return () => window.removeEventListener('resize', clampNow)
  }, [clampNow, count])

  // Show the active tab when the strip overflows.
  useEffect(() => {
    tablistRef.current
      ?.querySelector('[role="tab"][aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeKey, count])

  const restore = useCallback(
    () => onMinimizedChange(false),
    [onMinimizedChange],
  )
  const { live, handlers } = useViewportMove({
    ref,
    pos,
    excludeSelector: minimized ? '[data-no-drag]' : 'button, [data-no-drag]',
    onMoveEnd,
    onTap: minimized ? restore : undefined,
  })

  if (!active) return null

  const effective = live ?? pos ?? cascadePos ?? null
  const placement: CSSProperties = effective
    ? { left: effective.x, top: effective.y }
    : { right: DEFAULT_RIGHT_PX, top: DEFAULT_TOP_PX }
  const layering: CSSProperties = zIndex === undefined ? {} : { zIndex }
  const raiseProps = {
    'data-field-window': '',
    onPointerDownCapture: onRaise,
  }

  const minimize = () => {
    if (!pos && ref.current) {
      // Anchor the block where the window is, so restore returns to it.
      const rect = ref.current.getBoundingClientRect()
      onMove({ x: Math.round(rect.left), y: Math.round(rect.top) })
    }
    onMinimizedChange(true)
  }

  const moveTab = (e: ReactKeyboardEvent<HTMLElement>) => {
    const index = items.findIndex((i) => i.id === active.id)
    let nextIndex = index
    if (e.key === 'ArrowRight') nextIndex = (index + 1) % items.length
    else if (e.key === 'ArrowLeft') {
      nextIndex = (index - 1 + items.length) % items.length
    } else if (e.key === 'Home') nextIndex = 0
    else if (e.key === 'End') nextIndex = items.length - 1
    else return
    e.preventDefault()
    e.stopPropagation()
    onFocus(items[nextIndex].id)
    tablistRef.current
      ?.querySelectorAll<HTMLElement>('[role="tab"]')
      [nextIndex].focus()
  }

  if (minimized) {
    return (
      <div
        ref={ref as RefObject<HTMLDivElement>}
        role="group"
        aria-label={t('whiteboard.fieldsDrawer.title', {
          name: active.table.name,
        })}
        data-testid="table-fields-block"
        style={{ ...placement, ...layering }}
        {...raiseProps}
        className="pointer-events-auto fixed z-40 flex max-w-[calc(100vw-1.5rem)] cursor-grab touch-none items-center gap-1 rounded-lg border bg-background py-1 pr-1 pl-2 text-foreground shadow-lg select-none"
        {...handlers}
      >
        <button
          type="button"
          aria-label={t('whiteboard.fieldsDrawer.restore')}
          className="flex min-w-0 items-center gap-1.5 rounded px-1 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={(e) => {
            // Mouse and touch restore through the tap path; a click with no
            // pointer (keyboard) arrives here.
            if (e.detail === 0) restore()
          }}
        >
          {pinned && <PinIcon className="size-3.5 shrink-0" />}
          <span className="truncate [overflow-wrap:anywhere]">
            {active.table.name}
          </span>
          {count > 1 && (
            <span className="shrink-0 text-muted-foreground">
              {t('whiteboard.fieldsDrawer.moreTables', { count: count - 1 })}
            </span>
          )}
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          data-no-drag
          aria-label={t('whiteboard.fieldsDrawer.close')}
          onClick={onCloseAll}
        >
          <XIcon className="size-4" />
        </Button>
      </div>
    )
  }

  return (
    <aside
      ref={ref}
      role="complementary"
      aria-labelledby="table-fields-drawer-title"
      data-testid="table-fields-drawer"
      style={{
        ...placement,
        ...layering,
        // Same cap at the default and a dragged position, so dragging never
        // resizes the window.
        // A cascaded window (no dragged position) also stops above the
        // viewport bottom: its top is lower than the default anchor.
        maxHeight: `calc(100vh - ${
          (pos === null && cascadePos ? cascadePos.y : DEFAULT_TOP_PX) +
          DEFAULT_RIGHT_PX
        }px)`,
      }}
      {...raiseProps}
      className="pointer-events-auto fixed z-40 flex w-[min(48rem,calc(100vw-1.5rem))] flex-col rounded-lg border bg-background text-foreground shadow-lg"
    >
      <header
        tabIndex={0}
        role="group"
        aria-label={t('whiteboard.fieldsDrawer.dragHandle')}
        data-testid="table-fields-header"
        className="flex cursor-grab touch-none items-start justify-between gap-2 rounded-t-lg px-4 pt-3 pb-2 select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
        {...handlers}
      >
        <div className="min-w-0">
          <h2
            id="table-fields-drawer-title"
            className="text-lg font-semibold [overflow-wrap:anywhere]"
          >
            {t('whiteboard.fieldsDrawer.title', { name: active.table.name })}
          </h2>
          <p className="mt-1 text-sm break-words text-muted-foreground">
            {active.table.description ||
              t('whiteboard.fieldsDrawer.description')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <div
            role="group"
            aria-label={t('whiteboard.fieldsDrawer.mode')}
            className="mr-1 flex rounded-md border p-0.5"
          >
            {(['tabs', 'windows'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                data-testid={`fields-window-mode-${m}`}
                className={cn(
                  'rounded px-2 py-0.5 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  mode === m
                    ? 'bg-muted font-semibold'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => onModeChange(m)}
              >
                {t(
                  m === 'tabs'
                    ? 'whiteboard.fieldsDrawer.modeTabs'
                    : 'whiteboard.fieldsDrawer.modeWindows',
                )}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('whiteboard.fieldsDrawer.pin')}
            title={t(
              pinned
                ? 'whiteboard.fieldsDrawer.unpin'
                : 'whiteboard.fieldsDrawer.pin',
            )}
            aria-pressed={pinned}
            data-testid="fields-window-pin"
            onClick={onTogglePin}
          >
            {pinned ? (
              <PinOffIcon className="size-4" />
            ) : (
              <PinIcon className="size-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('whiteboard.fieldsDrawer.minimize')}
            data-testid="fields-window-minimize"
            onClick={minimize}
          >
            <MinusIcon className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('whiteboard.fieldsDrawer.close')}
            onClick={onCloseAll}
          >
            <XIcon className="size-4" />
          </Button>
        </div>
      </header>
      {count > 1 && (
        <div
          ref={tablistRef}
          role="tablist"
          aria-label={t('whiteboard.fieldsDrawer.tabList')}
          className="flex shrink-0 gap-1 overflow-x-auto px-4 pb-2"
        >
          {items.map((item) => {
            const selected = item.id === active.id
            return (
              <div
                key={item.id}
                className={cn(
                  'flex shrink-0 items-center rounded-md border',
                  selected ? 'bg-muted' : 'bg-background',
                )}
              >
                <button
                  type="button"
                  role="tab"
                  id={`fields-tab-${item.id}`}
                  aria-selected={selected}
                  aria-controls="fields-tabpanel"
                  tabIndex={selected ? 0 : -1}
                  data-testid="fields-tab"
                  className={cn(
                    'max-w-[14rem] truncate rounded-l-md px-2 py-1 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    selected ? 'font-semibold' : 'text-muted-foreground',
                  )}
                  onClick={() => onFocus(item.id)}
                  onKeyDown={moveTab}
                >
                  {item.table.name}
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={t('whiteboard.fieldsDrawer.closeTable', {
                    name: item.table.name,
                  })}
                  data-testid="fields-tab-close"
                  className="rounded-r-md px-1 py-1 text-muted-foreground hover:text-foreground"
                  onClick={() => onCloseTable(item.id)}
                >
                  <XIcon className="size-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}
      <div
        id="fields-tabpanel"
        role={count > 1 ? 'tabpanel' : undefined}
        aria-labelledby={count > 1 ? `fields-tab-${active.id}` : undefined}
        className="min-h-0 flex-1 overflow-auto px-4 pb-4"
      >
        <FieldsGrid table={active.table} />
      </div>
    </aside>
  )
}
