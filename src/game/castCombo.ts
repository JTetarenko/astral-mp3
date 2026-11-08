/**
 * The bow-combo ladder — pure and node-testable in the scoring.ts mold.
 * snapController owns one mutable CastComboState and feeds it three event
 * streams: bolt HITS (ring-diffed from feelSignals) grow the combo, LOOSES
 * carry the on-beat resonance streak, and the decay clock is audioFrame.time
 * (the scoring-decay precedent: audio clock, hit-stop immune).
 *
 * Deliberately separate from scoring.ts — the snap chain's numbers are tuned
 * and test-locked; the bow earns its own heat. Tiers ignite the bow (visuals),
 * layer the release sounds, pay a small damage bonus, and tier 3 arms the
 * Resonance Storm. The ONLY thing that breaks a combo is window silence;
 * whiffs are already punished by wasted cadence.
 */

export const CAST_COMBO = {
  /** Seconds of bolt-hit silence (audio clock) that break the combo. */
  windowSec: 4.0,
  /** Hit counts at which tiers 1/2/3 arm. */
  tiers: [3, 6, 10] as const,
  /** Damage bonus per tier (tier 3 = +15%). */
  dmgPerTier: 0.05,
  /** Consecutive on-beat looses that arm the Resonance Storm. */
  stormStreak: 3,
} as const

export interface CastComboState {
  /** Bolt hits inside the rolling window. */
  comboCount: number
  /** Audio-clock stamp of the last counted hit (-Infinity when empty). */
  lastHitAt: number
  /** Consecutive on-beat looses. */
  streak: number
  /** A full-draw release will burst into the storm fan. */
  stormArmed: boolean
}

export function makeCastCombo(): CastComboState {
  return { comboCount: 0, lastHitAt: -Infinity, streak: 0, stormArmed: false }
}

export function resetCastCombo(s: CastComboState): void {
  s.comboCount = 0
  s.lastHitAt = -Infinity
  s.streak = 0
  s.stormArmed = false
}

export function comboTier(count: number): 0 | 1 | 2 | 3 {
  const t = CAST_COMBO.tiers
  if (count >= t[2]) return 3
  if (count >= t[1]) return 2
  if (count >= t[0]) return 1
  return 0
}

export function castComboDamageMult(tier: number): number {
  return 1 + CAST_COMBO.dmgPerTier * Math.max(0, tier)
}

/**
 * Advance the decay clock. Returns true exactly on the call where window
 * silence zeroes a live combo — the caller plays the break. Streak and an
 * armed storm survive a break (rhythm skill isn't spent by a lull).
 */
export function tickCastCombo(s: CastComboState, now: number): boolean {
  if (s.comboCount > 0 && now - s.lastHitAt > CAST_COMBO.windowSec) {
    s.comboCount = 0
    s.lastHitAt = -Infinity
    return true
  }
  return false
}

/**
 * A bolt connected (each pierce victim counts — a lined-up lance is the peak
 * bow play). Arms the storm on the tier-3 CROSSING only, so a hot combo
 * cannot instantly re-arm after firing. Returns the new tier for cue diffing.
 */
export function castComboOnHit(s: CastComboState, now: number): 0 | 1 | 2 | 3 {
  const before = comboTier(s.comboCount)
  s.comboCount++
  s.lastHitAt = now
  const after = comboTier(s.comboCount)
  if (before < 3 && after === 3) s.stormArmed = true
  return after
}

/** A cast loosed. On-beat extends the resonance streak; off-beat resets it. */
export function castComboOnLoose(s: CastComboState, onBeat: boolean): void {
  s.streak = onBeat ? s.streak + 1 : 0
  if (s.streak >= CAST_COMBO.stormStreak) s.stormArmed = true
}

/** Spend an armed storm. The storm consumes the streak that earned it. */
export function tryConsumeStorm(s: CastComboState): boolean {
  if (!s.stormArmed) return false
  s.stormArmed = false
  s.streak = 0
  return true
}
