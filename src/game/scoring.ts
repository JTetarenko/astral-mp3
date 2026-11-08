export const DEG = Math.PI / 180

export const SCORING = {
  base: 100,
  /** Strike-event base — modest on purpose: strikes also pay damage + a
   * multiplied killScore, so the per-event base must not outfarm collecting. */
  strikeBase: 45,
  perfectRad: 1.5 * DEG,
  perfectBonus: 50,
  goodRad: 4 * DEG,
  goodBonus: 20,
  distanceRate: 1.5,
  onBeatMult: 1.25,
  chainWindowSec: 8,
  chainStep: 0.2,
  multiplierCap: 5,
  decayDelaySec: 6,
  decayPerSec: 0.15,
}

export type ScoringConfig = typeof SCORING

export type PrecisionTier = 'perfect' | 'good' | 'ok'

export interface ScoreState {
  score: number
  multiplier: number
  chain: number
  bestChain: number
  lastSnapTime: number
}

export function initialScoreState(): ScoreState {
  return { score: 0, multiplier: 1, chain: 0, bestChain: 0, lastSnapTime: -Infinity }
}

export function precisionTier(aimErrorRad: number, cfg: ScoringConfig = SCORING): PrecisionTier {
  if (aimErrorRad <= cfg.perfectRad) return 'perfect'
  if (aimErrorRad <= cfg.goodRad) return 'good'
  return 'ok'
}

export interface SnapEventInput {
  aimErrorRad: number
  distance: number
  onBeat: boolean
  /** 'point' (default) collects resonance; 'strike' is a connected combat
   * snap — same chain/multiplier ladder, smaller base. */
  kind?: 'point' | 'strike'
}

export interface SnapOutcome {
  state: ScoreState
  gained: number
  tier: PrecisionTier
}

/**
 * Pure per-snap scoring. Multiplier grows +chainStep per snap; a snap more than
 * chainWindowSec after the previous one restarts the chain from x1.0 (+step).
 * A 7-snap chain therefore reads exactly x2.4 on the HUD.
 */
export function applySnap(
  s: ScoreState,
  ev: SnapEventInput,
  now: number,
  cfg: ScoringConfig = SCORING,
): SnapOutcome {
  const chained = now - s.lastSnapTime <= cfg.chainWindowSec
  const multiplier = Math.min(cfg.multiplierCap, (chained ? s.multiplier : 1) + cfg.chainStep)
  const chain = chained ? s.chain + 1 : 1
  const tier = precisionTier(ev.aimErrorRad, cfg)
  const tierBonus = tier === 'perfect' ? cfg.perfectBonus : tier === 'good' ? cfg.goodBonus : 0
  const base = ev.kind === 'strike' ? cfg.strikeBase : cfg.base
  let raw = base + tierBonus + Math.round(ev.distance * cfg.distanceRate)
  if (ev.onBeat) raw *= cfg.onBeatMult
  const gained = Math.round(raw * multiplier)
  return {
    state: {
      score: s.score + gained,
      multiplier,
      chain,
      bestChain: Math.max(s.bestChain, chain),
      lastSnapTime: now,
    },
    gained,
    tier,
  }
}

/** Multiplier decay toward 1.0 once the chain has idled past decayDelaySec. */
export function decayedMultiplier(
  multiplier: number,
  idleSec: number,
  dt: number,
  cfg: ScoringConfig = SCORING,
): number {
  if (idleSec <= cfg.decayDelaySec) return multiplier
  return Math.max(1, multiplier - cfg.decayPerSec * dt)
}
