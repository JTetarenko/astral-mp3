/**
 * Endless-world chunk generation. The XZ plane is a grid of square cells;
 * each cell owns an independent rng stream seeded from (trackSeed, depth,
 * cx, cz), so generation is deterministic regardless of visit order and
 * re-streaming a chunk after wandering away reproduces it bit-for-bit.
 * Pure module — worldState.ts owns the runtime pools and streaming window.
 */
import { hashInts, mulberry32, range, rangeInt } from './seededRandom'
import { LAYOUT } from './layout'
import type { IslandSpec } from '../types'
import type { RealmMods } from './realms'

export const CHUNK = {
  /** Cell side, world units. */
  size: 48,
  /** Chunks whose center falls within this radius of the player are live. */
  genRadius: 144,
  /** Stream-out hysteresis: freed only beyond this radius. */
  freeRadius: 176,
  /** Base islands per cell before realm density scaling. */
  islandsMin: 3,
  islandsMax: 5,
  /** Keep island centers off cell edges so neighbors don't visually fuse. */
  margin: 4,
  /** Vertical band: LAYOUT.yMin/yMax recast as center ± half for yBandMult. */
  yCenter: (LAYOUT.yMin + LAYOUT.yMax) / 2,
  yHalf: (LAYOUT.yMax - LAYOUT.yMin) / 2,
}

/** Pack signed cell coords into one int key for a single Map. */
export function chunkKey(cx: number, cz: number): number {
  return ((cx + 0x8000) << 16) | ((cz + 0x8000) & 0xffff)
}

export function chunkSeed(trackSeed: number, depth: number, cx: number, cz: number): number {
  return hashInts(trackSeed, depth, cx, cz)
}

/** An island produced by chunk gen; id seeds all derived dressing (shards, debris). */
export interface ChunkIsland extends IslandSpec {
  id: number
}

export function generateChunkIslands(
  trackSeed: number,
  depth: number,
  cx: number,
  cz: number,
  mods: RealmMods,
  cfg = CHUNK,
): ChunkIsland[] {
  const seed = chunkSeed(trackSeed, depth, cx, cz)
  const rng = mulberry32(seed)
  const base = range(rng, cfg.islandsMin, cfg.islandsMax)
  const count = Math.max(1, Math.round(base * mods.islandDensity))
  const x0 = cx * cfg.size + cfg.margin
  const x1 = (cx + 1) * cfg.size - cfg.margin
  const z0 = cz * cfg.size + cfg.margin
  const z1 = (cz + 1) * cfg.size - cfg.margin
  const islands: ChunkIsland[] = []
  for (let i = 0; i < count; i++) {
    islands.push({
      id: (seed ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0,
      x: range(rng, x0, x1),
      y: cfg.yCenter + range(rng, -1, 1) * cfg.yHalf * mods.yBandMult,
      z: range(rng, z0, z1),
      scale: range(rng, LAYOUT.scaleMin, LAYOUT.scaleMax) * mods.islandScaleMult,
      rotY: range(rng, 0, Math.PI * 2),
      bobPhase: range(rng, 0, Math.PI * 2),
      bobSpeed: range(rng, 0.1, 0.3),
      bobAmp: range(rng, 0.4, 1.2) * mods.bobMult,
      bassGain: range(rng, 0.5, 1.5),
      variant: rangeInt(rng, 0, 3),
    })
  }
  return islands
}
