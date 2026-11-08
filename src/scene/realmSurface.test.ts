import { describe, expect, it } from 'vitest'
import { REALMS } from '../game/realms'
import { SURFACE_IDENTITIES, surfaceForDepth, VEIN_TEXTURES } from './realmSurface'

describe('SURFACE_IDENTITIES', () => {
  it('covers the ladder; every vein texture comes from the preload set', () => {
    expect(SURFACE_IDENTITIES.length).toBe(REALMS.length)
    for (const s of SURFACE_IDENTITIES) {
      expect(VEIN_TEXTURES).toContain(s.veinTex)
      expect(s.veinGain).toBeGreaterThan(0)
      expect(s.veinGain).toBeLessThanOrEqual(2)
      for (const v of [s.up, s.down, s.sparkle, s.surfWhiteMix]) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(2)
      }
      expect(s.surfScale).toBeGreaterThan(0)
      expect(s.surfScale).toBeLessThanOrEqual(2)
    }
  })

  it('astral and ritual reuse the baked ritual script', () => {
    expect(SURFACE_IDENTITIES[0].veinTex).toBe('rune_emissive')
    expect(SURFACE_IDENTITIES[3].veinTex).toBe('rune_emissive')
  })

  it('lavacore is the only realm whose underglow reaches HDR bloom', () => {
    for (let i = 0; i < SURFACE_IDENTITIES.length; i++) {
      expect(SURFACE_IDENTITIES[i].down >= 1).toBe(i === 5)
    }
  })

  it('loop re-entry keeps astral behavior (palette carries the gilding)', () => {
    expect(surfaceForDepth(6)).toBe(surfaceForDepth(0))
    expect(surfaceForDepth(11)).toBe(SURFACE_IDENTITIES[5])
  })
})
