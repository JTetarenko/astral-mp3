/**
 * The hit-stop authority: a single world-motion time scale every scaled
 * consumer multiplies into its dt. Absolute clock time is NEVER warped —
 * 12+ loops read `clock.elapsedTime` as absolute stamps (bolt cooldowns,
 * shockwave ages, enemy state clocks, the beat grid), so the freeze works
 * purely by starving the three integrators that produce world motion
 * (snapController movement/phases, updateEnemies, particle integration) of
 * dt. The audio bus and every rhythm window run off the audio clock and are
 * structurally unable to pause. Ticked once per frame at priority -95, with
 * REAL dt, from PlayScene's FrameDriver. Pure module — node-testable.
 */

export const HITSTOP = {
  /** Non-lethal snap-strike connect: a micro-crunch. */
  strikeHit: 0.035,
  /** Snap-strike kill. */
  strikeKill: 0.06,
  /** Bolt/nova kill (seen via the feel ring diff). */
  boltKill: 0.045,
  /** Charged-cast connect (non-lethal). */
  chargedHit: 0.05,
  /** Charged-cast kill. */
  chargedKill: 0.06,
  /** Warden weak-point shatter — the ceiling. */
  wardenWeak: 0.08,
  /** Hard clamp on any request (user cap: 80ms). */
  maxStop: 0.08,
  /** worldScale eases 0 -> 1 over this after the stop (kills the resume pop). */
  rampOut: 0.035,
  /** Scale during the stop; 0 = full freeze. */
  scaleDuring: 0,
} as const

export const gameTime = {
  /** 0..1 multiplier for world-motion dt. */
  worldScale: 1,
  /** Seconds of freeze remaining (REAL time). */
  stopLeft: 0,
  /** Seconds of ramp-out remaining. */
  rampLeft: 0,
  /** Monotonic trigger counter (feelSignals mirrors for the HUD). */
  stopCount: 0,
}

/** Request a stop. Overlapping requests take max, never sum — stacked kills
 * can never exceed the cap. */
export function triggerHitStop(dur: number): void {
  const d = Math.min(Math.max(0, dur), HITSTOP.maxStop)
  if (d <= 0) return
  gameTime.stopLeft = Math.max(gameTime.stopLeft, d)
  gameTime.rampLeft = HITSTOP.rampOut
  gameTime.stopCount++
}

/** Tick with REAL dt at priority -95. */
export function updateGameTime(rawDt: number): void {
  const dt = Math.max(0, rawDt)
  if (gameTime.stopLeft > 0) {
    gameTime.stopLeft = Math.max(0, gameTime.stopLeft - dt)
    gameTime.worldScale = HITSTOP.scaleDuring
  } else if (gameTime.rampLeft > 0) {
    gameTime.rampLeft = Math.max(0, gameTime.rampLeft - dt)
    gameTime.worldScale =
      HITSTOP.rampOut <= 0 ? 1 : 1 - gameTime.rampLeft / HITSTOP.rampOut
  } else {
    gameTime.worldScale = 1
  }
}

/** The scaled world dt: same 0.1 clamp every loop already applies. */
export function worldDt(rawDt: number): number {
  return Math.min(rawDt, 0.1) * gameTime.worldScale
}

export function resetGameTime(): void {
  gameTime.worldScale = 1
  gameTime.stopLeft = 0
  gameTime.rampLeft = 0
  // stopCount stays monotonic — consumers diff it across runs.
}
