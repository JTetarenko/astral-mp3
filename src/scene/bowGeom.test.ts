import { describe, expect, it } from 'vitest'
import { COMBAT } from '../game/combat'
import {
  assemblyStagger,
  bowStringPoints,
  buildArrow,
  buildBowRiser,
  buildBowSegment,
  drawDist,
  idleFloatPose,
  limbCurl,
  limbTipPos,
  LIMB_LENS,
  LIMB_WIDTHS,
  mergeSoups,
  nockPos,
  RISER_HALF,
  SEG_COUNT,
  translateSoup,
  volleyFanAngles,
  type TriSoup,
} from './bowGeom'

function expectValidSoup(soup: TriSoup): void {
  expect(soup.positions.length % 9).toBe(0)
  expect(soup.along.length).toBe(soup.positions.length / 3)
  expect(soup.glow.length).toBe(soup.positions.length / 3)
  for (let i = 0; i < soup.positions.length; i++) {
    expect(Number.isFinite(soup.positions[i])).toBe(true)
  }
}

/** Outward winding on a single star-shaped solid (not valid for merges). */
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
    const ax = p[o]
    const ay = p[o + 1]
    const az = p[o + 2]
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
    expect(n[0] * cx + n[1] * cy + n[2] * cz).toBeGreaterThan(0)
  }
}

describe('bow solids', () => {
  it('limb segment is valid, outward-wound, with a sparse +Z ridge', () => {
    const soup = buildBowSegment()
    expectValidSoup(soup)
    expectOutwardWinding(soup)
    let ridge = 0
    for (let i = 0; i < soup.glow.length; i++) if (soup.glow[i] > 1) ridge++
    expect(ridge).toBeGreaterThan(0)
    expect(ridge).toBeLessThan(soup.glow.length / 2)
  })

  it('riser and arrow merges are valid with HDR accents', () => {
    for (const soup of [buildBowRiser(), buildArrow()]) {
      expectValidSoup(soup)
      expect(Math.max(...Array.from(soup.glow))).toBeGreaterThan(1)
    }
  })

  it('the arrow head is its hottest part (the absorbed muzzle orb)', () => {
    const soup = buildArrow()
    let headGlow = 0
    let bodyGlow = 0
    for (let i = 0; i < soup.glow.length; i++) {
      if (soup.positions[i * 3 + 1] > 0.99) headGlow = Math.max(headGlow, soup.glow[i])
      else bodyGlow = Math.max(bodyGlow, soup.glow[i])
    }
    expect(headGlow).toBeGreaterThan(bodyGlow)
  })

  it('mergeSoups concatenates counts; translateSoup shifts in place', () => {
    const a = buildBowSegment()
    const b = buildBowSegment()
    const aVerts = a.along.length
    const y0 = b.positions[1]
    translateSoup(b, 1, 2, 3)
    expect(b.positions[0]).toBeCloseTo(a.positions[0] + 1, 6)
    expect(b.positions[1]).toBeCloseTo(y0 + 2, 6)
    const m = mergeSoups(a, b)
    expect(m.along.length).toBe(aVerts * 2)
    expect(m.positions[aVerts * 3]).toBeCloseTo(b.positions[0], 6)
  })
})

describe('limb pose', () => {
  it('layout tables agree on the segment count', () => {
    expect(LIMB_LENS.length).toBe(SEG_COUNT)
    expect(LIMB_WIDTHS.length).toBe(SEG_COUNT)
  })

  it('brace sweeps the body toward the string and hooks the prongs away', () => {
    const c = new Float32Array(SEG_COUNT)
    limbCurl(c, 0, 0)
    for (let i = 0; i < 5; i++) expect(c[i]).toBeGreaterThanOrEqual(0)
    expect(c[5]).toBeLessThan(0)
    expect(c[6]).toBeLessThan(0)
  })

  it('every segment curls further with draw, further again with overdraw', () => {
    const brace = new Float32Array(SEG_COUNT)
    const drawn = new Float32Array(SEG_COUNT)
    const over = new Float32Array(SEG_COUNT)
    limbCurl(brace, 0, 0)
    limbCurl(drawn, 1, 0)
    limbCurl(over, 1, 1)
    for (let i = 0; i < SEG_COUNT; i++) {
      expect(drawn[i]).toBeGreaterThan(brace[i])
      expect(over[i]).toBeGreaterThan(drawn[i])
      expect(Math.abs(over[i])).toBeLessThan(Math.PI / 2)
    }
  })

  it('the cumulative heading never crosses the string plane, even overdrawn', () => {
    const c = new Float32Array(SEG_COUNT)
    limbCurl(c, 1, 1)
    let ang = 0
    for (let i = 0; i < 5; i++) {
      ang += c[i]
      expect(ang).toBeLessThan(Math.PI / 2)
    }
  })

  it('limb tip sits above the riser and moves toward +Z as the draw deepens', () => {
    const c = new Float32Array(SEG_COUNT)
    const tip = { y: 0, z: 0 }
    limbCurl(c, 0, 0)
    limbTipPos(tip, c)
    expect(tip.y).toBeGreaterThan(RISER_HALF)
    const zBrace = tip.z
    limbCurl(c, 1, 0)
    limbTipPos(tip, c)
    expect(tip.z).toBeGreaterThan(zBrace)
  })
})

describe('string', () => {
  it('drawDist and the nock are strictly monotonic in draw', () => {
    let prev = -1
    const out = { y: 0, z: 0 }
    for (const d of [0, 0.25, 0.5, 0.75, 1]) {
      nockPos(out, 0.7, 0.06, -0.7, 0.06, d, 0)
      expect(out.z).toBeGreaterThan(prev)
      prev = out.z
    }
    expect(drawDist(1, 1)).toBeGreaterThan(drawDist(1, 0))
    // at draw 0 the nock sits exactly on the tip chord — a straight string
    nockPos(out, 0.7, 0.06, -0.7, 0.06, 0, 0)
    expect(out.z).toBeCloseTo(0.06, 6)
    expect(out.y).toBeCloseTo(0, 6)
  })

  it('string endpoints exactly equal the tip attach points at any draw', () => {
    const n = 24
    const out = new Float32Array(n * 3)
    for (const d of [0, 0.5, 1]) {
      bowStringPoints(out, n, 0.72, 0.07, -0.72, 0.05, d, 0.3, 0.04, 2.1)
      expect(out[0]).toBe(0)
      expect(out[1]).toBeCloseTo(0.72, 6)
      expect(out[2]).toBeCloseTo(0.07, 6)
      expect(out[(n - 1) * 3]).toBe(0)
      expect(out[(n - 1) * 3 + 1]).toBeCloseTo(-0.72, 6)
      expect(out[(n - 1) * 3 + 2]).toBeCloseTo(0.05, 6)
    }
  })

  it('zero vibration keeps the string in the Y-Z plane; amplitude bounds X', () => {
    const n = 24
    const out = new Float32Array(n * 3)
    bowStringPoints(out, n, 0.72, 0.07, -0.72, 0.07, 1, 0, 0, 0)
    for (let i = 0; i < n; i++) expect(out[i * 3]).toBe(0)
    const amp = 0.08
    bowStringPoints(out, n, 0.72, 0.07, -0.72, 0.07, 1, 0, amp, 1.7)
    let maxX = 0
    for (let i = 0; i < n; i++) maxX = Math.max(maxX, Math.abs(out[i * 3]))
    expect(maxX).toBeGreaterThan(0)
    expect(maxX).toBeLessThanOrEqual(amp)
  })
})

describe('fan / stagger / idle', () => {
  it('volley fan is antisymmetric and matches the ballistic spread', () => {
    const out = new Float32Array(3)
    volleyFanAngles(out, 1)
    expect(out[0]).toBeCloseTo(-COMBAT.cast.volleySpreadRad, 6)
    expect(out[1]).toBe(0)
    expect(out[2]).toBeCloseTo(COMBAT.cast.volleySpreadRad, 6)
    volleyFanAngles(out, 0.5)
    expect(out[2]).toBeCloseTo(COMBAT.cast.volleySpreadRad * 0.5, 6)
    volleyFanAngles(out, 0)
    expect(out[0]).toBeCloseTo(0, 10)
    expect(out[2]).toBeCloseTo(0, 10)
  })

  it('assembly staggers core-first and always completes', () => {
    expect(assemblyStagger(0, 0)).toBe(0)
    expect(assemblyStagger(0, 1)).toBe(0)
    expect(assemblyStagger(1, 0)).toBe(1)
    expect(assemblyStagger(1, 1)).toBe(1)
    expect(assemblyStagger(0.3, 0)).toBeGreaterThan(assemblyStagger(0.3, 1))
    let prev = -1
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const v = assemblyStagger(t, 0.5)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })

  it('idle float stays bounded', () => {
    const out = { y: 0, yaw: 0, roll: 0, gap: 0 }
    for (let t = 0; t < 20; t += 0.37) {
      idleFloatPose(out, t, 1, 1)
      expect(Math.abs(out.y)).toBeLessThanOrEqual(0.04)
      expect(Math.abs(out.yaw)).toBeLessThanOrEqual(0.06)
      expect(Math.abs(out.roll)).toBeLessThanOrEqual(0.04)
      expect(out.gap).toBeLessThanOrEqual(0.004)
    }
  })
})
