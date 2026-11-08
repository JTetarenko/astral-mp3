import { describe, expect, it } from 'vitest'
import { duplicateRelicShards, getItem, ITEMS, ITEMS_BY_ID, WARDEN_DROPS } from './items'
import { BASE_STATS } from './stats'
import { REALMS } from './realms'

/** Mirror of scene/runeAtlas ATLAS_COLS x ATLAS_ROWS (4x3) — kept literal so
 * game tests never import a three-touching scene module. */
const ATLAS_CELLS = 12

describe('ITEMS catalog', () => {
  it('has unique ids and the lookup map covers all of them', () => {
    const ids = ITEMS.map(i => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(ITEMS_BY_ID[id]).toBeDefined()
    expect(getItem('nope')).toBeNull()
  })

  it('every relic has mods whose keys are CombatStats fields, finite and nonzero', () => {
    const statKeys = new Set(Object.keys(BASE_STATS))
    for (const item of ITEMS.filter(i => i.kind === 'relic')) {
      expect(item.mods).toBeDefined()
      const entries = Object.entries(item.mods!)
      expect(entries.length).toBeGreaterThan(0)
      for (const [k, v] of entries) {
        expect(statKeys.has(k)).toBe(true)
        expect(Number.isFinite(v)).toBe(true)
        expect(v).not.toBe(0)
      }
      expect(item.effect).toBeUndefined()
    }
  })

  it('every consumable has an effect and no mods', () => {
    for (const item of ITEMS.filter(i => i.kind === 'consumable')) {
      expect(item.effect).toBeDefined()
      expect(item.mods).toBeUndefined()
    }
  })

  it('trophies are unsellable proof pieces (price 0, no mods/effects)', () => {
    const trophies = ITEMS.filter(i => i.kind === 'trophy')
    expect(trophies.length).toBe(6)
    for (const t of trophies) {
      expect(t.price).toBe(0)
      expect(t.mods).toBeUndefined()
      expect(t.effect).toBeUndefined()
    }
  })

  it('shop prices are positive for everything Elara sells', () => {
    for (const item of ITEMS) {
      expect(Number.isFinite(item.price)).toBe(true)
      expect(item.price).toBeGreaterThanOrEqual(0)
    }
    // at least the commons must be purchasable
    expect(ITEMS.filter(i => i.price > 0).length).toBeGreaterThanOrEqual(10)
  })

  it('glyph indices stay inside the rune atlas', () => {
    for (const item of ITEMS) {
      expect(Number.isInteger(item.glyph)).toBe(true)
      expect(item.glyph).toBeGreaterThanOrEqual(0)
      expect(item.glyph).toBeLessThan(ATLAS_CELLS)
    }
  })

  it('every item carries voice: name, flavor, source', () => {
    for (const item of ITEMS) {
      expect(item.name.length).toBeGreaterThan(2)
      expect(item.flavor.length).toBeGreaterThan(10)
      expect(item.source.length).toBeGreaterThan(2)
    }
  })
})

describe('WARDEN_DROPS', () => {
  it('covers every realm warden with valid item refs and chances', () => {
    for (const realm of REALMS) {
      const table = WARDEN_DROPS[`warden:${realm.id}`]
      expect(table).toBeDefined()
      expect(table.length).toBeGreaterThanOrEqual(2)
      for (const roll of table) {
        expect(ITEMS_BY_ID[roll.itemId]).toBeDefined()
        expect(roll.chance).toBeGreaterThan(0)
        expect(roll.chance).toBeLessThanOrEqual(1)
      }
      // the trophy is a guaranteed drop
      const guaranteed = table.filter(r => r.chance === 1)
      expect(guaranteed.some(r => ITEMS_BY_ID[r.itemId].kind === 'trophy')).toBe(true)
    }
  })

  it('has no tables for keys outside the warden set', () => {
    for (const key of Object.keys(WARDEN_DROPS)) {
      expect(key.startsWith('warden:')).toBe(true)
      expect(REALMS.some(r => `warden:${r.id}` === key)).toBe(true)
    }
  })
})

describe('duplicateRelicShards', () => {
  it('pays half price with a 40-shard floor', () => {
    expect(duplicateRelicShards(ITEMS_BY_ID['wardens-fang'])).toBe(90)
    expect(duplicateRelicShards(ITEMS_BY_ID['gravemoss-crown'])).toBe(40) // price 0
  })
})
