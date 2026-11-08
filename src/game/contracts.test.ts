import { describe, expect, it } from 'vitest'
import {
  applyRunToContracts,
  completeContractSlot,
  CONTRACT_GIVERS,
  contractDef,
  contractGates,
  normalizeContracts,
} from './contracts'
import { QUESTS_BY_ID, type QuestRunCounters } from './quests'
import { parseGenId } from './genItems'
import type { ContractsSave, QuestSave } from './rpg'

const GATES_ALL = { korr: true, elara: true }
const GATES_NONE = { korr: false, elara: false }

function fresh(): ContractsSave {
  return { counter: 0, slots: [null, null, null] }
}

function counters(over: Partial<QuestRunCounters> = {}): QuestRunCounters {
  return {
    depth: 0,
    collected: 0,
    perfects: 0,
    latchesSuffered: 0,
    shardsEarned: 0,
    killsByRealm: {},
    wardenKillsByRealm: {},
    ...over,
  }
}

describe('normalizeContracts', () => {
  it('fills unlocked slots deterministically for a fixed counter/level', () => {
    const a = normalizeContracts(fresh(), 5, GATES_ALL)
    const b = normalizeContracts(fresh(), 5, GATES_ALL)
    expect(a).toEqual(b)
    expect(a.slots.every(s => s !== null)).toBe(true)
    expect(a.slots[0]!.seed).not.toBe(a.slots[1]!.seed)
  })

  it('respects giver gates', () => {
    const none = normalizeContracts(fresh(), 5, GATES_NONE)
    expect(none.slots.every(s => s === null)).toBe(true)
    expect(none).toBe(none) // unchanged object identity path
    const korrOnly = normalizeContracts(fresh(), 5, { korr: true, elara: false })
    expect(korrOnly.slots[0]).not.toBeNull()
    expect(korrOnly.slots[1]).not.toBeNull()
    expect(korrOnly.slots[2]).toBeNull()
  })

  it('is idempotent — a filled board returns the same object', () => {
    const filled = normalizeContracts(fresh(), 5, GATES_ALL)
    expect(normalizeContracts(filled, 5, GATES_ALL)).toBe(filled)
  })
})

describe('contractDef', () => {
  it('derives a stable QuestDef with a collision-proof id and scaled rewards', () => {
    const filled = normalizeContracts(fresh(), 8, GATES_ALL)
    for (let slot = 0; slot < 3; slot++) {
      const save = filled.slots[slot]!
      const def = contractDef(save, slot)
      expect(def.id.startsWith('contract:')).toBe(true)
      expect(QUESTS_BY_ID[def.id]).toBeUndefined()
      expect(def.giver).toBe(CONTRACT_GIVERS[slot])
      expect(def.objective.target).toBeGreaterThan(0)
      expect(def.reward.xp).toBe(45 + 9 * 8)
      expect(def.reward.shards).toBe(35 + 7 * 8)
      // same save -> same derivation
      expect(contractDef(save, slot)).toEqual(def)
    }
  })

  it('every third seed carries a valid generated item reward', () => {
    let withItem = 0
    for (let seed = 0; seed < 30; seed++) {
      const def = contractDef({ seed, level: 5, state: 'active', progress: 0 }, 0)
      if (def.reward.itemId) {
        withItem++
        expect(parseGenId(def.reward.itemId)).not.toBeNull()
      }
    }
    expect(withItem).toBe(10) // seeds 0,3,6...27
  })

  it('targets scale with the frozen level', () => {
    const low = contractDef({ seed: 999, level: 1, state: 'active', progress: 0 }, 2)
    const high = contractDef({ seed: 999, level: 20, state: 'active', progress: 0 }, 2)
    expect(high.objective.target).toBeGreaterThan(low.objective.target)
  })
})

describe('applyRunToContracts', () => {
  it('advances active slots and completes at target', () => {
    const filled = normalizeContracts(fresh(), 1, GATES_ALL)
    const big = counters({
      depth: 20,
      collected: 999,
      perfects: 999,
      shardsEarned: 9999,
      killsByRealm: Object.fromEntries(
        ['astral', 'jungle', 'cathedral', 'ritual', 'collapse', 'lavacore'].map(id => [id, 200]),
      ),
      wardenKillsByRealm: { astral: 3 },
    })
    const { next, ticks } = applyRunToContracts(filled, big)
    expect(ticks.length).toBeGreaterThan(0)
    for (const slot of next.slots) {
      if (!slot) continue
      expect(slot.state).toBe('complete')
    }
    for (const tick of ticks) expect(tick.completed).toBe(true)
  })

  it('no counters -> unchanged object, no ticks', () => {
    const filled = normalizeContracts(fresh(), 3, GATES_ALL)
    const { next, ticks } = applyRunToContracts(filled, counters())
    expect(next).toBe(filled)
    expect(ticks).toHaveLength(0)
  })
})

describe('completeContractSlot', () => {
  it('clears the slot, bumps the counter, and the refill reseeds', () => {
    const filled = normalizeContracts(fresh(), 5, GATES_ALL)
    const oldSeed = filled.slots[0]!.seed
    const cleared = completeContractSlot(filled, 0)
    expect(cleared.counter).toBe(1)
    expect(cleared.slots[0]).toBeNull()
    const refilled = normalizeContracts(cleared, 5, GATES_ALL)
    expect(refilled.slots[0]).not.toBeNull()
    expect(refilled.slots[0]!.seed).not.toBe(oldSeed)
  })
})

describe('contractGates', () => {
  it('opens per giver on the first quest turning in', () => {
    const saves: Record<string, QuestSave> = {}
    expect(contractGates(saves)).toEqual(GATES_NONE)
    saves['k1-first-blood'] = { state: 'turnedIn', progress: 10 }
    expect(contractGates(saves)).toEqual({ korr: true, elara: false })
    saves['e1-first-offering'] = { state: 'turnedIn', progress: 30 }
    expect(contractGates(saves)).toEqual(GATES_ALL)
  })
})
