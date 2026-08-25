// src/components/canvas/TextInputProxy.tsx
// The off-screen text input for the canvas engine (tactical plan Wave 3,
// step 11).
//
// This is NOT a retreat from pure-canvas rendering. The browser fires
// `compositionstart` / `compositionupdate` / `compositionend` only at a
// FOCUSED form element, so without one, Chinese, Japanese and Korean input
// is impossible on a canvas — not degraded, impossible. Google Docs,
// Excalidraw and tldraw all do exactly this. The element is visually hidden
// and never renders board content: every pixel the user sees still comes from
// the canvas.
//
// It is positioned at the caret rather than parked in a corner, because the
// IME candidate window anchors to the focused element. A candidate list in
// the page's top-left while the text is in the middle of the board is
// unusable.

import { useEffect, useRef } from 'react'
import type { CompositionEvent, KeyboardEvent } from 'react'
import type { Point } from '@/lib/canvas-engine/camera'

interface TextInputProxyProps {
  /** True while a canvas element is being typed into. */
  active: boolean
  /** Caret position in canvas-relative CSS pixels, or null. */
  caretScreenPoint: Point | null
  /** Commit typed or composed text at the caret. */
  onInsertText: (text: string) => void
  /** Report the in-flight composition string (empty string clears it). */
  onCompositionChange: (composition: string) => void
  /** Returns true when the key was consumed and should be prevented. */
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean
  /** Focus left the proxy — the edit is finished. */
  onBlur: () => void
}

export function TextInputProxy({
  active,
  caretScreenPoint,
  onInsertText,
  onCompositionChange,
  onKeyDown,
  onBlur,
}: TextInputProxyProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const composingRef = useRef(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (active) element.focus({ preventScroll: true })
    else if (document.activeElement === element) element.blur()
  }, [active])

  const handleCompositionStart = (
    event: CompositionEvent<HTMLTextAreaElement>,
  ) => {
    composingRef.current = true
    onCompositionChange(event.data)
  }

  const handleCompositionUpdate = (
    event: CompositionEvent<HTMLTextAreaElement>,
  ) => {
    onCompositionChange(event.data)
  }

  const handleCompositionEnd = (
    event: CompositionEvent<HTMLTextAreaElement>,
  ) => {
    composingRef.current = false
    onCompositionChange('')
    onInsertText(event.data)
    // Emptying the field here is what stops the composed text arriving a
    // second time: Chrome fires `input` AFTER `compositionend`, and that
    // event would otherwise carry the same characters we just committed.
    if (ref.current) ref.current.value = ''
  }

  const handleChange = () => {
    const element = ref.current
    if (!element) return
    // Firefox fires `input` BEFORE `compositionend`, so the composing flag
    // (not event ordering) is what keeps composition text out of the
    // committed string.
    if (composingRef.current) return
    const value = element.value
    element.value = ''
    if (value.length > 0) onInsertText(value)
  }

  const handleBlur = () => {
    // Clear the composing flag on the way out.
    //
    // `handleChange` returns early while this is set, so a browser that blurs
    // without firing `compositionend` would leave it stuck true and silently
    // drop EVERY subsequent keystroke for the rest of the session. Chrome and
    // Firefox do fire it reliably, so the trigger is speculative — but the
    // failure it guards is total and silent, and the guard is one assignment.
    composingRef.current = false
    onBlur()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // While the IME owns the keystroke, the board must not interpret it:
    // Enter and Escape are how a candidate is accepted and cancelled.
    if (composingRef.current || event.nativeEvent.isComposing) return
    if (onKeyDown(event)) event.preventDefault()
  }

  return (
    <textarea
      ref={ref}
      // Not `hidden`, not `display: none`, not `sr-only`: all three make the
      // element unfocusable or clip it out of the layout, and an unfocused
      // element receives no composition events at all.
      className="absolute h-px w-px resize-none overflow-hidden border-0 bg-transparent p-0 text-transparent opacity-0 outline-none"
      style={{
        left: caretScreenPoint?.x ?? 0,
        top: caretScreenPoint?.y ?? 0,
        // The real caret is drawn on the canvas; a second one blinking inside
        // an invisible textarea would be a second caret in a different place.
        caretColor: 'transparent',
        pointerEvents: 'none',
      }}
      aria-label="Canvas text input"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      tabIndex={active ? 0 : -1}
      defaultValue=""
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onCompositionStart={handleCompositionStart}
      onCompositionUpdate={handleCompositionUpdate}
      onCompositionEnd={handleCompositionEnd}
      onBlur={handleBlur}
    />
  )
}
