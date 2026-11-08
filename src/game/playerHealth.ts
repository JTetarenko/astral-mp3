/**
 * The player blood pool. All hp mutation flows through here so the rules
 * live in one place: warden blows respect a short mercy window (SLAM+LASH
 * overlap must not double-dip), latch gnaws are the un-dodgeable pressure
 * clock, passive regen recovers a skirmish but never a war (delayed, slow,
 * capped below full — full heals come only from realm shifts and the
 * phoenix ash). Downed-at-0 is enforced by snapController's existing check;
 * latch overload still instant-downs regardless of hp. Imports runState +
 * feelSignals only — node-tested.
 */
import { feel, HK, pushHit } from './feelSignals'
import { runState } from './runState'

export const PLAYER_HP = {
  base: 100,
  /** Per latched rider per gnaw tick. */
  gnawDamage: 3,
  /** Seconds between gnaw ticks. */
  gnawPeriod: 1.0,
  /** Seconds after attach before the first tick (a fast tear-off is free). */
  gnawFirstAt: 0.6,
  /** Seconds ignoring further WARDEN damage after a warden hit. */
  wardenMercy: 0.5,
  /** Seconds without ANY damage before regen starts. */
  regenDelay: 5,
  /** HP per second while regenerating. */
  regenRate: 3,
  /** Passive regen ceiling as a fraction of maxHp. */
  regenCapFrac: 0.7,
  /** Phoenix ash revive floor as a fraction of maxHp. */
  reviveFrac: 0.5,
  /** HP restored by a perfect point snap. */
  perfectHeal: 3,
} as const

/**
 * Apply damage to the player. Returns the amount actually applied (0 when
 * the warden mercy window swallowed it). Pushes the taken-damage feel event
 * so the HUD flashes and bubbles without a second API.
 */
export function damagePlayer(
  amount: number,
  t: number,
  kind: typeof HK.PLAYER_TAKEN | typeof HK.LATCH_GNAW,
  x: number,
  y: number,
  z: number,
): number {
  const dmg = Math.max(0, amount)
  if (dmg <= 0 || runState.hp <= 0) return 0
  const c = runState.combat
  if (kind === HK.PLAYER_TAKEN) {
    if (c.lastWardenDamageAt >= 0 && t - c.lastWardenDamageAt < PLAYER_HP.wardenMercy) return 0
    c.lastWardenDamageAt = t
    c.wardenDamageTaken += dmg
  } else {
    c.gnawDamageTaken += dmg
  }
  c.damageTaken += dmg
  c.lastDamageTakenAt = t
  runState.hp = Math.max(0, runState.hp - dmg)
  pushHit(t, x, y, z, dmg, kind, false, runState.hp <= 0, -1)
  return dmg
}

export function healPlayer(amount: number): void {
  if (amount <= 0) return
  runState.hp = Math.min(runState.stats.maxHp, runState.hp + amount)
}

/**
 * Delayed, capped passive regen. Ticked with WORLD dt (freezes through a
 * hit-stop alongside the gnaws that oppose it).
 */
export function tickPlayerRegen(dt: number, t: number): void {
  if (runState.hp <= 0) return
  const c = runState.combat
  if (c.lastDamageTakenAt < 0) return // untouched this run: nothing to recover
  if (t - c.lastDamageTakenAt < PLAYER_HP.regenDelay) return
  const cap = runState.stats.maxHp * PLAYER_HP.regenCapFrac
  if (runState.hp >= cap) return
  runState.hp = Math.min(cap, runState.hp + PLAYER_HP.regenRate * dt)
}

export function isPlayerDead(): boolean {
  return runState.hp <= 0
}

/** Phoenix-ash floor: revive never returns less than half the pool. */
export function reviveFloor(): number {
  return Math.round(runState.stats.maxHp * PLAYER_HP.reviveFrac)
}

/** Convenience for tests/consumers. */
export { feel, HK }
