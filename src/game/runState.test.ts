import { describe, expect, it } from 'vitest'
import { freshCombatCounters, pushFeedback, resetRun, runState } from './runState'
import { BASE_STATS } from './stats'

describe('resetRun', () => {
  it('restores fresh combat counters and BASE_STATS when no loadout given', () => {
    runState.combat.kills = 9
    runState.combat.killsByArchetype[2] = 4
    runState.combat.latchesSuffered = 3
    runState.stats.maxLatch = 6
    runState.loadoutCharges = [5, 5]
    resetRun(0, 0)
    expect(runState.combat).toEqual(freshCombatCounters())
    expect(runState.stats).toEqual(BASE_STATS)
    expect(runState.stats).not.toBe(BASE_STATS) // must be a copy, sim mutari-safe
    expect(runState.loadout).toEqual([null, null])
    expect(runState.loadoutCharges).toEqual([0, 0])
    expect(runState.consumablesUsed).toEqual([0, 0])
    expect(runState.activeEffects).toEqual({ stasisT: 0, veilT: 0, frenzyT: 0 })
  })

  it('applies an RPG loadout snapshot without aliasing the input arrays', () => {
    const stats = { ...BASE_STATS, maxLatch: 5, snapDamageMult: 1.3 }
    const loadout: [string | null, string | null] = ['cleansing-ember', null]
    const charges: [number, number] = [3, 0]
    resetRun(2, 4, { stats, loadout, charges })
    expect(runState.stats.maxLatch).toBe(5)
    expect(runState.stats.snapDamageMult).toBe(1.3)
    expect(runState.loadout).toEqual(['cleansing-ember', null])
    expect(runState.loadoutCharges).toEqual([3, 0])
    // mutating the run copies must not touch the caller's arrays
    runState.loadoutCharges[0] = 0
    runState.loadout[0] = null
    runState.stats.maxLatch = 1
    expect(charges[0]).toBe(3)
    expect(loadout[0]).toBe('cleansing-ember')
    expect(stats.maxLatch).toBe(5)
  })

  it('keeps the existing depth/score reset behavior', () => {
    runState.collected = 7
    runState.shiftCharge = 9
    resetRun(3, 5)
    expect(runState.depth).toBe(3)
    expect(runState.collected).toBe(0)
    expect(runState.shiftCharge).toBe(0)
    expect(runState.bestDepthPrev).toBe(5)
  })
})

describe('freshCombatCounters', () => {
  it('starts all counters at zero with 6-slot archetype arrays', () => {
    const c = freshCombatCounters()
    expect(c.kills).toBe(0)
    expect(c.killsByArchetype).toEqual([0, 0, 0, 0, 0, 0])
    expect(c.wardenKillsByArchetype).toEqual([0, 0, 0, 0, 0, 0])
    expect(c.shardsEarned).toBe(0)
    expect(c.lastKillAt).toBe(-1)
    expect(c.lastLatchAt).toBe(-1)
  })

  it('returns independent objects (no shared archetype arrays)', () => {
    const a = freshCombatCounters()
    const b = freshCombatCounters()
    a.killsByArchetype[0] = 5
    expect(b.killsByArchetype[0]).toBe(0)
  })
})

describe('pushFeedback', () => {
  it('accepts the combat feedback kinds and keeps the 8-item cap', () => {
    resetRun()
    pushFeedback('LATCHED', 'VOIDMAW WISP', 'latch')
    pushFeedback('BANISH NOVA', 'THE GRIP BREAKS', 'nova')
    pushFeedback('WARDEN BANISHED', '+3 CHARGE', 'warden')
    pushFeedback('DRAGGED FROM THE SKY', '', 'downed')
    pushFeedback('NOT ENOUGH CHARGE', '', 'warn')
    pushFeedback('HORROR FELLED', '', 'kill')
    expect(runState.feedback.length).toBe(6)
    for (let i = 0; i < 6; i++) pushFeedback('X', '', 'kill')
    expect(runState.feedback.length).toBe(8)
  })
})
