/**
 * Persistent descent progress: best depth overall and per track. Pure parsing
 * and merge logic (node-testable); localStorage touched only in the wrappers.
 */

export interface ProgressData {
  /** Deepest realm reached across all runs (1-based, human depth). */
  bestDepth: number
  /** Deepest realm per track file. */
  bestByTrack: Record<string, number>
  runs: number
}

const KEY = 'astral.progress.v1'

export function defaultProgress(): ProgressData {
  return { bestDepth: 0, bestByTrack: {}, runs: 0 }
}

/** Corrupt-safe parse — any malformed field falls back to defaults. */
export function parseProgress(raw: string | null): ProgressData {
  const out = defaultProgress()
  if (!raw) return out
  try {
    const p = JSON.parse(raw) as Record<string, unknown>
    if (typeof p.bestDepth === 'number' && Number.isFinite(p.bestDepth)) {
      out.bestDepth = Math.max(0, Math.floor(p.bestDepth))
    }
    if (typeof p.runs === 'number' && Number.isFinite(p.runs)) {
      out.runs = Math.max(0, Math.floor(p.runs))
    }
    if (p.bestByTrack && typeof p.bestByTrack === 'object') {
      for (const [k, v] of Object.entries(p.bestByTrack as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
          out.bestByTrack[k] = Math.floor(v)
        }
      }
    }
  } catch {
    // corrupt JSON -> defaults
  }
  return out
}

/** Merge one finished run; bests never regress. Pure. */
export function applyRun(
  p: ProgressData,
  trackFile: string,
  depth: number,
): { next: ProgressData; newBest: boolean; newTrackBest: boolean } {
  const d = Math.max(0, Math.floor(depth))
  const prevTrack = p.bestByTrack[trackFile] ?? 0
  const newBest = d > p.bestDepth
  const newTrackBest = d > prevTrack
  const next: ProgressData = {
    bestDepth: Math.max(p.bestDepth, d),
    bestByTrack: newTrackBest ? { ...p.bestByTrack, [trackFile]: d } : p.bestByTrack,
    runs: p.runs + 1,
  }
  return { next, newBest, newTrackBest }
}

export function loadProgress(): ProgressData {
  try {
    return parseProgress(localStorage.getItem(KEY))
  } catch {
    return defaultProgress()
  }
}

/** Load -> applyRun -> save. Returns the best-depth flags for the end screen. */
export function recordRun(
  trackFile: string,
  depth: number,
): { newBest: boolean; newTrackBest: boolean } {
  const p = loadProgress()
  const { next, newBest, newTrackBest } = applyRun(p, trackFile, depth)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // storage unavailable (private mode) — progress just doesn't persist
  }
  return { newBest, newTrackBest }
}
