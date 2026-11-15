import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SpotlightTour } from './SpotlightTour'
import type { TourStep } from './use-spotlight-tour'

const labels = {
  next: 'Next',
  back: 'Back',
  skip: 'Skip',
  done: 'Done',
  stepOf: (n: number, t: number) => `${n} of ${t}`,
}

const steps: Array<TourStep> = [
  { id: 'a', target: () => null, title: 'First', body: 'one' },
  { id: 'b', target: () => null, title: 'Second', body: 'two' },
]

function setup(step = 0) {
  const handlers = { onNext: vi.fn(), onBack: vi.fn(), onEnd: vi.fn() }
  render(
    <SpotlightTour
      open
      step={step}
      steps={steps}
      labels={labels}
      {...handlers}
    />,
  )
  return handlers
}

afterEach(cleanup)

describe('SpotlightTour', () => {
  it('renders a modal dialog labelled by the title', () => {
    setup()
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const title = screen.getByRole('heading', { name: 'First' })
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id)
    expect(screen.getByText('1 of 2')).toBeTruthy()
  })

  it('hides Back on step 1 and shows Done on the last step', () => {
    setup()
    expect(screen.queryByText('Back')).toBeNull()
    cleanup()
    setup(1)
    expect(screen.getByText('Back')).toBeTruthy()
    expect(screen.getByText('Done')).toBeTruthy()
  })

  it('Esc calls preventDefault and ends the tour', () => {
    const { onEnd } = setup()
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    document.body.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('arrow keys move between steps', () => {
    const { onNext, onBack } = setup(1)
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('swallows pointer events on the mask', () => {
    setup()
    const outside = vi.fn()
    document.addEventListener('pointerdown', outside)
    fireEvent.pointerDown(screen.getByTestId('spotlight-tour'))
    document.removeEventListener('pointerdown', outside)
    expect(outside).not.toHaveBeenCalled()
  })

  it('renders nothing when closed', () => {
    render(
      <SpotlightTour
        open={false}
        step={0}
        steps={steps}
        labels={labels}
        onNext={vi.fn()}
        onBack={vi.fn()}
        onEnd={vi.fn()}
      />,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
