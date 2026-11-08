import { describe, expect, it } from 'vitest'
import { localDayString, rollDrops, settleRun, xpForRun, type RunCounters } from './rpgRun'
import { defaultRpg, levelForXp, setLoadoutSlot, type RpgData } from './rpg'
import { duplicateRelicShards, ITEMS_BY_ID } from './items'

const DAY = '2026-07-28'

function run(over: Partial<RunCounters> = {}): RunCounters {
  return {
    outcome: 'faded',
    depth: 3,
    collected: 12,
    perfects: 4,
    durationPlayed: 180,
    killsByArchetype: [0, 0, 0, 0, 0, 0],
    wardenKillsByArchetype: [0, 0, 0, 0, 0, 0],
    shardsEarned: 20,
    latchesSuffered: 1,
    consumablesUsed: [0, 0],
    loadout: [null, null],
    seed: 12345,
    ...over,
  }
}

describe('xpForRun', () => {
  it('pays for depth, collection, kills, and wardens', () => {
    expect(xpForRun(run({ depth: 3, collected: 12 }))).toBe(42)
    expect(
      xpForRun(run({ killsByArchetype: [5, 0, 0, 0, 0, 0], wardenKillsByArchetype: [1, 0, 0, 0, 0, 0] })),
    ).toBe(42 + 10 + 30)
  })

  it('downed runs pay exactly half, rounded', () => {
    const full = xpForRun(run())
    expect(xpForRun(run({ outcome: 'downed' }))).toBe(Math.round(full * 0.5))
  })

  it('an all-zero pre-combat run still pays depth + collection', () => {
    expect(xpForRun(run({ depth: 1, collected: 0, shardsEarned: 0 }))).toBe(10)
  })
})

describe('rollDrops', () => {
  it('is deterministic for a fixed seed and empty without warden kills', () => {
    expect(rollDrops(run())).toEqual([])
    const c = run({ wardenKillsByArchetype: [0, 1, 0, 0, 0, 0] })
    const a = rollDrops(c)
    const b = rollDrops(c)
    expect(a).toEqual(b)
    // the jungle trophy is a guaranteed roll
    expect(a).toContain('idol-green-warden')
    for (const id of a) expect(ITEMS_BY_ID[id]).toBeDefined()
  })

  it('varies with the run seed', () => {
    const base = run({ wardenKillsByArchetype: [1, 1, 1, 1, 1, 1] })
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8]
    const signatures = new Set(seeds.map(s => rollDrops({ ...base, seed: s }).join('|')))
    expect(signatures.size).toBeGreaterThan(1)
  })
})

describe('settleRun', () => {
  it('grants xp + attunement-boosted shards and reports levels', () => {
    const rpg: RpgData = { ...defaultRpg(), xp: 50 }
    rpg.attributes = { ...rpg.attributes, attunement: 10 }
    const s = settleRun(rpg, run({ shardsEarned: 100 }), DAY)
    expect(s.xpGained).toBe(xpForRun(run({ shardsEarned: 100 })))
    expect(s.shardsGained).toBe(130) // 100 * (1 + 0.03*10)
    expect(s.next.xp).toBe(50 + s.xpGained)
    expect(s.next.shards).toBe(130)
    expect(s.levelBefore).toBe(levelForXp(50))
    expect(s.levelAfter).toBe(levelForXp(s.next.xp))
  })

  it('decrements consumable charges atomically, flooring at zero', () => {
    let rpg: RpgData = { ...defaultRpg(), items: { 'cleansing-ember': 2, 'phoenix-ash': 1 } }
    rpg = setLoadoutSlot(rpg, 0, 'cleansing-ember').next
    rpg = setLoadoutSlot(rpg, 1, 'phoenix-ash').next
    const s = settleRun(
      rpg,
      run({ loadout: ['cleansing-ember', 'phoenix-ash'], consumablesUsed: [1, 3] }),
      DAY,
    )
    expect(s.next.items['cleansing-ember']).toBe(1)
    expect(s.next.items['phoenix-ash']).toBeUndefined() // exhausted, key removed
  })

  it('adds warden drops, converting duplicates to shards', () => {
    const c = run({ wardenKillsByArchetype: [0, 1, 0, 0, 0, 0], shardsEarned: 0 })
    const first = settleRun(defaultRpg(), c, DAY)
    expect(first.drops).toContain('idol-green-warden')
    expect(first.next.items['idol-green-warden']).toBe(1)
    // settle the identical run again from the drop-owning save: trophy dupes
    const again = settleRun(first.next, c, DAY)
    const dupeValue = duplicateRelicShards(ITEMS_BY_ID['idol-green-warden'])
    expect(again.next.items['idol-green-warden']).toBe(1)
    expect(again.next.shards).toBeGreaterThanOrEqual(first.next.shards + dupeValue)
  })

  it('advances active quests + the bounty through the same pass', () => {
    const rpg = defaultRpg()
    rpg.quests['k1-first-blood'] = { state: 'active', progress: 0 }
    const s = settleRun(rpg, run({ killsByArchetype: [4, 3, 0, 0, 0, 0] }), DAY)
    expect(s.next.quests['k1-first-blood'].progress).toBe(7)
    expect(s.questTicks.some(t => t.questId === 'k1-first-blood')).toBe(true)
    expect(s.next.bounty?.day).toBe(DAY)
  })

  it('merges lifetime kill tallies under realm and warden keys', () => {
    const s = settleRun(
      defaultRpg(),
      run({ killsByArchetype: [2, 0, 5, 0, 0, 0], wardenKillsByArchetype: [0, 0, 1, 0, 0, 0] }),
      DAY,
    )
    expect(s.next.kills['astral']).toBe(2)
    expect(s.next.kills['cathedral']).toBe(5)
    expect(s.next.kills['warden:cathedral']).toBe(1)
  })

  it('never mutates the input save', () => {
    const rpg = defaultRpg()
    rpg.quests['k1-first-blood'] = { state: 'active', progress: 0 }
    const frozen = JSON.stringify(rpg)
    settleRun(rpg, run({ killsByArchetype: [1, 1, 1, 0, 0, 0] }), DAY)
    expect(JSON.stringify(rpg)).toBe(frozen)
  })

  it('a zero-combat run (pre-horror world) settles cleanly', () => {
    const s = settleRun(defaultRpg(), run({ shardsEarned: 0, latchesSuffered: 0 }), DAY)
    expect(s.next.xp).toBeGreaterThan(0)
    expect(s.drops).toEqual([])
    expect(s.next.shards).toBe(0)
  })
})

describe('settleRun choice-of-3 offers', () => {
  it('writes deterministic pendingDrops (same counters -> same 3 gen ids)', () => {
    const a = settleRun(defaultRpg(), run(), DAY)
    const b = settleRun(defaultRpg(), run(), DAY)
    expect(a.next.pendingDrops).not.toBeNull()
    expect(a.next.pendingDrops!.offers).toEqual(b.next.pendingDrops!.offers)
    expect(a.next.pendingDrops!.offers).toHaveLength(3)
    for (const id of a.next.pendingDrops!.offers) expect(id.startsWith('gen:')).toBe(true)
    expect(a.stalePendingShards).toBe(0)
  })

  it('offers scale quality with depth', () => {
    const shallow = settleRun(defaultRpg(), run({ depth: 1 }), DAY)
    const deep = settleRun(defaultRpg(), run({ depth: 12 }), DAY)
    expect(deep.next.pendingDrops!.quality).toBeGreaterThan(shallow.next.pendingDrops!.quality)
  })

  it('dissolves a stale unclaimed choice into shards before writing the new one', () => {
    const first = settleRun(defaultRpg(), run(), DAY)
    const stale = first.next.pendingDrops!
    const second = settleRun(first.next, run({ depth: 4 }), DAY)
    expect(second.stalePendingShards).toBeGreaterThan(0)
    expect(second.next.shards).toBeGreaterThanOrEqual(
      first.next.shards + second.stalePendingShards,
    )
    expect(second.next.pendingDrops!.offers).not.toEqual(stale.offers)
  })
})

describe('localDayString', () => {
  it('formats as YYYY-MM-DD with zero padding', () => {
    expect(localDayString(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(localDayString(new Date(2026, 10, 23))).toBe('2026-11-23')
  })
})
