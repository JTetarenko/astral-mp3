import { describe, expect, it } from 'vitest'
import {
  CAST_COMBO,
  castComboDamageMult,
  castComboOnHit,
  castComboOnLoose,
  comboTier,
  makeCastCombo,
  resetCastCombo,
  tickCastCombo,
  tryConsumeStorm,
} from './castCombo'

describe('castCombo ladder', () => {
  it('hits inside the window build the combo; tiers arm at the thresholds', () => {
    const s = makeCastCombo()
    let now = 10
    for (let i = 1; i <= CAST_COMBO.tiers[2]; i++) {
      now += 0.5
      castComboOnHit(s, now)
      expect(s.comboCount).toBe(i)
    }
    expect(comboTier(CAST_COMBO.tiers[0] - 1)).toBe(0)
    expect(comboTier(CAST_COMBO.tiers[0])).toBe(1)
    expect(comboTier(CAST_COMBO.tiers[1])).toBe(2)
    expect(comboTier(CAST_COMBO.tiers[2])).toBe(3)
  })

  it('the break is timeout-only — window silence zeroes the count exactly once', () => {
    const s = makeCastCombo()
    castComboOnHit(s, 10)
    castComboOnHit(s, 11)
    expect(tickCastCombo(s, 11 + CAST_COMBO.windowSec)).toBe(false) // boundary holds
    expect(s.comboCount).toBe(2)
    expect(tickCastCombo(s, 11 + CAST_COMBO.windowSec + 0.01)).toBe(true)
    expect(s.comboCount).toBe(0)
    expect(tickCastCombo(s, 20)).toBe(false) // no double break on an empty combo
  })

  it('a pierced multi-hit frame counts every victim', () => {
    const s = makeCastCombo()
    const now = 5
    castComboOnHit(s, now)
    castComboOnHit(s, now)
    castComboOnHit(s, now)
    expect(s.comboCount).toBe(3)
    expect(comboTier(s.comboCount)).toBe(1)
  })

  it('a combo break never touches the resonance streak or an armed storm', () => {
    const s = makeCastCombo()
    for (let i = 0; i < CAST_COMBO.stormStreak; i++) castComboOnLoose(s, true)
    expect(s.stormArmed).toBe(true)
    castComboOnHit(s, 10)
    tickCastCombo(s, 10 + CAST_COMBO.windowSec + 1)
    expect(s.comboCount).toBe(0)
    expect(s.streak).toBe(CAST_COMBO.stormStreak)
    expect(s.stormArmed).toBe(true)
  })

  it('consecutive on-beat looses arm the storm; one off-beat loose resets the streak', () => {
    const s = makeCastCombo()
    castComboOnLoose(s, true)
    castComboOnLoose(s, true)
    expect(s.stormArmed).toBe(false)
    castComboOnLoose(s, false)
    expect(s.streak).toBe(0)
    for (let i = 0; i < CAST_COMBO.stormStreak; i++) castComboOnLoose(s, true)
    expect(s.stormArmed).toBe(true)
  })

  it('tier 3 arms the storm exactly once per crossing', () => {
    const s = makeCastCombo()
    let now = 0
    for (let i = 0; i < CAST_COMBO.tiers[2]; i++) castComboOnHit(s, (now += 0.1))
    expect(s.stormArmed).toBe(true)
    expect(tryConsumeStorm(s)).toBe(true)
    expect(s.stormArmed).toBe(false)
    // combo still at tier 3 — further hits must NOT instantly re-arm
    castComboOnHit(s, (now += 0.1))
    expect(comboTier(s.comboCount)).toBe(3)
    expect(s.stormArmed).toBe(false)
  })

  it('tryConsumeStorm fires once, disarms, and spends the streak', () => {
    const s = makeCastCombo()
    for (let i = 0; i < CAST_COMBO.stormStreak; i++) castComboOnLoose(s, true)
    expect(tryConsumeStorm(s)).toBe(true)
    expect(s.streak).toBe(0)
    expect(tryConsumeStorm(s)).toBe(false)
  })

  it('the damage bonus pays dmgPerTier per tier', () => {
    expect(castComboDamageMult(0)).toBe(1)
    expect(castComboDamageMult(2)).toBeCloseTo(1 + CAST_COMBO.dmgPerTier * 2, 6)
    expect(castComboDamageMult(3)).toBeCloseTo(1 + CAST_COMBO.dmgPerTier * 3, 6)
  })

  it('reset restores a clean state', () => {
    const s = makeCastCombo()
    castComboOnHit(s, 3)
    castComboOnLoose(s, true)
    resetCastCombo(s)
    expect(s).toEqual(makeCastCombo())
  })

  it('the same event script always lands the same state', () => {
    const run = () => {
      const s = makeCastCombo()
      let now = 0
      for (let i = 0; i < 30; i++) {
        now += 0.37
        if (i % 3 === 0) castComboOnHit(s, now)
        if (i % 4 === 0) castComboOnLoose(s, i % 8 === 0)
        tickCastCombo(s, now)
      }
      return { ...s }
    }
    expect(run()).toEqual(run())
  })
})
