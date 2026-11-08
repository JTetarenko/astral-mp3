import { describe, expect, it } from 'vitest'
import { REALMS } from '../game/realms'
import { GATE_STYLES, gateGlyph, gateStyleForDepth, RUNE_GLYPHS } from './runeAtlas'

describe('GATE_STYLES', () => {
  it('one style per realm; strides coprime with the atlas size', () => {
    expect(GATE_STYLES.length).toBe(REALMS.length)
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
    for (const s of GATE_STYLES) {
      expect(gcd(s.stride, RUNE_GLYPHS)).toBe(1)
      expect(s.offset).toBeGreaterThanOrEqual(0)
      expect(s.offset).toBeLessThan(RUNE_GLYPHS)
      for (const m of s.spinMult) expect(Number.isFinite(m)).toBe(true)
      for (const t of s.tiltAdd) expect(Math.abs(t)).toBeLessThanOrEqual(0.4)
    }
  })

  it('every realm walks all 12 glyphs in a distinct order', () => {
    const orders = new Set<string>()
    for (let d = 0; d < 6; d++) {
      const seq = Array.from({ length: RUNE_GLYPHS }, (_, i) => gateGlyph(d, i))
      expect(new Set(seq).size).toBe(RUNE_GLYPHS)
      orders.add(seq.join(','))
    }
    expect(orders.size).toBe(6)
  })

  it('depth resolution wraps the ladder and survives odd inputs', () => {
    expect(gateStyleForDepth(6)).toBe(GATE_STYLES[0])
    expect(gateStyleForDepth(-2)).toBe(GATE_STYLES[0])
    expect(gateGlyph(3, 14)).toBe(gateGlyph(3, 2))
  })
})
