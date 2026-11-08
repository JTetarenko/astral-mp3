/**
 * The combat-stats snapshot contract between the RPG layer (which derives it
 * from attributes + equipped relics) and the combat sim (which only ever reads
 * the per-run copy on runState.stats). Lives alone with zero imports so
 * rpg.ts, items.ts and runState.ts can all depend on it without cycles.
 */

export interface CombatStats {
  /** Latched horrors survivable before DOWNED. Integer, clamped 1..6 (physical anchor count). */
  maxLatch: number
  /** Blood pool. Warden blows + latch gnaws drain it; 0 = downed. Latch
   * overload still instant-downs regardless. Clamped 40..400. */
  maxHp: number
  snapDamageMult: number
  boltDamageMult: number
  novaRadiusMult: number
  moveMult: number
  chargeGainMult: number
  /** Divides cast windup + recover. Clamped 0.5..2.5. */
  castSpeedMult: number
  /** Divides the draw's chargeTime. Clamped 0.5..2.5. */
  drawSpeedMult: number
  /** Extra pierce victims on a half-draw-or-better shot. Integer, clamped 0..2. */
  pierceBonus: number
}

/** Level-1, no-relic baseline — must equal the pre-RPG game feel. */
export const BASE_STATS: CombatStats = {
  maxLatch: 3,
  maxHp: 100,
  snapDamageMult: 1,
  boltDamageMult: 1,
  novaRadiusMult: 1,
  moveMult: 1,
  chargeGainMult: 1,
  castSpeedMult: 1,
  drawSpeedMult: 1,
  pierceBonus: 0,
}

export function cloneStats(s: CombatStats): CombatStats {
  return { ...s }
}
