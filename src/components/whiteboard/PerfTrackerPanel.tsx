// src/components/whiteboard/PerfTrackerPanel.tsx
// In-app performance tracker HUD (GH #121 follow-up) — replaces DevFpsOverlay.
// Keeps the old overlay's live FPS/frame-time readout (same rAF loop, same
// `fpsColor` coding, same top-right placement) and adds a Record/Stop control
// that drives perf-tracker.ts's session recording -> downloadable JSON report.
//
// This component owns the ONLY rAF loop that feeds the tracker's frame buffer
// (via `perfTracker.pushFrame`). That loop lives here, in React-land, NOT on
// the canvas gesture hot path — so measuring the canvas never re-renders the
// canvas. The panel throttles its own setState (FPS/counters refresh a few
// times a second) so the HUD itself stays cheap.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useReactFlow } from '@xyflow/react'
import type { Gesture, PerfSnapshot } from '@/lib/perf/perf-tracker'
import { perfTracker } from '@/lib/perf/perf-tracker'

// Rolling window (ms) for the frames-per-second reading — how many rAF
// callbacks landed in the last second.
const SAMPLE_WINDOW_MS = 1000
// Throttle the HUD's own React updates so rendering the panel never competes
// with the gesture it's measuring. ~4 Hz is plenty for a human-readable HUD.
const HUD_REFRESH_MS = 250

/**
 * Color-code the FPS reading so a stutter is visible at a glance: red below
 * 30fps, amber below 50fps, green otherwise. (Carried over verbatim from
 * DevFpsOverlay.)
 */
function fpsColor(fps: number): string {
  if (fps < 30) return '#ef4444'
  if (fps < 50) return '#eab308'
  return '#22c55e'
}

const SERVER_SNAPSHOT: PerfSnapshot = {
  isRecording: false,
  currentGesture: 'idle',
  renders: 0,
  setNodesCalls: 0,
  hideEdges: false,
}

export function PerfTrackerPanel() {
  const [fps, setFps] = useState(0)
  const [frameTimeMs, setFrameTimeMs] = useState(0)
  const [gesture, setGesture] = useState<Gesture>('idle')
  const [liveCounters, setLiveCounters] = useState({
    renders: 0,
    setNodesCalls: 0,
  })
  const frameTimestampsRef = useRef<Array<number>>([])
  // Live viewport zoom — passed to startRecording so noteMove's first-move
  // pan/zoom disambiguation has a real baseline (avoids first-move mis-tag).
  const { getZoom } = useReactFlow()

  // isRecording flips rarely (start/stop) — cheap to source from the store.
  const isRecording = useSyncExternalStore(
    perfTracker.subscribe,
    () => perfTracker.getSnapshot().isRecording,
    () => SERVER_SNAPSHOT.isRecording,
  )

  // Edge-ablation toggle (GH #142) — flips only on click, so sourcing it from
  // the same store is cheap and keeps the button in sync with the canvas.
  const hideEdges = useSyncExternalStore(
    perfTracker.subscribe,
    () => perfTracker.getSnapshot().hideEdges,
    () => SERVER_SNAPSHOT.hideEdges,
  )

  useEffect(() => {
    let rafId: number
    let lastTime = performance.now()
    let lastHudPush = 0

    const tick = (time: number) => {
      const dt = time - lastTime
      lastTime = time

      // Feed the tracker's frame buffer (no-op unless recording).
      perfTracker.pushFrame(time, dt)

      const samples = frameTimestampsRef.current
      samples.push(time)
      const cutoff = time - SAMPLE_WINDOW_MS
      while (samples.length > 0 && samples[0] < cutoff) samples.shift()

      // Throttle React state updates so the HUD refresh doesn't perturb the
      // measured gesture.
      if (time - lastHudPush >= HUD_REFRESH_MS) {
        lastHudPush = time
        setFps(samples.length)
        setFrameTimeMs(dt)
        const live = perfTracker.getLive()
        setGesture(live.currentGesture)
        setLiveCounters({
          renders: live.renders,
          setNodesCalls: live.setNodesCalls,
        })
      }

      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafId)
      frameTimestampsRef.current = []
    }
  }, [])

  const handleToggleRecord = () => {
    if (perfTracker.isRecording) {
      const report = perfTracker.stopRecording()
      perfTracker.downloadReport(report)
      return
    }
    const tableCount =
      typeof document !== 'undefined'
        ? document.querySelectorAll('.react-flow__node').length
        : 0
    perfTracker.startRecording({ tableCount, zoom: getZoom() })
  }

  return (
    // The container itself must never eat canvas gestures (pointer-events-none);
    // individual controls re-enable pointer events below.
    <div
      data-testid="perf-tracker-panel"
      className="pointer-events-none absolute top-2 right-2 z-[10000] flex flex-col items-end gap-1 font-mono text-[11px]"
    >
      <button
        type="button"
        data-testid="perf-tracker-record"
        onClick={handleToggleRecord}
        aria-label={isRecording ? 'Stop recording' : 'Start recording'}
        className={`nodrag nowheel pointer-events-auto flex cursor-pointer items-center gap-1 rounded border border-[var(--rf-table-border,#404040)] bg-[var(--rf-table-header-bg,#1a1a1a)] px-1.5 py-0.5 font-semibold ${
          isRecording
            ? 'text-[#ef4444]'
            : 'text-[var(--rf-table-header-text,#9ca3af)]'
        }`}
      >
        <span aria-hidden className="text-[#ef4444]">
          {isRecording ? '■' : '●'}
        </span>
        {isRecording ? 'Stop' : 'Record'}
      </button>

      {/* Edge-ablation toggle (GH #142): drop the SVG edge layer so a
          record-with-edges vs record-without-edges pair attributes pan/zoom
          cost to the edges. Only the main canvas honors it (its
          `enableEdgeAblation` prop); the focus overlay ignores it. */}
      <button
        type="button"
        data-testid="perf-tracker-hide-edges"
        aria-pressed={hideEdges}
        onClick={() => perfTracker.setHideEdges(!hideEdges)}
        className={`nodrag nowheel pointer-events-auto flex cursor-pointer items-center gap-1 rounded border border-[var(--rf-table-border,#404040)] bg-[var(--rf-table-header-bg,#1a1a1a)] px-1.5 py-0.5 font-semibold ${
          hideEdges
            ? 'text-[#eab308]'
            : 'text-[var(--rf-table-header-text,#9ca3af)]'
        }`}
      >
        {hideEdges ? 'Edges: off' : 'Edges: on'}
      </button>

      <div className="nodrag nowheel pointer-events-auto min-w-32 rounded border border-[var(--rf-table-border,#404040)] bg-[var(--rf-table-header-bg,#1a1a1a)] px-2 py-1 text-right">
        <div className="font-semibold" style={{ color: fpsColor(fps) }}>
          {fps} fps
        </div>
        <div className="text-[var(--rf-table-header-text,#9ca3af)] opacity-70">
          {frameTimeMs.toFixed(1)} ms
        </div>
        {isRecording && (
          <div
            data-testid="perf-tracker-live"
            className="mt-1 border-t border-[var(--rf-table-border,#404040)] pt-1 text-[var(--rf-table-header-text,#9ca3af)] opacity-[0.85]"
          >
            <div>gesture: {gesture}</div>
            <div>renders: {liveCounters.renders}</div>
            <div>setNodes: {liveCounters.setNodesCalls}</div>
          </div>
        )}
      </div>
    </div>
  )
}
