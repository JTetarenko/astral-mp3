/**
 * The VISUALS slider doubles as the immersion/difficulty dial. These pure
 * helpers are the single source of truth for the tier labels shown in the UI
 * and for the enemy-pressure multiplier the director applies per frame.
 *
 * Tiers (slider step is 0.05, so every boundary is reachable):
 *   0–39% SERENE · 40–64% IMMERSIVE · 65–79% INTENSE · 80–89% HARD · 90–100% EXTREME
 */

export interface ImmersionTier {
  label: 'SERENE' | 'IMMERSIVE' | 'INTENSE' | 'HARD' | 'EXTREME'
  /** HSL hue for UI coloring: cool cyan at SERENE ramping to hot red at EXTREME. */
  hue: number
}

const TIERS: readonly (ImmersionTier & { min: number })[] = [
  { min: 0.9, label: 'EXTREME', hue: 8 },
  { min: 0.8, label: 'HARD', hue: 32 },
  { min: 0.65, label: 'INTENSE', hue: 48 },
  { min: 0.4, label: 'IMMERSIVE', hue: 150 },
  { min: 0, label: 'SERENE', hue: 190 },
]

export function immersionTier(vi: number): ImmersionTier {
  for (const t of TIERS) {
    if (vi >= t.min) return { label: t.label, hue: t.hue }
  }
  return { label: 'SERENE', hue: 190 }
}

/**
 * Enemy-pressure multiplier from visual intensity. Balance-neutral at the
 * historical default (0.8 → 1.0): below it the realm goes easier on the
 * player, above it pressure ramps — 90% ≈ 1.15 (HARD), 100% = 1.30 (EXTREME).
 */
export function difficultyFromVisuals(vi: number): number {
  const v = Math.min(1, Math.max(0, vi))
  if (v <= 0.8) return 0.7 + 0.375 * v
  return 1 + 1.5 * (v - 0.8)
}
