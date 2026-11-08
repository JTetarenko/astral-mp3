import { describe, expect, it } from 'vitest'
import { buildTendril, TENDRIL_POOL, TENDRIL_TRI_BUDGET, TENDRIL_VERT_BUDGET } from './tendrilGeom'
import type { TriSoup } from './wingGeom'

function expectValidSoup(soup: TriSoup): void {
  expect(soup.positions.length % 9).toBe(0)
  expect(soup.along.length).toBe(soup.positions.length / 3)
  expect(soup.glow.length).toBe(soup.positions.length / 3)
  for (let i = 0; i < soup.positions.length; i++) {
    expect(Number.isFinite(soup.positions[i])).toBe(true)
  }
}

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

describe('buildTendril', () => {
  it('is a valid solid whose rigid flip preserved outward winding', () => {
    for (const seed of [1, 99, 123456]) {
      const soup = buildTendril(seed)
      expectValidSoup(soup)
      expect(signedVolume(soup)).toBeGreaterThan(0)
    }
  })

  it('hangs: root embeds slightly above y=0, tip reaches y ~ -1', () => {
    const soup = buildTendril(7)
    let minY = Infinity
    let maxY = -Infinity
    for (let i = 1; i < soup.positions.length; i += 3) {
      minY = Math.min(minY, soup.positions[i])
      maxY = Math.max(maxY, soup.positions[i])
    }
    expect(maxY).toBeLessThanOrEqual(0.05 + 1e-6) // root cap embeds upward a hair
    expect(minY).toBeGreaterThanOrEqual(-1.1)
    expect(minY).toBeLessThan(-0.9)
  })

  it('carries a dim tip glow (below the HDR vein level — restraint)', () => {
    const soup = buildTendril(31)
    let maxGlow = 0
    for (const g of soup.glow) maxGlow = Math.max(maxGlow, g)
    expect(maxGlow).toBeGreaterThan(0.3)
    expect(maxGlow).toBeLessThanOrEqual(0.6 + 1e-6)
  })

  it('stays inside the tri + pooled-buffer budgets (cap guard)', () => {
    const soup = buildTendril(2026)
    const tris = soup.positions.length / 9
    expect(tris).toBeLessThanOrEqual(TENDRIL_TRI_BUDGET)
    expect(TENDRIL_POOL * tris).toBeLessThanOrEqual(TENDRIL_VERT_BUDGET)
  })

  it('is deterministic per seed', () => {
    expect(Array.from(buildTendril(5).positions)).toEqual(Array.from(buildTendril(5).positions))
  })
})
