import { describe, expect, it } from 'vitest'
import { REALMS } from '../game/realms'
import {
  DRESSING_BUILDERS,
  DRESSING_MAX_PER_ISLAND,
  DRESSING_TRI_BUDGET,
  DRESSING_VISUALS,
  placeDressing,
  type DressingPiece,
} from './dressingGeom'
import type { TriSoup } from './wingGeom'

function expectValidSoup(soup: TriSoup): void {
  expect(soup.positions.length % 9).toBe(0)
  expect(soup.along.length).toBe(soup.positions.length / 3)
  expect(soup.glow.length).toBe(soup.positions.length / 3)
  for (let i = 0; i < soup.positions.length; i++) {
    expect(Number.isFinite(soup.positions[i])).toBe(true)
  }
}

/** Divergence-theorem signed volume: positive = outward winding. */
function signedVolume(soup: TriSoup): number {
  const p = soup.positions
  let v = 0
  for (let o = 0; o + 8 < p.length; o += 9) {
    v +=
      (p[o] * (p[o + 4] * p[o + 8] - p[o + 5] * p[o + 7]) -
        p[o + 1] * (p[o + 3] * p[o + 8] - p[o + 5] * p[o + 6]) +
        p[o + 2] * (p[o + 3] * p[o + 7] - p[o + 4] * p[o + 6])) /
      6
  }
  return v
}

const SEEDS = [1, 777, 20260728, 42424242]
const FAMILIES = Object.keys(DRESSING_BUILDERS) as (keyof typeof DRESSING_BUILDERS)[]

describe('dressing builders', () => {
  it('every family x seed: valid, in-budget, finite, footprint-bounded, outward', () => {
    for (const fam of FAMILIES) {
      for (const seed of SEEDS) {
        const soup = DRESSING_BUILDERS[fam](seed)
        expectValidSoup(soup)
        const tris = soup.positions.length / 9
        expect(tris, `${fam} tri budget`).toBeLessThanOrEqual(DRESSING_TRI_BUDGET)
        expect(tris).toBeGreaterThan(0)
        let maxR = 0
        let minY = Infinity
        let maxY = -Infinity
        for (let i = 0; i < soup.positions.length; i += 3) {
          maxR = Math.max(maxR, Math.hypot(soup.positions[i], soup.positions[i + 2]))
          minY = Math.min(minY, soup.positions[i + 1])
          maxY = Math.max(maxY, soup.positions[i + 1])
        }
        expect(maxR, `${fam} footprint`).toBeLessThanOrEqual(2.0)
        // unit-height law with a small embed allowance below the base
        expect(minY, `${fam} base`).toBeGreaterThanOrEqual(-0.12)
        expect(maxY, `${fam} tip`).toBeLessThanOrEqual(1 + 1e-6)
        expect(signedVolume(soup), `${fam} winding`).toBeGreaterThan(0)
      }
    }
  })

  it('glow masks stay in [0,1] with mostly-dark restraint (plate edges exempt)', () => {
    for (const fam of FAMILIES) {
      const soup = DRESSING_BUILDERS[fam](555)
      let present = 0
      let lit = 0
      for (const g of soup.glow) {
        expect(g).toBeGreaterThanOrEqual(0)
        expect(g).toBeLessThanOrEqual(1)
        if (g > 0) present++
        if (g >= 0.5) lit++
      }
      expect(present, `${fam} has a vein read`).toBeGreaterThan(0)
      // the plate's identity IS its glowing fracture rim — higher cap
      const cap = fam === 'plate' ? 0.7 : 0.35
      expect(lit / soup.glow.length, `${fam} restraint`).toBeLessThan(cap)
    }
  })

  it('is deterministic per seed', () => {
    for (const fam of FAMILIES) {
      const a = DRESSING_BUILDERS[fam](909)
      const b = DRESSING_BUILDERS[fam](909)
      expect(Array.from(a.positions)).toEqual(Array.from(b.positions))
      expect(Array.from(a.glow)).toEqual(Array.from(b.glow))
    }
  })
})

describe('DRESSING_VISUALS', () => {
  it('aligns 1:1 with the realm ladder', () => {
    expect(DRESSING_VISUALS.length).toBe(REALMS.length)
    for (let i = 0; i < REALMS.length; i++) {
      expect(DRESSING_VISUALS[i].id).toBe(REALMS[i].id)
    }
  })

  it('all numeric fields are finite and placement windows sane', () => {
    for (const v of DRESSING_VISUALS) {
      for (const key of [
        'countBase',
        'countPerScale',
        'minIslandScale',
        'orbitRate',
        'veinGain',
        'tripStretch',
      ] as const) {
        expect(Number.isFinite(v[key]), `${v.id}.${key}`).toBe(true)
      }
      for (const key of ['radial', 'yJitter', 'size', 'stretch', 'tiltOut'] as const) {
        expect(Number.isFinite(v[key][0])).toBe(true)
        expect(Number.isFinite(v[key][1])).toBe(true)
        expect(v[key][1]).toBeGreaterThanOrEqual(v[key][0])
      }
      // island center axis stays clear for resonance-point spawns
      if (v.yMode !== 'orbit') {
        expect(v.radial[0], `${v.id} center-clear`).toBeGreaterThanOrEqual(0.3)
      }
    }
  })
})

describe('placeDressing', () => {
  const scratch: DressingPiece[] = []

  it('is deterministic and finite', () => {
    const spec = DRESSING_VISUALS[3]
    const a: DressingPiece[] = []
    const b: DressingPiece[] = []
    placeDressing(spec, 123456, 5.2, 1, 1, 1.28, 1.15, a)
    placeDressing(spec, 123456, 5.2, 1, 1, 1.28, 1.15, b)
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(0)
    for (const p of a) {
      for (const val of [p.ox, p.oy, p.oz, p.ry, p.tilt, p.tiltDir, p.sx, p.sy, p.phase]) {
        expect(Number.isFinite(val)).toBe(true)
      }
      expect(p.sx).toBeGreaterThan(0)
      expect(p.sy).toBeGreaterThan(0)
    }
  })

  it('returns nothing below minIslandScale and respects the per-island cap', () => {
    for (const spec of DRESSING_VISUALS) {
      expect(placeDressing(spec, 999, spec.minIslandScale - 0.1, 1, 1, 1.28, 1, scratch)).toBe(0)
      const n = placeDressing(spec, 999, 7, 1, 1, 1.78, 2, scratch)
      expect(n).toBeLessThanOrEqual(DRESSING_MAX_PER_ISLAND)
    }
  })

  it('ritual ring: equal angular spacing, k=0 is a squat center altar', () => {
    const spec = DRESSING_VISUALS[3]
    expect(spec.family).toBe('ring')
    const pieces: DressingPiece[] = []
    const n = placeDressing(spec, 4242, 6, 1, 1, 1.28, 1, pieces)
    expect(n).toBeGreaterThanOrEqual(4)
    expect(pieces[0].altar).toBe(1)
    expect(pieces[0].sy).toBeLessThan(pieces[0].sx)
    expect(Math.hypot(pieces[0].ox, pieces[0].oz)).toBeLessThan(Math.hypot(pieces[1].ox, pieces[1].oz))
    // stones k>=1 sit on the even grid; the altar's slot leaves one 2-step hole
    const angles = pieces.slice(1).map(p => Math.atan2(p.oz, p.ox)).sort((a, b) => a - b)
    const step = (Math.PI * 2) / n
    let holes = 0
    for (let i = 1; i < angles.length; i++) {
      const gap = angles[i] - angles[i - 1]
      const isStep = Math.abs(gap - step) < 0.3
      const isHole = Math.abs(gap - 2 * step) < 0.3
      expect(isStep || isHole, `gap ${gap}`).toBe(true)
      if (isHole) holes++
    }
    expect(holes).toBeLessThanOrEqual(1)
  })

  it('orbit families float outside the rock; top families sit above center', () => {
    const orbit = DRESSING_VISUALS[0]
    const pieces: DressingPiece[] = []
    placeDressing(orbit, 77, 4, 1, 1, 1.28, 1, pieces)
    for (const p of pieces) {
      expect(Math.hypot(p.ox, p.oz)).toBeGreaterThan(4 * 1.0)
    }
    const top = DRESSING_VISUALS[5]
    placeDressing(top, 77, 4, 1, 1, 1.0, 1, pieces)
    for (const p of pieces) {
      expect(p.oy).toBeGreaterThan(0)
    }
  })
})
