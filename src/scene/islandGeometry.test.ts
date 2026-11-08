import { describe, expect, it } from 'vitest'
import { IcosahedronGeometry, type BufferAttribute } from 'three'
import { VARIANT_STYLES, variantTop } from '../game/islandVariants'
import { makeIslandGeometry } from './islandGeometry'

/** The live variant seeds used by Islands.tsx. */
const SEEDS = [1000, 1001, 1002, 1003]

function positions(geo: IcosahedronGeometry): Float32Array {
  return (geo.attributes.position as BufferAttribute).array as Float32Array
}

function bounds(geo: IcosahedronGeometry) {
  const p = positions(geo)
  let maxY = -Infinity
  let minY = Infinity
  let maxXZ = 0
  for (let i = 0; i < p.length; i += 3) {
    maxY = Math.max(maxY, p[i + 1])
    minY = Math.min(minY, p[i + 1])
    maxXZ = Math.max(maxXZ, Math.hypot(p[i], p[i + 2]))
  }
  return { maxY, minY, maxXZ }
}

describe('makeIslandGeometry', () => {
  it('is deterministic per (seed, style)', () => {
    for (let v = 0; v < 4; v++) {
      const a = positions(makeIslandGeometry(SEEDS[v], 2, VARIANT_STYLES[v]))
      const b = positions(makeIslandGeometry(SEEDS[v], 2, VARIANT_STYLES[v]))
      expect(a).toEqual(b)
    }
    // legacy no-style path (DebrisRing) too
    expect(positions(makeIslandGeometry(4242, 1))).toEqual(
      positions(makeIslandGeometry(4242, 1)),
    )
  })

  it('variantTop is a true clearance bound for every baked variant', () => {
    for (let v = 0; v < 4; v++) {
      const { maxY } = bounds(makeIslandGeometry(SEEDS[v], 2, VARIANT_STYLES[v]))
      expect(maxY).toBeLessThanOrEqual(variantTop(v))
      // ...but not absurdly loose either (points would float far above rock)
      expect(variantTop(v)).toBeLessThanOrEqual(maxY * 1.45)
    }
  })

  it('monolith variants are tall and narrow; jagged variants squat', () => {
    // full-height / radius: a unit sphere scores 2.0
    for (let v = 0; v < 4; v++) {
      const { maxY, minY, maxXZ } = bounds(makeIslandGeometry(SEEDS[v], 2, VARIANT_STYLES[v]))
      const aspect = (maxY - minY) / maxXZ
      if (VARIANT_STYLES[v].kind === 'monolith') {
        expect(aspect).toBeGreaterThanOrEqual(3)
      } else {
        expect(aspect).toBeLessThanOrEqual(2)
      }
    }
  })

  it('bakes AO vertex colors in [0, 1]', () => {
    for (let v = 0; v < 4; v++) {
      const geo = makeIslandGeometry(SEEDS[v], 2, VARIANT_STYLES[v])
      const colors = (geo.attributes.color as BufferAttribute).array as Float32Array
      for (let i = 0; i < colors.length; i++) {
        expect(colors[i]).toBeGreaterThanOrEqual(0)
        expect(colors[i]).toBeLessThanOrEqual(1)
      }
    }
  })

  it('keeps duplicated (non-indexed) vertices welded through displacement', () => {
    // displacement is a pure function of position: any two raw vertices that
    // share a position must land on the same displaced position
    const raw = positions(new IcosahedronGeometry(1, 2))
    const seen = new Map<string, number>()
    let pairA = -1
    let pairB = -1
    for (let i = 0; i < raw.length / 3; i++) {
      const key = `${raw[i * 3].toFixed(6)},${raw[i * 3 + 1].toFixed(6)},${raw[i * 3 + 2].toFixed(6)}`
      const prev = seen.get(key)
      if (prev !== undefined) {
        pairA = prev
        pairB = i
        break
      }
      seen.set(key, i)
    }
    expect(pairA).toBeGreaterThanOrEqual(0)
    const baked = positions(makeIslandGeometry(SEEDS[2], 2, VARIANT_STYLES[2]))
    expect(baked[pairA * 3]).toBeCloseTo(baked[pairB * 3], 10)
    expect(baked[pairA * 3 + 1]).toBeCloseTo(baked[pairB * 3 + 1], 10)
    expect(baked[pairA * 3 + 2]).toBeCloseTo(baked[pairB * 3 + 2], 10)
  })

  it('legacy default style keeps the squat boulder silhouette', () => {
    const { maxY, maxXZ } = bounds(makeIslandGeometry(4242, 1))
    expect(maxY).toBeLessThan(maxXZ)
  })
})
