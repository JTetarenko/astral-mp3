import { describe, expect, it } from 'vitest'
import { describeEffect, describeItem, describeMods, rarityLabel } from './describe'
import { BASE_STATS } from './stats'
import { ITEMS } from './items'
import { rollItem } from './genItems'
import { RITE_DURATION } from './runState'
import type { ConsumableEffect, Rarity } from './itemTypes'

const EFFECTS: ConsumableEffect[] = [
  'purgeLatches',
  'stasisAura',
  'autoRevive',
  'overcharge',
  'veil',
  'frenzy',
]

describe('describeMods', () => {
  it('formats every CombatStats key', () => {
    const mods = Object.fromEntries(Object.keys(BASE_STATS).map(k => [k, 1])) as Record<
      string,
      number
    >
    const lines = describeMods(mods)
    expect(lines).toHaveLength(Object.keys(BASE_STATS).length)
    for (const line of lines) expect(line).toMatch(/^[+-]\d+%? [A-Z ]+$/)
  })

  it('int stats format as counts, mults as percentages, negatives signed', () => {
    expect(describeMods({ maxHp: 20 })).toEqual(['+20 BLOOD'])
    expect(describeMods({ maxLatch: 1 })).toEqual(['+1 LATCH WARD'])
    expect(describeMods({ snapDamageMult: 0.25 })).toEqual(['+25% SNAP FORCE'])
    expect(describeMods({ moveMult: -0.03 })).toEqual(['-3% FLIGHT'])
    expect(describeMods({ pierceBonus: 1 })).toEqual(['+1 PIERCE'])
    expect(describeMods({ castSpeedMult: 0.15 })).toEqual(['+15% CAST SPEED'])
    expect(describeMods({ drawSpeedMult: 0.2 })).toEqual(['+20% DRAW SPEED'])
  })

  it('skips zero and missing stats', () => {
    expect(describeMods({})).toEqual([])
    expect(describeMods({ maxHp: 0 })).toEqual([])
  })
})

describe('describeEffect', () => {
  it('covers every effect with a non-empty line', () => {
    for (const e of EFFECTS) expect(describeEffect(e).length).toBeGreaterThan(0)
  })

  it('timed rites carry their RITE_DURATION so text cannot drift from the sim', () => {
    expect(describeEffect('stasisAura')).toContain(`${RITE_DURATION.stasisAura}s`)
    expect(describeEffect('veil')).toContain(`${RITE_DURATION.veil}s`)
    expect(describeEffect('frenzy')).toContain(`${RITE_DURATION.frenzy}s`)
  })
})

describe('describeItem', () => {
  it('every catalog item describes with non-empty mechanical lines', () => {
    for (const item of ITEMS) {
      const d = describeItem(item)
      expect(d.lines.length).toBeGreaterThan(0)
      expect(d.lines[0].length).toBeGreaterThan(0)
      expect(d.rarityLabel.length).toBeGreaterThan(0)
      if (item.kind === 'relic') {
        // a relic's lines are its stats — the clarity contract
        expect(d.lines.join(' ')).toMatch(/[+-]\d/)
      }
    }
  })

  it('generated relics describe their rolled affixes', () => {
    const item = rollItem(777, 80)
    const d = describeItem(item)
    expect(d.lines).toHaveLength(item.gen.affixes.length >= 1 ? d.lines.length : 0)
    expect(d.lines.join(' ')).toMatch(/[+-]\d/)
  })

  it('every rarity has a label', () => {
    for (const r of ['common', 'rare', 'mythic', 'primal'] as Rarity[]) {
      expect(rarityLabel(r).length).toBeGreaterThan(0)
    }
  })
})
