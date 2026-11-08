/**
 * Pure DSP helpers — no Web Audio, no DOM. Everything operates on plain
 * numbers/typed arrays so the whole file is unit-testable in node.
 */

export interface BandRange {
  start: number
  end: number // inclusive
}

/** Low/mid/high split edges in Hz: [lowsFrom, lowsTo=midsFrom, midsTo=highsFrom, highsTo]. */
export const BAND_EDGES: readonly [number, number, number, number] = [20, 160, 2000, 12000]

/**
 * Maps Hz band edges to FFT bin ranges. binHz = sampleRate / fftSize.
 * Bin 0 (DC) is always excluded; bands never overlap.
 */
export function bandRanges(
  sampleRate: number,
  fftSize: number,
  edges: readonly [number, number, number, number] = BAND_EDGES,
): [BandRange, BandRange, BandRange] {
  const binHz = sampleRate / fftSize
  const maxBin = fftSize / 2 - 1
  const out: BandRange[] = []
  let prevEnd = 0 // skip DC bin
  for (let b = 0; b < 3; b++) {
    const start = Math.min(maxBin, Math.max(Math.ceil(edges[b] / binHz), prevEnd + 1))
    const end = Math.min(maxBin, Math.max(start, Math.floor(edges[b + 1] / binHz)))
    out.push({ start, end })
    prevEnd = end
  }
  return out as [BandRange, BandRange, BandRange]
}

/** AnalyserNode dB value -> linear magnitude. -Infinity maps to 0. */
export function dbToLinear(db: number): number {
  return db <= -160 ? 0 : Math.pow(10, db / 20)
}

/** Mean linear magnitude over an inclusive bin range (mean, not sum, so band width doesn't bias). */
export function bandEnergy(mag: Float32Array, range: BandRange): number {
  let sum = 0
  for (let i = range.start; i <= range.end; i++) sum += mag[i]
  return sum / (range.end - range.start + 1)
}

export interface BandTracker {
  env: number
  runMax: number
  norm: number
  tauAttack: number
  tauRelease: number
}

export function createBandTracker(tauAttack: number, tauRelease: number): BandTracker {
  return { env: 0, runMax: 1e-4, norm: 0, tauAttack, tauRelease }
}

/**
 * Frame-rate-independent asymmetric attack/release envelope with running-max
 * normalization to 0..1 and a silence gate.
 */
export function updateEnvelope(
  t: BandTracker,
  x: number,
  dt: number,
  maxDecayTau = 30,
  floor = 1e-4,
): number {
  const tau = x > t.env ? t.tauAttack : t.tauRelease
  t.env += (x - t.env) * (1 - Math.exp(-dt / tau))
  t.runMax = Math.max(t.runMax * Math.exp(-dt / maxDecayTau), t.env, floor)
  t.norm = t.env < floor ? 0 : Math.min(1, t.env / t.runMax)
  return t.norm
}

export interface OnsetConfig {
  mult: number
  add: number
  refractorySec: number
  warmupFrames: number
}

export const ONSET_DEFAULTS: OnsetConfig = {
  mult: 1.5,
  add: 0.005,
  refractorySec: 0.12,
  warmupFrames: 20,
}

/** Mids (snare/vocal range): higher mult resists sustained guitar/vocal swells. */
export const ONSET_MID: OnsetConfig = {
  mult: 1.6,
  add: 0.008,
  refractorySec: 0.09,
  warmupFrames: 20,
}

/**
 * Highs (hats/cymbals): fire fast — short refractory, gentler mult.
 * NOTE: flux is a sum over bins and the highs range spans hundreds of bins
 * vs ~6-8 for bass, so `add` floors are per-band tuned, not shared.
 */
export const ONSET_HIGH: OnsetConfig = {
  mult: 1.4,
  add: 0.006,
  refractorySec: 0.05,
  warmupFrames: 20,
}

export interface OnsetDetector {
  range: BandRange
  prev: Float32Array
  ring: Float32Array
  idx: number
  filled: number
  lastOnsetTime: number
}

export function createOnsetDetector(range: BandRange, ringSize = 43): OnsetDetector {
  return {
    range,
    prev: new Float32Array(range.end - range.start + 1),
    ring: new Float32Array(ringSize),
    idx: 0,
    filled: 0,
    lastOnsetTime: -999,
  }
}

export interface OnsetResult {
  onset: boolean
  strength: number
  flux: number
  threshold: number
}

/**
 * Half-wave-rectified spectral flux over the detector's bin range, compared to
 * an adaptive threshold (recent-flux mean * mult + add) with a refractory gap.
 */
export function updateOnset(
  d: OnsetDetector,
  mag: Float32Array,
  time: number,
  cfg: OnsetConfig = ONSET_DEFAULTS,
): OnsetResult {
  let flux = 0
  for (let i = d.range.start, j = 0; i <= d.range.end; i++, j++) {
    const diff = mag[i] - d.prev[j]
    if (diff > 0) flux += diff
    d.prev[j] = mag[i]
  }

  let mean = 0
  if (d.filled > 0) {
    for (let i = 0; i < d.filled; i++) mean += d.ring[i]
    mean /= d.filled
  }
  const threshold = mean * cfg.mult + cfg.add

  d.ring[d.idx] = flux
  d.idx = (d.idx + 1) % d.ring.length
  if (d.filled < d.ring.length) d.filled++

  let onset = false
  let strength = 0
  if (
    d.filled >= cfg.warmupFrames &&
    flux > threshold &&
    time - d.lastOnsetTime >= cfg.refractorySec
  ) {
    onset = true
    strength = Math.min(2, Math.max(0, flux / threshold - 1))
    d.lastOnsetTime = time
  }
  return { onset, strength, flux, threshold }
}
