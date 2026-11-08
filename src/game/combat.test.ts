import { describe, expect, it } from 'vitest'
import {
  boltHitDamage,
  castDamage,
  COMBAT,
  killScore,
  leapCurveY,
  novaHitDamage,
  snapStrikeDamage,
  wardenScore,
} from './combat'
import { SCORING } from './scoring'

const P = SCORING.perfectRad
const G = SCORING.goodRad

describe('snapStrikeDamage', () => {
  it('orders precision tiers: perfect > good > base', () => {
    const perfect = snapStrikeDamage(P * 0.5, P, G, false, 1)
    const good = snapStrikeDamage((P + G) / 2, P, G, false, 1)
    const base = snapStrikeDamage(G * 2, P, G, false, 1)
    expect(perfect).toBeGreaterThan(good)
    expect(good).toBeGreaterThan(base)
    expect(base).toBe(COMBAT.strike.base)
  })

  it('on-beat multiplies by exactly onBeatMult', () => {
    const off = snapStrikeDamage(0, P, G, false, 1)
    const on = snapStrikeDamage(0, P, G, true, 1)
    expect(on).toBeCloseTo(off * COMBAT.strike.onBeatMult, 6)
  })

  it('scales linearly with the stat multiplier and never goes negative', () => {
    expect(snapStrikeDamage(0, P, G, false, 1.5)).toBeCloseTo(
      snapStrikeDamage(0, P, G, false, 1) * 1.5,
      6,
    )
    expect(snapStrikeDamage(0, P, G, false, -2)).toBe(0)
  })
})

describe('novaHitDamage', () => {
  it('is max at center, zero at the edge, never negative', () => {
    expect(novaHitDamage(0, 16, 1)).toBe(COMBAT.nova.damage)
    expect(novaHitDamage(16, 16, 1)).toBe(0)
    expect(novaHitDamage(40, 16, 1)).toBe(0)
    expect(novaHitDamage(8, 16, 1)).toBeCloseTo(COMBAT.nova.damage / 2, 6)
    expect(novaHitDamage(5, 0, 1)).toBe(0)
  })
})

describe('boltHitDamage', () => {
  it('is the base damage times the stat multiplier', () => {
    expect(boltHitDamage(1)).toBe(COMBAT.bolt.damage)
    expect(boltHitDamage(1.3)).toBeCloseTo(COMBAT.bolt.damage * 1.3, 6)
  })
})

describe('shot economies', () => {
  it('a volley bolt pays less than a full shot; the whole fan pays more', () => {
    const full = castDamage(1, 1)
    const per = full * COMBAT.cast.volleyDamageK
    expect(per).toBeLessThan(full)
    expect(per * COMBAT.cast.volleyCount).toBeGreaterThan(full)
  })

  it('storm shards together outpay a volley, which outpays one full shot', () => {
    const full = castDamage(1, 1)
    const volley = full * COMBAT.cast.volleyDamageK * COMBAT.cast.volleyCount
    const storm = full * COMBAT.cast.stormDamageK * COMBAT.cast.stormCount
    expect(volley).toBeGreaterThan(full)
    expect(storm).toBeGreaterThan(volley)
  })

  it('storm shards home harder and fall harder than any drawn shot', () => {
    expect(COMBAT.cast.stormHomeTurn).toBeGreaterThan(COMBAT.bolt.homeTurn)
    expect(COMBAT.cast.stormGravity).toBeGreaterThan(COMBAT.bolt.gravity)
  })
})

describe('scores', () => {
  it('kill score grows monotonically with depth and bulk', () => {
    expect(killScore(30, 3)).toBeGreaterThan(killScore(30, 0))
    expect(killScore(40, 0)).toBeGreaterThan(killScore(22, 0))
    expect(wardenScore(4)).toBe(COMBAT.score.wardenKillBase * 5)
    expect(wardenScore(-2)).toBe(COMBAT.score.wardenKillBase)
  })
})

describe('leapCurveY', () => {
  it('interpolates endpoints exactly and lifts mid-arc', () => {
    expect(leapCurveY(0, 2, 8, 3)).toBe(2)
    expect(leapCurveY(1, 2, 8, 3)).toBe(8)
    expect(leapCurveY(0.5, 2, 8, 3)).toBeCloseTo(5 + 3, 6)
    expect(leapCurveY(1.7, 2, 8, 3)).toBe(8) // clamped
  })
})
