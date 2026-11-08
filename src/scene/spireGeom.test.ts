import { describe, expect, it } from 'vitest'
import { buildSpireCluster, buildSpirePrism, SPIRE_TRI_BUDGET } from './spireGeom'
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

const STATIONS = [
  [0, 1],
  [0.3, 0.85],
  [0.62, 0.6],
  [0.86, 0.3],
] as const

describe('buildSpirePrism', () => {
  it('is a valid, outward-wound closed solid', () => {
    const soup = buildSpirePrism(1234, 6, STATIONS, 0.2)
    expectValidSoup(soup)
    expect(signedVolume(soup)).toBeGreaterThan(0)
  })

  it('spans exactly base y=0 to tip y=1 with along = y', () => {
    const soup = buildSpirePrism(77, 6, STATIONS, 0.25)
    let minY = Infinity
    let maxY = -Infinity
    for (let i = 1; i < soup.positions.length; i += 3) {
      minY = Math.min(minY, soup.positions[i])
      maxY = Math.max(maxY, soup.positions[i])
    }
    expect(minY).toBeCloseTo(0, 6)
    expect(maxY).toBeCloseTo(1, 6)
    for (let i = 0; i < soup.along.length; i++) {
      expect(soup.along[i]).toBeCloseTo(soup.positions[i * 3 + 1], 6)
    }
  })

  it('carries a binary vein mask confined to the y 0.30-0.90 band', () => {
    const soup = buildSpirePrism(555, 6, STATIONS, 0.2)
    let veins = 0
    for (let i = 0; i < soup.glow.length; i++) {
      const g = soup.glow[i]
      expect(g === 0 || g === 1).toBe(true)
      if (g === 1) {
        veins++
        const y = soup.positions[i * 3 + 1]
        expect(y).toBeGreaterThanOrEqual(0.3 - 1e-6)
        expect(y).toBeLessThanOrEqual(0.9 + 1e-6)
      }
    }
    expect(veins).toBeGreaterThan(0)
    // restraint: most of the monolith stays dark silhouette
    expect(veins / soup.glow.length).toBeLessThan(0.3)
  })
})

describe('buildSpireCluster', () => {
  it('stays valid, in-budget, and inside the restream footprint at any seed', () => {
    for (const seed of [1, 20260501, 987654, 42424242]) {
      const soup = buildSpireCluster(seed)
      expectValidSoup(soup)
      const tris = soup.positions.length / 9
      expect(tris).toBeLessThanOrEqual(SPIRE_TRI_BUDGET)
      let minY = Infinity
      let maxY = -Infinity
      let maxR = 0
      for (let i = 0; i < soup.positions.length; i += 3) {
        const x = soup.positions[i]
        const y = soup.positions[i + 1]
        const z = soup.positions[i + 2]
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
        maxR = Math.max(maxR, Math.hypot(x, z))
      }
      // unit-height convention: never below the base, never above the tip
      expect(minY).toBeGreaterThanOrEqual(-1e-6)
      expect(maxY).toBeLessThanOrEqual(1 + 1e-6)
      // XZ footprint safety for the restream w-scale
      expect(maxR).toBeLessThanOrEqual(1.8)
      // vein mask present, mostly-dark restraint holds for the whole cluster
      let veins = 0
      for (const g of soup.glow) {
        expect(g === 0 || g === 1).toBe(true)
        if (g === 1) veins++
      }
      expect(veins).toBeGreaterThan(0)
      expect(veins / soup.glow.length).toBeLessThan(0.3)
    }
  })

  it('is deterministic per seed', () => {
    const a = buildSpireCluster(777)
    const b = buildSpireCluster(777)
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions))
    expect(Array.from(a.glow)).toEqual(Array.from(b.glow))
  })
})
