import { describe, expect, it } from 'vitest'
import { REALMS } from '../game/realms'
import { PK } from './burstVocab'
import { AMBIENT_RECIPES, ambientRecipeForDepth, ambientStyleForSlot } from './ambientVocab'

const CELLS = new Set<number>(Object.values(PK))

describe('AMBIENT_RECIPES', () => {
  it('covers the ladder; fracs sum to 1; cells and params sane', () => {
    expect(AMBIENT_RECIPES.length).toBe(REALMS.length)
    for (let i = 0; i < AMBIENT_RECIPES.length; i++) {
      const r = AMBIENT_RECIPES[i]
      expect(r.id).toBe(REALMS[i].id)
      expect(CELLS.has(r.fallCell)).toBe(true)
      const sum = r.styles.reduce((a, s) => a + s.frac, 0)
      expect(Math.abs(sum - 1)).toBeLessThan(1e-9)
      for (const s of r.styles) {
        expect(CELLS.has(s.cell)).toBe(true)
        expect(s.sizeMin).toBeGreaterThan(0)
        expect(s.blinkDepth).toBeGreaterThanOrEqual(0)
        expect(s.blinkDepth).toBeLessThanOrEqual(1)
        expect(s.bright).toBeGreaterThan(0)
        expect(Number.isFinite(s.settleMult)).toBe(true)
      }
    }
  })

  it('rising-against-the-realm settle exists only where intended', () => {
    for (const r of AMBIENT_RECIPES) {
      for (const s of r.styles) {
        if (s.settleMult < 0) expect(r.id).toBe('cathedral')
      }
    }
  })

  it('the WISP cell finally earns its bake', () => {
    const usesWisp = AMBIENT_RECIPES.some(
      r => r.fallCell === PK.WISP || r.styles.some(s => s.cell === PK.WISP),
    )
    expect(usesWisp).toBe(true)
  })
})

describe('ambientStyleForSlot', () => {
  it('partitions slots to within one slot of frac x total, stable and pure', () => {
    for (const r of AMBIENT_RECIPES) {
      const counts = new Map<number, number>()
      const TOTAL = 400
      for (let i = 0; i < TOTAL; i++) {
        const a = ambientStyleForSlot(r, i, TOTAL)
        const b = ambientStyleForSlot(r, i, TOTAL)
        expect(a).toBe(b)
        counts.set(r.styles.indexOf(a), (counts.get(r.styles.indexOf(a)) ?? 0) + 1)
      }
      for (let si = 0; si < r.styles.length; si++) {
        const want = r.styles[si].frac * TOTAL
        expect(Math.abs((counts.get(si) ?? 0) - want)).toBeLessThanOrEqual(1)
      }
    }
  })

  it('resolves by depth with ladder wrap', () => {
    expect(ambientRecipeForDepth(0).id).toBe('astral')
    expect(ambientRecipeForDepth(7).id).toBe('jungle')
    expect(ambientRecipeForDepth(-1).id).toBe('astral')
  })
})
