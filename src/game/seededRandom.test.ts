import { describe, expect, it } from 'vitest'
import { fnv1a, mulberry32, range, rangeInt } from './seededRandom'

describe('mulberry32', () => {
  it('is deterministic for the same seed', () => {
    const a = mulberry32(1234)
    const b = mulberry32(1234)
    for (let i = 0; i < 1000; i++) expect(a()).toBe(b())
  })

  it('differs across seeds', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    const seqA = Array.from({ length: 10 }, () => a())
    const seqB = Array.from({ length: 10 }, () => b())
    expect(seqA).not.toEqual(seqB)
  })

  it('stays in [0, 1)', () => {
    const rng = mulberry32(99)
    for (let i = 0; i < 10000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('fnv1a', () => {
  it('matches known vectors', () => {
    expect(fnv1a([])).toBe(0x811c9dc5)
    expect(fnv1a([0x61, 0x62, 0x63])).toBe(0x1a47e90b) // "abc"
  })

  it('is stable and spreads', () => {
    const a = fnv1a(new Uint8Array([1, 2, 3, 4]))
    expect(fnv1a(new Uint8Array([1, 2, 3, 4]))).toBe(a)
    expect(fnv1a(new Uint8Array([1, 2, 3, 5]))).not.toBe(a)
  })
})

describe('range helpers', () => {
  it('range stays in bounds', () => {
    const rng = mulberry32(7)
    for (let i = 0; i < 1000; i++) {
      const v = range(rng, -5, 5)
      expect(v).toBeGreaterThanOrEqual(-5)
      expect(v).toBeLessThan(5)
    }
  })

  it('rangeInt is inclusive of both ends', () => {
    const rng = mulberry32(7)
    const seen = new Set<number>()
    for (let i = 0; i < 1000; i++) seen.add(rangeInt(rng, 0, 3))
    expect([...seen].sort()).toEqual([0, 1, 2, 3])
  })
})
