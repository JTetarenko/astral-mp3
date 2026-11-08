import { describe, expect, it } from 'vitest'
import { BURST, BURST_STYLES, cellOffset, hexToRgb, PK, ROLE, ROLE_COUNT, styleTint } from './burstVocab'

describe('burstVocab', () => {
  it('every BURST id resolves to a style (dense table)', () => {
    const ids = Object.values(BURST)
    expect(BURST_STYLES.length).toBe(Math.max(...ids) + 1)
    for (const id of ids) expect(BURST_STYLES[id]).toBeDefined()
  })

  it('GENERIC is byte-for-byte the legacy spawnBurst defaults (parity ratchet)', () => {
    const g = BURST_STYLES[BURST.GENERIC]
    expect(g).toMatchObject({
      cell: PK.GLOW,
      whiteMix: 0,
      bright: 1.8,
      speedMin: 2,
      speedVar: 4,
      lifeMin: 1.2,
      lifeVar: 0.6,
      sizeMin: 0.9,
      sizeVar: 0.4,
      grav: 0,
    })
  })

  it('NOVA is byte-for-byte the legacy drop-nova call (parity ratchet)', () => {
    const n = BURST_STYLES[BURST.NOVA]
    expect(n).toMatchObject({ speedMin: 6, speedVar: 8, lifeMin: 1.6, lifeVar: 0.8, grav: 0 })
  })

  it('all styles carry pool-safe finite ranges', () => {
    for (const s of BURST_STYLES) {
      for (const v of Object.values(s)) {
        expect(Number.isFinite(v)).toBe(true)
      }
      expect(s.speedMin).toBeGreaterThan(0)
      expect(s.speedVar).toBeGreaterThanOrEqual(0)
      expect(s.lifeMin).toBeGreaterThan(0)
      expect(s.lifeVar).toBeGreaterThanOrEqual(0)
      expect(s.sizeMin).toBeGreaterThan(0)
      expect(s.whiteMix).toBeGreaterThanOrEqual(0)
      expect(s.whiteMix).toBeLessThanOrEqual(1)
      expect(s.bright).toBeGreaterThan(0)
      expect(Object.values(PK)).toContain(s.cell)
      expect(s.role).toBeGreaterThanOrEqual(0)
      expect(s.role).toBeLessThan(ROLE_COUNT)
    }
  })

  it('bow styles rise: assembly twinkles drift up, storm shards rush up harder', () => {
    const a = BURST_STYLES[BURST.BOW_ASSEMBLE]
    const s = BURST_STYLES[BURST.STORM]
    expect(a.grav).toBeLessThan(0)
    expect(s.grav).toBeLessThan(a.grav)
    expect(s.speedMin).toBeGreaterThan(a.speedMin)
  })

  it('cellOffset matches the shader formula and is unique per kind', () => {
    const seen = new Set<string>()
    for (const k of Object.values(PK)) {
      const [u, v] = cellOffset(k)
      expect([0, 0.5]).toContain(u)
      expect([0, 0.5]).toContain(v)
      seen.add(`${u},${v}`)
    }
    expect(seen.size).toBe(4)
  })

  it('hexToRgb parses channels', () => {
    const out = new Float32Array(9)
    hexToRgb('#ffffff', out, 0)
    hexToRgb('#000000', out, 3)
    hexToRgb('#ff8000', out, 6)
    expect(Array.from(out.slice(0, 3))).toEqual([1, 1, 1])
    expect(Array.from(out.slice(3, 6))).toEqual([0, 0, 0])
    expect(out[6]).toBe(1)
    expect(out[7]).toBeCloseTo(0x80 / 255, 5)
    expect(out[8]).toBe(0)
  })

  it('styleTint lerps toward white and folds bright in', () => {
    const roles = new Float32Array(ROLE_COUNT * 3)
    roles.set([1, 1, 1], ROLE.WHITE * 3)
    roles.set([0.2, 0.4, 0.6], ROLE.RUNE * 3)
    const out = new Float32Array(3)
    styleTint({ ...BURST_STYLES[BURST.BOLT_HIT], role: ROLE.WHITE, whiteMix: 0, bright: 2 }, roles, out, 0)
    expect(Array.from(out)).toEqual([2, 2, 2])
    styleTint({ ...BURST_STYLES[BURST.SOUL], role: ROLE.RUNE, whiteMix: 1, bright: 1 }, roles, out, 0)
    expect(Array.from(out)).toEqual([1, 1, 1])
    styleTint({ ...BURST_STYLES[BURST.SOUL], role: ROLE.RUNE, whiteMix: 0.5, bright: 1 }, roles, out, 0)
    expect(out[0]).toBeCloseTo(0.6, 5)
    expect(out[1]).toBeCloseTo(0.7, 5)
    expect(out[2]).toBeCloseTo(0.8, 5)
  })
})
