// src/components/whiteboard/PerfTrackerPanel.test.tsx
// The panel must mount without a React Flow provider (canvas boards have
// none) and stamp the caller's zoom and item count into the recording.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PerfTrackerPanel } from './PerfTrackerPanel'
import { perfTracker } from '@/lib/perf/perf-tracker'

afterEach(() => {
  if (perfTracker.isRecording) perfTracker.stopRecording()
})

describe('PerfTrackerPanel without React Flow', () => {
  it('renders with no provider and records using the supplied getters', () => {
    const getZoom = vi.fn(() => 1.5)
    const getItemCount = vi.fn(() => 42)
    render(<PerfTrackerPanel getZoom={getZoom} getItemCount={getItemCount} />)

    expect(screen.getByTestId('perf-tracker-panel')).toBeTruthy()
    fireEvent.click(screen.getByTestId('perf-tracker-record'))

    expect(getZoom).toHaveBeenCalledTimes(1)
    expect(getItemCount).toHaveBeenCalledTimes(1)
    expect(perfTracker.isRecording).toBe(true)
    const report = perfTracker.stopRecording()
    expect(report.meta.tableCount).toBe(42)
  })
})

describe('PerfTrackerPanel edge toggle', () => {
  it('shows the Edges toggle by default (React Flow boards)', () => {
    render(<PerfTrackerPanel getZoom={() => 1} getItemCount={() => 1} />)
    expect(screen.getByTestId('perf-tracker-hide-edges')).toBeTruthy()
  })

  it('hides the Edges toggle when the board has no edge layer (canvas)', () => {
    render(
      <PerfTrackerPanel
        getZoom={() => 1}
        getItemCount={() => 1}
        showEdgeToggle={false}
      />,
    )
    expect(screen.queryByTestId('perf-tracker-hide-edges')).toBeNull()
    expect(screen.getByTestId('perf-tracker-record')).toBeTruthy()
  })
})
