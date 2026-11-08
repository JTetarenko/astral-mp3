/**
 * Adaptive quality governor. Watches frame times through a fixed ring of
 * over-budget flags (an allocation-free p75 proxy: >25% of a 3s window over
 * budget triggers a step down) and steps back up only after a sustained
 * period of clear headroom. Pure state machine — Effects.tsx applies levels:
 *   L0 dpr min(2, devicePR) | L1 dpr 1.5 | L2 dpr 1.25
 *   L3 echo half-res + MSAA 2 | L4 echo off + MSAA 0
 */
export const GOV = {
  windowFrames: 180,
  badMs: 18,
  stepDownCount: 45,
  goodMs: 13,
  upStreakFrames: 600,
  cooldownSec: 4,
  maxLevel: 4,
} as const

export interface Governor {
  ring: Uint8Array
  idx: number
  filled: number
  sum: number
  level: number
  lastStepAt: number
  goodStreak: number
}

export function createGovernor(): Governor {
  return {
    ring: new Uint8Array(GOV.windowFrames),
    idx: 0,
    filled: 0,
    sum: 0,
    level: 0,
    lastStepAt: -Infinity,
    goodStreak: 0,
  }
}

/** Feed one frame; returns the new level when a step occurs, else null. */
export function updateGovernor(g: Governor, frameMs: number, nowSec: number): number | null {
  const bad = frameMs > GOV.badMs ? 1 : 0
  if (g.filled >= GOV.windowFrames) g.sum -= g.ring[g.idx]
  g.ring[g.idx] = bad
  g.sum += bad
  g.idx = (g.idx + 1) % GOV.windowFrames
  if (g.filled < GOV.windowFrames) g.filled++
  g.goodStreak = frameMs < GOV.goodMs ? g.goodStreak + 1 : 0

  if (nowSec - g.lastStepAt < GOV.cooldownSec) return null

  // `bad` guard: a stale saturated window (badness that ended before the
  // cooldown did) must not step down while current frames are fine
  if (bad === 1 && g.sum > GOV.stepDownCount && g.filled >= GOV.windowFrames && g.level < GOV.maxLevel) {
    g.level++
    g.lastStepAt = nowSec
    g.ring.fill(0)
    g.sum = 0
    g.filled = 0
    g.goodStreak = 0
    return g.level
  }
  if (g.goodStreak >= GOV.upStreakFrames && g.level > 0) {
    g.level--
    g.lastStepAt = nowSec
    g.goodStreak = 0
    return g.level
  }
  return null
}

export const governor = createGovernor()

/** Per-frame renderer stats surfaced for the ?debug overlay. */
export const perfStats = { calls: 0, dpr: 0 }
