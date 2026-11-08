/**
 * The cast/charge state machine behind the ranged attack. Pure and
 * node-testable in the inputBuffer.ts mold: snapController owns one mutable
 * CastState struct and steps it once per frame with REAL dt (a draw must not
 * freeze through hit-stop).
 *
 * Shape of the verb: every RMB press begins a WINDUP (visible anticipation).
 * Released before the windup completes -> a quick bolt looses at windup end
 * (a tap is a cast, never a dropped input). Still held -> CHARGE, power
 * ramping 0..1 like a bowstring; release looses at the current power.
 * Holding never autofires.
 */

import { COMBAT } from './combat'

export const CP = { IDLE: 0, WINDUP: 1, CHARGE: 2, RECOVER: 3 } as const

export interface CastState {
  phase: number
  /** Seconds in the current phase. */
  t: number
  /** 0..1 while CHARGE; frozen at the loose value through RECOVER. */
  power: number
  /** 0..1 held past full draw — the volley split ramp; frozen through RECOVER. */
  over: number
  /** RMB went up during WINDUP -> loose quick at windup end. */
  releasedEarly: boolean
  /** Full-draw cue one-shot latch. */
  fullFired: boolean
  /** Overdraw-split cue one-shot latch (caller-written, the fullFired contract). */
  overFired: boolean
}

/** The loose event returned by stepCast. power 0 = quick bolt; over 1 = volley. */
export interface CastLoose {
  power: number
  over: number
}

export function makeCastState(): CastState {
  return {
    phase: CP.IDLE,
    t: 0,
    power: 0,
    over: 0,
    releasedEarly: false,
    fullFired: false,
    overFired: false,
  }
}

export function resetCast(cs: CastState): void {
  cs.phase = CP.IDLE
  cs.t = 0
  cs.power = 0
  cs.over = 0
  cs.releasedEarly = false
  cs.fullFired = false
  cs.overFired = false
}

export function recoverDuration(power: number, castSpeedMult: number): number {
  const cfg = COMBAT.cast
  const p = Math.min(1, Math.max(0, power))
  return (cfg.recoverQuick + (cfg.recoverFull - cfg.recoverQuick) * p) / Math.max(0.01, castSpeedMult)
}

/**
 * Advance one frame. Returns a loose event exactly on the frame a projectile
 * should spawn, else null. `startEdge` is the consumed press-buffer edge (only
 * honored from IDLE), `heldNow` the raw RMB flag. `!canAct` mid-cast cancels
 * outright (snap streak/pull, shift, downed) — the caller plays the fizzle.
 */
export function stepCast(
  cs: CastState,
  startEdge: boolean,
  heldNow: boolean,
  canAct: boolean,
  dt: number,
  castSpeedMult: number,
  drawSpeedMult: number,
): CastLoose | null {
  const cfg = COMBAT.cast
  if (cs.phase !== CP.IDLE && !canAct) {
    resetCast(cs)
    return null
  }
  switch (cs.phase) {
    case CP.IDLE: {
      if (startEdge && canAct) {
        cs.phase = CP.WINDUP
        cs.t = 0
        cs.power = 0
        cs.over = 0
        cs.releasedEarly = false
        cs.fullFired = false
        cs.overFired = false
      }
      return null
    }
    case CP.WINDUP: {
      cs.t += dt
      if (!heldNow) cs.releasedEarly = true
      if (cs.t >= cfg.windup / Math.max(0.01, castSpeedMult)) {
        if (cs.releasedEarly) {
          cs.phase = CP.RECOVER
          cs.t = 0
          cs.power = 0
          return { power: 0, over: 0 }
        }
        cs.phase = CP.CHARGE
        cs.t = 0
        cs.power = 0
      }
      return null
    }
    case CP.CHARGE: {
      cs.t += dt
      const chargeDur = cfg.chargeTime / Math.max(0.01, drawSpeedMult)
      cs.power = Math.min(1, cs.t / chargeDur)
      // overdraw only accumulates at full power — a partial draw never splits
      if (cs.power >= 1) {
        cs.over = Math.min(1, (cs.t - chargeDur) / (cfg.overdrawTime / Math.max(0.01, drawSpeedMult)))
      }
      if (!heldNow) {
        const p = Math.max(cfg.minChargePower, cs.power)
        cs.phase = CP.RECOVER
        cs.t = 0
        cs.power = p
        return { power: p, over: cs.over }
      }
      return null
    }
    case CP.RECOVER: {
      cs.t += dt
      if (cs.t >= recoverDuration(cs.power, castSpeedMult)) {
        cs.phase = CP.IDLE
        cs.t = 0
        cs.power = 0
        cs.over = 0
      }
      return null
    }
    default:
      return null
  }
}
