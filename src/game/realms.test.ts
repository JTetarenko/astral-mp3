import { describe, expect, it } from 'vitest'
import { getRealmForDepth, NEUTRAL_MODS, REALMS, shiftBonus, shiftCostForDepth } from './realms'
import { getPalette, PALETTES } from '../theme/palettes'

describe('REALMS', () => {
  it('has the 6-realm descent ladder in concept order', () => {
    expect(REALMS.map(r => r.id)).toEqual([
      'astral',
      'jungle',
      'cathedral',
      'ritual',
      'collapse',
      'lavacore',
    ])
  })

  it('every paletteId resolves to a real palette (not the fallback)', () => {
    for (const r of REALMS) {
      expect(PALETTES.some(p => p.id === r.paletteId)).toBe(true)
      expect(getPalette(r.paletteId).id).toBe(r.paletteId)
    }
    // the gilded loop variant too
    expect(getPalette('ashGold').id).toBe('ashGold')
  })

  it('lavacore embers rise (fallDir -1); all others fall', () => {
    for (const r of REALMS) {
      expect(r.mods.fallDir).toBe(r.id === 'lavacore' ? -1 : 1)
    }
  })
})

describe('getRealmForDepth', () => {
  it('cycles the ladder across loops', () => {
    for (let d = 0; d < 18; d++) {
      const { realm, loop } = getRealmForDepth(d)
      expect(realm.id).toBe(REALMS[d % 6].id)
      expect(loop).toBe(Math.floor(d / 6))
    }
  })

  it('loop 0 mods are the untouched realm mods', () => {
    for (let d = 0; d < 6; d++) {
      expect(getRealmForDepth(d).mods).toEqual(REALMS[d].mods)
    }
  })

  it('gilds each loop entry: ashGold at depths 6 and 12, never at 0', () => {
    expect(getRealmForDepth(0).paletteId).toBe('ritualVoid')
    expect(getRealmForDepth(6).paletteId).toBe('ashGold')
    expect(getRealmForDepth(12).paletteId).toBe('ashGold')
    expect(getRealmForDepth(7).paletteId).toBe(REALMS[1].paletteId)
  })

  it('escalates monotonically with loop and caps at loop 3', () => {
    const d0 = getRealmForDepth(0).mods // astral loop 0
    const d6 = getRealmForDepth(6).mods // loop 1
    const d12 = getRealmForDepth(12).mods // loop 2
    const d18 = getRealmForDepth(18).mods // loop 3
    const d24 = getRealmForDepth(24).mods // loop 4 -> capped at 3
    expect(d6.islandDensity).toBeGreaterThan(d0.islandDensity)
    expect(d12.fallRateMult).toBeGreaterThan(d6.fallRateMult)
    expect(d18.tripBias).toBeGreaterThan(d12.tripBias)
    expect(d24).toEqual(d18)
    expect(d18.debrisFloor).toBeLessThanOrEqual(0.5)
  })

  it('never mutates the registry', () => {
    const before = JSON.stringify(REALMS)
    getRealmForDepth(13)
    getRealmForDepth(25)
    expect(JSON.stringify(REALMS)).toBe(before)
  })

  it('clamps negative/fractional depths', () => {
    expect(getRealmForDepth(-3).realm.id).toBe('astral')
    expect(getRealmForDepth(1.9).realm.id).toBe('jungle')
  })
})

describe('shiftCostForDepth', () => {
  it('escalates 6,8,10,12 then caps at 14', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(shiftCostForDepth)).toEqual([6, 8, 10, 12, 14, 14, 14])
  })
})

describe('shiftBonus', () => {
  it('scales with depth and pays 1.5x when hot', () => {
    expect(shiftBonus(0, false)).toBe(400)
    expect(shiftBonus(2, false)).toBe(1200)
    expect(shiftBonus(2, true)).toBe(1800)
  })
})

describe('NEUTRAL_MODS', () => {
  it('matches the base game feel (sink -3, everything at unity)', () => {
    expect(NEUTRAL_MODS.sinkRate).toBe(-3)
    expect(NEUTRAL_MODS.islandDensity).toBe(1)
    expect(NEUTRAL_MODS.fallDir).toBe(1)
    expect(NEUTRAL_MODS.debrisFloor).toBe(0)
  })

  it('fog medium mods default to unity and stay finite/positive per realm', () => {
    expect(NEUTRAL_MODS.fogDensityMult).toBe(1)
    expect(NEUTRAL_MODS.fogGlowMult).toBe(1)
    for (const r of REALMS) {
      expect(r.mods.fogDensityMult).toBeGreaterThan(0)
      expect(Number.isFinite(r.mods.fogDensityMult)).toBe(true)
      expect(r.mods.fogGlowMult).toBeGreaterThan(0)
      expect(Number.isFinite(r.mods.fogGlowMult)).toBe(true)
    }
  })

  it('horror pressure mods default to unity and stay finite/positive per realm', () => {
    expect(NEUTRAL_MODS.enemyDensity).toBe(1)
    expect(NEUTRAL_MODS.enemyAggroMult).toBe(1)
    expect(NEUTRAL_MODS.enemySpeedMult).toBe(1)
    expect(NEUTRAL_MODS.wardenHpMult).toBe(1)
    for (const r of REALMS) {
      for (const k of ['enemyDensity', 'enemyAggroMult', 'enemySpeedMult', 'wardenHpMult'] as const) {
        expect(r.mods[k]).toBeGreaterThan(0)
        expect(Number.isFinite(r.mods[k])).toBe(true)
      }
    }
  })

  it('dressing density defaults to unity, stays finite, jungle densest', () => {
    expect(NEUTRAL_MODS.dressingDensity).toBe(1)
    for (const r of REALMS) {
      expect(r.mods.dressingDensity).toBeGreaterThan(0)
      expect(Number.isFinite(r.mods.dressingDensity)).toBe(true)
      expect(r.mods.dressingDensity).toBeLessThanOrEqual(
        REALMS.find(x => x.id === 'jungle')!.mods.dressingDensity,
      )
    }
  })

  it('lavacore is the hungriest realm; astral the gentlest', () => {
    const byId = new Map(REALMS.map(r => [r.id, r.mods]))
    for (const r of REALMS) {
      if (r.id === 'lavacore') continue
      expect(byId.get('lavacore')!.enemyDensity).toBeGreaterThanOrEqual(r.mods.enemyDensity)
      expect(byId.get('astral')!.enemyDensity).toBeLessThanOrEqual(r.mods.enemyDensity)
    }
  })
})

describe('horror pressure escalation', () => {
  it('escalates enemy mods per loop and caps at loop 3', () => {
    const d0 = getRealmForDepth(0).mods
    const d6 = getRealmForDepth(6).mods
    const d12 = getRealmForDepth(12).mods
    const d18 = getRealmForDepth(18).mods
    const d24 = getRealmForDepth(24).mods
    expect(d6.enemyDensity).toBeGreaterThan(d0.enemyDensity)
    expect(d12.enemyAggroMult).toBeGreaterThan(d6.enemyAggroMult)
    expect(d18.wardenHpMult).toBeGreaterThan(d12.wardenHpMult)
    expect(d12.enemySpeedMult).toBeGreaterThan(d6.enemySpeedMult)
    expect(d24).toEqual(d18)
  })
})
