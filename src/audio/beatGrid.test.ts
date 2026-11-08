import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../game/seededRandom'
import {
  computeBeatGrid,
  createBeatCursor,
  emptyBeatGrid,
  updateBeatFields,
  type BeatFrameFields,
} from './beatGrid'
import type { BeatGrid } from '../types'

const RATE = 100 // matches preAnalysis' 100 Hz onset envelope

interface EnvOpts {
  phase?: number
  accentEvery?: number
  accentOffset?: number
  accentGain?: number
  floor?: number
}

/** Synthetic 100 Hz onset envelope: fractional-position beat spikes over a floor. */
function envOf(bpm: number, seconds: number, opts: EnvOpts = {}): Float32Array {
  const { phase = 0, accentEvery = 0, accentOffset = 0, accentGain = 2.5, floor = 0.002 } = opts
  const n = Math.round(seconds * RATE)
  const env = new Float32Array(n).fill(floor)
  const period = 60 / bpm
  for (let k = 0; ; k++) {
    const pos = (phase + k * period) * RATE
    if (pos >= n - 1) break
    const amp = accentEvery > 0 && k % accentEvery === accentOffset ? accentGain : 1
    const i0 = Math.floor(pos)
    const frac = pos - i0
    env[i0] += amp * (1 - frac)
    env[i0 + 1] += amp * frac
  }
  return env
}

describe('computeBeatGrid', () => {
  it('locks phase within 10ms and never drifts on a clean 120 BPM pulse', () => {
    const g = computeBeatGrid(envOf(120, 60, { phase: 0.137 }), RATE, 120, 60)
    const K = g.beatTimes.length
    expect(K).toBeGreaterThan(100)
    expect(Math.abs(g.beatTimes[0] - 0.137)).toBeLessThan(0.01)
    for (let k = 0; k < K; k++) {
      expect(Math.abs(g.beatTimes[k] - (0.137 + k * 0.5))).toBeLessThan(0.015)
    }
    expect(Math.abs(g.gridBpm - 120)).toBeLessThan(0.5)
    expect(g.confidence).toBeGreaterThan(0.7)
  })

  it('absorbs a ~1% BPM mis-estimate via block correction + period adaptation', () => {
    // true pulse at 128 BPM, but the estimator claims 126.5
    const g = computeBeatGrid(envOf(128, 60), RATE, 126.5, 60)
    const period = 60 / 128
    let worstAfterLock = 0
    for (let k = 0; k < g.beatTimes.length; k++) {
      if (g.beatTimes[k] < 4) continue // allow a brief lock-in
      const m = g.beatTimes[k] % period
      worstAfterLock = Math.max(worstAfterLock, Math.min(m, period - m))
    }
    expect(worstAfterLock).toBeLessThan(0.025)
    expect(Math.abs(g.gridBpm - 128)).toBeLessThan(1.5)
    expect(g.confidence).toBeGreaterThan(0.5)
  })

  it('confidence separates pulse from noise from silence', () => {
    const click = computeBeatGrid(envOf(120, 60), RATE, 120, 60)
    expect(click.confidence).toBeGreaterThan(0.7)

    const rng = mulberry32(1234)
    const noise = new Float32Array(60 * RATE)
    for (let i = 0; i < noise.length; i++) noise[i] = rng()
    const g = computeBeatGrid(noise, RATE, 120, 60)
    expect(g.confidence).toBeLessThan(0.2)

    const silent = computeBeatGrid(new Float32Array(60 * RATE), RATE, 120, 60)
    expect(silent.beatTimes.length).toBe(0)
    expect(silent.confidence).toBe(0)
  })

  it('detects 4/4 downbeats from accent emphasis', () => {
    const g = computeBeatGrid(
      envOf(120, 60, { accentEvery: 4, accentOffset: 2 }),
      RATE,
      120,
      60,
    )
    expect(g.barBeats).toBe(4)
    expect(g.downbeatIndex % 4).toBe(2)
    expect(g.barConfidence).toBeGreaterThan(0.5)
  })

  it('degrades gracefully on odd meters instead of inventing bars', () => {
    const g = computeBeatGrid(envOf(120, 60, { accentEvery: 7 }), RATE, 120, 60)
    expect(g.barBeats).toBe(4) // no false 3/5 adoption
    expect(g.barConfidence).toBeLessThan(0.25)
  })

  it('produces strictly increasing beats with bounded intervals, deterministically', () => {
    const env = envOf(97, 45, { phase: 0.21 })
    const a = computeBeatGrid(env, RATE, 97, 45)
    const b = computeBeatGrid(env, RATE, 97, 45)
    expect(Array.from(a.beatTimes)).toEqual(Array.from(b.beatTimes))
    const P = 60 / 97
    for (let k = 1; k < a.beatTimes.length; k++) {
      const dt = a.beatTimes[k] - a.beatTimes[k - 1]
      expect(dt).toBeGreaterThan(0.85 * P)
      expect(dt).toBeLessThan(1.15 * P)
    }
  })

  it('returns an empty grid on tracks with too little material', () => {
    const g = computeBeatGrid(envOf(120, 1.5), RATE, 120, 1.5)
    expect(g.beatTimes.length).toBe(0)
    expect(g.confidence).toBe(0)
    expect(g.period).toBeCloseTo(0.5, 5)
  })

  it('octave-folded BPM still yields a stable (double-time) grid', () => {
    // true pulse 60 BPM, estimator folded it to 120: every 2nd grid beat hits a spike
    const g = computeBeatGrid(envOf(60, 60), RATE, 120, 60)
    expect(g.beatTimes.length).toBeGreaterThan(100)
    expect(Math.abs(g.gridBpm - 120)).toBeLessThan(2)
    expect(g.confidence).toBeGreaterThanOrEqual(0.4)
  })
})

describe('updateBeatFields', () => {
  const grid: BeatGrid = {
    beatTimes: Float32Array.from([1.0, 1.5, 2.0, 2.5, 3.0]),
    period: 0.5,
    gridBpm: 120,
    confidence: 1,
    barBeats: 4,
    downbeatIndex: 1,
    barConfidence: 1,
  }
  const out = (): BeatFrameFields => ({ gridPhase: 0, gridBeatIndex: 0, barPhase: 0, gridSpanSec: 0 })

  it('is continuous while stepping and hits barPhase 0 exactly on downbeats', () => {
    const cur = createBeatCursor()
    const f = out()
    let prevPhase = -1
    for (let t = 0; t <= 4; t += 0.005) {
      updateBeatFields(cur, grid, t, f)
      expect(f.gridPhase).toBeGreaterThanOrEqual(0)
      expect(f.gridPhase).toBeLessThan(1 + 1e-9)
      if (prevPhase >= 0) {
        const step = f.gridPhase - prevPhase
        // small forward step, or a wrap of ~-1
        expect((step >= 0 && step < 0.02) || step < -0.9).toBe(true)
      }
      prevPhase = f.gridPhase
    }
    updateBeatFields(cur, grid, 1.5, f) // beatTimes[1] is the downbeat class
    expect(f.barPhase).toBeCloseTo(0, 5)
    expect(f.gridBeatIndex).toBe(1)
  })

  it('free-runs at the nominal period during lead-in and outro', () => {
    const cur = createBeatCursor()
    const f = out()
    updateBeatFields(cur, grid, 0.3, f) // 1.4 beats before the first beat
    expect(f.gridBeatIndex).toBe(-2)
    expect(f.gridPhase).toBeCloseTo(0.6, 5)
    updateBeatFields(cur, grid, 4.1, f) // 2.2 beats past the last beat
    expect(f.gridBeatIndex).toBe(6)
    expect(f.gridPhase).toBeCloseTo(0.2, 4)
  })

  it('recovers from backward time jumps', () => {
    const cur = createBeatCursor()
    const f = out()
    updateBeatFields(cur, grid, 3.8, f)
    updateBeatFields(cur, grid, 1.2, f)
    expect(f.gridBeatIndex).toBe(0)
    expect(f.gridPhase).toBeCloseTo(0.4, 5)
  })

  it('yields inert fields on an empty grid', () => {
    const cur = createBeatCursor()
    const f = out()
    updateBeatFields(cur, emptyBeatGrid(120), 12, f)
    expect(f.gridPhase).toBe(0)
    expect(f.gridBeatIndex).toBe(-1)
    expect(f.barPhase).toBe(0)
    expect(f.gridSpanSec).toBe(0)
  })

  it('gridSpanSec is the local inter-beat interval mid-grid, period at the ends', () => {
    const uneven: BeatGrid = { ...grid, beatTimes: Float32Array.from([1.0, 1.5, 2.1, 2.5]) }
    const cur = createBeatCursor()
    const f = out()
    updateBeatFields(cur, uneven, 1.7, f) // inside the 1.5..2.1 stretch
    expect(f.gridSpanSec).toBeCloseTo(0.6, 5)
    updateBeatFields(cur, uneven, 3.4, f) // outro free-run
    expect(f.gridSpanSec).toBeCloseTo(0.5, 5)
    const cur2 = createBeatCursor()
    updateBeatFields(cur2, uneven, 0.2, f) // lead-in
    expect(f.gridSpanSec).toBeCloseTo(0.5, 5)
  })
})
