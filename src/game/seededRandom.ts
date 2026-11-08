/** Deterministic 32-bit PRNG. Same seed -> same sequence, in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a 32-bit hash over bytes. */
export function fnv1a(bytes: ArrayLike<number>): number {
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i] & 0xff
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Mix four 32-bit ints into one well-distributed 32-bit seed. Used to derive
 * independent rng streams per (trackSeed, depth, chunkX, chunkZ) so chunk
 * generation is order-independent.
 */
export function hashInts(a: number, b: number, c: number, d: number): number {
  let h = 0x9e3779b9 ^ Math.imul(a | 0, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= Math.imul(b | 0, 0x27d4eb2f)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h ^= Math.imul(c | 0, 0x165667b1)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= Math.imul(d | 0, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  return (h ^ (h >>> 13)) >>> 0
}

export function range(rng: () => number, a: number, b: number): number {
  return a + rng() * (b - a)
}

export function rangeInt(rng: () => number, a: number, b: number): number {
  return Math.min(b, Math.floor(range(rng, a, b + 1)))
}

export function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))]
}
