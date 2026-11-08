import { describe, expect, it } from 'vitest'
import {
  bandEnergy,
  bandRanges,
  createBandTracker,
  createOnsetDetector,
  dbToLinear,
  ONSET_DEFAULTS,
  ONSET_HIGH,
  ONSET_MID,
  updateEnvelope,
  updateOnset,
  type OnsetConfig,
} from './analysis'

describe('bandRanges', () => {
  it('computes exact bins at 48kHz / 2048', () => {
    const [lows, mids, highs] = bandRanges(48000, 2048)
    expect(lows).toEqual({ start: 1, end: 6 })
    expect(mids).toEqual({ start: 7, end: 85 })
    expect(highs).toEqual({ start: 86, end: 512 })
  })

  it('computes exact bins at 44.1kHz / 2048', () => {
    const [lows, mids, highs] = bandRanges(44100, 2048)
    expect(lows).toEqual({ start: 1, end: 7 })
    expect(mids).toEqual({ start: 8, end: 92 })
    expect(highs).toEqual({ start: 93, end: 557 })
  })

  it('never overlaps bands and excludes DC', () => {
    for (const sr of [22050, 44100, 48000, 96000]) {
      const [lows, mids, highs] = bandRanges(sr, 2048)
      expect(lows.start).toBeGreaterThanOrEqual(1)
      expect(mids.start).toBeGreaterThan(lows.end)
      expect(highs.start).toBeGreaterThan(mids.end)
      expect(highs.end).toBeLessThanOrEqual(1023)
    }
  })
})

describe('dbToLinear', () => {
  it('maps 0dB to 1 and -20dB to 0.1', () => {
    expect(dbToLinear(0)).toBeCloseTo(1)
    expect(dbToLinear(-20)).toBeCloseTo(0.1)
    expect(dbToLinear(-Infinity)).toBe(0)
  })
})

describe('bandEnergy', () => {
  it('is the mean over the inclusive range', () => {
    const mag = new Float32Array([0, 1, 2, 3, 4])
    expect(bandEnergy(mag, { start: 1, end: 3 })).toBeCloseTo(2)
  })
})

describe('updateEnvelope', () => {
  it('reaches ~63% of a step after one attack tau', () => {
    const t = createBandTracker(0.1, 0.5)
    // simulate 100ms in 1ms steps with x = 1
    for (let i = 0; i < 100; i++) updateEnvelope(t, 1, 0.001)
    expect(t.env).toBeGreaterThan(0.6)
    expect(t.env).toBeLessThan(0.66)
  })

  it('is frame-rate independent for constant input', () => {
    const a = createBandTracker(0.05, 0.3)
    const b = createBandTracker(0.05, 0.3)
    const total = 0.5
    for (let i = 0; i < total * 30; i++) updateEnvelope(a, 1, 1 / 30)
    for (let i = 0; i < total * 144; i++) updateEnvelope(b, 1, 1 / 144)
    expect(a.env).toBeCloseTo(b.env, 6)
  })

  it('decays with the release tau', () => {
    const t = createBandTracker(0.01, 0.2)
    for (let i = 0; i < 200; i++) updateEnvelope(t, 1, 0.01)
    const peak = t.env
    for (let i = 0; i < 20; i++) updateEnvelope(t, 0, 0.01) // 200ms = 1 release tau
    expect(t.env / peak).toBeGreaterThan(0.3)
    expect(t.env / peak).toBeLessThan(0.42)
  })

  it('keeps normalized output in [0,1] and gates silence to 0', () => {
    const t = createBandTracker(0.01, 0.2)
    for (let i = 0; i < 500; i++) {
      const norm = updateEnvelope(t, Math.random() * 0.5, 1 / 60)
      expect(norm).toBeGreaterThanOrEqual(0)
      expect(norm).toBeLessThanOrEqual(1)
    }
    for (let i = 0; i < 2000; i++) updateEnvelope(t, 0, 1 / 60)
    expect(t.norm).toBe(0)
  })
})

describe('updateOnset', () => {
  const range = { start: 1, end: 6 }
  const nBins = 8

  function frames(pattern: (frame: number) => number): Float32Array[] {
    const out: Float32Array[] = []
    for (let f = 0; f < 240; f++) {
      const mag = new Float32Array(nBins)
      const v = pattern(f)
      for (let i = range.start; i <= range.end; i++) mag[i] = v
      out.push(mag)
    }
    return out
  }

  it('fires exactly on periodic spikes after warmup, refractory suppresses doubles', () => {
    const d = createOnsetDetector(range)
    // 120 BPM at 60fps -> spike every 30 frames; double-spike at 90/91
    const spikeFrames = new Set([60, 90, 91, 120, 150, 180, 210])
    const mags = frames(f => 0.01 + (spikeFrames.has(f) ? 0.08 : 0))
    const onsets: number[] = []
    mags.forEach((mag, f) => {
      const r = updateOnset(d, mag, f / 60)
      if (r.onset) onsets.push(f)
    })
    expect(onsets).toEqual([60, 90, 120, 150, 180, 210]) // 91 suppressed
  })

  it('never fires on constant signal', () => {
    const d = createOnsetDetector(range)
    const mags = frames(() => 0.05)
    let count = 0
    mags.forEach((mag, f) => {
      if (updateOnset(d, mag, f / 60).onset) count++
    })
    expect(count).toBe(0)
  })

  it('strength scales with spike size (below the clamp)', () => {
    const strengths: number[] = []
    for (const spike of [0.0012, 0.002]) {
      const d = createOnsetDetector(range)
      const mags = frames(f => 0.01 + (f === 100 ? spike : 0))
      mags.forEach((mag, f) => {
        const r = updateOnset(d, mag, f / 60)
        if (r.onset) strengths.push(r.strength)
      })
    }
    expect(strengths).toHaveLength(2)
    expect(strengths[1]).toBeGreaterThan(strengths[0])
  })
})

describe('per-band onset detectors', () => {
  it('detectors on disjoint ranges are fully independent', () => {
    const lowRange = { start: 1, end: 6 }
    const highRange = { start: 10, end: 20 }
    const dLow = createOnsetDetector(lowRange)
    const dHigh = createOnsetDetector(highRange)
    let lowFired = 0
    let highFired = 0
    for (let f = 0; f < 240; f++) {
      const mag = new Float32Array(24)
      const spike = f >= 30 && f % 30 === 0
      for (let i = highRange.start; i <= highRange.end; i++) mag[i] = 0.01 + (spike ? 0.08 : 0)
      for (let i = lowRange.start; i <= lowRange.end; i++) mag[i] = 0.02 // constant
      const t = f / 60
      if (updateOnset(dLow, mag, t, ONSET_MID).onset) lowFired++
      if (updateOnset(dHigh, mag, t, ONSET_HIGH).onset) highFired++
    }
    expect(highFired).toBeGreaterThan(3)
    expect(lowFired).toBe(0)
  })

  it('ONSET_HIGH keeps up with hat-rate spikes that ONSET_DEFAULTS drops', () => {
    const range = { start: 1, end: 6 }
    const runWith = (cfg: OnsetConfig) => {
      const d = createOnsetDetector(range)
      let fired = 0
      for (let f = 0; f < 240; f++) {
        const mag = new Float32Array(8)
        const spike = f >= 30 && (f - 30) % 5 === 0 // every 5 frames = 83ms
        for (let i = range.start; i <= range.end; i++) mag[i] = 0.01 + (spike ? 0.08 : 0)
        if (updateOnset(d, mag, f / 60, cfg).onset) fired++
      }
      return fired
    }
    const fast = runWith(ONSET_HIGH)
    const slow = runWith(ONSET_DEFAULTS)
    expect(fast).toBeGreaterThan(slow * 1.6) // 83ms gaps beat the 120ms refractory every other hit
  })
})
