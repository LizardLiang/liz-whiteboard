/**
 * useAutofillSync — reconcile controlled input state with browser autofill
 *
 * Browsers and password managers write an input's DOM `value` directly. They do
 * not always emit an event React observes, and the fill frequently lands BEFORE
 * hydration, when no React listener exists yet. A controlled input therefore
 * shows credentials on screen while its `useState` value is still `''` — which
 * previously left the login/register submit button disabled forever, with the
 * Enter key dead too (HTML blocks implicit submission when the default submit
 * button is disabled).
 *
 * Three sync points cover the possible timings:
 *
 *  - L0 render-phase read: `readAutofilledValue` seeds `useState` from the DOM
 *    node the server rendered, so state is correct on the very first render —
 *    no frame where the form looks filled but validates as empty.
 *  - L1 mount effect: re-reads each ref after the first commit. Covers a fill
 *    that lands between the render phase and that commit.
 *  - L2 animation event: `styles.css` attaches a no-op `autofill-start`
 *    keyframe to `input:-webkit-autofill`. Chromium fires `animationstart` the
 *    moment it applies an autofill, so a fill that lands after hydration syncs
 *    too. Spread the returned handler onto every participating input.
 *
 * Measured, not assumed (probe against the dev server): a value written into
 * the SSR markup before hydration SURVIVES hydration — React does not reset a
 * controlled input it is hydrating. So L0 and L1 both recover a pre-hydration
 * fill; L0 is kept because it is the earlier and cheaper of the two.
 *
 * Neither path is a correctness backstop on its own — submit handlers still read
 * the form's own values (see login.tsx / register.tsx). This hook exists so the
 * VISIBLE state (button enablement, live validation) matches what the user sees
 * in the fields.
 */

import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/** The keyframe name declared in styles.css for `input:-webkit-autofill`. */
export const AUTOFILL_ANIMATION_NAME = 'autofill-start'

/**
 * Reads the value a browser already wrote into a server-rendered input.
 *
 * Call this ONLY from a `useState` initializer — `useState(() =>
 * readAutofilledValue('email'))`. It reads the live DOM during the render
 * phase, which is meaningless anywhere else.
 *
 * Returns `fallback` on the server, where there is no document.
 *
 * React deliberately does not warn about a hydration mismatch on an input's
 * `value` — autofill is exactly why — so seeding state this way is safe.
 *
 * @param elementId `id` of the input as rendered by the server.
 * @param fallback Value to use when there is no DOM node or it is empty.
 */
export function readAutofilledValue(elementId: string, fallback = ''): string {
  if (typeof document === 'undefined') return fallback
  const element = document.getElementById(elementId)
  if (!(element instanceof HTMLInputElement)) return fallback
  return element.value || fallback
}

export interface AutofillField {
  /** Ref attached to the controlled input element. */
  ref: RefObject<HTMLInputElement | null>
  /** Current controlled value, so an unchanged DOM value is not re-set. */
  value: string
  /** State setter invoked when the DOM value differs. */
  setValue: (value: string) => void
}

export interface UseAutofillSyncResult {
  /** Spread onto each participating input to catch post-hydration autofill. */
  onAnimationStart: (event: React.AnimationEvent<HTMLInputElement>) => void
  /** Imperative re-sync, exposed for tests and manual recovery paths. */
  sync: () => void
}

/**
 * Keeps controlled state in step with values the browser wrote directly.
 *
 * @param fields Record of field name to its ref, current value, and setter.
 */
export function useAutofillSync(
  fields: Record<string, AutofillField>,
): UseAutofillSyncResult {
  // Fields are re-created every render (new refs object, fresh closures). Hold
  // them in a ref so `sync` stays stable and always reads the latest setters.
  const fieldsRef = useRef(fields)
  fieldsRef.current = fields

  const sync = useCallback(() => {
    for (const field of Object.values(fieldsRef.current)) {
      const domValue = field.ref.current?.value ?? ''
      // Only adopt a non-empty DOM value. An empty one is either the genuine
      // initial state or React having already written state back to the DOM;
      // adopting it would clobber a real value the user typed.
      if (domValue !== '' && domValue !== field.value) {
        field.setValue(domValue)
      }
    }
  }, [])

  // L1: pre-hydration autofill. Runs once after the first commit, when refs are
  // attached and the DOM values the browser wrote are readable.
  useEffect(() => {
    sync()
  }, [sync])

  const onAnimationStart = useCallback(
    (event: React.AnimationEvent<HTMLInputElement>) => {
      // L2: Chromium fires this for the no-op keyframe bound to
      // `input:-webkit-autofill`. Ignore every other animation on the input.
      if (event.animationName !== AUTOFILL_ANIMATION_NAME) return
      sync()
    },
    [sync],
  )

  return { onAnimationStart, sync }
}
