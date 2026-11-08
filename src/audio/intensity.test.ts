import { describe, expect, it } from 'vitest'
import {
  advanceTierState,
  buildDropIndex,
  computeIntensity,
  createSectionCursor,
  createTierState,
  INTENSITY_CFG,
  sampleCurve,
  sampleRise,
  sectionsFromTierCurve,
  updateSectionFields,
  type SectionFrameFields,
} from './intensity'
import type { IntensitySection } from '../types'

const RATE = 20

/** Builds a 20 Hz profile from [durationSec, level] segments. */
function profileOf(segments: Array<[number, number]>): Float32Array {
  const parts: number[] = []
  for (const [dur, level] of segments) {
    for (let i = 0; i < Math.round(dur * RATE); i++) parts.push(level)
  }
  return Float32Array.from(parts)
}

function run(segments: Array<[number, number]>) {
  const profile = profileOf(segments)
  const duration = profile.length / RATE
  return { analysis: computeIntensity(profile, RATE, duration), duration }
}

describe('computeIntensity — degenerate guards', () => {
  it('silence stays CALM everywhere', () => {
    const { analysis, duration } = run([[60, 0]])
    expect(analysis.sections).toEqual([{ startSec: 0, endSec: duration, tier: 0 }])
    expect(Math.max(...analysis.curve)).toBe(0)
  })

  it('brickwalled-flat tracks read as constant PEAK, no fake drops', () => {
    const { analysis } = run([[90, 0.25]])
    expect(analysis.sections).toHaveLength(1)
    expect(analysis.sections[0].tier).toBe(2)
    expect(analysis.curve[100]).toBeCloseTo(INTENSITY_CFG.flatFallbackLevel, 5)
  })

  it('handles very short tracks without throwing', () => {
    const { analysis, duration } = run([[3, 0.1]])
    expect(analysis.sections[analysis.sections.length - 1].endSec).toBeCloseTo(duration, 5)
  })

  it('handles empty profiles', () => {
    const a = computeIntensity(new Float32Array(0), RATE, 0)
    expect(a.sections).toHaveLength(1)
  })
})

describe('computeIntensity — tiers', () => {
  it('linear ramp produces CALM -> RISING -> PEAK in order', () => {
    const n = 120 * RATE
    const profile = new Float32Array(n)
    for (let i = 0; i < n; i++) profile[i] = (0.3 * i) / n
    const a = computeIntensity(profile, RATE, 120)
    const tiers = a.sections.map(s => s.tier)
    expect(tiers).toEqual([0, 1, 2])
    for (let i = 1; i < tiers.length; i++) expect(tiers[i]).toBeGreaterThan(tiers[i - 1])
  })

  it('square-wave alternates quiet/loud with section-length invariants', () => {
    const { analysis } = run([
      [20, 0.05], [20, 0.3],
      [20, 0.05], [20, 0.3],
      [20, 0.05], [20, 0.3],
    ])
    for (const s of analysis.sections) {
      const len = s.endSec - s.startSec
      if (s.tier === 3) expect(len).toBeGreaterThanOrEqual(INTENSITY_CFG.minShatterSec - 1e-6)
      else expect(len).toBeGreaterThanOrEqual(INTENSITY_CFG.minSectionSec - 1e-6)
    }
    // each loud plateau surfaces as loud tiers (PEAK or SHATTER — a square rise IS a drop)
    const loud = analysis.sections.filter(s => s.tier >= 2)
    expect(loud.length).toBeGreaterThanOrEqual(2)
    expect(loud.length).toBeLessThanOrEqual(6)
    // quiet plateaus stay calm
    expect(analysis.sections.filter(s => s.tier === 0).length).toBeGreaterThanOrEqual(2)
  })

  it('hysteresis prevents flapping around a threshold', () => {
    // oscillate +-0.04 at 2 Hz around the tier-1 entry level
    const n = 60 * RATE
    const profile = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      profile[i] = 0.15 + 0.04 * Math.sin((2 * Math.PI * 2 * i) / RATE)
    }
    const a = computeIntensity(profile, RATE, 60)
    expect(a.sections.length).toBeLessThanOrEqual(2)
  })

  it('is scale invariant (percentile normalization)', () => {
    const n = 120 * RATE
    const p1 = new Float32Array(n)
    for (let i = 0; i < n; i++) p1[i] = (0.3 * i) / n
    const p2 = p1.map(v => v * 0.1)
    const a1 = computeIntensity(p1, RATE, 120)
    const a2 = computeIntensity(new Float32Array(p2), RATE, 120)
    expect(a1.sections.map(s => s.tier)).toEqual(a2.sections.map(s => s.tier))
  })

  it('RLE of tierCurve always equals sections', () => {
    const cases = [
      run([[60, 0]]),
      run([[30, 0.1], [10, 0.28], [20, 0.29]]),
      run([[20, 0.05], [20, 0.3], [20, 0.05]]),
    ]
    for (const { analysis, duration } of cases) {
      expect(sectionsFromTierCurve(analysis.tierCurve, RATE, duration)).toEqual(analysis.sections)
    }
  })
})

describe('computeIntensity — SHATTER detection', () => {
  it('Pattern A: build-then-sustain becomes tier 3 near rise completion, capped at 12s', () => {
    const { analysis } = run([
      [30, 0.1],
      [10, 0.2], // rising toward the drop
      [20, 0.32], // sustained slam
    ])
    const t3 = analysis.sections.filter(s => s.tier === 3)
    expect(t3.length).toBeGreaterThanOrEqual(1)
    expect(t3[0].startSec).toBeGreaterThan(35)
    expect(t3[0].startSec).toBeLessThan(45)
    expect(t3[0].endSec - t3[0].startSec).toBeLessThanOrEqual(INTENSITY_CFG.maxShatterSec + 0.5)
    // after the cap the sustained loud section falls back to PEAK
    const after = analysis.sections.find(s => s.startSec >= t3[0].endSec - 1e-6)
    expect(after?.tier).toBe(2)
  })

  it('Pattern B: cliff-then-slam triggers tier 3 at the slam', () => {
    const { analysis } = run([
      [30, 0.28],
      [1, 0.02], // the cliff dip
      [15, 0.3], // slam back
    ])
    const t3 = analysis.sections.filter(s => s.tier === 3)
    expect(t3.length).toBeGreaterThanOrEqual(1)
    expect(Math.abs(t3[0].startSec - 31)).toBeLessThanOrEqual(2)
  })

  it('respects the refractory period between shatter starts', () => {
    const { analysis } = run([
      [30, 0.28],
      [1, 0.02],
      [3, 0.3],
      [1, 0.02], // second cliff too soon
      [3, 0.3],
      [20, 0.1],
    ])
    const t3 = analysis.sections.filter(s => s.tier === 3)
    expect(t3.length).toBeLessThanOrEqual(1)
  })
})

describe('sampleCurve', () => {
  const curve = Float32Array.from([0, 1, 0.5])
  it('clamps below zero and past the end', () => {
    expect(sampleCurve(curve, 20, -5)).toBe(0)
    expect(sampleCurve(curve, 20, 100)).toBe(0.5)
  })
  it('interpolates midpoints', () => {
    expect(sampleCurve(curve, 20, 0.025)).toBeCloseTo(0.5, 5) // halfway sample 0 -> 1
  })
  it('handles empty curves', () => {
    expect(sampleCurve(new Float32Array(0), 20, 1)).toBe(0)
  })
})

describe('sampleRise', () => {
  const RATE20 = 20

  it('reads the slope of a linear ramp', () => {
    // 0 -> 1 over 60s: slope 1/60 per sec; rise = clamp01(slope*4/0.35)
    const n = 60 * RATE20
    const curve = new Float32Array(n)
    for (let i = 0; i < n; i++) curve[i] = i / (n - 1)
    const expected = (4 / 60) / INTENSITY_CFG.riseSignalFullDelta
    expect(sampleRise(curve, RATE20, 30)).toBeCloseTo(expected, 2)
  })

  it('is 0 on flat and falling curves', () => {
    const flat = new Float32Array(600).fill(0.5)
    expect(sampleRise(flat, RATE20, 15)).toBe(0)
    const falling = new Float32Array(600)
    for (let i = 0; i < 600; i++) falling[i] = 1 - i / 599
    expect(sampleRise(falling, RATE20, 15)).toBe(0)
  })

  it('saturates just after a step and releases once the lookback passes it', () => {
    const n = 60 * RATE20
    const curve = new Float32Array(n)
    for (let i = 30 * RATE20; i < n; i++) curve[i] = 0.8
    expect(sampleRise(curve, RATE20, 30.5)).toBe(1) // 0.8/0.35 clamps
    expect(sampleRise(curve, RATE20, 35)).toBe(0) // past t-4 the step is behind both reads
  })

  it('clamps the lookback to curve start and handles empty curves', () => {
    const rampUp = Float32Array.from([0, 0.2, 0.4, 0.6])
    expect(sampleRise(rampUp, 1, 1)).toBeCloseTo((0.2 - 0) / 0.35, 5)
    expect(sampleRise(new Float32Array(0), 20, 10)).toBe(0)
  })
})

describe('section lookahead', () => {
  const sections: IntensitySection[] = [
    { startSec: 0, endSec: 10, tier: 0 },
    { startSec: 10, endSec: 20, tier: 1 },
    { startSec: 20, endSec: 26, tier: 3 },
    { startSec: 26, endSec: 40, tier: 2 },
  ]
  const drops = buildDropIndex(sections)

  function freshOut(): SectionFrameFields {
    return {
      sectionIndex: 0,
      sectionProgress: 0,
      timeToNextSection: Infinity,
      nextTier: -1,
      timeToDrop: Infinity,
      dropAt: -999,
      dropCommitCount: 0,
    }
  }

  it('buildDropIndex maps next/prev drop starts per section', () => {
    expect(Array.from(drops.next)).toEqual([20, 20, 20, Infinity])
    expect(Array.from(drops.prev)).toEqual([-999, -999, 20, 20])
  })

  it('fills lookahead fields correctly across the timeline', () => {
    const cur = createSectionCursor(drops.prev[0])
    const out = freshOut()
    updateSectionFields(cur, sections, drops, 5, out)
    expect(out.sectionIndex).toBe(0)
    expect(out.sectionProgress).toBeCloseTo(0.5, 5)
    expect(out.timeToNextSection).toBeCloseTo(5, 5)
    expect(out.nextTier).toBe(1)
    expect(out.timeToDrop).toBeCloseTo(15, 5)
    expect(out.dropAt).toBe(-999)

    updateSectionFields(cur, sections, drops, 22, out)
    expect(out.sectionIndex).toBe(2)
    expect(out.timeToDrop).toBe(0)
    expect(out.dropAt).toBe(20)

    updateSectionFields(cur, sections, drops, 30, out)
    expect(out.sectionIndex).toBe(3)
    expect(out.nextTier).toBe(-1)
    expect(out.timeToNextSection).toBeCloseTo(10, 5)
    expect(out.timeToDrop).toBe(Infinity)
    expect(out.dropAt).toBe(20)
  })

  it('fires the drop commit exactly once when swept in small steps', () => {
    const cur = createSectionCursor(drops.prev[0])
    const out = freshOut()
    let commits = 0
    let commitAt = -1
    let prev = 0
    for (let t = 0; t <= 40; t += 0.05) {
      updateSectionFields(cur, sections, drops, t, out)
      if (out.dropCommitCount !== prev) {
        commits += out.dropCommitCount - prev
        commitAt = t
        prev = out.dropCommitCount
      }
    }
    expect(commits).toBe(1)
    expect(Math.abs(commitAt - 20)).toBeLessThanOrEqual(0.05 + 1e-9)
  })

  it('suppresses stale commits after a giant dt but keeps dropAt exact', () => {
    const cur = createSectionCursor(drops.prev[0])
    const out = freshOut()
    updateSectionFields(cur, sections, drops, 19.9, out)
    updateSectionFields(cur, sections, drops, 35, out) // hidden tab: one huge step
    expect(out.dropAt).toBe(20)
    expect(out.dropCommitCount).toBe(0)
  })

  it('matches a brute-force search and recovers from backward jumps', () => {
    const cur = createSectionCursor(drops.prev[0])
    const out = freshOut()
    const bruteIndex = (t: number) => {
      for (let i = 0; i < sections.length; i++) {
        if (t < sections[i].endSec || i === sections.length - 1) return i
      }
      return sections.length - 1
    }
    for (let t = 0; t <= 40; t += 0.016) {
      updateSectionFields(cur, sections, drops, t, out)
      expect(out.sectionIndex).toBe(bruteIndex(t))
    }
    updateSectionFields(cur, sections, drops, 3, out) // seek back
    expect(out.sectionIndex).toBe(0)
  })

  it('a track opening in SHATTER never fires a commit at t~0', () => {
    const opening: IntensitySection[] = [
      { startSec: 0, endSec: 8, tier: 3 },
      { startSec: 8, endSec: 20, tier: 1 },
    ]
    const d = buildDropIndex(opening)
    const cur = createSectionCursor(d.prev[0])
    const out = freshOut()
    updateSectionFields(cur, opening, d, 0.05, out)
    expect(out.dropCommitCount).toBe(0)
    expect(out.dropAt).toBe(0)
  })

  it('handles empty section lists inertly', () => {
    const cur = createSectionCursor()
    const out = freshOut()
    out.timeToDrop = 123 // garbage in, inert out
    updateSectionFields(cur, [], buildDropIndex([]), 5, out)
    expect(out.timeToDrop).toBe(Infinity)
    expect(out.nextTier).toBe(-1)
  })
})

describe('advanceTierState', () => {
  it('blends to 0.5 at half the blend window and commits exactly once', () => {
    const st = createTierState(0)
    expect(advanceTierState(st, 2, 10)).toBe(true)
    expect(advanceTierState(st, 2, 10.75)).toBe(false)
    expect(st.blend).toBeCloseTo(0.5, 5)
    advanceTierState(st, 2, 11.5)
    expect(st.blend).toBe(1)
  })

  it('re-change mid-blend restarts from the abandoned tier', () => {
    const st = createTierState(0)
    advanceTierState(st, 2, 10)
    advanceTierState(st, 3, 10.6)
    expect(st.tierFrom).toBe(2)
    expect(st.tier).toBe(3)
    expect(st.blend).toBe(0)
  })
})
