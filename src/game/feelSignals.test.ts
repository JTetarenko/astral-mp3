import { describe, expect, it } from 'vitest'
import { feel, HIT_RING_CAP, HK, pushHit, resetFeel } from './feelSignals'

describe('feelSignals ring', () => {
  it('wrap at CAP+1 pushes preserves the newest CAP with correct slot mapping', () => {
    const base = feel.hitSerial
    for (let i = 0; i < HIT_RING_CAP + 1; i++) {
      pushHit(i, i, 0, 0, 10 + i, HK.STRIKE, false, false, i)
    }
    expect(feel.hitSerial).toBe(base + HIT_RING_CAP + 1)
    // the newest CAP serials are all present at serial % CAP
    for (let s = feel.hitSerial; s > feel.hitSerial - HIT_RING_CAP; s--) {
      const e = feel.hitRing[s % HIT_RING_CAP]
      expect(e.serial).toBe(s)
    }
  })

  it('pushHit overwrites slots in place (no allocation)', () => {
    const slotBefore = feel.hitRing[(feel.hitSerial + 1) % HIT_RING_CAP]
    pushHit(1, 2, 3, 4, 5, HK.BOLT, true, true, 7)
    const e = feel.hitRing[feel.hitSerial % HIT_RING_CAP]
    expect(e).toBe(slotBefore) // same object identity
    expect(e.kind).toBe(HK.BOLT)
    expect(e.crit).toBe(1)
    expect(e.kill).toBe(1)
    expect(e.targetId).toBe(7)
  })

  it('resetFeel keeps serials and counters, clears continuous fields', () => {
    pushHit(0, 0, 0, 0, 1, HK.NOVA, false, false, 0)
    feel.whiffCount++
    feel.castVolleyCount++
    feel.castComboTierCount++
    feel.deniedGateAim = true
    feel.hitStopActive = true
    const serial = feel.hitSerial
    const whiffs = feel.whiffCount
    const volleys = feel.castVolleyCount
    const tierUps = feel.castComboTierCount
    resetFeel()
    expect(feel.hitSerial).toBe(serial)
    expect(feel.whiffCount).toBe(whiffs)
    expect(feel.castVolleyCount).toBe(volleys)
    expect(feel.castComboTierCount).toBe(tierUps)
    expect(feel.deniedGateAim).toBe(false)
    expect(feel.hitStopActive).toBe(false)
  })
})
