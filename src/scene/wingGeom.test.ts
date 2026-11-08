import { describe, expect, it } from 'vitest'
import {
  BONE_LENGTHS,
  buildCollarPlate,
  buildFeatherBlade,
  buildStrutSlab,
  buildWingLayout,
  charmIgnition,
  flapPose,
  flapWave,
  gemProfile,
  ringSolid,
  type FlapPose,
  type TriSoup,
} from './wingGeom'

function expectValidSoup(soup: TriSoup): void {
  expect(soup.positions.length % 9).toBe(0)
  expect(soup.along.length).toBe(soup.positions.length / 3)
  expect(soup.glow.length).toBe(soup.positions.length / 3)
  for (let i = 0; i < soup.positions.length; i++) {
    expect(Number.isFinite(soup.positions[i])).toBe(true)
  }
}

/** Every face normal must point away from the solid's centroid (outward
 * winding on a star-shaped solid) — flat-shaded facets depend on it. */
function expectOutwardWinding(soup: TriSoup): void {
  const p = soup.positions
  const vertCount = p.length / 3
  const c = [0, 0, 0]
  for (let i = 0; i < vertCount; i++) {
    c[0] += p[i * 3]
    c[1] += p[i * 3 + 1]
    c[2] += p[i * 3 + 2]
  }
  c[0] /= vertCount
  c[1] /= vertCount
  c[2] /= vertCount
  for (let f = 0; f < vertCount / 3; f++) {
    const o = f * 9
    const ax = p[o], ay = p[o + 1], az = p[o + 2]
    const e1 = [p[o + 3] - ax, p[o + 4] - ay, p[o + 5] - az]
    const e2 = [p[o + 6] - ax, p[o + 7] - ay, p[o + 8] - az]
    const n = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ]
    const cx = (ax + p[o + 3] + p[o + 6]) / 3 - c[0]
    const cy = (ay + p[o + 4] + p[o + 7]) / 3 - c[1]
    const cz = (az + p[o + 5] + p[o + 8]) / 3 - c[2]
    const dot = n[0] * cx + n[1] * cy + n[2] * cz
    expect(dot).toBeGreaterThan(0)
  }
}

describe('ringSolid', () => {
  it('produces a valid outward-wound solid with normalized along', () => {
    const soup = ringSolid(
      [
        { y: 0, hx: 0.3, hz: 0.1 },
        { y: 0.5, hx: 0.5, hz: 0.2 },
        { y: 0.9, hx: 0.2, hz: 0.08 },
      ],
      -0.1,
      1,
    )
    expectValidSoup(soup)
    expectOutwardWinding(soup)
    for (let i = 0; i < soup.along.length; i++) {
      expect(soup.along[i]).toBeGreaterThanOrEqual(0)
      expect(soup.along[i]).toBeLessThanOrEqual(1)
    }
  })

  it('carries station glow onto vertices', () => {
    const soup = ringSolid(
      [
        { y: 0, hx: 0.3, hz: 0.1, glow: 0.5 },
        { y: 1, hx: 0.3, hz: 0.1, glow: 2 },
      ],
      -0.1,
      1.1,
    )
    expect(Math.max(...soup.glow)).toBe(2)
    expect(Math.min(...soup.glow)).toBe(0.5)
  })
})

describe('blade / slab / plate solids', () => {
  it('feather blade is valid and outward-wound', () => {
    const soup = buildFeatherBlade()
    expectValidSoup(soup)
    expectOutwardWinding(soup)
  })

  it('strut slab has a small set of HDR ridge verts', () => {
    const soup = buildStrutSlab()
    expectValidSoup(soup)
    expectOutwardWinding(soup)
    let ridge = 0
    for (let i = 0; i < soup.glow.length; i++) if (soup.glow[i] > 1) ridge++
    expect(ridge).toBeGreaterThan(0)
    expect(ridge).toBeLessThan(soup.glow.length / 2)
  })

  it('collar plate is valid, outward-wound, with a glowing apex', () => {
    const soup = buildCollarPlate()
    expectValidSoup(soup)
    expectOutwardWinding(soup)
    let apexGlow = 0
    for (let i = 0; i < soup.glow.length; i++) {
      if (soup.positions[i * 3 + 1] < -0.5) apexGlow = Math.max(apexGlow, soup.glow[i])
    }
    expect(apexGlow).toBeGreaterThan(1)
  })
})

describe('wing layout', () => {
  const layout = buildWingLayout()

  it('has 15 feathers across 3 layers on valid bones', () => {
    expect(layout.length).toBe(15)
    expect(BONE_LENGTHS.length).toBe(3)
    for (const f of layout) {
      expect(f.bone === 0 || f.bone === 1 || f.bone === 2).toBe(true)
      expect(f.t).toBeGreaterThanOrEqual(0)
      expect(f.t).toBeLessThanOrEqual(1)
      expect(f.len).toBeGreaterThan(0)
      expect(f.wid).toBeGreaterThan(0)
      // in-plane down-fan, never past perpendicular
      expect(f.splay).toBeGreaterThanOrEqual(0)
      expect(f.splay).toBeLessThan(Math.PI / 2)
    }
  })

  it('primaries are the longest layer and sit on the hand', () => {
    const primaries = layout.filter(f => f.layer === 0)
    const rest = layout.filter(f => f.layer !== 0)
    const maxPrimary = Math.max(...primaries.map(f => f.len))
    const maxRest = Math.max(...rest.map(f => f.len))
    expect(primaries.every(f => f.bone === 2)).toBe(true)
    expect(maxPrimary).toBeGreaterThan(maxRest)
  })

  it('ripple rank grows root->tip so cascades travel outward', () => {
    for (const f of layout) {
      expect(f.ripple).toBeCloseTo(f.bone + f.t, 6)
    }
  })
})

describe('flapWave', () => {
  it('is periodic with top at 0 and bottom at the downstroke end', () => {
    expect(flapWave(0)).toBeCloseTo(1, 6)
    expect(flapWave(1)).toBeCloseTo(1, 6)
    expect(flapWave(0.42)).toBeCloseTo(-1, 6)
    expect(flapWave(-0.58)).toBeCloseTo(flapWave(0.42), 6)
  })

  it('is continuous across the whole cycle (no pops)', () => {
    const N = 2000
    let maxStep = 0
    let prev = flapWave(0)
    for (let i = 1; i <= N; i++) {
      const w = flapWave(i / N)
      maxStep = Math.max(maxStep, Math.abs(w - prev))
      expect(w).toBeGreaterThanOrEqual(-1.000001)
      expect(w).toBeLessThanOrEqual(1.000001)
      prev = w
    }
    // one 1/2000 step should never jump more than ~2pi/segment slope bound
    expect(maxStep).toBeLessThan(0.01)
  })
})

describe('flapPose', () => {
  const mk = (): FlapPose => ({
    shoulderLift: 0,
    shoulderSweep: 0,
    shoulderTwist: 0,
    elbowBend: 0,
    handBend: 0,
    elbowFold: 0,
    handFold: 0,
    splayMul: 1,
    featherPitch: 0,
  })

  it('is phase-continuous at full amplitude', () => {
    const a = mk()
    const b = mk()
    const params = { phase: 0, amp: 1.6, raise: 0.3, sweep: 0.2, fold: 0.1, spread: 0.1 }
    let prevLift = flapPose(a, params).shoulderLift
    for (let i = 1; i <= 500; i++) {
      params.phase = i / 500
      const lift = flapPose(b, params).shoulderLift
      expect(Math.abs(lift - prevLift)).toBeLessThan(0.02)
      prevLift = lift
    }
  })

  it('keeps joints inside sane bounds across the input space', () => {
    const out = mk()
    for (let phase = 0; phase < 1; phase += 0.09) {
      for (const amp of [0, 0.6, 1.6]) {
        for (const fold of [0, 0.6, 1.2]) {
          for (const spread of [0, 1]) {
            flapPose(out, { phase, amp, raise: 0.5, sweep: 0.3, fold, spread })
            expect(Math.abs(out.elbowBend)).toBeLessThan(1.5)
            expect(Math.abs(out.handBend)).toBeLessThan(1.5)
            expect(out.elbowFold).toBeGreaterThanOrEqual(0)
            expect(out.handFold).toBeGreaterThanOrEqual(0)
            expect(out.splayMul).toBeGreaterThanOrEqual(0.22)
            expect(out.splayMul).toBeLessThanOrEqual(1.7)
            expect(Math.abs(out.shoulderLift)).toBeLessThan(2.5)
            expect(Math.abs(out.shoulderSweep)).toBeLessThan(2.5)
          }
        }
      }
    }
  })

  it('fold tucks: wing folds out of plane, feathers close ranks', () => {
    const rest = flapPose(mk(), { phase: 0.2, amp: 0.5, raise: 0, sweep: 0, fold: 0, spread: 0 })
    const tuck = flapPose(mk(), { phase: 0.2, amp: 0.5, raise: 0, sweep: 0, fold: 1, spread: 0 })
    expect(tuck.elbowFold).toBeGreaterThan(rest.elbowFold + 0.8)
    expect(tuck.handFold).toBeGreaterThan(rest.handFold + 1)
    expect(tuck.splayMul).toBeLessThan(rest.splayMul - 0.3)
    expect(tuck.shoulderSweep).toBeGreaterThan(rest.shoulderSweep + 0.4)
  })

  it('spread flares: lift up, fan open, tips curve upward', () => {
    const rest = flapPose(mk(), { phase: 0.6, amp: 0.4, raise: 0, sweep: 0, fold: 0, spread: 0 })
    const flare = flapPose(mk(), { phase: 0.6, amp: 0.4, raise: 0, sweep: 0, fold: 0, spread: 1 })
    expect(flare.shoulderLift).toBeGreaterThan(rest.shoulderLift)
    expect(flare.splayMul).toBeGreaterThan(rest.splayMul + 0.3)
    expect(flare.handBend).toBeLessThan(rest.handBend - 0.3)
  })
})

describe('trick helpers', () => {
  it('charmIgnition fills charms in thirds', () => {
    expect([0, 1, 2].map(i => charmIgnition(0, 6, i))).toEqual([0, 0, 0])
    expect([0, 1, 2].map(i => charmIgnition(6, 6, i))).toEqual([1, 1, 1])
    expect(charmIgnition(3, 6, 0)).toBe(1)
    expect(charmIgnition(3, 6, 1)).toBeCloseTo(0.5, 6)
    expect(charmIgnition(3, 6, 2)).toBe(0)
    expect(charmIgnition(5, 0, 2)).toBe(1)
  })
})

describe('gemProfile', () => {
  it('is a closed monotonic-y lathe profile', () => {
    const pts = gemProfile()
    expect(pts[0][0]).toBe(0)
    expect(pts[pts.length - 1][0]).toBe(0)
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i][1]).toBeGreaterThanOrEqual(pts[i - 1][1])
      expect(pts[i][0]).toBeGreaterThanOrEqual(0)
    }
    const maxR = Math.max(...pts.map(p => p[0]))
    expect(maxR).toBe(1)
  })
})
