import { describe, expect, it } from 'vitest'
import { CHUNK, chunkKey, generateChunkIslands } from './chunks'
import { hashInts } from './seededRandom'
import { getRealmForDepth, NEUTRAL_MODS } from './realms'
import { LAYOUT } from './layout'

describe('chunkKey', () => {
  it('is unique across a signed coordinate grid', () => {
    const seen = new Set<number>()
    for (let cx = -20; cx <= 20; cx++) {
      for (let cz = -20; cz <= 20; cz++) {
        const k = chunkKey(cx, cz)
        expect(seen.has(k)).toBe(false)
        seen.add(k)
      }
    }
  })
})

describe('hashInts', () => {
  it('has no collisions over a dense (depth, cx, cz) sample', () => {
    const seen = new Set<number>()
    let n = 0
    for (let d = 0; d < 4; d++) {
      for (let cx = -16; cx < 16; cx++) {
        for (let cz = -16; cz < 16; cz++) {
          seen.add(hashInts(12345, d, cx, cz))
          n++
        }
      }
    }
    expect(seen.size).toBe(n)
  })

  it('changes when any single argument changes', () => {
    const base = hashInts(1, 2, 3, 4)
    expect(hashInts(2, 2, 3, 4)).not.toBe(base)
    expect(hashInts(1, 3, 3, 4)).not.toBe(base)
    expect(hashInts(1, 2, 4, 4)).not.toBe(base)
    expect(hashInts(1, 2, 3, 5)).not.toBe(base)
  })
})

describe('generateChunkIslands', () => {
  const mods = NEUTRAL_MODS

  it('is deterministic per (trackSeed, depth, cx, cz)', () => {
    const a = generateChunkIslands(777, 2, -3, 5, mods)
    const b = generateChunkIslands(777, 2, -3, 5, mods)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('differs when seed, depth, or cell changes', () => {
    const base = JSON.stringify(generateChunkIslands(777, 2, -3, 5, mods))
    expect(JSON.stringify(generateChunkIslands(778, 2, -3, 5, mods))).not.toBe(base)
    expect(JSON.stringify(generateChunkIslands(777, 3, -3, 5, mods))).not.toBe(base)
    expect(JSON.stringify(generateChunkIslands(777, 2, -2, 5, mods))).not.toBe(base)
    expect(JSON.stringify(generateChunkIslands(777, 2, -3, 6, mods))).not.toBe(base)
  })

  it('keeps islands inside the cell with margin', () => {
    for (let s = 0; s < 30; s++) {
      const cx = (s % 5) - 2
      const cz = Math.floor(s / 5) - 3
      for (const isl of generateChunkIslands(s * 31 + 7, s % 4, cx, cz, mods)) {
        expect(isl.x).toBeGreaterThanOrEqual(cx * CHUNK.size + CHUNK.margin - 1e-9)
        expect(isl.x).toBeLessThanOrEqual((cx + 1) * CHUNK.size - CHUNK.margin + 1e-9)
        expect(isl.z).toBeGreaterThanOrEqual(cz * CHUNK.size + CHUNK.margin - 1e-9)
        expect(isl.z).toBeLessThanOrEqual((cz + 1) * CHUNK.size - CHUNK.margin + 1e-9)
        expect(isl.variant).toBeGreaterThanOrEqual(0)
        expect(isl.variant).toBeLessThanOrEqual(3)
      }
    }
  })

  it('respects realm density / scale / y-band mods', () => {
    const dense = { ...NEUTRAL_MODS, islandDensity: 2 }
    const big = { ...NEUTRAL_MODS, islandScaleMult: 1.5 }
    const flat = { ...NEUTRAL_MODS, yBandMult: 0.2 }
    let nBase = 0
    let nDense = 0
    for (let cx = 0; cx < 12; cx++) {
      nBase += generateChunkIslands(99, 0, cx, 0, NEUTRAL_MODS).length
      nDense += generateChunkIslands(99, 0, cx, 0, dense).length
    }
    expect(nDense).toBeGreaterThan(nBase * 1.5)

    for (const isl of generateChunkIslands(99, 0, 1, 1, big)) {
      expect(isl.scale).toBeLessThanOrEqual(LAYOUT.scaleMax * 1.5 + 1e-9)
    }
    const maxScaleBase = LAYOUT.scaleMax
    const scalesBig = generateChunkIslands(99, 0, 2, 2, big).map(i => i.scale)
    // with 1.5x mult at least the range extends beyond the base max sometimes across cells
    const anyBeyond = [3, 4, 5, 6].some(c =>
      generateChunkIslands(99, 0, c, 2, big).some(i => i.scale > maxScaleBase),
    )
    expect(anyBeyond || scalesBig.some(s => s > maxScaleBase)).toBe(true)

    for (const isl of generateChunkIslands(99, 0, 3, 3, flat)) {
      expect(Math.abs(isl.y - CHUNK.yCenter)).toBeLessThanOrEqual(CHUNK.yHalf * 0.2 + 1e-9)
    }
  })

  it('island ids are unique within and across neighboring chunks', () => {
    const ids = new Set<number>()
    let n = 0
    for (let cx = -3; cx <= 3; cx++) {
      for (let cz = -3; cz <= 3; cz++) {
        for (const isl of generateChunkIslands(4242, 1, cx, cz, mods)) {
          ids.add(isl.id)
          n++
        }
      }
    }
    expect(ids.size).toBe(n)
  })

  it('escalated realm mods still generate sane counts (pool math)', () => {
    // Worst case: jungle at loop 3 -> density 1.25 * 1.15
    const worst = getRealmForDepth(19) // depth 19 = jungle, loop 3
    expect(worst.realm.id).toBe('jungle')
    let total = 0
    let cells = 0
    for (let cx = -2; cx <= 2; cx++) {
      for (let cz = -2; cz <= 2; cz++) {
        total += generateChunkIslands(31337, 19, cx, cz, worst.mods).length
        cells++
      }
    }
    // genRadius 144 / size 48 covers ~28 cells; extrapolate this 25-cell sample
    const projected = (total / cells) * 28
    expect(projected).toBeLessThan(192)
  })
})
