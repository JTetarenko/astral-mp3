/**
 * The on-beat predicate for snap timing. The legacy rule credited only the
 * 90ms AFTER a bass onset — a one-sided window that punished anticipation,
 * fatal in a music game. The grid path adds a predictive early window using
 * the offline beat grid (gridPhase + live inter-beat span), confidence-gated;
 * the union is NEVER stricter than the legacy rule, so gridless material
 * behaves exactly as before. Pure — node-tested.
 */

export const BEAT_WINDOW = {
  /** Seconds BEFORE the grid beat that still credit (anticipation). */
  early: 0.07,
  /** Seconds AFTER the grid beat that credit (reaction). */
  late: 0.09,
  /** audioFrame.gridConfidence floor for the grid path (matches the
   * visualTuning gating floor smoothstep(0.35, ...)). */
  minConfidence: 0.35,
  /** The legacy onset-trailing window, kept verbatim as the fallback. */
  onsetWindow: 0.09,
} as const

/**
 * @param gridPhase      0..1 phase within the current grid beat
 * @param gridSpanSec    live inter-beat interval in seconds (0 = no grid)
 * @param gridConfidence 0..1 offline grid confidence
 * @param timeSinceOnset seconds since the last detected bass onset
 */
export function isOnBeat(
  gridPhase: number,
  gridSpanSec: number,
  gridConfidence: number,
  timeSinceOnset: number,
  cfg: typeof BEAT_WINDOW = BEAT_WINDOW,
): boolean {
  if (timeSinceOnset <= cfg.onsetWindow) return true
  if (gridConfidence >= cfg.minConfidence && gridSpanSec > 1e-4) {
    const sinceBeat = gridPhase * gridSpanSec
    const untilBeat = (1 - gridPhase) * gridSpanSec
    if (sinceBeat <= cfg.late || untilBeat <= cfg.early) return true
  }
  return false
}
