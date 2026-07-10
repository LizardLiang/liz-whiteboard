// src/lib/perf/perf-tracker.ts
// In-app performance tracker core (GH #121 follow-up). This is the *instrument*
// that captures hard, reproducible perf numbers on real hardware — replacing
// DevFpsOverlay's eyeball-only HUD. It is deliberately framework-free: a
// module-level imperative store (plain mutable state + O(1) writes), NOT a
// React Context/store. Canvas event handlers write to it synchronously on the
// gesture hot path; the PerfTrackerPanel reads it from its own rAF loop.
//
// HOT-PATH CONTRACT (critical): every write helper's FIRST line is
// `if (!isRecording) return`. When the tracker is off, each canvas call site
// collapses to a single function call + boolean test, so the canvas returns to
// its exact uninstrumented path (PT-7). No helper on the hot path calls
// `emit()` — subscriber notifications fire only on record start/stop, so a
// pan/zoom/drag frame never triggers a React re-render.
//
// Secure-context note: this file uses NEITHER `crypto.randomUUID` NOR
// `Date.now()` for the report filename — the user develops over plain-HTTP LAN
// (repo memory). Filenames derive from a `performance.now()` reading + a
// monotonic counter instead.

export type Gesture = 'pan' | 'zoom' | 'hover' | 'drag' | 'idle'

const GESTURES: ReadonlyArray<Gesture> = [
  'pan',
  'zoom',
  'hover',
  'drag',
  'idle',
]

interface FrameSample {
  t: number
  dtMs: number
  gesture: Gesture
}

interface LatencySample {
  gesture: Gesture
  durationMs: number
}

export interface GestureStats {
  frames: number
  fps: { min: number; avg: number; p95: number }
  frameMs: { avg: number; p95: number; worst: number }
  latencyMs: { avg: number; p95: number } | null
}

export interface PerfReport {
  meta: {
    tableCount: number
    domNodeCount: number
    durationMs: number
    /** `performance.now()`-based origin (NOT wall-clock) — monotonic + safe
     *  in insecure contexts. */
    startedAt: number
    userAgent: string
    viewport: { width: number; height: number }
  }
  overall: GestureStats
  perGesture: Record<Gesture, GestureStats>
  counters: { renders: number; setNodesCalls: number }
  longTasks: { count: number; totalMs: number }
}

// ---------------------------------------------------------------------------
// Module singleton state
// ---------------------------------------------------------------------------

let isRecording = false
let currentGesture: Gesture = 'idle'
// Last viewport zoom seen by noteMove — disambiguates pan (translate only)
// from zoom (scale change). NaN sentinel => first move of a session is pan.
let lastZoom = Number.NaN

const counters = { renders: 0, setNodesCalls: 0 }

let frames: Array<FrameSample> = []
let latencies: Array<LatencySample> = []
let longTaskCount = 0
let longTaskTotalMs = 0

let recordTableCount = 0
let startedAt = 0

let eventObserver: PerformanceObserver | null = null
let longTaskObserver: PerformanceObserver | null = null

// Monotonic report sequence — combined with a performance.now() reading for a
// collision-resistant filename without touching Date.now()/randomUUID.
let reportSeq = 0

// ---------------------------------------------------------------------------
// useSyncExternalStore plumbing (start/stop transitions only — never the hot
// path). getSnapshot MUST return a stable reference between emits, so we cache
// the snapshot object and only rebuild it in emit().
// ---------------------------------------------------------------------------

export interface PerfSnapshot {
  isRecording: boolean
  currentGesture: Gesture
  renders: number
  setNodesCalls: number
  /**
   * Edge-ablation toggle (GH #142). When true, the main canvas renders NO
   * relationship edges — a lever for attributing pan/zoom cost to the SVG
   * edge layer (record edges-on vs edges-off and compare). NOT a hot-path
   * flag: it flips only on an explicit user click, so `setHideEdges` may
   * `emit()` (unlike the gesture/counter writers). Independent of recording.
   */
  hideEdges: boolean
}

// Edge-ablation flag (GH #142). Read by ReactFlowCanvas (main instance only,
// gated by its `enableEdgeAblation` prop) and the PerfTrackerPanel toggle.
let hideEdges = false

let snapshot: PerfSnapshot = {
  isRecording: false,
  currentGesture: 'idle',
  renders: 0,
  setNodesCalls: 0,
  hideEdges: false,
}

const listeners = new Set<() => void>()

function emit(): void {
  snapshot = {
    isRecording,
    currentGesture,
    renders: counters.renders,
    setNodesCalls: counters.setNodesCalls,
    hideEdges,
  }
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function getSnapshot(): PerfSnapshot {
  return snapshot
}

/**
 * Fresh, uncached live readout for the panel's throttled rAF loop. Unlike
 * `getSnapshot`, this allocates a new object every call and MUST NOT be used
 * with `useSyncExternalStore` (which would loop). It lets the panel show live
 * counters/gesture without an emit on the canvas hot path.
 */
function getLive(): PerfSnapshot {
  return {
    isRecording,
    currentGesture,
    renders: counters.renders,
    setNodesCalls: counters.setNodesCalls,
    hideEdges,
  }
}

/**
 * Flip the edge-ablation toggle (GH #142). Explicit user action, NOT the
 * gesture hot path — so it emits to re-render the HUD toggle and the canvas
 * (which drops/restores the edge layer). No `isRecording` guard: ablation is
 * independent of recording.
 */
function setHideEdges(value: boolean): void {
  if (hideEdges === value) return
  hideEdges = value
  emit()
}

// ---------------------------------------------------------------------------
// Hot-path write helpers — first line is always the `isRecording` guard.
// ---------------------------------------------------------------------------

function setGesture(g: Gesture): void {
  if (!isRecording) return
  currentGesture = g
}

/**
 * Reset to `idle`.
 *
 * - With `expected` passed (the drag/hover callers): only clears if the current
 *   gesture still matches it — so e.g. a hover-leave that arrives after a drag
 *   has started cannot wipe the 'drag' tag.
 * - With no arg (the `onMoveEnd` caller): only clears a viewport gesture
 *   ('pan'/'zoom'). React Flow's `autoPanOnNodeDrag` fires onMove/onMoveEnd
 *   during an edge/node drag at viewport edges; a bare `clearGesture()` must NOT
 *   reset an in-flight 'drag'/'hover' tag to 'idle' before onNodeDragStop runs.
 */
function clearGesture(expected?: Gesture): void {
  if (!isRecording) return
  if (expected !== undefined) {
    if (currentGesture !== expected) return
  } else if (currentGesture !== 'pan' && currentGesture !== 'zoom') {
    return
  }
  currentGesture = 'idle'
}

/**
 * Called from `onMove`: zoom if the scale changed, else pan. `lastZoom` is
 * seeded from the live viewport in `startRecording`, so the very first move of a
 * session compares against a real baseline (a pure-zoom first move tags 'zoom',
 * not 'pan'). If seeding wasn't reachable, `lastZoom` is NaN and the first move
 * falls back to 'pan' (SUGGESTION 5).
 */
function noteMove(zoom: number): void {
  if (!isRecording) return
  if (!Number.isNaN(lastZoom) && zoom !== lastZoom) {
    currentGesture = 'zoom'
  } else {
    currentGesture = 'pan'
  }
  lastZoom = zoom
}

function incRender(): void {
  if (!isRecording) return
  counters.renders++
}

function incSetNodes(): void {
  if (!isRecording) return
  counters.setNodesCalls++
}

/** Appended by the panel's rAF loop while recording. */
function pushFrame(t: number, dtMs: number): void {
  if (!isRecording) return
  frames.push({ t, dtMs, gesture: currentGesture })
}

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

function avg(xs: Array<number>): number {
  if (xs.length === 0) return 0
  let sum = 0
  for (const x of xs) sum += x
  return sum / xs.length
}

// Single-pass min/max. Avoids `Math.min(...xs)` / `Math.max(...xs)`: the
// per-session frame array grows ~60/s, and spreading it as call args risks
// hitting the engine's argument-count limit on long recordings.
function minOf(xs: Array<number>): number {
  if (xs.length === 0) return 0
  let m = xs[0]
  for (let i = 1; i < xs.length; i++) if (xs[i] < m) m = xs[i]
  return m
}

function maxOf(xs: Array<number>): number {
  if (xs.length === 0) return 0
  let m = xs[0]
  for (let i = 1; i < xs.length; i++) if (xs[i] > m) m = xs[i]
  return m
}

/** Nearest-rank percentile (p in [0,1]) over an ascending sort. */
function percentile(xs: Array<number>, p: number): number {
  if (xs.length === 0) return 0
  // Copy via slice (not spread) then sort in place — O(n log n), no spread-args.
  const sorted = xs.slice().sort((a, b) => a - b)
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(p * sorted.length) - 1),
  )
  return sorted[idx]
}

function computeStats(
  frameBucket: Array<FrameSample>,
  latencyBucket: Array<LatencySample>,
): GestureStats {
  if (frameBucket.length === 0) {
    return {
      frames: 0,
      fps: { min: 0, avg: 0, p95: 0 },
      frameMs: { avg: 0, p95: 0, worst: 0 },
      latencyMs:
        latencyBucket.length === 0
          ? null
          : {
              avg: avg(latencyBucket.map((l) => l.durationMs)),
              p95: percentile(
                latencyBucket.map((l) => l.durationMs),
                0.95,
              ),
            },
    }
  }

  const dts = frameBucket.map((f) => f.dtMs)
  // Frame-time -> instantaneous fps; a 0/negative dt is treated as 0 fps to
  // avoid Infinity poisoning min/avg.
  const fpsVals = dts.map((dt) => (dt > 0 ? 1000 / dt : 0))

  return {
    frames: frameBucket.length,
    fps: {
      min: minOf(fpsVals),
      avg: avg(fpsVals),
      // p95 over the ascending fps distribution (high end); the worst-case
      // slow frames are already surfaced by `fps.min` + `frameMs.worst`.
      p95: percentile(fpsVals, 0.95),
    },
    frameMs: {
      avg: avg(dts),
      p95: percentile(dts, 0.95),
      worst: maxOf(dts),
    },
    latencyMs:
      latencyBucket.length === 0
        ? null
        : {
            avg: avg(latencyBucket.map((l) => l.durationMs)),
            p95: percentile(latencyBucket.map((l) => l.durationMs), 0.95),
          },
  }
}

// ---------------------------------------------------------------------------
// PerformanceObserver wiring (feature-detected; degrades to null latency)
// ---------------------------------------------------------------------------

function startObservers(): void {
  if (typeof PerformanceObserver === 'undefined') return
  // `supportedEntryTypes` is typed non-nullable but is genuinely absent in
  // older engines — widen so the runtime fallback is honest (and lint-clean).
  const supported: ReadonlyArray<string> =
    (PerformanceObserver as { supportedEntryTypes?: ReadonlyArray<string> })
      .supportedEntryTypes ?? []

  if (supported.includes('longtask')) {
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTaskCount++
          longTaskTotalMs += entry.duration
        }
      })
      longTaskObserver.observe({ type: 'longtask', buffered: false })
    } catch {
      longTaskObserver = null
    }
  }

  if (supported.includes('event')) {
    try {
      eventObserver = new PerformanceObserver((list) => {
        // A queued 'event' entry can fire just after stopRecording/disconnect;
        // guard so a late callback can't append to `latencies` post-compute.
        if (!isRecording) return
        for (const entry of list.getEntries()) {
          // Tag each interaction with the gesture active at observe time —
          // gives per-gesture interaction latency (Event Timing API).
          latencies.push({
            gesture: currentGesture,
            durationMs: (entry as PerformanceEventTiming).duration,
          })
        }
      })
      // `durationThreshold` is valid for the Event Timing entry type but isn't
      // in the DOM lib's PerformanceObserverInit; widen the type locally.
      eventObserver.observe({
        type: 'event',
        durationThreshold: 16,
        buffered: false,
      } as PerformanceObserverInit & { durationThreshold: number })
    } catch {
      eventObserver = null
    }
  }
}

function stopObservers(): void {
  longTaskObserver?.disconnect()
  longTaskObserver = null
  eventObserver?.disconnect()
  eventObserver = null
}

// ---------------------------------------------------------------------------
// Recording lifecycle
// ---------------------------------------------------------------------------

function startRecording(meta: { tableCount: number; zoom?: number }): void {
  frames = []
  latencies = []
  longTaskCount = 0
  longTaskTotalMs = 0
  counters.renders = 0
  counters.setNodesCalls = 0
  currentGesture = 'idle'
  // Seed lastZoom from the live viewport zoom (if the caller could reach it) so
  // the first onMove has a real baseline; else NaN => first move tags 'pan'.
  lastZoom = typeof meta.zoom === 'number' ? meta.zoom : Number.NaN
  recordTableCount = meta.tableCount
  startedAt = performance.now()
  isRecording = true
  startObservers()
  emit()
}

function stopRecording(): PerfReport {
  const durationMs = performance.now() - startedAt
  isRecording = false
  stopObservers()

  const reactFlowEl =
    typeof document !== 'undefined'
      ? document.querySelector('.react-flow')
      : null
  const domNodeCount = reactFlowEl
    ? reactFlowEl.getElementsByTagName('*').length
    : 0

  const perGesture = {} as Record<Gesture, GestureStats>
  for (const g of GESTURES) {
    perGesture[g] = computeStats(
      frames.filter((f) => f.gesture === g),
      latencies.filter((l) => l.gesture === g),
    )
  }

  const report: PerfReport = {
    meta: {
      tableCount: recordTableCount,
      domNodeCount,
      durationMs,
      startedAt,
      userAgent:
        typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      viewport: {
        width: typeof window !== 'undefined' ? window.innerWidth : 0,
        height: typeof window !== 'undefined' ? window.innerHeight : 0,
      },
    },
    overall: computeStats(frames, latencies),
    perGesture,
    counters: { ...counters },
    longTasks: { count: longTaskCount, totalMs: longTaskTotalMs },
  }

  emit()
  return report
}

// ---------------------------------------------------------------------------
// Report output
// ---------------------------------------------------------------------------

function downloadReport(report: PerfReport): void {
  console.log('[perf-tracker] report', report)
  if (typeof document === 'undefined') return

  // Non-prod convenience: expose the last report for the e2e's download-flaky
  // fallback path (mirrors the prod/dev split convention used for Socket.IO).
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    ;(window as unknown as { __lastPerfReport?: PerfReport }).__lastPerfReport =
      report
  }

  const stamp = Math.round(performance.now())
  const seq = ++reportSeq
  const json = JSON.stringify(report, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `perf-report-${stamp}-${seq}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Public singleton
// ---------------------------------------------------------------------------

export const perfTracker = {
  get isRecording(): boolean {
    return isRecording
  },
  get currentGesture(): Gesture {
    return currentGesture
  },
  get hideEdges(): boolean {
    return hideEdges
  },
  setHideEdges,
  setGesture,
  clearGesture,
  noteMove,
  incRender,
  incSetNodes,
  pushFrame,
  startRecording,
  stopRecording,
  downloadReport,
  subscribe,
  getSnapshot,
  getLive,
}
