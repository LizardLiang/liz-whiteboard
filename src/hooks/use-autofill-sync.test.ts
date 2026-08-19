// @vitest-environment jsdom
// src/hooks/use-autofill-sync.test.ts
// Autofill-sync tests: a browser-written DOM value must reach controlled state
// via the mount effect (pre-hydration fill) and via the `autofill-start`
// animation event (post-hydration fill), without clobbering real user input.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  AUTOFILL_ANIMATION_NAME,
  readAutofilledValue,
  useAutofillSync,
} from './use-autofill-sync'
import type { AutofillField } from './use-autofill-sync'

/** Builds a field backed by a real input element carrying `domValue`. */
function makeField(domValue: string, stateValue = ''): AutofillField {
  const input = document.createElement('input')
  input.value = domValue
  return {
    ref: { current: input },
    value: stateValue,
    setValue: vi.fn(),
  }
}

/** Minimal stand-in for React's synthetic animation event. */
function animationEvent(animationName: string) {
  return { animationName } as React.AnimationEvent<HTMLInputElement>
}

describe('readAutofilledValue — render-phase read (pre-hydration autofill)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('reads the value the browser wrote into the server-rendered input', () => {
    document.body.innerHTML = '<input id="email" />'
    ;(document.getElementById('email') as HTMLInputElement).value =
      'autofilled@example.com'

    expect(readAutofilledValue('email')).toBe('autofilled@example.com')
  })

  it('returns the fallback when the input is empty', () => {
    document.body.innerHTML = '<input id="email" />'

    expect(readAutofilledValue('email', 'seed')).toBe('seed')
  })

  it('returns the fallback when no such element exists', () => {
    expect(readAutofilledValue('missing')).toBe('')
  })

  it('returns the fallback when the element is not an input', () => {
    document.body.innerHTML = '<div id="email"></div>'

    expect(readAutofilledValue('email')).toBe('')
  })
})

describe('useAutofillSync — mount sync (pre-hydration autofill)', () => {
  it('adopts a DOM value the browser wrote before hydration', () => {
    const email = makeField('autofilled@example.com')
    const password = makeField('hunter2')

    renderHook(() => useAutofillSync({ email, password }))

    expect(email.setValue).toHaveBeenCalledWith('autofilled@example.com')
    expect(password.setValue).toHaveBeenCalledWith('hunter2')
  })

  it('leaves state alone when the DOM value is empty', () => {
    const email = makeField('')

    renderHook(() => useAutofillSync({ email }))

    expect(email.setValue).not.toHaveBeenCalled()
  })

  it('does not re-set a DOM value that already matches state', () => {
    const email = makeField('same@example.com', 'same@example.com')

    renderHook(() => useAutofillSync({ email }))

    expect(email.setValue).not.toHaveBeenCalled()
  })

  it('tolerates a ref that is not attached yet', () => {
    const detached: AutofillField = {
      ref: { current: null },
      value: '',
      setValue: vi.fn(),
    }

    expect(() => renderHook(() => useAutofillSync({ detached }))).not.toThrow()
    expect(detached.setValue).not.toHaveBeenCalled()
  })
})

describe('useAutofillSync — animation sync (post-hydration autofill)', () => {
  it('syncs when the autofill keyframe fires', () => {
    const email = makeField('')
    const { result } = renderHook(() => useAutofillSync({ email }))

    // The browser fills after hydration, then Chromium fires the keyframe.
    email.ref.current!.value = 'late-fill@example.com'
    result.current.onAnimationStart(animationEvent(AUTOFILL_ANIMATION_NAME))

    expect(email.setValue).toHaveBeenCalledWith('late-fill@example.com')
  })

  it('ignores animations that are not the autofill keyframe', () => {
    const email = makeField('')
    const { result } = renderHook(() => useAutofillSync({ email }))

    email.ref.current!.value = 'unrelated@example.com'
    result.current.onAnimationStart(animationEvent('fade-in'))

    expect(email.setValue).not.toHaveBeenCalled()
  })

  it('reads the latest setters after a re-render', () => {
    const first = makeField('')
    const { result, rerender } = renderHook(
      ({ field }) => useAutofillSync({ email: field }),
      { initialProps: { field: first } },
    )

    const second = makeField('')
    second.ref = first.ref
    rerender({ field: second })

    first.ref.current!.value = 'fresh@example.com'
    result.current.onAnimationStart(animationEvent(AUTOFILL_ANIMATION_NAME))

    expect(second.setValue).toHaveBeenCalledWith('fresh@example.com')
    expect(first.setValue).not.toHaveBeenCalled()
  })
})
