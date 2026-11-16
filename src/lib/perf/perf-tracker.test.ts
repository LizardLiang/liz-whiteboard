// Report statistics: `fps.avg` is frames per elapsed second, `fps.low1` is the
// 1% low (fps of the 99th-percentile frame time), so a stall shows in both.
import { afterEach, describe, expect, it } from 'vitest'
import { PERF_REPORT_VERSION, perfTracker } from './perf-tracker'

afterEach(() => {
  if (perfTracker.isRecording) perfTracker.stopRecording()
})

function record(dts: Array<number>) {
  perfTracker.startRecording({ tableCount: 1 })
  let t = 0
  for (const dt of dts) {
    t += dt
    perfTracker.pushFrame(t, dt)
  }
  return perfTracker.stopRecording()
}

describe('perf report stats', () => {
  it('stamps the schema version', () => {
    expect(record([16]).version).toBe(PERF_REPORT_VERSION)
    expect(PERF_REPORT_VERSION).toBe(2)
  })

  it('avg is frames per elapsed second, not the mean of per-frame fps', () => {
    // 99 fast frames (10 ms) and one 1000 ms stall: 100 frames in 1.99 s.
    const dts = [...Array.from({ length: 99 }, () => 10), 1000]
    const { fps } = record(dts).overall
    expect(fps.avg).toBeCloseTo((100 * 1000) / 1990, 5)
    // The old mean of 1000/dt would have read about 100 fps.
    expect(fps.avg).toBeLessThan(55)
  })

  it('low1 is the fps of the 99th-percentile frame time', () => {
    const dts = [...Array.from({ length: 99 }, () => 10), 1000]
    const { fps } = record(dts).overall
    // ceil(0.99 * 100) - 1 = index 98 of the ascending times: still 10 ms.
    expect(fps.low1).toBeCloseTo(100, 5)
    const many = [...Array.from({ length: 98 }, () => 10), 500, 1000]
    // Two slow frames in 100: index 98 is the 500 ms frame.
    expect(record(many).overall.fps.low1).toBeCloseTo(2, 5)
  })

  it('min is the slowest frame as fps', () => {
    expect(record([10, 20, 100]).overall.fps.min).toBeCloseTo(10, 5)
  })

  it('has no p95 fps field any more', () => {
    expect('p95' in record([16, 16]).overall.fps).toBe(false)
  })

  it('reports zeros for an empty recording', () => {
    expect(record([]).overall.fps).toEqual({ min: 0, avg: 0, low1: 0 })
  })

  it('exposes the same stats live while recording', () => {
    perfTracker.startRecording({ tableCount: 1 })
    perfTracker.pushFrame(20, 20)
    perfTracker.pushFrame(40, 20)
    const live = perfTracker.getLiveStats()
    expect(live.fps.avg).toBeCloseTo(50, 5)
    expect(live.fps.low1).toBeCloseTo(50, 5)
  })
})
