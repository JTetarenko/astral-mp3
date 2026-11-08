import { describe, expect, it } from 'vitest'
import { REALMS } from '../game/realms'
import {
  buildLandmarkOrbit,
  LANDMARK_CORE_BUILDERS,
  LANDMARK_CORE_TRI_BUDGET,
  LANDMARK_DIST_MIN,
  LANDMARK_DIST_SPAN,
  LANDMARK_FAR_SAFE,
  LANDMARK_ORBIT_TRI_BUDGET,
  LANDMARK_PARALLAX_CAP,
  LANDMARK_VISUALS,
  landmarkPlacement,
} from './landmarkGeom'
import type { TriSoup } from './wingGeom'

function expectValidSoup(soup: TriSoup): void {
  expect(soup.positions.length % 9).toBe(0)
  expect(soup.along.length).toBe(soup.positions.length / 3)
  expect(soup.glow.length).toBe(soup.positions.length / 3)
  for (let i = 0; i < soup.positions.length; i++) {
    expect(Number.isFinite(soup.positions[i])).toBe(true)
  }
}

function maxRadius(soup: TriSoup): number {
  let r = 0
  for (let i = 0; i < soup.positions.length; i += 3) {
    r = Math.max(r, Math.hypot(soup.positions[i], soup.positions[i + 2]))
  }
  return r
}

const SEEDS = [3, 20260728, 909090]

describe('landmark core builders', () => {
  it('every realm x seed: valid, in-budget, unit-height, glow-restrained', () => {
    for (let idx = 0; idx < LANDMARK_CORE_BUILDERS.length; idx++) {
      const id = LANDMARK_VISUALS[idx].id
      for (const seed of SEEDS) {
        const soup = LANDMARK_CORE_BUILDERS[idx](seed)
        expectValidSoup(soup)
        expect(soup.positions.length / 9, `${id} tris`).toBeLessThanOrEqual(LANDMARK_CORE_TRI_BUDGET)
        let minY = Infinity
        let maxY = -Infinity
        for (let i = 1; i < soup.positions.length; i += 3) {
          minY = Math.min(minY, soup.positions[i])
          maxY = Math.max(maxY, soup.positions[i])
        }
        expect(minY, `${id} base`).toBeGreaterThanOrEqual(-1e-6)
        expect(maxY, `${id} top`).toBeLessThanOrEqual(1 + 1e-6)
        let present = 0
        let lit = 0
        for (const g of soup.glow) {
          expect(g).toBeGreaterThanOrEqual(0)
          expect(g).toBeLessThanOrEqual(1)
          if (g > 0) present++
          if (g >= 0.5) lit++
        }
        expect(present, `${id} has an emissive accent`).toBeGreaterThan(0)
        // the shattered planet's burning core IS the identity — higher cap
        const cap = id === 'collapse' ? 0.45 : 0.3
        expect(lit / soup.glow.length, `${id} restraint`).toBeLessThan(cap)
      }
    }
  })

  it('is deterministic per seed', () => {
    for (let idx = 0; idx < LANDMARK_CORE_BUILDERS.length; idx++) {
      const a = LANDMARK_CORE_BUILDERS[idx](1234)
      const b = LANDMARK_CORE_BUILDERS[idx](1234)
      expect(Array.from(a.positions)).toEqual(Array.from(b.positions))
      expect(Array.from(a.glow)).toEqual(Array.from(b.glow))
    }
  })
})

describe('landmark orbit builders', () => {
  it('exists exactly where the spec declares one, valid and in-budget', () => {
    for (let idx = 0; idx < LANDMARK_VISUALS.length; idx++) {
      const soup = buildLandmarkOrbit(idx, 777)
      if (LANDMARK_VISUALS[idx].orbit) {
        expect(soup).not.toBeNull()
        expectValidSoup(soup!)
        expect(soup!.positions.length / 9).toBeLessThanOrEqual(LANDMARK_ORBIT_TRI_BUDGET)
        for (const g of soup!.glow) {
          expect(g).toBeGreaterThanOrEqual(0)
          expect(g).toBeLessThanOrEqual(1)
        }
      } else {
        expect(soup).toBeNull()
      }
    }
  })
})

describe('LANDMARK_VISUALS', () => {
  it('aligns 1:1 with the realm ladder', () => {
    expect(LANDMARK_VISUALS.length).toBe(REALMS.length)
    for (let i = 0; i < REALMS.length; i++) {
      expect(LANDMARK_VISUALS[i].id).toBe(REALMS[i].id)
    }
  })

  it('no corner can cross the camera far plane at max placement', () => {
    const worstDist = LANDMARK_DIST_MIN + LANDMARK_DIST_SPAN + LANDMARK_PARALLAX_CAP
    for (let idx = 0; idx < LANDMARK_VISUALS.length; idx++) {
      const spec = LANDMARK_VISUALS[idx]
      const h = spec.height * 1.08 // max scaleJitter
      let horiz = maxRadius(LANDMARK_CORE_BUILDERS[idx](3)) * h
      const orbit = buildLandmarkOrbit(idx, 3)
      if (orbit && spec.orbit) {
        horiz = Math.max(horiz, maxRadius(orbit) * spec.orbit.radiusFrac * h)
      }
      const topY = spec.baseY + h
      const far = Math.hypot(worstDist + horiz, Math.max(Math.abs(topY), Math.abs(spec.baseY)))
      expect(far, `${spec.id} far-plane margin`).toBeLessThanOrEqual(LANDMARK_FAR_SAFE)
    }
  })
})

describe('landmarkPlacement', () => {
  it('is deterministic, window-bounded, and clears the Eclipse berth', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (let depth = 0; depth < 6; depth++) {
        const a = landmarkPlacement(seed * 7919, depth)
        const b = landmarkPlacement(seed * 7919, depth)
        expect(a).toEqual(b)
        expect(a.dist).toBeGreaterThanOrEqual(LANDMARK_DIST_MIN)
        expect(a.dist).toBeLessThanOrEqual(LANDMARK_DIST_MIN + LANDMARK_DIST_SPAN)
        expect(a.scaleJitter).toBeGreaterThanOrEqual(0.92)
        expect(a.scaleJitter).toBeLessThanOrEqual(1.08)
        const d = Math.abs(a.azimuth - Math.PI)
        expect(Math.min(d, Math.PI * 2 - d)).toBeGreaterThanOrEqual(0.65 - 1e-9)
      }
    }
  })

  it('moves the hero between descents', () => {
    const octants = new Set<number>()
    for (let depth = 0; depth < 6; depth++) {
      octants.add(Math.floor((landmarkPlacement(123456, depth).azimuth / (Math.PI * 2)) * 8))
    }
    expect(octants.size).toBeGreaterThanOrEqual(2)
  })
})
