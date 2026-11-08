/**
 * Shared world-layout constants. Chunk generation (chunks.ts) and the point
 * spawner (worldState.ts) reuse the scale/y bands and spacing rules that
 * shaped the original finite layout, so the endless world keeps its feel.
 */
export const LAYOUT = {
  yMin: -20,
  yMax: 25,
  scaleMin: 1.5,
  scaleMax: 7,
  pointMinPairDist: 18,
  pointMinSpawnDist: 20,
  spawn: { x: 0, y: 4, z: 40 },
}
