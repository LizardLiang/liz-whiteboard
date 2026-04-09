// @vitest-environment jsdom
// src/components/whiteboard/ConnectionStatusIndicator.test.tsx
// TS-09: ConnectionStatusIndicator unit tests

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConnectionStatusIndicator } from './ConnectionStatusIndicator'

describe('ConnectionStatusIndicator', () => {
  it('TC-09-01: renders nothing when connectionState is "connected"', () => {
    const { container } = render(
      <ConnectionStatusIndicator connectionState="connected" />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('TC-09-02: shows amber indicator and "Reconnecting" text when state is "connecting"', () => {
    render(<ConnectionStatusIndicator connectionState="connecting" />)
    const banner = screen.getByRole('status')
    expect(banner).toBeTruthy()
    expect(banner.textContent).toContain('Reconnecting')
  })

  it('TC-09-03: shows red indicator and "Disconnected" text when state is "disconnected"', () => {
    render(<ConnectionStatusIndicator connectionState="disconnected" />)
    const banner = screen.getByRole('status')
    expect(banner).toBeTruthy()
    expect(banner.textContent).toContain('Disconnected')
  })

  it('TC-09-04: banner disappears when state transitions to "connected"', () => {
    const { rerender, container } = render(
      <ConnectionStatusIndicator connectionState="disconnected" />,
    )
    expect(screen.getByRole('status')).toBeTruthy()

    rerender(<ConnectionStatusIndicator connectionState="connected" />)
    expect(container.firstChild).toBeNull()
  })

  it('TC-09-05: component is positioned absolutely (for canvas overlay)', () => {
    render(<ConnectionStatusIndicator connectionState="disconnected" />)
    const banner = screen.getByRole('status')
    expect(banner.style.position).toBe('absolute')
  })
})
