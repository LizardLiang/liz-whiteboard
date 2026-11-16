// src/components/whiteboard/field-window/FieldWindows.tsx
// Renders the field window set through one portal layer on <body>. The layer
// is a fixed, click-through, isolated z-40 stacking context, so the windows
// raise above each other with small z values yet stay below dialogs and
// popovers (z-50) and above the minimap.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FieldWindow } from './FieldWindow'
import {
  ENTRY_TOUR_STEP_COUNT,
  TOUR_STEP_COUNT,
  buildFieldWindowTour,
  buildIntroStep,
} from './field-window-tour'
import {
  getFieldWindowPrefs,
  setFieldWindowTourSeen,
} from './use-field-window-prefs'
import type { FieldWindowItem } from './FieldWindow'
import type { FieldWindowMode, FieldWindowPos } from './use-field-window-prefs'
import type { useFieldWindows } from './use-field-windows'
import type { TourFlow } from './field-window-tour'
import { SpotlightTour } from '@/components/tutorial/SpotlightTour'
import { useSpotlightTour } from '@/components/tutorial/use-spotlight-tour'
import { useI18n } from '@/lib/i18n/use-t'

/**
 * Cascade step: the visible strip of a back window must show its whole title
 * row. The header is 1 px border + 12 px top padding (pt-3) + 28 px title line
 * (text-lg, line-height 1.75 rem) = 41 px; rounded up to 44 px, the next
 * multiple of 4 (the Tailwind spacing grid), so descenders are not clipped.
 */
export const CASCADE_STEP_PX = 44
const DEFAULT_RIGHT_PX = 12
const DEFAULT_TOP_PX = 76
/** Rows below this stay reachable when the cascade wraps. */
const MIN_WINDOW_HEIGHT_PX = 160
/**
 * Space kept free at the viewport bottom when the bottom toolbar
 * (data-testid="whiteboard-dock", `absolute bottom-4` in Toolbar.tsx) cannot
 * be measured: 16 px bottom offset + about 54 px toolbar height + 8 px gap.
 */
const FALLBACK_BOTTOM_RESERVE_PX = 78
const DOCK_GAP_PX = 8

/** Free space to keep at the viewport bottom, measured from the real toolbar. */
export function measureBottomReserve(viewportHeight: number): number {
  const dock = document.querySelector('[data-testid="whiteboard-dock"]')
  const rect = dock?.getBoundingClientRect()
  if (!rect || rect.height === 0) {
    return dock ? DEFAULT_RIGHT_PX : FALLBACK_BOTTOM_RESERVE_PX
  }
  return Math.max(DEFAULT_RIGHT_PX, viewportHeight - rect.top + DOCK_GAP_PX)
}

/** Viewport size and toolbar reserve; re-renders the layer when the window resizes. */
function useViewportBox() {
  const read = () => ({
    width: window.innerWidth,
    height: window.innerHeight,
    reserve: measureBottomReserve(window.innerHeight),
  })
  const [box, setBox] = useState(read)
  useEffect(() => {
    const onResize = () => setBox(read())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const live = read()
  return live.reserve === box.reserve &&
    live.width === box.width &&
    live.height === box.height
    ? box
    : live
}

/**
 * Top-left of the window in cascade `slot`. The origin is the remembered
 * position, else the default anchor; steps go right and down from a
 * remembered position and left and down from the default anchor. The step
 * index wraps to the start when the next step would leave the viewport.
 */
export function cascadePlacement(
  origin: FieldWindowPos | null,
  slot: number,
  viewportWidth: number,
  viewportHeight: number,
  bottomReserve = 0,
): FieldWindowPos {
  const width = Math.min(768, viewportWidth - 24)
  const maxX = Math.max(0, viewportWidth - width)
  const maxY = Math.max(
    0,
    viewportHeight - bottomReserve - MIN_WINDOW_HEIGHT_PX,
  )
  const raw = origin ?? {
    x: viewportWidth - DEFAULT_RIGHT_PX - width,
    y: DEFAULT_TOP_PX,
  }
  // A remembered origin can predate a resize: pull it back inside first.
  const start = {
    x: Math.min(Math.max(raw.x, 0), maxX),
    y: Math.min(Math.max(raw.y, 0), maxY),
  }
  const dir = origin ? 1 : -1
  const steps = Math.max(1, Math.floor((maxY - start.y) / CASCADE_STEP_PX) + 1)
  const i = slot % steps
  return {
    x: Math.round(
      Math.min(Math.max(start.x + dir * CASCADE_STEP_PX * i, 0), maxX),
    ),
    y: start.y + CASCADE_STEP_PX * i,
  }
}

interface FieldWindowsProps {
  fieldWindows: ReturnType<typeof useFieldWindows>
  items: Array<FieldWindowItem>
  /** Canvas instance; tour step 4 pans it to show the table. */
  flow?: TourFlow
  /** Every canvas table; the board-entry tour starts once there is one. */
  tables?: Array<{ id: string; name: string }>
}

/** The window a tour explains: the one tabs window, or one window by id. */
interface TourWindow {
  mode: FieldWindowMode
  id: string
}

/** `entry` = the board-entry tour (intro step + window steps), `window` = the 7 window steps. */
type TourKind = 'entry' | 'window'

export function FieldWindows({
  fieldWindows,
  items,
  flow,
  tables = [],
}: FieldWindowsProps) {
  const { state, actions } = fieldWindows
  const viewport = useViewportBox()
  const { t } = useI18n()
  const tour = useSpotlightTour()
  const [tourWindow, setTourWindow] = useState<TourWindow | null>(null)

  const [tourKind, setTourKind] = useState<TourKind>('window')

  const latest = useRef({ items, state, flow, tourWindow, tables })
  latest.current = { items, state, flow, tourWindow, tables }
  /** The canvas table the intro step spotlights and Next opens. */
  const introId = useRef<string | null>(null)

  const { start: startSteps, end: endTour } = tour
  const startTour = useCallback(
    (target: TourWindow | null) => {
      setFieldWindowTourSeen()
      setTourWindow(target)
      setTourKind(target ? 'window' : 'entry')
      introId.current = null
      startSteps(target ? TOUR_STEP_COUNT : ENTRY_TOUR_STEP_COUNT)
    },
    [startSteps],
  )

  // Entering a board that has a table, in a browser that never saw the tour:
  // explain the field window before the user has found it. Waits for React
  // Flow to measure the first table (the intro step needs its geometry).
  const hasTables = tables.length > 0
  const hasFlow = !!flow
  useEffect(() => {
    if (!hasTables || !hasFlow) return
    let frame = 0
    const tryStart = () => {
      if (getFieldWindowPrefs().tourSeen) return
      const { tables: all, flow: f } = latest.current
      const first = all.length > 0 ? f?.getInternalNode(all[0].id) : undefined
      if (first?.measured.width) startTour(null)
      else frame = requestAnimationFrame(tryStart)
    }
    tryStart()
    return () => cancelAnimationFrame(frame)
  }, [hasTables, hasFlow, startTour])

  // The first time a window opens in this browser, explain it.
  const hasItems = items.length > 0
  useEffect(() => {
    if (!hasItems || getFieldWindowPrefs().tourSeen) return
    const { items: now, state: current } = latest.current
    startTour({
      mode: current.mode,
      id: current.mode === 'windows' ? now[0].id : '',
    })
  }, [hasItems, startTour])

  const tourOpen = tour.state.open
  const tourItem = tourWindow
    ? tourWindow.mode === 'tabs'
      ? (items.find((i) => i.id === state.activeId) ?? items.at(-1))
      : items.find((i) => i.id === tourWindow.id)
    : undefined
  const windowAlive =
    tourWindow !== null && tourWindow.mode === state.mode && !!tourItem
  // The intro step has no window yet, so it does not depend on one.
  const onIntro = tourKind === 'entry' && tour.state.step === 0
  const tourAlive = onIntro || windowAlive

  // The tour ends with its window (closed, deleted, or switched mode).
  useEffect(() => {
    if (tourOpen && !tourAlive) endTour()
  }, [tourOpen, tourAlive, endTour])

  const windowSteps = useMemo(
    () =>
      buildFieldWindowTour({
        t,
        getWindowEl: () => {
          const { tourWindow: w } = latest.current
          if (!w) return null
          const selector =
            w.mode === 'tabs'
              ? '[data-testid="table-fields-drawer"]'
              : `[data-testid="table-fields-drawer"][data-field-window-id="${CSS.escape(w.id)}"]`
          return document.querySelector<HTMLElement>(selector)
        },
        getTable: () => {
          const { items: all, state: s, tourWindow: w } = latest.current
          if (!w) return null
          const item =
            w.mode === 'tabs'
              ? (all.find((i) => i.id === s.activeId) ?? all.at(-1))
              : all.find((i) => i.id === w.id)
          return item ? { id: item.id, name: item.table.name } : null
        },
        getFlow: () => latest.current.flow ?? null,
        getBottomReserve: () => measureBottomReserve(window.innerHeight),
      }),
    [t],
  )
  const entrySteps = useMemo(
    () => [
      buildIntroStep({
        t,
        getTables: () => latest.current.tables,
        getIntroId: () => introId.current,
        setIntroId: (id) => {
          introId.current = id
        },
        getWindowEl: () =>
          document.querySelector<HTMLElement>(
            '[data-testid="table-fields-drawer"]',
          ),
        getFlow: () => latest.current.flow ?? null,
        getBottomReserve: () => measureBottomReserve(window.innerHeight),
      }),
      ...windowSteps,
    ],
    [t, windowSteps],
  )
  const steps = tourKind === 'entry' ? entrySteps : windowSteps
  const labels = useMemo(
    () => ({
      next: t('whiteboard.fieldsTour.next'),
      back: t('whiteboard.fieldsTour.back'),
      skip: t('whiteboard.fieldsTour.skip'),
      done: t('whiteboard.fieldsTour.done'),
      stepOf: (step: number, total: number) =>
        t('whiteboard.fieldsTour.stepOf', { step, total }),
    }),
    [t],
  )

  // The intro step's Next opens the window for its table, the same path as a
  // plain click, then the tour continues on the window steps.
  const onTourNext = () => {
    if (onIntro) {
      const id = introId.current
      if (!id) {
        endTour()
        return
      }
      const { state: current } = latest.current
      setTourWindow({
        mode: current.mode,
        id: current.mode === 'windows' ? id : '',
      })
      actions.plainClick(id)
    }
    tour.next()
  }

  if (typeof document === 'undefined') return null

  const onModeChange = (mode: FieldWindowMode) => fieldWindows.switchMode(mode)

  let content = null
  if (items.length === 0) {
    content = null
  } else if (state.mode === 'windows') {
    content = items.map((item) => {
      const entry = state.windows[item.id]
      return (
        <FieldWindow
          key={item.id}
          items={[item]}
          activeId={item.id}
          mode="windows"
          onModeChange={onModeChange}
          pinned={entry.pinned}
          minimized={entry.minimized}
          pos={entry.pos}
          zIndex={entry.z}
          cascadePos={cascadePlacement(
            state.pos,
            entry.slot,
            viewport.width,
            viewport.height,
            viewport.reserve,
          )}
          bottomReserve={viewport.reserve}
          onRaise={() => actions.focus(item.id)}
          onFocus={actions.focus}
          onCloseTable={actions.close}
          onCloseAll={() => actions.close(item.id)}
          onTogglePin={() =>
            fieldWindows.setWindowPinned(item.id, !entry.pinned)
          }
          onHelp={() => startTour({ mode: 'windows', id: item.id })}
          onMinimizedChange={(m) => actions.setWindowMinimized(item.id, m)}
          onMove={(pos) => actions.moveWindow(item.id, pos)}
          onMoveEnd={(pos) => fieldWindows.commitWindowPos(item.id, pos)}
        />
      )
    })
  } else {
    content = (
      <FieldWindow
        items={items}
        activeId={state.activeId}
        mode="tabs"
        bottomReserve={viewport.reserve}
        onModeChange={onModeChange}
        pinned={state.pinned}
        minimized={state.minimized}
        pos={state.pos}
        onFocus={actions.focus}
        onCloseTable={actions.close}
        onCloseAll={actions.closeAll}
        onTogglePin={() => fieldWindows.setPinned(!state.pinned)}
        onHelp={() => startTour({ mode: 'tabs', id: '' })}
        onMinimizedChange={actions.setMinimized}
        onMove={actions.move}
        onMoveEnd={fieldWindows.commitPos}
      />
    )
  }

  return (
    <>
      {content &&
        createPortal(
          <div
            data-testid="field-window-layer"
            className="pointer-events-none fixed inset-0 z-40 isolate"
          >
            {content}
          </div>,
          document.body,
        )}
      <SpotlightTour
        open={tourOpen && tourAlive}
        step={tour.state.step}
        steps={steps}
        labels={labels}
        onNext={onTourNext}
        onBack={tour.back}
        onEnd={tour.end}
      />
    </>
  )
}
