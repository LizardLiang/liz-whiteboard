// src/components/canvas/TextEditBar.tsx
// The text styling bar shown while a label is being edited.
//
// `SelectionToolbar` hides itself while `editingElementId` is set, so a
// per-range pick needs its own control. It reads the same selection the
// caret draws: a selected range gets the pick, a collapsed caret stores it as
// the pending style for the next characters.
//
// Sits above the element box, like `SelectionToolbar`, so it never covers the
// label text or the IME candidate window (which opens below the caret). Every
// press is `preventDefault`ed on mousedown: moving focus off the text proxy
// would commit the edit and drop the selection the pick is meant for.

import { Bold, Italic, ListTodo, Strikethrough, Underline } from 'lucide-react'
import { STYLE_TOOLBAR_OFFSET } from './SelectionToolbar'
import type { ComponentType } from 'react'
import type { Camera } from '@/lib/canvas-engine/camera'
import type { CanvasElement, Scene } from '@/lib/canvas-engine/scene'
import type { TextRunAttrs } from '@/lib/canvas-engine/text-runs'
import type { TextEditStyleChange, TextToggleKey } from './use-canvas-input'
import { worldToScreen } from '@/lib/canvas-engine/camera'
import { resolveRuns } from '@/lib/canvas-engine/text-runs'
import { isChecklistRange } from '@/lib/canvas-engine/text-todo'
import {
  CANVAS_FONT_SIZES,
  CANVAS_TEXT_COLORS,
  DEFAULT_TEXT_COLOR,
} from '@/lib/canvas-style-palette'

/** What the bar shows as active; `null` means the selected characters disagree. */
export interface TextEditBarState {
  fontWeight: boolean | null
  fontStyle: boolean | null
  underline: boolean | null
  strikethrough: boolean | null
  fontSize: number | null
  color: string | null
}

function sharedValue<T>(values: Array<T>): T | null {
  return values.length > 0 && values.every((value) => value === values[0])
    ? values[0]
    : null
}

/**
 * The active state for the edit bar: over the selected characters, or at the
 * caret (the character before it, overridden by any pending style).
 */
export function textEditBarState(
  element: CanvasElement,
  selection: { anchor: number; caret: number },
  pending: TextRunAttrs | null | undefined,
): TextEditBarState {
  const text = element.text ?? ''
  const style = element.style
  const start = Math.min(selection.anchor, selection.caret)
  const end = Math.max(selection.anchor, selection.caret)
  const segments = resolveRuns(text, style)
  const covered =
    start === end
      ? segments.filter(
          (segment) =>
            segment.start < Math.max(start, 1) &&
            Math.max(start, 1) <= segment.end,
        )
      : segments.filter((segment) => segment.end > start && segment.start < end)
  const sources: Array<{
    fontWeight: string
    fontStyle: string
    underline: boolean
    strikethrough: boolean
    fontSize: number
    color: string
  }> = (covered.length > 0 ? covered : [style]).map((source) =>
    start === end ? { ...source, ...pending } : source,
  )
  return {
    fontWeight: sharedValue(sources.map((s) => s.fontWeight === 'bold')),
    fontStyle: sharedValue(sources.map((s) => s.fontStyle === 'italic')),
    underline: sharedValue(sources.map((s) => s.underline)),
    strikethrough: sharedValue(sources.map((s) => s.strikethrough)),
    fontSize: sharedValue(sources.map((s) => s.fontSize)),
    color: sharedValue(sources.map((s) => s.color)),
  }
}

interface TextEditBarProps {
  scene: Scene
  /** The edit session, or null when nothing is being edited. */
  editing: {
    elementId: string
    anchor: number
    caret: number
    pending?: TextRunAttrs | null
  } | null
  camera: Camera
  readOnly: boolean
  onPick: (change: TextEditStyleChange) => void
  /** Turn the lines under the caret or selection into todo lines, or back. */
  onChecklist: () => void
}

const TOGGLES: ReadonlyArray<{
  key: TextToggleKey
  label: string
  hint: string
  Icon: ComponentType<{ className?: string }>
}> = [
  { key: 'fontWeight', label: 'Bold', hint: 'Ctrl+B', Icon: Bold },
  { key: 'fontStyle', label: 'Italic', hint: 'Ctrl+I', Icon: Italic },
  { key: 'underline', label: 'Underline', hint: 'Ctrl+U', Icon: Underline },
  {
    key: 'strikethrough',
    label: 'Strikethrough',
    hint: 'Ctrl+Shift+X',
    Icon: Strikethrough,
  },
]

const ACTIVE_RING =
  'border-transparent ring-2 ring-ring ring-offset-1 ring-offset-background'

export function TextEditBar({
  scene,
  editing,
  camera,
  readOnly,
  onPick,
  onChecklist,
}: TextEditBarProps) {
  if (readOnly || !editing) return null
  const element = scene.byId.get(editing.elementId)
  if (!element) return null
  const state = textEditBarState(element, editing, editing.pending)
  const checklistOn = isChecklistRange(
    element.text ?? '',
    Math.min(editing.anchor, editing.caret),
    Math.max(editing.anchor, editing.caret),
  )
  const anchor = worldToScreen(camera, {
    x: element.x + element.width / 2,
    y: element.y,
  })

  return (
    <div
      className="absolute z-10 flex items-center gap-1.5 rounded-md border bg-background/90 p-1 shadow-sm backdrop-blur-sm"
      style={{
        left: anchor.x,
        top: anchor.y - STYLE_TOOLBAR_OFFSET,
        transform: 'translate(-50%, -100%)',
      }}
      role="toolbar"
      aria-label="Text styling"
      onMouseDown={(event) => event.preventDefault()}
    >
      {TOGGLES.map(({ key, label, hint, Icon }) => (
        <button
          key={key}
          type="button"
          className={`flex h-7 w-8 items-center justify-center rounded border transition-shadow ${
            state[key] === true ? ACTIVE_RING : 'border-border/60'
          }`}
          aria-label={label}
          aria-pressed={state[key] === true}
          title={`${label} (${hint})`}
          onClick={() => onPick({ kind: 'toggle', key })}
        >
          <Icon className="size-4" />
        </button>
      ))}
      <button
        type="button"
        className={`flex h-7 w-8 items-center justify-center rounded border transition-shadow ${
          checklistOn ? ACTIVE_RING : 'border-border/60'
        }`}
        aria-label="Checklist"
        aria-pressed={checklistOn}
        title="Checklist (type [] at a line start)"
        onClick={onChecklist}
      >
        <ListTodo className="size-4" />
      </button>
      <span className="h-5 w-px bg-border" aria-hidden />
      {CANVAS_FONT_SIZES.map(({ size, label }) => (
        <button
          key={size}
          type="button"
          className={`flex h-7 w-8 items-center justify-center rounded border text-xs font-medium transition-shadow ${
            state.fontSize === size ? ACTIVE_RING : 'border-border/60'
          }`}
          aria-label={`Text size ${label}`}
          aria-pressed={state.fontSize === size}
          title={`${label} (${size}px)`}
          onClick={() => onPick({ kind: 'set', key: 'fontSize', value: size })}
        >
          {label}
        </button>
      ))}
      <span className="h-5 w-px bg-border" aria-hidden />
      {CANVAS_TEXT_COLORS.map(({ label, value }) => {
        const active = state.color === value
        const isDefault = value === DEFAULT_TEXT_COLOR
        return (
          <button
            key={label}
            type="button"
            className={`flex size-5 items-center justify-center rounded-full border-2 text-[10px] font-semibold transition-shadow ${
              active
                ? 'ring-2 ring-ring ring-offset-1 ring-offset-background'
                : ''
            } ${isDefault ? 'border-border bg-background' : ''}`}
            style={
              isDefault
                ? undefined
                : { backgroundColor: value, borderColor: value }
            }
            aria-label={`Text color ${label}`}
            aria-pressed={active}
            title={label}
            onClick={() => onPick({ kind: 'set', key: 'color', value })}
          >
            {isDefault ? 'A' : null}
          </button>
        )
      })}
    </div>
  )
}
