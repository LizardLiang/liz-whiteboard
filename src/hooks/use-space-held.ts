// src/hooks/use-space-held.ts
// Tracks whether the spacebar is held, for the "space + drag pans the camera"
// modifier both boards share (the Canvas 2D board and the React Flow ER board).
//
// Why this listens on `window` rather than on the board element: a keydown
// handler bound to the board only fires while the board itself holds DOM
// focus. Clicking a toolbar button, closing a dialog or dismissing the search
// panel moves focus off the board, and from then on space did nothing until
// the user clicked the canvas again. The modifier is supposed to be
// unconditional, so the listener has to be too.
//
// Listening globally then needs a rule for "is this space press mine". The
// rule is EXCLUSION, not containment: while a board is on screen the modifier
// belongs to the board unless something else has a stronger claim to the key.
// Two things do:
//
//  1. A text field or a contenteditable. Space is a character there, never a
//     modifier. This covers the search panel, rename inputs and the Canvas 2D
//     board's own off-screen text proxy.
//  2. A modal dialog. Its buttons keep native space-activates-focused-button,
//     and the board behind it is not being dragged anyway.
//
// Containment in `rootRef` is deliberately NOT the test. The obvious version
// of this hook armed only while focus sat inside the board element, and that
// reintroduced the very bug it exists to fix on the ER board, whose Toolbar
// renders OUTSIDE `.react-flow-wrapper` — clicking a tool button put focus in
// a sibling subtree and space went dead again. `rootRef` is read only to
// confirm the board is mounted.
//
// Once a press does count, `preventDefault()` runs. That is what stops the
// page scrolling under the board, and it also means space does NOT activate a
// focused button outside a dialog — the same trade every canvas tool makes
// (Figma, Excalidraw, Miro): on a drawing surface space is the pan modifier,
// and Enter is what activates a focused control.

import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

/** Contexts whose own claim on space beats the board's — see the module comment. */
const SPACE_OWNER_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[aria-modal="true"]',
].join(', ')

function isSpaceKey(event: KeyboardEvent): boolean {
  // `code` is the physical key and is what React Flow's own
  // `panActivationKeyCode` matches on; `key` is the fallback for layouts and
  // synthetic events that report only the character.
  return event.code === 'Space' || event.key === ' '
}

function eventTarget(event: KeyboardEvent): Element | null {
  // `composedPath()[0]` rather than `target` so a press originating inside a
  // shadow root resolves to the real element, matching how React Flow reads
  // its own key events. Returns null for a press dispatched straight at the
  // window or the document, neither of which is an Element.
  const [first] = event.composedPath()
  const candidate = first instanceof Element ? first : event.target
  return candidate instanceof Element ? candidate : null
}

/**
 * True while the spacebar is held and nothing with a stronger claim to the key
 * has focus.
 *
 * @param rootRef  The board's own element. Read only to confirm the board is
 *                 mounted — the modifier is deliberately NOT scoped to focus
 *                 inside it (see the module comment).
 * @param disabled Suppresses new presses while the board is in a mode that
 *                 owns the key itself — text editing on the Canvas 2D board,
 *                 whose caret lives in an off-screen proxy that the focus
 *                 check alone cannot always distinguish. A key already held
 *                 when this flips true is released, never left stuck.
 */
export function useSpaceHeld(
  rootRef: RefObject<HTMLElement | null>,
  disabled = false,
): boolean {
  const [held, setHeld] = useState(false)
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled

  useEffect(() => {
    if (disabled) setHeld(false)
  }, [disabled])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSpaceKey(event) || disabledRef.current) return

      // No board mounted yet — nothing to pan.
      if (!rootRef.current) return

      // Checked on the event target AND on `document.activeElement`: a key
      // event is delivered to the focused element, but a listener bound to
      // `window` also sees presses whose target is `document.body` while a
      // dialog is open and focus sits inside it.
      const target = eventTarget(event)
      if (target?.closest(SPACE_OWNER_SELECTOR)) return
      const focused = document.activeElement
      if (focused?.closest(SPACE_OWNER_SELECTOR)) return

      event.preventDefault()
      // `event.repeat` still lands here. Setting the same `true` again is a
      // no-op for React, and returning early instead would be wrong: the
      // first press can be the one that arrives while `disabled` was set.
      setHeld(true)
    }

    // Keyup is unguarded on purpose. Whatever the state of `disabled`, focus
    // or the event target, releasing the key must always release the
    // modifier — anything else leaves the board stuck in pan mode.
    const onKeyUp = (event: KeyboardEvent) => {
      if (isSpaceKey(event)) setHeld(false)
    }

    // A key released while the window is in the background delivers no keyup
    // at all: alt-tabbing away mid-press would otherwise pin the board in pan
    // mode until the user pressed and released space again.
    const onBlur = () => setHeld(false)

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [rootRef])

  return held
}
