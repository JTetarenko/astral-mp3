/**
 * Pure reticle-state decode: snapController sentinels + the denied-gate feel
 * signal -> a kind the DOM layer maps to color classes, plus the cone width
 * used to scale the lock brackets. No imports — node-tested.
 */

export type ReticleKind = 'none' | 'point' | 'enemy' | 'warden' | 'gate' | 'sealed'

/** Sentinels (mirrors snapController — literal so this module stays pure). */
export const RETICLE_SENTINELS = {
  GATE: 100,
  ENEMY_BASE: 200,
  WARDEN: 300,
} as const

export function reticleKindFor(target: number, deniedGateAim: boolean): ReticleKind {
  if (target === RETICLE_SENTINELS.WARDEN) return 'warden'
  if (target === RETICLE_SENTINELS.GATE) return 'gate'
  if (target >= RETICLE_SENTINELS.ENEMY_BASE) return 'enemy'
  if (target >= 0) return 'point'
  // no lock, but the player is aiming at a warden-sealed gate: say WHY
  if (deniedGateAim) return 'sealed'
  return 'none'
}

/** Aim-cone half angle per kind (rad) — mirrors src/game/aim.ts configs. */
export function coneHalfFor(kind: ReticleKind): number {
  switch (kind) {
    case 'enemy':
      return 0.16
    case 'warden':
      return 0.2
    case 'gate':
    case 'sealed':
      return 0.18
    default:
      return 0.122
  }
}
