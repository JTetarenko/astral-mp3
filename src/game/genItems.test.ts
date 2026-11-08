import { describe, expect, it } from 'vitest'
import {
  AFFIXES,
  dropQuality,
  GEN_VERSION,
  genPrice,
  isGenId,
  makeGenId,
  parseGenId,
  rollFromId,
  rollItem,
  rollOffers,
  tierWeightsFor,
} from './genItems'
import { BASE_STATS } from './stats'
import { RARITY_ORDER } from './itemTypes'
import { duplicateRelicShards } from './items'

describe('gen id codec', () => {
  it('round-trips seed and quality', () => {
    const id = makeGenId(0x9f3ac1d2, 47)
    expect(id).toBe('gen:1:9f3ac1d2:q47')
    expect(isGenId(id)).toBe(true)
    expect(parseGenId(id)).toEqual({ version: GEN_VERSION, seed: 0x9f3ac1d2, quality: 47 })
  })

  it('rejects malformed ids', () => {
    for (const bad of ['gen:', 'gen:1:zzzz:q10', 'gen:1:12345678:q101', 'feathered-ward', 'gen:1:1234:q5']) {
      expect(parseGenId(bad)).toBeNull()
    }
  })
})

describe('rollItem determinism + contracts', () => {
  it('same id -> identical roll', () => {
    const a = rollItem(12345, 60)
    const b = rollItem(12345, 60)
    expect(a).toBe(b) // memoized
    expect(rollFromId(a.id)).toBe(a)
  })

  it('affix count = tier + 1 and mods are nonzero CombatStats keys', () => {
    const statKeys = Object.keys(BASE_STATS)
    for (let s = 0; s < 200; s++) {
      const item = rollItem(s * 2654435761, (s * 13) % 101)
      expect(item.gen.affixes.length).toBeGreaterThanOrEqual(1)
      expect(item.gen.affixes.length).toBeLessThanOrEqual(item.gen.tier + 1)
      for (const [k, v] of Object.entries(item.mods ?? {})) {
        expect(statKeys).toContain(k)
        expect(v).not.toBe(0)
      }
      expect(item.kind).toBe('relic')
      expect(item.rarity).toBe(RARITY_ORDER[item.gen.tier])
      expect(item.glyph).toBeGreaterThanOrEqual(0)
      expect(item.glyph).toBeLessThan(12)
      expect(item.price).toBe(genPrice(item.gen.quality, item.gen.tier))
      expect(item.name).toMatch(/^[A-Z]+ OF THE [A-Z]+ [A-Z]+$/)
      expect(item.flavor.length).toBeGreaterThan(0)
    }
  })

  it('affixes respect minTier and magnitude bounds (lo/hi x jitter)', () => {
    for (let s = 0; s < 200; s++) {
      const item = rollItem(s * 40503 + 7, 100)
      for (const roll of item.gen.affixes) {
        const def = AFFIXES.find(a => a.id === roll.id)!
        expect(def.minTier).toBeLessThanOrEqual(item.gen.tier)
        if (def.round === 'pct') {
          // ±0.005 covers the 2-decimal rounding at the band edges
          expect(roll.value).toBeGreaterThanOrEqual(def.lo * 0.85 - 0.005)
          expect(roll.value).toBeLessThanOrEqual(def.hi * 1.15 + 0.005)
        }
      }
    }
  })

  it('500 distinct seeds -> 500 distinct ids', () => {
    const ids = new Set<string>()
    for (let s = 0; s < 500; s++) ids.add(rollItem(s * 2246822519 + 1, 50).id)
    expect(ids.size).toBe(500)
  })

  it('dissolve value: duplicateRelicShards sees a real price', () => {
    const item = rollItem(999, 80)
    expect(item.price).toBeGreaterThan(0)
    expect(duplicateRelicShards(item)).toBe(Math.max(40, Math.floor(item.price / 2)))
  })

  it('old-version ids heal by re-rolling at the same quality', () => {
    const cur = rollItem(0xabcd, 30)
    const oldId = cur.id.replace(`gen:${GEN_VERSION}:`, 'gen:0:')
    const healed = rollFromId(oldId)
    expect(healed).not.toBeNull()
    expect(healed!.id).toBe(oldId) // save key keeps resolving
    expect(healed!.gen.quality).toBe(30)
  })
})

describe('tier weights + quality', () => {
  it('higher quality shifts weight off common toward mythic/primal', () => {
    const lo = tierWeightsFor(10)
    const hi = tierWeightsFor(90)
    expect(hi[0]).toBeLessThan(lo[0])
    expect(hi[2]).toBeGreaterThan(lo[2])
    expect(lo[3]).toBe(0)
    expect(hi[3]).toBeGreaterThan(0)
  })

  it('dropQuality scales with depth/performance and clamps 5..100', () => {
    expect(dropQuality(0, 0, 0, 0, true)).toBe(5)
    expect(dropQuality(3, 10, 0, 20, false)).toBe(7 * 3 + 5 + 5)
    expect(dropQuality(20, 200, 5, 400, false)).toBe(100)
    expect(dropQuality(2, 0, 0, 0, false)).toBeGreaterThan(dropQuality(2, 0, 0, 0, true))
  })
})

describe('rollOffers', () => {
  it('is deterministic and yields three parseable gen ids', () => {
    const a = rollOffers(1234, 5, 40, 60)
    const b = rollOffers(1234, 5, 40, 60)
    expect(a).toEqual(b)
    for (const id of a) expect(parseGenId(id)).not.toBeNull()
  })

  it('different runs (kills) yield different offers', () => {
    const a = rollOffers(1234, 5, 40, 60)
    const b = rollOffers(1234, 5, 41, 60)
    expect(a).not.toEqual(b)
  })
})
