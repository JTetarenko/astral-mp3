/**
 * Third-person boom math: constants plus a cheap segment-vs-bounding-sphere
 * clearance test used to shorten the boom instead of clipping into islands.
 * Pure and zero-alloc — node-testable like aim.ts.
 */

export const BOOM = {
  /** Boom length along -forward. */
  back: 5.5,
  /** Pivot lift above the player origin. */
  up: 1.6,
  /** Right-shoulder offset in the yaw plane. */
  side: 0.9,
  /** V-toggle ease (~95% settled in 0.27s). */
  blendTau: 0.09,
  /** Positional anchor lag by phase. */
  tauIdle: 0.07,
  tauStreak: 0.1,
  tauPull: 0.22,
  /** Occlusion shortening: fast in (never see inside rock), slow out. */
  occludeInTau: 0.03,
  occludeOutTau: 0.25,
  /** Island bounding-sphere radius = scale * K + pad. */
  occluderRadK: 1.2,
  occluderPad: 0.4,
}

/** Structural subset of IslandSpec / worldState.IslandSlot. */
export interface Occluder {
  x: number
  y: number
  z: number
  scale: number
  /** IslandSlot free-flag; plain specs (undefined) count as live. */
  used?: boolean
}

export function islandOccluderRadius(scale: number, cfg = BOOM): number {
  return scale * cfg.occluderRadK + cfg.occluderPad
}

/**
 * Smallest clear fraction t in [0,1] along segment A->B against island
 * bounding spheres. Spheres CONTAINING A are skipped — hovering 2.2u above an
 * island top puts the player inside its inflated sphere while the actual rock
 * is well below the boom. Returns 1 when unobstructed or degenerate.
 */
export function boomClearT(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  islands: readonly Occluder[],
  cfg = BOOM,
): number {
  const dx = bx - ax
  const dy = by - ay
  const dz = bz - az
  const segSq = dx * dx + dy * dy + dz * dz
  if (segSq < 1e-6) return 1
  let tMin = 1
  // Early-out radius: segment length + max plausible island radius.
  const reach = Math.sqrt(segSq) + 12
  const reachSq = reach * reach
  for (let i = 0; i < islands.length; i++) {
    const isl = islands[i]
    if (isl.used === false) continue
    const cx = isl.x - ax
    const cy = isl.y - ay
    const cz = isl.z - az
    const cSq = cx * cx + cy * cy + cz * cz
    if (cSq > reachSq) continue
    const r = islandOccluderRadius(isl.scale, cfg)
    if (cSq < r * r) continue // A inside sphere: hovering above this island
    const tc = (cx * dx + cy * dy + cz * dz) / segSq // closest-approach t
    if (tc < 0) continue // sphere behind A
    const px = cx - tc * dx
    const py = cy - tc * dy
    const pz = cz - tc * dz
    const dSq = px * px + py * py + pz * pz
    if (dSq >= r * r) continue
    const dt = Math.sqrt((r * r - dSq) / segSq)
    const tHit = tc - dt
    if (tHit > 0 && tHit < tMin) tMin = tHit
  }
  return tMin
}
