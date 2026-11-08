import { describe, expect, it } from 'vitest'
import {
  applySnap,
  DEG,
  decayedMultiplier,
  initialScoreState,
  precisionTier,
  SCORING,
  type SnapEventInput,
} from './scoring'

const ev = (over: Partial<SnapEventInput> = {}): SnapEventInput => ({
  aimErrorRad: 3 * DEG,
  distance: 20,
  onBeat: false,
  ...over,
})

describe('precisionTier', () => {
  it('honors boundaries inclusively', () => {
    expect(precisionTier(1.5 * DEG)).toBe('perfect')
    expect(precisionTier(1.51 * DEG)).toBe('good')
    expect(precisionTier(4 * DEG)).toBe('good')
    expect(precisionTier(4.01 * DEG)).toBe('ok')
  })
})

describe('applySnap', () => {
  it('reaches exactly x2.4 after a 7-snap chain (concept HUD)', () => {
    let s = initialScoreState()
    for (let i = 0; i < 7; i++) {
      s = applySnap(s, ev(), i * 2).state // 2s apart, inside the 8s window
    }
    expect(s.multiplier).toBeCloseTo(2.4, 5)
    expect(s.chain).toBe(7)
    expect(s.bestChain).toBe(7)
  })

  it('caps the multiplier at 5.0', () => {
    let s = initialScoreState()
    for (let i = 0; i < 40; i++) s = applySnap(s, ev(), i).state
    expect(s.multiplier).toBe(SCORING.multiplierCap)
  })

  it('restarts the chain after the window lapses', () => {
    let s = initialScoreState()
    for (let i = 0; i < 5; i++) s = applySnap(s, ev(), i).state
    const late = applySnap(s, ev(), 100).state
    expect(late.multiplier).toBeCloseTo(1.2, 5)
    expect(late.chain).toBe(1)
    expect(late.bestChain).toBe(5)
  })

  it('applies tier, distance and on-beat bonuses', () => {
    const s = initialScoreState()
    const plain = applySnap(s, ev({ aimErrorRad: 5 * DEG, distance: 0 }), 0)
    expect(plain.gained).toBe(Math.round(100 * 1.2))
    const perfect = applySnap(s, ev({ aimErrorRad: 1 * DEG, distance: 0 }), 0)
    expect(perfect.gained).toBe(Math.round(150 * 1.2))
    const far = applySnap(s, ev({ aimErrorRad: 5 * DEG, distance: 40 }), 0)
    expect(far.gained).toBe(Math.round((100 + 60) * 1.2))
    const beat = applySnap(s, ev({ aimErrorRad: 5 * DEG, distance: 0, onBeat: true }), 0)
    expect(beat.gained).toBe(Math.round(100 * 1.25 * 1.2))
  })

  it('accumulates score', () => {
    let s = initialScoreState()
    const g1 = applySnap(s, ev(), 0)
    s = g1.state
    const g2 = applySnap(s, ev(), 1)
    expect(g2.state.score).toBe(g1.gained + g2.gained)
  })

  it('strikes use strikeBase and share ONE chain ladder with point snaps', () => {
    const s0 = initialScoreState()
    const strike = applySnap(s0, ev({ aimErrorRad: 5 * DEG, distance: 0, kind: 'strike' }), 0)
    expect(strike.gained).toBe(Math.round(SCORING.strikeBase * 1.2))
    // interleaved point/strike events climb the same multiplier
    let s = initialScoreState()
    s = applySnap(s, ev(), 0).state // point: x1.2
    s = applySnap(s, ev({ kind: 'strike' }), 2).state // strike chains: x1.4
    expect(s.multiplier).toBeCloseTo(1.4, 5)
    expect(s.chain).toBe(2)
    const point = applySnap(s, ev({ aimErrorRad: 5 * DEG, distance: 0 }), 4)
    expect(point.gained).toBe(Math.round(100 * 1.6)) // the strike fed the point
  })
})

describe('decayedMultiplier', () => {
  it('holds within the grace window', () => {
    expect(decayedMultiplier(2.4, 5, 1)).toBe(2.4)
  })

  it('decays toward 1.0 after the grace window', () => {
    expect(decayedMultiplier(2.4, 7, 1)).toBeCloseTo(2.25, 5)
    expect(decayedMultiplier(1.05, 20, 1)).toBe(1)
  })
})
