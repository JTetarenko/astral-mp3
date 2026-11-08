/**
 * Pure math for the cracked-crystal resonance artifacts: seeded crack planes
 * through the origin classify faces into dark body vs HDR glowing crack (the
 * CrystalShards two-tone vertex-color trick), and per-respawn variant picking
 * keys off the pool serial. No three.js — node-testable.
 */
import { hashInts, mulberry32 } from '../game/seededRandom'

/** HDR crack faces cross the bloom threshold; the body stays a silhouette. */
export const CRACK_BRIGHT = 3.2
export const BODY_DIM = 0.06
export const CRYSTAL_VARIANTS = 3

/** Crack brightness for a point: near any crack plane -> HDR, else body. */
export function crackValue(
  x: number,
  y: number,
  z: number,
  planes: number[][],
  eps = 0.14,
): number {
  for (let i = 0; i < planes.length; i++) {
    const p = planes[i]
    if (Math.abs(x * p[0] + y * p[1] + z * p[2]) < eps) return CRACK_BRIGHT
  }
  return BODY_DIM
}

/** Two seeded unit-normal crack planes per crystal variant. */
export function crackPlanesForVariant(variant: number): number[][] {
  const rng = mulberry32((0xc4a7 + variant * 977) >>> 0)
  const planes: number[][] = []
  for (let k = 0; k < 2; k++) {
    const theta = rng() * Math.PI * 2
    const zc = rng() * 2 - 1
    const s = Math.sqrt(Math.max(0, 1 - zc * zc))
    planes.push([Math.cos(theta) * s, zc, Math.sin(theta) * s])
  }
  return planes
}

/** Deterministic per-respawn seed (serial bumps on every pool respawn). */
export function crystalVariantSeed(serial: number, slot: number): number {
  return hashInts(serial, slot, 0x77cc, 0x51a9)
}

export function pickCrystalVariant(seed: number): number {
  return seed % CRYSTAL_VARIANTS
}
