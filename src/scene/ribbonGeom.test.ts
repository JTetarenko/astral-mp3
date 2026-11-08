import { describe, expect, it } from 'vitest'
import { fillRibbonColors, fillRibbonPositions, ribbonEdges, ribbonIndices } from './ribbonGeom'

function line(n: number, axis: 0 | 1 | 2 = 0): Float32Array {
  const pts = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) pts[i * 3 + axis] = i
  return pts
}

describe('ribbonIndices / ribbonEdges', () => {
  it('builds (n-1) quads with in-range indices sharing the expected diagonal', () => {
    const n = 4
    const idx = ribbonIndices(n)
    expect(idx.length).toBe((n - 1) * 6)
    for (const v of idx) expect(v).toBeLessThan(n * 2)
    // first quad: (0,1,2) + (1,3,2) — diagonal 1-2 shared
    expect(Array.from(idx.slice(0, 6))).toEqual([0, 1, 2, 1, 3, 2])
  })

  it('edges alternate -1/+1 across 2n entries', () => {
    const e = ribbonEdges(5)
    expect(e.length).toBe(10)
    for (let i = 0; i < 5; i++) {
      expect(e[i * 2]).toBe(-1)
      expect(e[i * 2 + 1]).toBe(1)
    }
  })
})

describe('fillRibbonPositions', () => {
  it('a straight strip with an off-axis camera is perpendicular to tangent and view', () => {
    const n = 8
    const pts = line(n)
    const widths = new Float32Array(n).fill(0.5)
    const out = new Float32Array(n * 6)
    fillRibbonPositions(out, pts, n, widths, 0, 10, 0)
    for (let i = 0; i < n; i++) {
      const o = i * 6
      const dx = out[o + 3] - out[o]
      const dy = out[o + 4] - out[o + 1]
      const dz = out[o + 5] - out[o + 2]
      // full width = 2 x half-width
      expect(Math.hypot(dx, dy, dz)).toBeCloseTo(1, 5)
      // side ⊥ tangent (+X) and ⊥ view (+Y here)
      expect(Math.abs(dx)).toBeLessThan(1e-6)
      expect(Math.abs(dy)).toBeLessThan(1e-6)
    }
  })

  it('camera exactly on the line falls back finitely (no NaN)', () => {
    const n = 6
    const pts = line(n)
    const widths = new Float32Array(n).fill(0.3)
    const out = new Float32Array(n * 6)
    fillRibbonPositions(out, pts, n, widths, 3, 0, 0)
    for (const v of out) expect(Number.isFinite(v)).toBe(true)
  })

  it('duplicated (zero-length) segment points reuse the previous side', () => {
    const n = 5
    const pts = line(n)
    // collapse points 2 and 3 onto each other
    pts[3 * 3] = pts[2 * 3]
    const widths = new Float32Array(n).fill(0.4)
    const out = new Float32Array(n * 6)
    fillRibbonPositions(out, pts, n, widths, 0, 8, 3)
    for (const v of out) expect(Number.isFinite(v)).toBe(true)
  })

  it('per-point taper is respected', () => {
    const n = 3
    const pts = line(n)
    const widths = new Float32Array([1, 0.5, 0])
    const out = new Float32Array(n * 6)
    fillRibbonPositions(out, pts, n, widths, 0, 10, 0)
    for (let i = 0; i < n; i++) {
      const o = i * 6
      const w = Math.hypot(out[o + 3] - out[o], out[o + 4] - out[o + 1], out[o + 5] - out[o + 2])
      expect(w).toBeCloseTo(widths[i] * 2, 5)
    }
  })

  it('a 96-point fill writes exactly 576 finite floats (cap guard)', () => {
    const n = 96
    const pts = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      pts[i * 3] = Math.sin(i * 0.3) * 10
      pts[i * 3 + 1] = i * 0.1
      pts[i * 3 + 2] = Math.cos(i * 0.3) * 10
    }
    const widths = new Float32Array(n).fill(0.2)
    const out = new Float32Array(n * 6)
    fillRibbonPositions(out, pts, n, widths, 5, 20, -8)
    expect(out.length).toBe(576)
    for (const v of out) expect(Number.isFinite(v)).toBe(true)
  })
})

describe('fillRibbonColors', () => {
  it('duplicates each point color to both strip vertices', () => {
    const rgb = new Float32Array([1, 2, 3, 4, 5, 6])
    const out = new Float32Array(12)
    fillRibbonColors(out, rgb, 2)
    expect(Array.from(out)).toEqual([1, 2, 3, 1, 2, 3, 4, 5, 6, 4, 5, 6])
  })
})
