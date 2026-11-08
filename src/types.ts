export interface TrackManifestEntry {
  file: string
  name: string
  sizeBytes: number
}

export type IntensityTier = 0 | 1 | 2 | 3 // CALM / RISING / PEAK / SHATTER

export interface IntensitySection {
  startSec: number
  endSec: number
  tier: IntensityTier
}

export interface IntensityAnalysis {
  /** Normalized 0..1 intensity at `curveRate` Hz. */
  curve: Float32Array
  curveRate: number
  /** Per-sample tier — source of truth; `sections` is its run-length encoding. */
  tierCurve: Uint8Array
  sections: IntensitySection[]
  p10: number
  p95: number
}

/**
 * Offline stable beat grid (unlike audioFrame.beatPhase, which re-anchors on
 * every detected onset and cannot drive synced visuals).
 */
export interface BeatGrid {
  /** Beat instants in seconds, strictly increasing. Empty when no usable pulse. */
  beatTimes: Float32Array
  /** Nominal beat period (sec) — free-run extrapolation past either end. */
  period: number
  /** Effective BPM implied by the refined grid (may differ slightly from TrackAnalysis.bpm). */
  gridBpm: number
  /** 0..1 — comb contrast x phase stability x coverage. Consumers gate below ~0.5. */
  confidence: number
  /** Beats per bar the downbeat search settled on (4 unless 3 or 5 clearly won). */
  barBeats: number
  /** Beat class (0..barBeats-1) whose beats are downbeats. */
  downbeatIndex: number
  /** 0..1 contrast of downbeat emphasis — low on odd/shifting meters. Gate barPhase on this. */
  barConfidence: number
}

export interface TrackAnalysis {
  duration: number
  seed: number
  bpm: number
  /** Coarse energy-over-time profile at `profileRate` Hz (used for seed + loading strip). */
  energyProfile: Float32Array
  profileRate: number
  avgEnergy: number
  peakEnergy: number
  intensity: IntensityAnalysis
  beatGrid: BeatGrid
}

export interface IslandSpec {
  x: number
  y: number
  z: number
  scale: number
  rotY: number
  bobPhase: number
  bobSpeed: number
  bobAmp: number
  /** Per-island multiplier on bass displacement so the field doesn't pulse in lockstep. */
  bassGain: number
  variant: number
}

/** How the run ended: the track finished, or the swarm dragged the player down. */
export type RunOutcome = 'faded' | 'downed'

/** One quest's progress delta from a settled run (shown on the end screen). */
export interface QuestTick {
  questId: string
  title: string
  before: number
  after: number
  target: number
  completed: boolean
}

export interface RunResult {
  trackName: string
  score: number
  /** Resonance points collected across all realms this run. */
  collected: number
  snaps: number
  perfects: number
  goods: number
  onBeats: number
  bestChain: number
  /** 1-based deepest realm reached. */
  depth: number
  realmName: string
  realmsVisited: number
  /** Beat the persisted best depth. */
  newBest: boolean
  durationPlayed: number
  outcome: RunOutcome
  /** Combat tallies (all zero until the horror layer is live). */
  kills: number
  wardenKills: number
  damageDealt: number
  /** Player HP lost this run — the blood paid. */
  damageTaken: number
  latchesSuffered: number
  novasFired: number
  /** RPG settlement (filled by settleRun in endRun). */
  xpGained: number
  levelBefore: number
  levelAfter: number
  shardsGained: number
  /** Item ids dropped this run. */
  drops: string[]
  questTicks: QuestTick[]
}
