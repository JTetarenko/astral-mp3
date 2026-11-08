/**
 * Offline stable beat grid: comb-aligns the 100 Hz onset envelope against the
 * autocorrelation BPM estimate, then re-anchors the phase blockwise so slow
 * drift is absorbed without a full dynamic-programming beat tracker. Pure
 * math — no Web Audio, no DOM, fully unit-testable in node.
 *
 * The runtime cursor turns beatTimes into per-frame gridPhase / gridBeatIndex /
 * barPhase with an O(1) monotonic pointer. (audioFrame.beatPhase re-anchors on
 * every detected onset — documented in sfx.ts as unusable for sync — which is
 * exactly why this module exists.)
 */
import type { BeatGrid } from '../types'

export const BEAT_GRID_CFG = {
  /** Beats per re-anchor block. Small enough that a ~1% BPM estimate error
   * accrues less drift per block than maxCorrection can absorb. */
  blockBeats: 8,
  /** Per-block phase correction cap, as a fraction of the beat period. */
  maxCorrection: 0.12,
  /** Candidate corrections evaluated per block (odd, symmetric around 0). */
  correctionSteps: 21,
  /** |correction| below this fraction of the period counts as "stable".
   * Syncopation jitters real-music corrections by a few percent even when the
   * grid is locked, so this is deliberately loose. */
  stableCorrection: 0.08,
  /** Block peak comb score must exceed gate * global env mean to count as active. */
  quietGate: 1.2,
  /** Fewer beats of material than this -> empty grid. */
  minBeats: 8,
  /** Consistent block corrections feed back into the running period at this
   * gain, so a systematic BPM error converges to zero instead of pegging the
   * corrector every block. */
  adaptGain: 0.6,
  /** Running period stays within this ratio of the nominal 60/bpm. */
  periodClampRatio: 0.15,
  /** Meters tried by the downbeat search (4 wins unless an alt clearly beats it). */
  barCandidates: [4, 3, 5] as const,
  /** An alternative meter must beat M=4's emphasis contrast by this factor. */
  barMargin: 1.3,
  /** Fewer beats than this -> barConfidence 0. */
  minBarBeats: 16,
} as const

export type BeatGridConfig = typeof BEAT_GRID_CFG

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/** Linear-interpolated read of arr at a fractional index, clamped to ends. */
function lerpAt(arr: Float32Array, pos: number): number {
  const n = arr.length
  if (n === 0) return 0
  if (pos <= 0) return arr[0]
  const i0 = Math.min(n - 1, Math.floor(pos))
  const i1 = Math.min(n - 1, i0 + 1)
  return arr[i0] + (arr[i1] - arr[i0]) * (pos - i0)
}

export function emptyBeatGrid(bpm: number): BeatGrid {
  return {
    beatTimes: new Float32Array(0),
    period: 60 / Math.max(1, bpm > 0 ? bpm : 120),
    gridBpm: bpm > 0 ? bpm : 120,
    confidence: 0,
    barBeats: 4,
    downbeatIndex: 0,
    barConfidence: 0,
  }
}

export function computeBeatGrid(
  onsetEnv: Float32Array,
  rate: number,
  bpm: number,
  duration: number,
  cfg: BeatGridConfig = BEAT_GRID_CFG,
): BeatGrid {
  const n = onsetEnv.length
  if (bpm <= 0 || rate <= 0) return emptyBeatGrid(bpm)
  const P = 60 / bpm // sec per beat
  const L = P * rate // envelope frames per beat (float)
  if (n < cfg.minBeats * L) return emptyBeatGrid(bpm)

  // 1. light 1-2-1 triangular smoothing kills single-frame jitter
  const sm = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = onsetEnv[i > 0 ? i - 1 : 0]
    const b = onsetEnv[i]
    const c = onsetEnv[i < n - 1 ? i + 1 : n - 1]
    sm[i] = (a + 2 * b + c) / 4
  }
  let mAll = 0
  for (let i = 0; i < n; i++) mAll += sm[i]
  mAll /= n
  if (mAll < 1e-9) return emptyBeatGrid(bpm) // silence / constant tone

  // Sparse-transient gate via envelope occupancy: fraction of time spent above
  // half the p98 level. Percussive material is sparse (clicks ~5%, Ritual
  // Engine 18%); coherent tonal micro-ripple (34%) and broadband noise (64%)
  // are dense and must never read as a beat pulse.
  const sortedSm = Float32Array.from(sm).sort()
  const p98 = sortedSm[Math.min(n - 1, Math.floor(0.98 * (n - 1)))]
  let occ = 0
  const occLevel = 0.5 * p98
  for (let i = 0; i < n; i++) if (sm[i] > occLevel) occ++
  const spikeGate = clamp01((0.28 - occ / n) / 0.08)

  // 2. comb phase seed at 1-envelope-sample resolution, over a short leading
  //    window so a slightly-off BPM estimate can't smear the peak (the block
  //    corrector below re-anchors and tempo-adapts from there anyway)
  const nCand = Math.max(1, Math.ceil(L))
  const phaseBeats = Math.max(cfg.minBeats, Math.min(16, Math.floor(n / L)))
  const score = new Float32Array(nCand)
  for (let c = 0; c < nCand; c++) {
    let s = 0
    let k = 0
    for (let pos = c; pos < n && k < phaseBeats; pos += L) {
      s += lerpAt(sm, pos)
      k++
    }
    score[c] = k > 0 ? s / k : 0
  }
  let cBest = 0
  let scoreMax = -Infinity
  for (let c = 0; c < nCand; c++) {
    if (score[c] > scoreMax) {
      scoreMax = score[c]
      cBest = c
    }
  }
  // circular parabolic refinement around the winning phase candidate
  let cRefined = cBest
  if (nCand >= 3) {
    const y1 = score[(cBest - 1 + nCand) % nCand]
    const y2 = score[cBest]
    const y3 = score[(cBest + 1) % nCand]
    const denom = y1 - 2 * y2 + y3
    if (Math.abs(denom) > 1e-12) cRefined = cBest + (0.5 * (y1 - y3)) / denom
  }
  let phi0 = cRefined / rate
  while (phi0 < 0) phi0 += P
  while (phi0 >= P) phi0 -= P

  // 3. blockwise re-anchor: absorb drift with per-block corrections spread
  //    linearly across the block so intervals never jump; consistent
  //    corrections feed back into the running period (tempo adaptation)
  const beats: number[] = []
  const maxCorr = cfg.maxCorrection * P
  const halfSteps = (cfg.correctionSteps - 1) / 2
  const corrStep = maxCorr / halfSteps
  const cand = new Float64Array(cfg.correctionSteps)
  const pMin = P * (1 - cfg.periodClampRatio)
  const pMax = P * (1 + cfg.periodClampRatio)
  let pRun = P
  let anchor = phi0
  let blocks = 0
  let active = 0
  let stable = 0
  let contrastSum = 0
  while (anchor < duration - 0.5 * pRun) {
    const kMax = Math.max(1, Math.min(cfg.blockBeats, Math.floor((duration - anchor) / pRun)))
    let bestIdx = 0
    let bestS = -Infinity
    for (let ci = 0; ci < cfg.correctionSteps; ci++) {
      const d = (ci - halfSteps) * corrStep
      let s = 0
      for (let k = 0; k < kMax; k++) s += lerpAt(sm, (anchor + d + k * pRun) * rate)
      s /= kMax
      cand[ci] = s
      if (s > bestS) {
        bestS = s
        bestIdx = ci
      }
    }
    let d = (bestIdx - halfSteps) * corrStep
    if (bestIdx > 0 && bestIdx < cfg.correctionSteps - 1) {
      const y1 = cand[bestIdx - 1]
      const y2 = cand[bestIdx]
      const y3 = cand[bestIdx + 1]
      const denom = y1 - 2 * y2 + y3
      if (Math.abs(denom) > 1e-12) d += ((0.5 * (y1 - y3)) / denom) * corrStep
    }
    d = Math.max(-maxCorr, Math.min(maxCorr, d))
    blocks++
    let adapt = false
    if (bestS < cfg.quietGate * mAll) {
      d = 0 // quiet bridge: free-run rather than chase noise
    } else {
      active++
      if (Math.abs(d) <= cfg.stableCorrection * P) stable++
      adapt = true
      let candMean = 0
      for (let ci = 0; ci < cfg.correctionSteps; ci++) candMean += cand[ci]
      candMean /= cfg.correctionSteps
      if (bestS > 1e-12) contrastSum += (bestS - candMean) / bestS
    }
    for (let k = 0; k < kMax; k++) beats.push(anchor + k * pRun + (d * (k + 1)) / kMax)
    anchor += kMax * pRun + d
    // adapt AFTER emitting: the beats must match the positions the comb scored
    if (adapt) pRun = Math.max(pMin, Math.min(pMax, pRun + (d / kMax) * cfg.adaptGain))
  }
  if (beats.length < cfg.minBeats) return emptyBeatGrid(bpm)
  const beatTimes = Float32Array.from(beats)
  const K = beatTimes.length

  // 4. confidence = comb contrast x phase stability x coverage x sparseness.
  //    Scales calibrated against real material: Ritual Engine (locked grid,
  //    syncopated) lands ~0.5; synthetic clicks ~1; noise/tonal ~0.
  const combContrast = active > 0 ? contrastSum / active : 0
  const phaseStability = active > 0 ? stable / active : 0
  const activeRatio = blocks > 0 ? active / blocks : 0
  const confidence =
    clamp01(2.2 * combContrast) *
    (0.45 + 0.55 * phaseStability) *
    (0.5 + 0.5 * activeRatio) *
    spikeGate
  const gridBpm = K > 1 ? (60 * (K - 1)) / (beatTimes[K - 1] - beatTimes[0]) : bpm

  // 5. downbeat / bar detection: emphasis comb over beat energies
  const beatE = new Float32Array(K)
  for (let k = 0; k < K; k++) beatE[k] = lerpAt(sm, beatTimes[k] * rate)
  const classMean = new Float64Array(8)
  const classCount = new Float64Array(8)
  const contrastOf = (M: number): [number, number] => {
    if (K < Math.max(cfg.minBarBeats, 4 * M)) return [0, 0]
    classMean.fill(0)
    classCount.fill(0)
    for (let k = 0; k < K; k++) {
      classMean[k % M] += beatE[k]
      classCount[k % M]++
    }
    let mx = -Infinity
    let mean = 0
    let db = 0
    for (let m = 0; m < M; m++) {
      const v = classMean[m] / Math.max(1, classCount[m])
      mean += v
      if (v > mx) {
        mx = v
        db = m
      }
    }
    mean /= M
    return [mx > 1e-12 ? (mx - mean) / mx : 0, db]
  }
  const [c4, db4] = contrastOf(4)
  let barBeats = 4
  let downbeatIndex = db4
  let barContrast = c4
  for (const M of cfg.barCandidates) {
    if (M === 4) continue
    const [c, db] = contrastOf(M)
    if (c > cfg.barMargin * c4 && c > barContrast) {
      barBeats = M
      downbeatIndex = db
      barContrast = c
    }
  }
  // an alt meter must have beaten 4 by the margin; otherwise contrast is c4
  if (barBeats !== 4 && barContrast <= cfg.barMargin * c4) {
    barBeats = 4
    downbeatIndex = db4
    barContrast = c4
  }
  const barConfidence = clamp01(3 * barContrast)

  return { beatTimes, period: P, gridBpm, confidence, barBeats, downbeatIndex, barConfidence }
}

// ---------------------------------------------------------------------------
// Runtime cursor (zero allocations per frame)
// ---------------------------------------------------------------------------

export interface BeatCursor {
  /** Index of the last beat <= time; -1 before the first beat. */
  idx: number
}

export function createBeatCursor(): BeatCursor {
  return { idx: -1 }
}

/** Structural subset of AudioFrame written by updateBeatFields. */
export interface BeatFrameFields {
  gridPhase: number
  gridBeatIndex: number
  barPhase: number
  /** Live inter-beat interval in seconds (the span gridPhase runs over);
   * nominal period during lead-in/outro, 0 when there is no grid at all. */
  gridSpanSec: number
}

export function updateBeatFields(
  cur: BeatCursor,
  grid: BeatGrid,
  time: number,
  out: BeatFrameFields,
): void {
  const bt = grid.beatTimes
  const nb = bt.length
  if (nb === 0) {
    out.gridPhase = 0
    out.gridBeatIndex = -1
    out.barPhase = 0
    out.gridSpanSec = 0
    return
  }
  let b = cur.idx
  if (b >= nb) b = nb - 1
  while (b >= 0 && bt[b] > time) b-- // backward guard (future seek)
  while (b + 1 < nb && bt[b + 1] <= time) b++ // monotonic advance, O(1) amortized
  cur.idx = b
  const P = grid.period > 0 ? grid.period : 0.5
  let phase: number
  let virtualIdx: number
  let span = P
  if (b < 0) {
    // lead-in: extrapolate backward at the nominal period
    const x = (time - bt[0]) / P
    const k = Math.floor(x)
    phase = x - k
    virtualIdx = k
  } else if (b + 1 < nb) {
    const local = bt[b + 1] - bt[b]
    if (local > 1e-9) span = local
    phase = local > 1e-9 ? (time - bt[b]) / local : 0
    virtualIdx = b
  } else {
    // outro: free-run at the nominal period
    const x = (time - bt[b]) / P
    const k = Math.floor(x)
    phase = x - k
    virtualIdx = b + k
  }
  out.gridPhase = phase
  out.gridBeatIndex = virtualIdx
  out.gridSpanSec = span
  const M = grid.barBeats > 0 ? grid.barBeats : 4
  const beatInBar = (((virtualIdx - grid.downbeatIndex) % M) + M) % M
  out.barPhase = (beatInBar + phase) / M
}
