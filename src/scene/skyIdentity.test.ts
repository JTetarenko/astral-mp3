import { describe, expect, it } from 'vitest'
import { REALMS } from '../game/realms'
import { SKY_IDENTITIES, SKY_IDENTITY_GILDED, skyIdentityForDepth } from './skyIdentity'

describe('SKY_IDENTITIES', () => {
  it('covers the realm ladder with sane windows', () => {
    expect(SKY_IDENTITIES.length).toBe(REALMS.length)
    for (const s of SKY_IDENTITIES) {
      if (s.feature !== null) {
        expect(['sky_canopy', 'sky_cracks', 'sky_vortex']).toContain(s.feature)
        expect(s.tintScale).toBeGreaterThan(0)
        expect(s.tintScale).toBeLessThanOrEqual(1)
      }
      expect(s.opacity).toBeGreaterThan(0)
      expect(s.opacity).toBeLessThanOrEqual(1)
      for (const g of [s.starGain, s.mistGain, s.nebBGain]) {
        expect(g).toBeGreaterThanOrEqual(0.3)
        expect(g).toBeLessThanOrEqual(1.6)
      }
      expect(Number.isFinite(s.featureSpin)).toBe(true)
      expect(s.audioGain).toBeGreaterThanOrEqual(0)
      expect(s.audioGain).toBeLessThanOrEqual(0.6)
    }
  })

  it('astral hides the shell; jungle is the only normal-blend entry', () => {
    expect(SKY_IDENTITIES[0].feature).toBeNull()
    for (let i = 0; i < SKY_IDENTITIES.length; i++) {
      expect(SKY_IDENTITIES[i].blend === 'normal').toBe(i === 1)
    }
    expect(SKY_IDENTITY_GILDED.blend).toBe('add')
  })
})

describe('skyIdentityForDepth', () => {
  it('resolves the ladder and gilds only loop re-entries', () => {
    for (let d = 0; d < 6; d++) {
      expect(skyIdentityForDepth(d)).toBe(SKY_IDENTITIES[d])
    }
    expect(skyIdentityForDepth(6)).toBe(SKY_IDENTITY_GILDED)
    expect(skyIdentityForDepth(12)).toBe(SKY_IDENTITY_GILDED)
    expect(skyIdentityForDepth(7)).toBe(SKY_IDENTITIES[1])
    expect(skyIdentityForDepth(-2)).toBe(SKY_IDENTITIES[0])
  })
})
