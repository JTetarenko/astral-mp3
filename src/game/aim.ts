import { isTargetable } from './enemyState'

export const AIM = {
  coneHalfRad: 0.122, // ~7 degrees
  maxDist: 70,
  minDist: 3,
  distFadeStart: 5,
  distFadeMax: 0.6,
}

/** Gate targeting: wider cone, longer reach — the run-defining action. */
export const GATE_AIM = {
  coneHalfRad: 0.18,
  maxDist: 90,
  minDist: 4,
  distFadeStart: 5,
  distFadeMax: 0.6,
}

/** Horror targeting: slightly wider than points, shorter reach — combat
 * happens in the mid-field, not at the fog line. */
export const ENEMY_AIM = {
  coneHalfRad: 0.16,
  maxDist: 60,
  minDist: 2.5,
  distFadeStart: 5,
  distFadeMax: 0.6,
}

/** Warden weak point: generous cone — it is the fight-defining action. */
export const WARDEN_AIM = {
  coneHalfRad: 0.2,
  maxDist: 80,
  minDist: 4,
  distFadeStart: 5,
  distFadeMax: 0.6,
}

export type AimConfig = typeof AIM

/** Target-stability knobs consumed by snapController.updateAim. */
export const AIM_HYST = {
  /** Score bonus for whichever candidate is ALREADY the held target —
   * continuous hysteresis, no timers, kills point<->enemy flicker. */
  stickyMult: 1.25,
  /** Min seconds between lock sfx ticks (stops the machine-gun). */
  lockSfxCooldown: 0.12,
} as const

export interface AimResult {
  index: number
  angle: number
  dist: number
  score: number
}

export type AlignBand = 'perfect' | 'good' | 'lock'

export interface AlignmentQuality {
  /** 1 at/inside perfectRad, smooth fall to 0 at coneHalfRad. */
  q: number
  band: AlignBand
}

/**
 * Live alignment read for the aim thread: how close the current angular error
 * is to a perfect snap. Thresholds are passed in (SCORING.perfectRad/goodRad)
 * so aim.ts stays decoupled from scoring.ts.
 */
export function alignmentQuality(
  angleRad: number,
  coneHalfRad: number,
  perfectRad: number,
  goodRad: number,
): AlignmentQuality {
  const a = Math.max(0, angleRad)
  const band: AlignBand = a <= perfectRad ? 'perfect' : a <= goodRad ? 'good' : 'lock'
  if (a <= perfectRad) return { q: 1, band }
  if (a >= coneHalfRad) return { q: 0, band }
  const t = (a - perfectRad) / (coneHalfRad - perfectRad)
  // smoothstep-shaped falloff: gentle near perfect, steep at the cone edge
  const s = 1 - t * t * (3 - 2 * t)
  return { q: s, band }
}

/** Scalar aim-assist score: 1 at crosshair-center/near, 0 outside the cone. */
export function aimScore(angle: number, dist: number, cfg: AimConfig = AIM): number {
  if (angle >= cfg.coneHalfRad || dist > cfg.maxDist || dist < cfg.minDist) return 0
  const angular = 1 - angle / cfg.coneHalfRad
  const distPenalty = Math.min(cfg.distFadeMax, Math.max(0, (dist - cfg.distFadeStart) / cfg.maxDist))
  return angular * (1 - distPenalty)
}

/** Structure-of-arrays point pool (worldState.points is the live source). */
export interface PoolPoints {
  active: ArrayLike<number>
  x: ArrayLike<number>
  y: ArrayLike<number>
  z: ArrayLike<number>
}

/**
 * Picks the best active resonance point inside the aim cone.
 * Pure scalar math — safe to call every frame and to unit-test.
 */
export function pickPoolTarget(
  pts: PoolPoints,
  px: number,
  py: number,
  pz: number,
  fx: number,
  fy: number,
  fz: number,
  cfg: AimConfig = AIM,
): AimResult {
  let bestIndex = -1
  let bestAngle = 0
  let bestDist = 0
  let bestScore = 0
  for (let i = 0; i < pts.active.length; i++) {
    if (!pts.active[i]) continue
    const dx = pts.x[i] - px
    const dy = pts.y[i] - py
    const dz = pts.z[i] - pz
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (dist > cfg.maxDist || dist < cfg.minDist) continue
    const dot = (dx * fx + dy * fy + dz * fz) / dist
    if (dot <= 0) continue
    const angle = Math.acos(Math.min(1, dot))
    const score = aimScore(angle, dist, cfg)
    if (score > bestScore) {
      bestScore = score
      bestIndex = i
      bestAngle = angle
      bestDist = dist
    }
  }
  return { index: bestIndex, angle: bestAngle, dist: bestDist, score: bestScore }
}

/** Structural view of the enemy pool (enemyState.pool is the live source). */
export interface EnemyAimPool {
  state: ArrayLike<number>
  x: ArrayLike<number>
  y: ArrayLike<number>
  z: ArrayLike<number>
}

/**
 * Best targetable horror in the aim cone (LATCHED/DYING/DORMANT excluded —
 * you strike hunters, not riders or corpses). Pure scalar math.
 */
export function pickEnemyTarget(
  pool: EnemyAimPool,
  px: number,
  py: number,
  pz: number,
  fx: number,
  fy: number,
  fz: number,
  cfg: AimConfig = ENEMY_AIM,
): AimResult {
  let bestIndex = -1
  let bestAngle = 0
  let bestDist = 0
  let bestScore = 0
  for (let i = 0; i < pool.state.length; i++) {
    if (!isTargetable(pool.state[i])) continue
    const dx = pool.x[i] - px
    const dy = pool.y[i] - py
    const dz = pool.z[i] - pz
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (dist > cfg.maxDist || dist < cfg.minDist) continue
    const dot = (dx * fx + dy * fy + dz * fz) / dist
    if (dot <= 0) continue
    const angle = Math.acos(Math.min(1, dot))
    const score = aimScore(angle, dist, cfg)
    if (score > bestScore) {
      bestScore = score
      bestIndex = i
      bestAngle = angle
      bestDist = dist
    }
  }
  return { index: bestIndex, angle: bestAngle, dist: bestDist, score: bestScore }
}

/** Cone test against the single realm gate. index 0 on hit, -1 otherwise. */
export function pickGate(
  gx: number,
  gy: number,
  gz: number,
  px: number,
  py: number,
  pz: number,
  fx: number,
  fy: number,
  fz: number,
  cfg: AimConfig = GATE_AIM,
): AimResult {
  const dx = gx - px
  const dy = gy - py
  const dz = gz - pz
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (dist > cfg.maxDist || dist < cfg.minDist) {
    return { index: -1, angle: 0, dist, score: 0 }
  }
  const dot = (dx * fx + dy * fy + dz * fz) / dist
  if (dot <= 0) return { index: -1, angle: 0, dist, score: 0 }
  const angle = Math.acos(Math.min(1, dot))
  const score = aimScore(angle, dist, cfg)
  return { index: score > 0 ? 0 : -1, angle, dist, score }
}
