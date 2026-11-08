import { describe, expect, it } from 'vitest'
import {
  ATTR_CAP,
  buildRunLoadout,
  claimPendingDrop,
  computeStats,
  defaultRpg,
  equipRelic,
  grantRewards,
  LEVEL_CAP,
  levelForXp,
  parseRpg,
  pointsForLevel,
  setLoadoutSlot,
  spendPoint,
  tryBuy,
  unequipRelic,
  unspentPoints,
  xpIntoLevel,
  xpToNext,
  type RpgData,
} from './rpg'
import { BASE_STATS } from './stats'
import { duplicateRelicShards, getItem, ITEMS_BY_ID } from './items'
import { rollItem, rollOffers } from './genItems'

function rich(over: Partial<RpgData> = {}): RpgData {
  return { ...defaultRpg(), shards: 10_000, ...over }
}

describe('level curve', () => {
  it('starts at level 1 with 0 xp and is monotonic non-decreasing', () => {
    expect(levelForXp(0)).toBe(1)
    let prev = 1
    for (let xp = 0; xp <= 50_000; xp += 137) {
      const l = levelForXp(xp)
      expect(l).toBeGreaterThanOrEqual(prev)
      prev = l
    }
  })

  it('is consistent with xpToNext partial sums', () => {
    let acc = 0
    for (let level = 1; level < 10; level++) {
      acc += xpToNext(level)
      expect(levelForXp(acc - 1)).toBe(level)
      expect(levelForXp(acc)).toBe(level + 1)
    }
  })

  it('caps at LEVEL_CAP', () => {
    expect(levelForXp(10_000_000)).toBe(LEVEL_CAP)
  })

  it('xpIntoLevel reports bar progress inside the current span', () => {
    expect(xpIntoLevel(0)).toEqual({ into: 0, span: 60 })
    expect(xpIntoLevel(59).into).toBe(59)
    expect(xpIntoLevel(60)).toEqual({ into: 0, span: xpToNext(2) })
  })

  it('grants level-1 points at 0 and 29 at cap', () => {
    expect(pointsForLevel(1)).toBe(0)
    expect(pointsForLevel(LEVEL_CAP)).toBe(29)
  })
})

describe('computeStats', () => {
  it('a fresh save is exactly the pre-RPG baseline', () => {
    expect(computeStats(defaultRpg())).toEqual(BASE_STATS)
  })

  it('attributes raise stats within clamps', () => {
    const rpg = rich()
    rpg.attributes = { vigor: 12, force: 12, grace: 12, attunement: 12 }
    const s = computeStats(rpg)
    expect(s.maxLatch).toBe(6) // 3 + floor(12/3) = 7, clamped to the 6 anchors
    expect(s.maxHp).toBe(196) // 100 + 8*12 — vigor pays between latch breaks
    expect(s.snapDamageMult).toBeCloseTo(1.6, 5)
    expect(s.boltDamageMult).toBeCloseTo(1.48, 5)
    expect(s.novaRadiusMult).toBeCloseTo(1.36, 5)
    expect(s.moveMult).toBeCloseTo(1.18, 5)
    expect(s.chargeGainMult).toBeCloseTo(1.48, 5)
  })

  it('marrow-lantern folds +20 maxHp; the pool clamps to 40..400', () => {
    const rpg = rich({ items: { 'marrow-lantern': 1 } })
    rpg.relics = ['marrow-lantern', null, null]
    expect(computeStats(rpg).maxHp).toBe(120)
    const stacked = rich({ items: { 'marrow-lantern': 1 } })
    stacked.attributes = { vigor: 999, force: 0, grace: 0, attunement: 0 }
    stacked.relics = ['marrow-lantern', null, null]
    expect(computeStats(stacked).maxHp).toBe(400)
  })

  it('equipped relics add their mods; unequipped ones do not', () => {
    const rpg = rich({ items: { 'wardens-fang': 1, 'feathered-ward': 1 } })
    rpg.relics = ['wardens-fang', null, null]
    const s = computeStats(rpg)
    expect(s.snapDamageMult).toBeCloseTo(1.25, 5)
    expect(s.maxLatch).toBe(BASE_STATS.maxLatch) // feathered-ward owned, not socketed
  })

  it('never exceeds the hard clamps even fully stacked', () => {
    const rpg = rich({
      items: { 'wardens-fang': 1, 'ember-vertebra': 1, 'chorus-of-teeth': 1 },
    })
    rpg.attributes = { vigor: 12, force: 12, grace: 12, attunement: 12 }
    rpg.relics = ['wardens-fang', 'ember-vertebra', 'chorus-of-teeth']
    const s = computeStats(rpg)
    for (const v of [s.snapDamageMult, s.boltDamageMult, s.novaRadiusMult, s.moveMult, s.chargeGainMult]) {
      expect(v).toBeGreaterThanOrEqual(0.5)
      expect(v).toBeLessThanOrEqual(2.5)
    }
    expect(Number.isInteger(s.maxLatch)).toBe(true)
    expect(s.maxLatch).toBeLessThanOrEqual(6)
  })
})

describe('tryBuy', () => {
  it('buys a consumable, deducts shards, stacks counts', () => {
    const r1 = tryBuy(rich(), 'cleansing-ember')
    expect(r1.ok).toBe(true)
    expect(r1.next.shards).toBe(10_000 - 35)
    const r2 = tryBuy(r1.next, 'cleansing-ember')
    expect(r2.next.items['cleansing-ember']).toBe(2)
  })

  it('refuses poor / duplicate-relic / unknown / not-sold', () => {
    expect(tryBuy(rich({ shards: 10 }), 'feathered-ward').reason).toBe('poor')
    const owned = rich({ items: { 'feathered-ward': 1 } })
    expect(tryBuy(owned, 'feathered-ward').reason).toBe('owned')
    expect(tryBuy(rich(), 'nonsense-id').reason).toBe('unknown')
    expect(tryBuy(rich(), 'gravemoss-crown').reason).toBe('unknown') // price 0, drop-only
  })

  it('never mutates the input', () => {
    const rpg = rich()
    const frozen = JSON.stringify(rpg)
    tryBuy(rpg, 'cleansing-ember')
    tryBuy(rpg, 'nonsense')
    expect(JSON.stringify(rpg)).toBe(frozen)
  })
})

describe('equip / loadout', () => {
  it('equips an owned relic and auto-moves between sockets', () => {
    let rpg = rich({ items: { 'wardens-fang': 1 } })
    const e1 = equipRelic(rpg, 'wardens-fang', 0)
    expect(e1.ok).toBe(true)
    rpg = e1.next
    const e2 = equipRelic(rpg, 'wardens-fang', 2)
    expect(e2.next.relics).toEqual([null, null, 'wardens-fang'])
  })

  it('refuses unowned, wrong-kind, and bad slots', () => {
    const rpg = rich({ items: { 'cleansing-ember': 3 } })
    expect(equipRelic(rpg, 'wardens-fang', 0).ok).toBe(false)
    expect(equipRelic(rpg, 'cleansing-ember', 0).ok).toBe(false)
    const owned = rich({ items: { 'wardens-fang': 1 } })
    expect(equipRelic(owned, 'wardens-fang', 3).ok).toBe(false)
    expect(unequipRelic(owned, 0).ok).toBe(false) // empty socket
  })

  it('sets consumable loadout slots with the same-rite exclusivity', () => {
    let rpg = rich({ items: { 'cleansing-ember': 2, 'phoenix-ash': 1 } })
    rpg = setLoadoutSlot(rpg, 0, 'cleansing-ember').next
    rpg = setLoadoutSlot(rpg, 1, 'phoenix-ash').next
    expect(rpg.loadout).toEqual(['cleansing-ember', 'phoenix-ash'])
    rpg = setLoadoutSlot(rpg, 1, 'cleansing-ember').next
    expect(rpg.loadout).toEqual([null, 'cleansing-ember'])
    expect(setLoadoutSlot(rpg, 0, 'wardens-fang').ok).toBe(false)
    rpg = setLoadoutSlot(rpg, 1, null).next
    expect(rpg.loadout).toEqual([null, null])
  })
})

describe('spendPoint', () => {
  it('spends only available points and respects ATTR_CAP', () => {
    const broke = defaultRpg() // level 1 -> 0 points
    expect(spendPoint(broke, 'vigor').ok).toBe(false)
    const leveled = rich({ xp: 100_000 }) // cap level, 29 points
    let cur = leveled
    for (let i = 0; i < ATTR_CAP; i++) {
      const r = spendPoint(cur, 'vigor')
      expect(r.ok).toBe(true)
      cur = r.next
    }
    expect(cur.attributes.vigor).toBe(ATTR_CAP)
    expect(spendPoint(cur, 'vigor').ok).toBe(false)
    expect(unspentPoints(cur)).toBe(29 - ATTR_CAP)
  })
})

describe('grantRewards', () => {
  it('adds xp/shards and stacks consumables', () => {
    const next = grantRewards(defaultRpg(), {
      xp: 120,
      shards: 60,
      items: { 'cleansing-ember': 2 },
    })
    expect(next.xp).toBe(120)
    expect(next.shards).toBe(60)
    expect(next.items['cleansing-ember']).toBe(2)
  })

  it('converts duplicate relics to shards instead of stacking', () => {
    const owned = rich({ shards: 0, items: { 'wardens-fang': 1 } })
    const next = grantRewards(owned, { items: { 'wardens-fang': 1 } })
    expect(next.items['wardens-fang']).toBe(1)
    expect(next.shards).toBe(duplicateRelicShards(ITEMS_BY_ID['wardens-fang']))
  })
})

describe('parseRpg', () => {
  it('null / garbage / non-object all yield a fresh save', () => {
    expect(parseRpg(null)).toEqual(defaultRpg())
    expect(parseRpg('not json{')).toEqual(defaultRpg())
    expect(parseRpg('42')).toEqual(defaultRpg())
    expect(parseRpg('"str"')).toEqual(defaultRpg())
  })

  it('round-trips a healthy save', () => {
    let rpg = rich({ xp: 500, items: { 'wardens-fang': 1, 'cleansing-ember': 3 } })
    rpg = equipRelic(rpg, 'wardens-fang', 1).next
    rpg = setLoadoutSlot(rpg, 0, 'cleansing-ember').next
    rpg.quests['e1-first-offering'] = { state: 'active', progress: 12 }
    rpg.bounty = { day: '2026-07-28', progress: 3, claimed: false }
    rpg.kills = { astral: 9, 'warden:jungle': 1 }
    expect(parseRpg(JSON.stringify(rpg))).toEqual(rpg)
  })

  it('drops unknown items and heals sockets pointing at unowned/wrong-kind ids', () => {
    const raw = JSON.stringify({
      xp: 100,
      shards: 50,
      items: { 'wardens-fang': 1, 'ghost-item': 4, 'cleansing-ember': 2 },
      relics: ['wardens-fang', 'cleansing-ember', 'ghost-item'],
      loadout: ['cleansing-ember', 'wardens-fang'],
    })
    const out = parseRpg(raw)
    expect(out.items['ghost-item']).toBeUndefined()
    expect(out.relics).toEqual(['wardens-fang', null, null])
    expect(out.loadout).toEqual(['cleansing-ember', null])
  })

  it('clamps negatives, floors fractions, caps relic counts at 1', () => {
    const raw = JSON.stringify({
      xp: -50,
      shards: 12.9,
      items: { 'wardens-fang': 5, 'cleansing-ember': 2.7 },
      attributes: { vigor: -2, force: 99 },
    })
    const out = parseRpg(raw)
    expect(out.xp).toBe(0)
    expect(out.shards).toBe(12)
    expect(out.items['wardens-fang']).toBe(1)
    expect(out.items['cleansing-ember']).toBe(2)
    expect(out.attributes.vigor).toBe(0)
  })

  it('resets over-spent attributes (points refund, player-favorable)', () => {
    const raw = JSON.stringify({
      xp: 0, // level 1 -> 0 legal points
      attributes: { vigor: 5, force: 0, grace: 0, attunement: 0 },
    })
    const out = parseRpg(raw)
    expect(out.attributes).toEqual({ vigor: 0, force: 0, grace: 0, attunement: 0 })
  })

  it('rejects a socketed relic duplicated across sockets', () => {
    const raw = JSON.stringify({
      items: { 'wardens-fang': 1 },
      relics: ['wardens-fang', 'wardens-fang', null],
    })
    expect(parseRpg(raw).relics).toEqual(['wardens-fang', null, null])
  })

  it('drops malformed bounty days and quest states', () => {
    const raw = JSON.stringify({
      bounty: { day: 'someday', progress: 5, claimed: false },
      quests: { q1: { state: 'weird', progress: 3 }, q2: { state: 'active', progress: -4 } },
    })
    const out = parseRpg(raw)
    expect(out.bounty).toBeNull()
    expect(out.quests.q1).toBeUndefined()
    expect(out.quests.q2).toEqual({ state: 'active', progress: 0 })
  })
})

describe('buildRunLoadout', () => {
  it('freezes stats + loadout + charge counts without aliasing', () => {
    let rpg = rich({ items: { 'cleansing-ember': 3, 'phoenix-ash': 1 } })
    rpg = setLoadoutSlot(rpg, 0, 'cleansing-ember').next
    rpg = setLoadoutSlot(rpg, 1, 'phoenix-ash').next
    const rl = buildRunLoadout(rpg)
    expect(rl.loadout).toEqual(['cleansing-ember', 'phoenix-ash'])
    expect(rl.charges).toEqual([3, 1])
    expect(rl.stats).toEqual(computeStats(rpg))
    rl.loadout[0] = null
    rl.charges[0] = 0
    expect(rpg.loadout[0]).toBe('cleansing-ember')
    expect(rpg.items['cleansing-ember']).toBe(3)
  })

  it('empty slots yield zero charges', () => {
    expect(buildRunLoadout(defaultRpg()).charges).toEqual([0, 0])
  })
})

describe('procedural items in the save', () => {
  const genId = () => rollItem(424242, 70).id

  it('parseRpg accepts valid gen ids in items and relic sockets', () => {
    const id = genId()
    const saved = { ...defaultRpg(), items: { [id]: 1 }, relics: [id, null, null] }
    const back = parseRpg(JSON.stringify(saved))
    expect(back.items[id]).toBe(1)
    expect(back.relics[0]).toBe(id)
  })

  it('parseRpg drops malformed gen ids silently', () => {
    const saved = {
      ...defaultRpg(),
      items: { 'gen:1:zzzzzzzz:q50': 1, 'gen:nonsense': 2 },
    }
    const back = parseRpg(JSON.stringify(saved))
    expect(Object.keys(back.items)).toHaveLength(0)
  })

  it('gen relics cap at count 1 like named relics', () => {
    const id = genId()
    const back = parseRpg(JSON.stringify({ ...defaultRpg(), items: { [id]: 5 } }))
    expect(back.items[id]).toBe(1)
  })

  it('computeStats folds a socketed gen relic and clamps', () => {
    const item = rollItem(424242, 70)
    const rpg = { ...defaultRpg(), items: { [item.id]: 1 }, relics: [item.id, null, null] as RpgData['relics'] }
    const s = computeStats(rpg)
    for (const [k, v] of Object.entries(item.mods ?? {})) {
      const key = k as keyof typeof BASE_STATS
      if (key === 'maxLatch' || key === 'maxHp' || key === 'pierceBonus') continue // int clamps
      expect(s[key]).toBeCloseTo(Math.min(2.5, BASE_STATS[key] + v), 6)
    }
  })

  it('pendingDrops and contracts round-trip through parseRpg', () => {
    const offers = rollOffers(99, 3, 10, 50)
    const rpg: RpgData = {
      ...defaultRpg(),
      pendingDrops: { quality: 50, offers },
      contracts: {
        counter: 4,
        slots: [{ seed: 123, level: 5, state: 'active', progress: 2 }, null, null],
      },
    }
    const back = parseRpg(JSON.stringify(rpg))
    expect(back.pendingDrops).toEqual(rpg.pendingDrops)
    expect(back.contracts).toEqual(rpg.contracts)
  })

  it('a v1 save without the new fields heals to defaults', () => {
    const legacy = { xp: 500, shards: 100, items: { 'feathered-ward': 1 } }
    const back = parseRpg(JSON.stringify(legacy))
    expect(back.pendingDrops).toBeNull()
    expect(back.contracts).toEqual({ counter: 0, slots: [null, null, null] })
    expect(back.items['feathered-ward']).toBe(1)
  })
})

describe('claimPendingDrop', () => {
  it('grants the chosen offer and clears the pending record', () => {
    const offers = rollOffers(7, 5, 30, 60)
    const rpg: RpgData = { ...defaultRpg(), pendingDrops: { quality: 60, offers } }
    const { next, ok } = claimPendingDrop(rpg, 1)
    expect(ok).toBe(true)
    expect(next.items[offers[1]]).toBe(1)
    expect(next.items[offers[0]]).toBeUndefined()
    expect(next.pendingDrops).toBeNull()
  })

  it('claiming a duplicate converts to shards via grantRewards', () => {
    const offers = rollOffers(7, 5, 30, 60)
    const item = getItem(offers[0])!
    const rpg: RpgData = {
      ...defaultRpg(),
      items: { [offers[0]]: 1 },
      pendingDrops: { quality: 60, offers },
    }
    const { next, ok } = claimPendingDrop(rpg, 0)
    expect(ok).toBe(true)
    expect(next.items[offers[0]]).toBe(1)
    expect(next.shards).toBe(duplicateRelicShards(item))
  })

  it('no-ops without a pending record', () => {
    const { ok } = claimPendingDrop(defaultRpg(), 0)
    expect(ok).toBe(false)
  })
})
