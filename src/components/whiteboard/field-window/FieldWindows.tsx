// src/components/whiteboard/field-window/FieldWindows.tsx
// Renders the field window set through one portal layer on <body>. The layer
// is a fixed, click-through, isolated z-40 stacking context, so the windows
// raise above each other with small z values yet stay below dialogs and
// popovers (z-50) and above the minimap.

import { createPortal } from 'react-dom'
import { FieldWindow } from './FieldWindow'
import type { FieldWindowItem } from './FieldWindow'
import type { FieldWindowMode, FieldWindowPos } from './use-field-window-prefs'
import type { useFieldWindows } from './use-field-windows'

const CASCADE_STEP_PX = 24
const DEFAULT_RIGHT_PX = 12
const DEFAULT_TOP_PX = 76
/** Rows below this stay reachable when the cascade wraps. */
const MIN_WINDOW_HEIGHT_PX = 160

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
): FieldWindowPos {
  const width = Math.min(768, viewportWidth - 24)
  const start = origin ?? {
    x: viewportWidth - DEFAULT_RIGHT_PX - width,
    y: DEFAULT_TOP_PX,
  }
  const dir = origin ? 1 : -1
  const steps = Math.max(
    1,
    Math.floor(
      (viewportHeight - start.y - MIN_WINDOW_HEIGHT_PX) / CASCADE_STEP_PX,
    ) + 1,
  )
  const i = slot % steps
  const maxX = Math.max(0, viewportWidth - width)
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
}

export function FieldWindows({ fieldWindows, items }: FieldWindowsProps) {
  const { state, actions } = fieldWindows
  if (typeof document === 'undefined' || items.length === 0) return null

  const onModeChange = (mode: FieldWindowMode) => fieldWindows.switchMode(mode)

  let content
  if (state.mode === 'windows') {
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
            window.innerWidth,
            window.innerHeight,
          )}
          onRaise={() => actions.focus(item.id)}
          onFocus={actions.focus}
          onCloseTable={actions.close}
          onCloseAll={() => actions.close(item.id)}
          onTogglePin={() =>
            fieldWindows.setWindowPinned(item.id, !entry.pinned)
          }
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
        onModeChange={onModeChange}
        pinned={state.pinned}
        minimized={state.minimized}
        pos={state.pos}
        onFocus={actions.focus}
        onCloseTable={actions.close}
        onCloseAll={actions.closeAll}
        onTogglePin={() => fieldWindows.setPinned(!state.pinned)}
        onMinimizedChange={actions.setMinimized}
        onMove={actions.move}
        onMoveEnd={fieldWindows.commitPos}
      />
    )
  }

  return createPortal(
    <div
      data-testid="field-window-layer"
      className="pointer-events-none fixed inset-0 z-40 isolate"
    >
      {content}
    </div>,
    document.body,
  )
}
