/**
 * The single sim -> UI combat-feel contract: a per-hit ring buffer (damage
 * bubbles, hitmarkers, kill confirms) plus one-shot monotonic counters
 * (whiff/denied/kill/charge events) and a hit-stop mirror. Zero imports,
 * zero allocation after module init — producers overwrite pre-allocated ring
 * slots and bump counters; consumers diff serials (never callbacks, the
 * runState doctrine). Serials and counters survive resetFeel so mounted
 * consumers never see phantom events across runs.
 */

/** Hit kinds. */
export const HK = {
  STRIKE: 0,
  BOLT: 1,
  NOVA: 2,
  WARDEN_WEAK: 3,
  /** Damage TAKEN by the player from a warden blow. */
  PLAYER_TAKEN: 4,
  /** Damage TAKEN by the player from a latched gnaw tick. */
  LATCH_GNAW: 5,
} as const

export interface HitEvent {
  /** Monotonic id; 0 = slot never written. */
  serial: number
  /** Sim clock at write (consumers animate on wall clock — hit-stop safe). */
  t: number
  /** Event position. Dealt kinds (0-3): the victim. PLAYER_TAKEN (4): the
   * ATTACKER — the HUD derives its directional damage arc from it.
   * LATCH_GNAW (5): the player (riders have no useful bearing). */
  x: number
  y: number
  z: number
  /** Post-multiplier damage dealt (or taken, kinds 4/5). */
  amount: number
  kind: number
  /** On-beat or perfect-precision player hit (styling). */
  crit: 0 | 1
  /** This event destroyed the target. */
  kill: 0 | 1
  /** Enemy pool idx | 300 warden | -1 player. */
  targetId: number
}

export const HIT_RING_CAP = 32

function freshEvent(): HitEvent {
  return { serial: 0, t: 0, x: 0, y: 0, z: 0, amount: 0, kind: 0, crit: 0, kill: 0, targetId: -1 }
}

export const feel = {
  /** Serial of the newest event; slot index = serial % HIT_RING_CAP. */
  hitSerial: 0,
  hitRing: Array.from({ length: HIT_RING_CAP }, freshEvent) as HitEvent[],

  // ---- one-shot counters (consumers diff; monotonic across runs) ----
  /** LMB consumed with no target, or a strike that lost its victim. */
  whiffCount: 0,
  /** E consumed without enough charge. */
  deniedNovaCount: 0,
  /** Swarm kill via any source. */
  killConfirmCount: 0,
  wardenKillConfirmCount: 0,
  /** shiftCharge crossed shiftCost (the collect that armed the gate). */
  chargeFullCount: 0,
  /** The warden fell; the gate seal broke. */
  gateUnsealedCount: 0,
  /** A cast loosed (quick or charged) — HUD flashes the reticle. */
  castLooseCount: 0,
  /** Subset of looses that landed on the beat (gold flash). */
  castLooseBeatCount: 0,
  /** Style of the newest loose: 0 quick / 1 charged / 2 volley / 3 storm.
   * Written BEFORE castLooseCount++ (value-before-counter). */
  lastLooseKind: 0,
  /** Overdraw volley releases. */
  castVolleyCount: 0,
  /** Resonance-storm releases. */
  castStormCount: 0,
  /** Bow-combo tier at the newest tier-up (written BEFORE castComboTierCount++). */
  lastComboTier: 0,
  /** Bow-combo tier-up edges. */
  castComboTierCount: 0,
  /** Bow combo died to the decay window. */
  castComboBreakCount: 0,
  /** Storm arming edges (on-beat streak or combo tier 3). */
  stormArmedCount: 0,

  // ---- continuous, written every frame ----
  /** Aiming into the gate cone while the gate is warden-sealed. */
  deniedGateAim: false,
  /** Mirrors of gameTime, stamped by the FrameDriver tick. */
  hitStopActive: false,
  hitStopT: 0,
  hitStopCount: 0,
}

/** Zero-alloc ring write. */
export function pushHit(
  t: number,
  x: number,
  y: number,
  z: number,
  amount: number,
  kind: number,
  crit: boolean,
  kill: boolean,
  targetId: number,
): void {
  feel.hitSerial++
  const e = feel.hitRing[feel.hitSerial % HIT_RING_CAP]
  e.serial = feel.hitSerial
  e.t = t
  e.x = x
  e.y = y
  e.z = z
  e.amount = amount
  e.kind = kind
  e.crit = crit ? 1 : 0
  e.kill = kill ? 1 : 0
  e.targetId = targetId
}

/** Run reset: serials/counters SURVIVE (consumers diff them); only the
 * continuous fields clear. */
export function resetFeel(): void {
  feel.deniedGateAim = false
  feel.hitStopActive = false
  feel.hitStopT = 0
}
