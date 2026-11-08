import { beforeEach, describe, expect, it } from 'vitest'
import { feel, HK } from './feelSignals'
import {
  damagePlayer,
  healPlayer,
  isPlayerDead,
  PLAYER_HP,
  reviveFloor,
  tickPlayerRegen,
} from './playerHealth'
import { resetRun, runState } from './runState'

describe('playerHealth', () => {
  beforeEach(() => resetRun())

  it('resetRun restores hp to stats.maxHp', () => {
    expect(runState.hp).toBe(runState.stats.maxHp)
  })

  it('damage floors at 0 and flags death', () => {
    damagePlayer(999, 10, HK.LATCH_GNAW, 0, 0, 0)
    expect(runState.hp).toBe(0)
    expect(isPlayerDead()).toBe(true)
    // further damage is a no-op
    expect(damagePlayer(10, 11, HK.LATCH_GNAW, 0, 0, 0)).toBe(0)
  })

  it('warden mercy window swallows the second blow, gnaws ignore it', () => {
    expect(damagePlayer(18, 10, HK.PLAYER_TAKEN, 0, 0, 0)).toBe(18)
    expect(damagePlayer(12, 10.2, HK.PLAYER_TAKEN, 0, 0, 0)).toBe(0) // inside 0.5s mercy
    expect(damagePlayer(12, 10.61, HK.PLAYER_TAKEN, 0, 0, 0)).toBe(12) // past it
    const hpBefore = runState.hp
    expect(damagePlayer(3, 10.7, HK.LATCH_GNAW, 0, 0, 0)).toBe(3) // gnaw unaffected by mercy
    expect(runState.hp).toBe(hpBefore - 3)
  })

  it('counters split by source and stamp lastDamageTakenAt', () => {
    damagePlayer(18, 5, HK.PLAYER_TAKEN, 0, 0, 0)
    damagePlayer(3, 6, HK.LATCH_GNAW, 0, 0, 0)
    const c = runState.combat
    expect(c.damageTaken).toBe(21)
    expect(c.wardenDamageTaken).toBe(18)
    expect(c.gnawDamageTaken).toBe(3)
    expect(c.lastDamageTakenAt).toBe(6)
  })

  it('taken damage pushes a feel event with kill flag on the lethal blow', () => {
    const s0 = feel.hitSerial
    runState.hp = 5
    damagePlayer(5, 9, HK.PLAYER_TAKEN, 1, 2, 3)
    expect(feel.hitSerial).toBe(s0 + 1)
    const e = feel.hitRing[feel.hitSerial % 32]
    expect(e.kind).toBe(HK.PLAYER_TAKEN)
    expect(e.kill).toBe(1)
    expect(e.targetId).toBe(-1)
  })

  it('regen waits for the delay, then climbs to the cap and stops', () => {
    damagePlayer(80, 10, HK.PLAYER_TAKEN, 0, 0, 0) // hp 20
    tickPlayerRegen(1, 12) // inside delay
    expect(runState.hp).toBe(20)
    tickPlayerRegen(1, 16) // past delay: +3
    expect(runState.hp).toBeCloseTo(23, 6)
    // grind to the cap
    for (let i = 0; i < 100; i++) tickPlayerRegen(1, 20 + i)
    expect(runState.hp).toBeCloseTo(runState.stats.maxHp * PLAYER_HP.regenCapFrac, 6)
  })

  it('an untouched run never regens (nothing to recover)', () => {
    runState.hp = 50 // hp lowered without a damage event (hypothetical)
    tickPlayerRegen(10, 100)
    expect(runState.hp).toBe(50)
  })

  it('heal clamps at maxHp; revive floor is half the pool', () => {
    damagePlayer(10, 5, HK.LATCH_GNAW, 0, 0, 0)
    healPlayer(999)
    expect(runState.hp).toBe(runState.stats.maxHp)
    expect(reviveFloor()).toBe(Math.round(runState.stats.maxHp * 0.5))
  })
})
