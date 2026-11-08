/**
 * Song-intensity analysis: turns the 20 Hz RMS energy profile into a
 * normalized 0..1 intensity curve plus a tier timeline
 * (0 CALM / 1 RISING / 2 PEAK / 3 SHATTER) with hysteresis and explicit
 * drop detection. Pure math — no Web Audio, no DOM, fully unit-testable.
 */
import type { IntensityAnalysis, IntensitySection, IntensityTier } from '../types'

export const INTENSITY_CFG = {
  curveWindowSec: 1.0,
  sectionWindowSec: 3.0,
  pLo: 0.1,
  pHi: 0.95,
  gamma: 0.8,
  enter1: 0.3,
  exit1: 0.22,
  enter2: 0.62,
  exit2: 0.52,
  exit3: 0.55,
  dwellSec: 0.75,
  minSectionSec: 2.0,
  minShatterSec: 1.0,
  maxShatterSec: 12.0,
  shatterRefractorySec: 8.0,
  riseLookbackSec: 8.0,
  riseMin: 0.25,
  highLevel: 0.78,
  sustainSec: 2.0,
  sustainLevel: 0.72,
  cliffLow: 0.35,
  cliffDepth: 0.3,
  cliffWinSec: 1.5,
  slamLevel: 0.75,
  slamWinSec: 1.0,
  tierBlendSec: 1.5,
  offlineWeight: 0.7,
  silenceFloor: 1e-3,
  flatSpreadMin: 0.05,
  flatFallbackLevel: 0.7,
  riseSignalLookbackSec: 4.0,
  riseSignalFullDelta: 0.35,
} as const

export type IntensityConfig = typeof INTENSITY_CFG

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/** Centered moving average with shrink-at-edges windows, via prefix sums. */
function movingAverage(src: Float32Array, halfWindow: number): Float32Array {
  const n = src.length
  const prefix = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + src[i]
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - halfWindow)
    const hi = Math.min(n, i + halfWindow + 1)
    out[i] = (prefix[hi] - prefix[lo]) / (hi - lo)
  }
  return out
}

function percentile(sorted: Float32Array, q: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.round(q * (sorted.length - 1))))
  return sorted[idx]
}

/** Merges runs shorter than minN into their higher neighbor until stable.
 * With protectTier3, runs of tier 3 are never merge candidates (they may
 * still absorb short neighbors). */
function mergeShortSections(tierCurve: Uint8Array, minN: number, protectTier3: boolean): void {
  const n = tierCurve.length
  let changed = true
  while (changed) {
    changed = false
    let start = 0
    for (let i = 1; i <= n; i++) {
      if (i === n || tierCurve[i] !== tierCurve[start]) {
        const len = i - start
        const tier = tierCurve[start]
        if (len < minN && !(protectTier3 && tier === 3) && (start > 0 || i < n)) {
          const prevTier = start > 0 ? tierCurve[start - 1] : -1
          const nextTier = i < n ? tierCurve[i] : -1
          const merged = Math.max(prevTier, nextTier)
          if (merged >= 0 && merged !== tier) {
            tierCurve.fill(merged, start, i)
            changed = true
            break
          }
        }
        start = i
      }
    }
  }
}

/** Run-length encode a tier curve into sections spanning exactly [0, duration]. */
export function sectionsFromTierCurve(
  tierCurve: Uint8Array,
  rate: number,
  duration: number,
): IntensitySection[] {
  const sections: IntensitySection[] = []
  if (tierCurve.length === 0) return [{ startSec: 0, endSec: duration, tier: 0 }]
  let start = 0
  for (let i = 1; i <= tierCurve.length; i++) {
    if (i === tierCurve.length || tierCurve[i] !== tierCurve[start]) {
      sections.push({
        startSec: start / rate,
        endSec: i === tierCurve.length ? duration : i / rate,
        tier: tierCurve[start] as IntensityTier,
      })
      start = i
    }
  }
  return sections
}

export function computeIntensity(
  profile: Float32Array,
  profileRate: number,
  duration: number,
  cfg: IntensityConfig = INTENSITY_CFG,
): IntensityAnalysis {
  const n = profile.length
  const rate = profileRate
  if (n === 0) {
    return {
      curve: new Float32Array(0),
      curveRate: rate,
      tierCurve: new Uint8Array(0),
      sections: [{ startSec: 0, endSec: duration, tier: 0 }],
      p10: 0,
      p95: 0,
    }
  }

  const fastHalf = Math.max(1, Math.round((cfg.curveWindowSec * rate) / 2))
  const slowHalf = Math.max(1, Math.round((cfg.sectionWindowSec * rate) / 2))
  const fastRaw = movingAverage(profile, fastHalf)
  const slowRaw = movingAverage(profile, slowHalf)

  const sorted = Float32Array.from(slowRaw).sort()
  const p10 = percentile(sorted, cfg.pLo)
  const p95 = percentile(sorted, cfg.pHi)

  const curve = new Float32Array(n)
  const tierCurve = new Uint8Array(n)

  // Degenerate: silence
  if (p95 < cfg.silenceFloor) {
    return { curve, curveRate: rate, tierCurve, sections: sectionsFromTierCurve(tierCurve, rate, duration), p10, p95 }
  }
  // Degenerate: brickwalled/flat — normalizing would amplify noise into flapping
  if (p95 - p10 < cfg.flatSpreadMin * p95) {
    curve.fill(cfg.flatFallbackLevel)
    tierCurve.fill(2)
    return { curve, curveRate: rate, tierCurve, sections: sectionsFromTierCurve(tierCurve, rate, duration), p10, p95 }
  }

  const span = Math.max(p95 - p10, 1e-6)
  const norm = (x: number) => clamp01((x - p10) / span)
  const s = new Float32Array(n) // shaped slow curve (tier signal)
  const f = new Float32Array(n) // shaped fast curve (drops + exposed)
  for (let i = 0; i < n; i++) {
    s[i] = Math.pow(norm(slowRaw[i]), cfg.gamma)
    f[i] = Math.pow(norm(fastRaw[i]), cfg.gamma)
    curve[i] = f[i]
  }

  // ---- SHATTER intervals (detected first, overlaid last) ----
  const shatter: Array<[number, number]> = []
  {
    const riseLb = Math.round(cfg.riseLookbackSec * rate)
    const sustainN = Math.round(cfg.sustainSec * rate)
    const cliffWin = Math.round(cfg.cliffWinSec * rate)
    const slamWin = Math.round(cfg.slamWinSec * rate)
    const endHoldN = Math.round(1.0 * rate)
    const maxN = Math.round(cfg.maxShatterSec * rate)
    const refractoryN = Math.round(cfg.shatterRefractorySec * rate)
    let lastStart = -Infinity
    let armed = true

    const findEnd = (from: number): number => {
      let below = 0
      for (let i = from; i < n; i++) {
        if (i - from >= maxN) return i
        if (s[i] < cfg.exit3) {
          below++
          if (below >= endHoldN) return i - endHoldN + 1
        } else {
          below = 0
        }
      }
      return n
    }

    for (let i = 0; i < n; i++) {
      if (i - lastStart < refractoryN) continue
      // re-arm pattern A after a cap-out once the level truly falls
      if (!armed) {
        let low = 0
        for (let j = i; j < Math.min(n, i + Math.round(2 * rate)); j++) {
          if (s[j] < cfg.exit3) low++
        }
        if (low >= Math.round(2 * rate)) armed = true
      }

      // Pattern A: build-then-sustain
      let hitA = false
      if (armed && s[i] >= cfg.highLevel && s[i] - s[Math.max(0, i - riseLb)] >= cfg.riseMin) {
        let sum = 0
        const hi = Math.min(n, i + sustainN)
        for (let j = i; j < hi; j++) sum += s[j]
        if (sum / Math.max(1, hi - i) >= cfg.sustainLevel) hitA = true
      }

      // Pattern B: cliff-then-slam on the fast curve
      let hitB = false
      if (!hitA && f[i] <= cfg.cliffLow) {
        let cliff = false
        for (let j = Math.max(0, i - cliffWin); j < i; j++) {
          if (f[j] >= f[i] + cfg.cliffDepth) {
            cliff = true
            break
          }
        }
        if (cliff) {
          for (let j = i + 1; j < Math.min(n, i + slamWin); j++) {
            if (f[j] >= cfg.slamLevel) {
              hitB = true
              i = j // shatter starts at the slam itself
              break
            }
          }
        }
      }

      if (hitA || hitB) {
        const end = findEnd(i)
        shatter.push([i, end])
        if (end - i >= maxN) armed = false // capped out — needs re-arm
        lastStart = i
        i = end
      }
    }
  }

  // ---- hysteresis tier state machine over s ----
  {
    const dwellN = Math.round(cfg.dwellSec * rate)
    let tier = s[0] >= cfg.enter2 ? 2 : s[0] >= cfg.enter1 ? 1 : 0
    let candidate = tier
    let candidateSince = 0
    for (let i = 0; i < n; i++) {
      const v = s[i]
      let target = tier
      if (tier <= 0) target = v >= cfg.enter2 ? 2 : v >= cfg.enter1 ? 1 : 0
      else if (tier === 1) target = v >= cfg.enter2 ? 2 : v < cfg.exit1 ? 0 : 1
      else target = v < cfg.exit2 ? 1 : 2
      if (target !== candidate) {
        candidate = target
        candidateSince = i
      }
      if (candidate !== tier && (candidate > tier ? i - candidateSince >= 0 : true) && i - candidateSince >= dwellN) {
        // downward moves one step at a time; upward jumps allowed
        tier = candidate > tier ? candidate : tier - 1
        if (tier !== candidate) candidateSince = i
      }
      tierCurve[i] = tier
    }
  }

  // ---- min-section merge, overlay SHATTER, then merge the slivers the
  //      overlay created (tier-3 runs are immutable in the second pass) ----
  mergeShortSections(tierCurve, Math.round(cfg.minSectionSec * rate), false)
  const minShatterN = Math.round(cfg.minShatterSec * rate)
  for (const [a, b] of shatter) {
    if (b - a >= minShatterN) tierCurve.fill(3, a, b)
  }
  mergeShortSections(tierCurve, Math.round(cfg.minSectionSec * rate), true)

  return {
    curve,
    curveRate: rate,
    tierCurve,
    sections: sectionsFromTierCurve(tierCurve, rate, duration),
    p10,
    p95,
  }
}

/** Linear-interpolated, clamped curve sampling (zero allocations). */
export function sampleCurve(curve: Float32Array, rate: number, t: number): number {
  const n = curve.length
  if (n === 0) return 0
  const pos = t * rate
  if (pos <= 0) return curve[0]
  const i0 = Math.min(n - 1, Math.floor(pos))
  const i1 = Math.min(n - 1, i0 + 1)
  const frac = pos - i0
  return curve[i0] + (curve[i1] - curve[i0]) * frac
}

/**
 * 0..1 riser/charge: recent upward slope of the fast intensity curve. Two
 * O(1) lerped reads of the already-shipped curve — no offline data added.
 * The curve is 1s-moving-averaged, so the difference is stable; falling or
 * flat material reads 0. Early times clamp to curve[0], so intro build-ups
 * correctly read as rise.
 */
export function sampleRise(
  curve: Float32Array,
  rate: number,
  t: number,
  lookbackSec: number = INTENSITY_CFG.riseSignalLookbackSec,
  fullDelta: number = INTENSITY_CFG.riseSignalFullDelta,
): number {
  const now = sampleCurve(curve, rate, t)
  const past = sampleCurve(curve, rate, t - lookbackSec)
  return clamp01((now - past) / fullDelta)
}

export interface DropIndex {
  /** next[i]: startSec of the first tier-3 section at index >= i, else +Infinity. */
  next: Float64Array
  /** prev[i]: startSec of the last tier-3 section at index <= i, else -999. */
  prev: Float64Array
}

export function buildDropIndex(sections: IntensitySection[]): DropIndex {
  const n = sections.length
  const next = new Float64Array(n)
  const prev = new Float64Array(n)
  let nx = Infinity
  for (let i = n - 1; i >= 0; i--) {
    if (sections[i].tier === 3) nx = sections[i].startSec
    next[i] = nx
  }
  let pv = -999
  for (let i = 0; i < n; i++) {
    if (sections[i].tier === 3) pv = sections[i].startSec
    prev[i] = pv
  }
  return { next, prev }
}

export interface SectionCursor {
  /** Index of the section containing the last-seen time (monotonic pointer). */
  idx: number
  /** Drop start already counted toward dropCommitCount (dedupe key). */
  lastDropStart: number
}

/**
 * Pre-seed lastDropStart with dropIndex.prev[0] so a track that OPENS in
 * SHATTER never fires a drop commit at t=0.
 */
export function createSectionCursor(prevDropStart0 = -999): SectionCursor {
  return { idx: 0, lastDropStart: prevDropStart0 }
}

/** Structural subset of AudioFrame written by updateSectionFields. */
export interface SectionFrameFields {
  sectionIndex: number
  sectionProgress: number
  timeToNextSection: number
  nextTier: number
  timeToDrop: number
  dropAt: number
  dropCommitCount: number
}

/**
 * O(1) per-frame section lookahead. The freshness gate keeps hidden-tab time
 * jumps from firing stale drop one-shots while dropAt/continuous fields stay
 * exact (a whole drop skipped in one giant dt still updates dropAt).
 */
export function updateSectionFields(
  cur: SectionCursor,
  sections: IntensitySection[],
  drops: DropIndex,
  time: number,
  out: SectionFrameFields,
  freshSec = 1.0,
): void {
  const n = sections.length
  if (n === 0) {
    out.sectionIndex = 0
    out.sectionProgress = 0
    out.timeToNextSection = Infinity
    out.nextTier = -1
    out.timeToDrop = Infinity
    out.dropAt = -999
    return
  }
  let i = Math.min(cur.idx, n - 1)
  while (i > 0 && time < sections[i].startSec) i-- // backward guard (future seek)
  while (i < n - 1 && time >= sections[i].endSec) i++
  cur.idx = i
  const s = sections[i]
  out.sectionIndex = i
  out.sectionProgress = clamp01((time - s.startSec) / Math.max(1e-6, s.endSec - s.startSec))
  out.timeToNextSection = Math.max(0, s.endSec - time)
  out.nextTier = i < n - 1 ? sections[i + 1].tier : -1
  const ds = drops.next[i]
  out.timeToDrop = ds === Infinity ? Infinity : Math.max(0, ds - time)
  const pd = drops.prev[i]
  out.dropAt = pd
  if (pd !== cur.lastDropStart) {
    cur.lastDropStart = pd // also resets on backward jumps so a replayed drop re-fires
    if (pd > -999 && time - pd <= freshSec) out.dropCommitCount++
  }
}

export interface TierState {
  tier: number
  tierFrom: number
  changedAt: number
  blend: number
}

export function createTierState(initialTier = 0): TierState {
  return { tier: initialTier, tierFrom: initialTier, changedAt: -999, blend: 1 }
}

/**
 * Advances the runtime tier crossfade. Returns true on the frame a new tier
 * commits (the SFX transition hook). A re-change mid-blend restarts the ramp
 * from the tier being abandoned.
 */
export function advanceTierState(
  st: TierState,
  targetTier: number,
  time: number,
  blendSec = INTENSITY_CFG.tierBlendSec,
): boolean {
  let committed = false
  if (targetTier !== st.tier) {
    st.tierFrom = st.tier
    st.tier = targetTier
    st.changedAt = time
    committed = true
  }
  st.blend = clamp01((time - st.changedAt) / blendSec)
  return committed
}
