import { describe, expect, it } from 'vitest'
import {
  applyRunToBounty,
  applyRunToQuests,
  BOUNTY_POOL,
  bountyComplete,
  bountyForDay,
  normalizeBounty,
  questAvailability,
  QUESTS,
  QUESTS_BY_ID,
  type QuestRunCounters,
} from './quests'
import { ITEMS_BY_ID } from './items'
import { NPCS_BY_ID } from './npcs'
import { REALMS } from './realms'
import type { QuestSave } from './rpg'

function counters(over: Partial<QuestRunCounters> = {}): QuestRunCounters {
  return {
    depth: 1,
    collected: 0,
    perfects: 0,
    latchesSuffered: 0,
    shardsEarned: 0,
    killsByRealm: {},
    wardenKillsByRealm: {},
    ...over,
  }
}

describe('QUESTS registry', () => {
  it('has unique ids across quests and bounties', () => {
    const ids = [...QUESTS, ...BOUNTY_POOL].map(q => q.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('requires-chains reference real quests and are acyclic', () => {
    for (const q of QUESTS) {
      if (!q.requires) continue
      expect(QUESTS_BY_ID[q.requires]).toBeDefined()
      // walk the chain — must terminate without revisiting
      const seen = new Set<string>([q.id])
      let cur = q.requires as string | undefined
      while (cur) {
        expect(seen.has(cur)).toBe(false)
        seen.add(cur)
        cur = QUESTS_BY_ID[cur]?.requires
      }
    }
  })

  it('rewards reference real items and every giver is a real NPC', () => {
    for (const q of [...QUESTS, ...BOUNTY_POOL]) {
      expect(NPCS_BY_ID[q.giver]).toBeDefined()
      expect(q.reward.xp).toBeGreaterThan(0)
      if (q.reward.itemId) expect(ITEMS_BY_ID[q.reward.itemId]).toBeDefined()
      if (q.objective.realmId) {
        expect(REALMS.some(r => r.id === q.objective.realmId)).toBe(true)
      }
      expect(q.objective.target).toBeGreaterThan(0)
    }
  })

  it('every quest is reachable from a root (no orphaned chains)', () => {
    const turnedAll: Record<string, QuestSave> = {}
    for (const q of QUESTS) turnedAll[q.id] = { state: 'turnedIn', progress: 0 }
    for (const q of QUESTS) {
      // with everything turned in, availability must be the save state
      expect(questAvailability(q, turnedAll)).toBe('turnedIn')
      // with an empty save, roots are offered and dependents locked
      const empty = questAvailability(q, {})
      expect(empty).toBe(q.requires ? 'locked' : 'offered')
    }
  })
})

describe('questAvailability', () => {
  it('unlocks a dependent only when its prerequisite is turned in', () => {
    const k3 = QUESTS_BY_ID['k3-the-green-warden']
    expect(questAvailability(k3, {})).toBe('locked')
    expect(
      questAvailability(k3, { 'k1-first-blood': { state: 'complete', progress: 10 } }),
    ).toBe('locked')
    expect(
      questAvailability(k3, { 'k1-first-blood': { state: 'turnedIn', progress: 10 } }),
    ).toBe('offered')
  })
})

describe('applyRunToQuests', () => {
  it('advances only active quests, additively, capped at target', () => {
    const saves: Record<string, QuestSave> = {
      'k1-first-blood': { state: 'active', progress: 4 },
      'e1-first-offering': { state: 'complete', progress: 30 },
    }
    const { next, ticks } = applyRunToQuests(
      saves,
      counters({ killsByRealm: { astral: 3, jungle: 2 }, collected: 50 }),
    )
    expect(next['k1-first-blood']).toEqual({ state: 'active', progress: 9 })
    expect(next['e1-first-offering']).toEqual({ state: 'complete', progress: 30 })
    expect(ticks.length).toBe(1)
    expect(ticks[0]).toMatchObject({ questId: 'k1-first-blood', before: 4, after: 9, completed: false })
  })

  it('flips to complete exactly at target and reports the tick', () => {
    const saves: Record<string, QuestSave> = {
      'k1-first-blood': { state: 'active', progress: 8 },
    }
    const { next, ticks } = applyRunToQuests(saves, counters({ killsByRealm: { ritual: 5 } }))
    expect(next['k1-first-blood']).toEqual({ state: 'complete', progress: 10 })
    expect(ticks[0].completed).toBe(true)
  })

  it('filters killArchetype by realm', () => {
    const saves: Record<string, QuestSave> = {
      'k2-cull-the-chorus': { state: 'active', progress: 0 },
    }
    const { next } = applyRunToQuests(
      saves,
      counters({ killsByRealm: { astral: 10, cathedral: 4 } }),
    )
    expect(next['k2-cull-the-chorus'].progress).toBe(4)
  })

  it('reachDepth is a high-water mark, not additive', () => {
    const saves: Record<string, QuestSave> = {
      'e3-six-below': { state: 'active', progress: 4 },
    }
    const low = applyRunToQuests(saves, counters({ depth: 3 }))
    expect(low.next['e3-six-below'].progress).toBe(4)
    expect(low.ticks.length).toBe(0)
    const high = applyRunToQuests(saves, counters({ depth: 6 }))
    expect(high.next['e3-six-below']).toEqual({ state: 'complete', progress: 6 })
  })

  it('surviveNoLatch requires zero latches AND depth >= 2', () => {
    const saves: Record<string, QuestSave> = {
      'k5-no-purchase': { state: 'active', progress: 0 },
    }
    expect(
      applyRunToQuests(saves, counters({ depth: 1, latchesSuffered: 0 })).next['k5-no-purchase']
        .progress,
    ).toBe(0)
    expect(
      applyRunToQuests(saves, counters({ depth: 3, latchesSuffered: 2 })).next['k5-no-purchase']
        .progress,
    ).toBe(0)
    expect(
      applyRunToQuests(saves, counters({ depth: 3, latchesSuffered: 0 })).next['k5-no-purchase'],
    ).toEqual({ state: 'complete', progress: 1 })
  })

  it('killWarden filters by realm id', () => {
    const saves: Record<string, QuestSave> = {
      'k3-the-green-warden': { state: 'active', progress: 0 },
    }
    const wrong = applyRunToQuests(saves, counters({ wardenKillsByRealm: { astral: 1 } }))
    expect(wrong.next['k3-the-green-warden'].progress).toBe(0)
    const right = applyRunToQuests(saves, counters({ wardenKillsByRealm: { jungle: 1 } }))
    expect(right.next['k3-the-green-warden']).toEqual({ state: 'complete', progress: 1 })
  })

  it('never mutates its inputs', () => {
    const saves: Record<string, QuestSave> = {
      'k1-first-blood': { state: 'active', progress: 4 },
    }
    const frozen = JSON.stringify(saves)
    applyRunToQuests(saves, counters({ killsByRealm: { astral: 3 } }))
    expect(JSON.stringify(saves)).toBe(frozen)
  })
})

describe('daily bounty', () => {
  it('is deterministic per date and varies across dates', () => {
    const a = bountyForDay('2026-07-28')
    expect(bountyForDay('2026-07-28').id).toBe(a.id)
    const ids = new Set(
      ['2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02'].map(
        d => bountyForDay(d).id,
      ),
    )
    expect(ids.size).toBeGreaterThan(1)
  })

  it('normalizeBounty resets on day change and preserves same-day progress', () => {
    const b = { day: '2026-07-27', progress: 9, claimed: true }
    expect(normalizeBounty(b, '2026-07-28')).toEqual({
      day: '2026-07-28',
      progress: 0,
      claimed: false,
    })
    expect(normalizeBounty(b, '2026-07-27')).toBe(b)
    expect(normalizeBounty(null, '2026-07-28').day).toBe('2026-07-28')
  })

  it('applyRunToBounty advances toward the day quest and stops when claimed', () => {
    const day = '2026-07-28'
    const def = bountyForDay(day)
    // build counters that give this bounty progress no matter which it is
    const c = counters({
      killsByRealm: { astral: 25 },
      collected: 70,
      perfects: 20,
      shardsEarned: 150,
      depth: 3,
    })
    const { next, tick } = applyRunToBounty(null, day, c)
    expect(next.day).toBe(day)
    expect(next.progress).toBe(def.objective.target)
    expect(tick?.completed).toBe(true)
    expect(bountyComplete(next, day)).toBe(true)
    const claimed = { ...next, claimed: true }
    expect(applyRunToBounty(claimed, day, c).tick).toBeNull()
    expect(bountyComplete(claimed, day)).toBe(false)
  })
})
