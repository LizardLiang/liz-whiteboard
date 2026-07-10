// src/components/whiteboard/DevFpsOverlay.tsx
// Dev-only FPS / frame-time HUD (GH #121 perf work) — the instrument used to
// capture before/after numbers while profiling pan/zoom/hover/drag at various
// table counts (20/30/100/200). Callers MUST gate rendering on
// `import.meta.env.DEV` (see ReactFlowWhiteboard.tsx) so this never ships in
// the production bundle. Toggleable via the on-screen button; state does not
// persist across reloads — it's a throwaway profiling tool, not a feature.
import { useEffect, useRef, useState } from 'react'

// Rolling window (ms) used to compute the frames-per-second reading — counts
// how many rAF callbacks landed in the last second.
const SAMPLE_WINDOW_MS = 1000

/**
 * Color-code the FPS reading so a stutter is visible at a glance without
 * reading the number: red below 30fps, amber below 50fps, green otherwise.
 */
function fpsColor(fps: number): string {
  if (fps < 30) return '#ef4444'
  if (fps < 50) return '#eab308'
  return '#22c55e'
}

export function DevFpsOverlay() {
  const [enabled, setEnabled] = useState(true)
  const [fps, setFps] = useState(0)
  const [frameTimeMs, setFrameTimeMs] = useState(0)
  const frameTimestampsRef = useRef<Array<number>>([])

  useEffect(() => {
    if (!enabled) return
    let rafId: number
    let lastTime = performance.now()

    const tick = (time: number) => {
      setFrameTimeMs(time - lastTime)
      lastTime = time

      const samples = frameTimestampsRef.current
      samples.push(time)
      const cutoff = time - SAMPLE_WINDOW_MS
      while (samples.length > 0 && samples[0] < cutoff) samples.shift()
      setFps(samples.length)

      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafId)
      frameTimestampsRef.current = []
    }
  }, [enabled])

  return (
    <div
      data-testid="dev-fps-overlay"
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 4,
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 11,
        pointerEvents: 'none',
      }}
    >
      <button
        type="button"
        onClick={() => setEnabled((prev) => !prev)}
        aria-label={enabled ? 'Hide FPS overlay' : 'Show FPS overlay'}
        className="nodrag nowheel"
        style={{
          pointerEvents: 'auto',
          background: 'var(--rf-table-header-bg, #1a1a1a)',
          color: 'var(--rf-table-header-text, #9ca3af)',
          border: '1px solid var(--rf-table-border, #404040)',
          borderRadius: 4,
          padding: '2px 6px',
          cursor: 'pointer',
        }}
      >
        {enabled ? 'FPS: hide' : 'FPS: show'}
      </button>
      {enabled && (
        <div
          style={{
            background: 'var(--rf-table-header-bg, #1a1a1a)',
            border: '1px solid var(--rf-table-border, #404040)',
            borderRadius: 4,
            padding: '4px 8px',
            minWidth: 96,
            textAlign: 'right',
          }}
        >
          <div style={{ color: fpsColor(fps), fontWeight: 600 }}>
            {fps} fps
          </div>
          <div style={{ color: 'var(--rf-table-header-text, #9ca3af)', opacity: 0.7 }}>
            {frameTimeMs.toFixed(1)} ms
          </div>
        </div>
      )}
    </div>
  )
}
