import { describe, expect, it } from 'vitest'
import {
  BODY_DIM,
  CRACK_BRIGHT,
  crackPlanesForVariant,
  crackValue,
  CRYSTAL_VARIANTS,
  crystalVariantSeed,
  pickCrystalVariant,
} from './crystalGeom'

describe('crackPlanesForVariant', () => {
  it('is deterministic and yields unit normals', () => {
    for (let v = 0; v < CRYSTAL_VARIANTS; v++) {
      const a = crackPlanesForVariant(v)
      const b = crackPlanesForVariant(v)
      expect(a).toEqual(b)
      for (const [nx, ny, nz] of a) {
        expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 6)
      }
    }
  })

  it('distinct variants get distinct planes', () => {
    const keys = new Set(
      Array.from({ length: CRYSTAL_VARIANTS }, (_, v) => JSON.stringify(crackPlanesForVariant(v))),
    )
    expect(keys.size).toBe(CRYSTAL_VARIANTS)
  })
})

describe('crackValue', () => {
  const planes = crackPlanesForVariant(0)

  it('is symmetric through the origin (|dot| classification)', () => {
    for (const p of [
      [0.3, 0.7, -0.2],
      [0.9, -0.1, 0.4],
      [-0.5, 0.5, 0.5],
    ]) {
      expect(crackValue(p[0], p[1], p[2], planes)).toBe(
        crackValue(-p[0], -p[1], -p[2], planes),
      )
    }
  })

  it('points on a crack plane glow; points far from all planes stay dark', () => {
    // a point exactly on plane 0: any vector orthogonal to its normal
    const [nx, ny, nz] = planes[0]
    const ox = ny // cross([nx,ny,nz], [0,0,1]) = [ny, -nx, 0]
    const oy = -nx
    expect(crackValue(ox, oy, 0, planes)).toBe(CRACK_BRIGHT)
    // the plane normal itself is as far from the plane as it gets
    const away = crackValue(nx, ny, nz, [planes[0]])
    expect(away).toBe(BODY_DIM)
  })
})

describe('variant picking', () => {
  it('is stable for fixed (serial, slot)', () => {
    expect(crystalVariantSeed(42, 3)).toBe(crystalVariantSeed(42, 3))
    expect(pickCrystalVariant(crystalVariantSeed(42, 3))).toBe(
      pickCrystalVariant(crystalVariantSeed(42, 3)),
    )
  })

  it('spreads variants across serials', () => {
    const seen = new Set<number>()
    for (let serial = 0; serial < 24; serial++) {
      seen.add(pickCrystalVariant(crystalVariantSeed(serial, 1)))
    }
    expect(seen.size).toBeGreaterThan(1)
    for (const v of seen) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(CRYSTAL_VARIANTS)
    }
  })
})
