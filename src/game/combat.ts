/**
 * Combat math: damage, scores, ballistics. Pure scalar functions in the
 * scoring.ts mold — every tuning knob for the battle layer lives in COMBAT.
 */

export const COMBAT = {
  strike: {
    base: 30,
    perfectBonus: 25,
    goodBonus: 10,
    onBeatMult: 1.5,
    /** Radial knockback around a strike hit. */
    knockR: 9,
    knock: 16,
    /** Serial-guarded arrival still whiffs past this distance. */
    hitR: 4.5,
    /** Snap-strike passes THROUGH the target by this much (no landing). */
    passThrough: 6,
    /** Exit speed along the approach after a connected strike. */
    exitSpeed: 14,
  },
  bolt: {
    /** Quick-cast baseline — each cast must matter at the slower cadence. */
    damage: 18,
    speed: 52,
    life: 1.6,
    hitR: 1.6,
    /** Max homing turn rate, rad/s. */
    homeTurn: 3,
    /** Upward lob at launch (quick cast only) — the wizard's arc. */
    lobUp: 2.2,
    /** Gravity on a quick bolt, u/s². Readable arc that still lands ~on-crosshair. */
    gravity: 5,
  },
  cast: {
    /** Press → projectile anticipation. Every millisecond is choreographed. */
    windup: 0.12,
    /** Windup end → full draw. */
    chargeTime: 0.85,
    recoverQuick: 0.18,
    recoverFull: 0.32,
    /** A release that entered CHARGE never fires weaker than this. */
    minChargePower: 0.15,
    /** On-beat RELEASE bonus — timing skill lives at the loose instant. */
    onBeatMult: 1.25,
    /** Movement factor while drawing = 1 - moveSlowAtFull * power. */
    moveSlowAtFull: 0.4,
    /** Full-draw (power 1) projectile targets; curves lerp toward these. */
    fullDamage: 55,
    fullSpeed: 72,
    fullHitR: 2.6,
    fullGravity: 1.5,
    fullHomeTurn: 0.8,
    fullLife: 1.4,
    maxPierce: 3,
    /** Charged-impact radial shove (power >= 0.5), scaled by power. */
    knockR: 7,
    knock: 14,
    /** Seconds held past full draw to arm the volley split (÷ drawSpeedMult). */
    overdrawTime: 0.48,
    /** Overdraw volley: a flat 3-bolt fan. No homing — the spread is honest. */
    volleyCount: 3,
    /** Per-side fan half-angle, rad (~8°; ~4.2u apart at 30u range). */
    volleySpreadRad: 0.14,
    /** Per-bolt damage × castDamage(1): all three landing beats one full shot. */
    volleyDamageK: 0.55,
    /** Deterministic side-bolt speed variance (center 1.0, sides 1 ∓/± this). */
    volleySpeedVar: 0.06,
    /** Under fullLife — the fan is a mid-range verb. */
    volleyLife: 1.2,
    /** Resonance storm: shards launched up-and-over, homing hard on the swarm. */
    stormCount: 5,
    /** Per-shard yaw step, rad (5 shards span ±2 steps). */
    stormFanRad: 0.175,
    /** Launch pitch above aim, rad (~31°) — the up-and-over arc. */
    stormUpPitch: 0.55,
    /** Per-shard damage × castDamage(1) — 2.5 full shots total, paid for by the streak. */
    stormDamageK: 0.5,
    /** Homing gain (quick bolt 3, full draw 0.8) — shards chase. */
    stormHomeTurn: 6,
    stormSpeedK: 0.85,
    /** Strong pull-down so the fan rains onto targets instead of sailing. */
    stormGravity: 9,
    stormLife: 2.2,
    /** Five shards already multi-target; none pierce. */
    stormPierce: 0,
  },
  nova: {
    /** shiftCharge cost — every nova is a third of an early gate. */
    cost: 2,
    radius: 16,
    damage: 26,
    knock: 24,
  },
  /** Damage factor on the warden body outside EXPOSED/STAGGER windows. */
  wardenArmor: 0.25,
  /** Snap-strike damage on an open weak point (before multipliers). */
  wardenWeakHit: 90,
  score: {
    swarmKillBase: 60,
    wardenKillBase: 600,
  },
} as const

/** Snap-strike damage from aim precision + beat timing. Thresholds are passed
 * in (SCORING.perfectRad/goodRad) so combat stays decoupled from scoring. */
export function snapStrikeDamage(
  aimErrorRad: number,
  perfectRad: number,
  goodRad: number,
  onBeat: boolean,
  mult: number,
): number {
  const a = Math.max(0, aimErrorRad)
  let dmg = COMBAT.strike.base
  if (a <= perfectRad) dmg += COMBAT.strike.perfectBonus
  else if (a <= goodRad) dmg += COMBAT.strike.goodBonus
  if (onBeat) dmg *= COMBAT.strike.onBeatMult
  return dmg * Math.max(0, mult)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t))
}

/** Cast damage curve — the ease-in makes the last third of a draw visibly worth it. */
export function castDamage(power: number, mult: number): number {
  const p = Math.min(1, Math.max(0, power))
  return lerp(COMBAT.bolt.damage, COMBAT.cast.fullDamage, Math.pow(p, 1.35)) * Math.max(0, mult)
}

export function castSpeed(power: number): number {
  return lerp(COMBAT.bolt.speed, COMBAT.cast.fullSpeed, power)
}

export function castHitR(power: number): number {
  return lerp(COMBAT.bolt.hitR, COMBAT.cast.fullHitR, power)
}

export function castGravity(power: number): number {
  return lerp(COMBAT.bolt.gravity, COMBAT.cast.fullGravity, power)
}

export function castHomeTurn(power: number): number {
  return lerp(COMBAT.bolt.homeTurn, COMBAT.cast.fullHomeTurn, power)
}

export function castLife(power: number): number {
  return lerp(COMBAT.bolt.life, COMBAT.cast.fullLife, power)
}

/** Discrete pierce tiers so the HUD ring reads honestly: none / half-draw / full. */
export function castPierce(power: number, pierceBonus: number): number {
  const bonus = Math.max(0, Math.round(pierceBonus))
  if (power < 0.5) return 0
  if (power >= 0.999) return COMBAT.cast.maxPierce + bonus
  return 1 + bonus
}

/** A bolt hit at or above this base damage styles/feels as a charged impact. */
export const CHARGED_HIT_DMG = castDamage(0.5, 1)

export function boltHitDamage(mult: number): number {
  return castDamage(0, mult)
}

/** Linear falloff: full at the center, zero at the ring edge, never negative. */
export function novaHitDamage(dist: number, radius: number, mult: number): number {
  if (radius <= 0) return 0
  const k = 1 - Math.min(1, Math.max(0, dist) / radius)
  return COMBAT.nova.damage * k * Math.max(0, mult)
}

/** Kill score scales with the horror's bulk and the current depth. */
export function killScore(hpMax: number, depth: number): number {
  const bulk = Math.max(0.5, hpMax / 30)
  return Math.round(COMBAT.score.swarmKillBase * bulk * (1 + 0.2 * Math.max(0, depth)))
}

export function wardenScore(depth: number): number {
  return COMBAT.score.wardenKillBase * (Math.max(0, depth) + 1)
}

/** Leap arc height: linear blend + parabolic lift, matching the sim's curve. */
export function leapCurveY(k: number, y0: number, y1: number, lift: number): number {
  const t = Math.min(1, Math.max(0, k))
  return y0 + (y1 - y0) * t + lift * 4 * t * (1 - t)
}
