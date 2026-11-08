import { describe, expect, it } from 'vitest'
import { BEAT_WINDOW, isOnBeat } from './beatWindow'

const SPAN = 0.5 // 120 BPM

describe('beatWindow', () => {
  it('credits late hits inside the +late window via the grid', () => {
    // 40ms after the beat, no recent onset
    expect(isOnBeat(0.04 / SPAN, SPAN, 0.9, 999)).toBe(true)
  })

  it('credits EARLY hits — the case the legacy one-sided rule fails', () => {
    // 50ms BEFORE the next beat (phase 0.9 of a 0.5s beat), no recent onset:
    // legacy (timeSinceOnset <= 0.09) would refuse this.
    const phase = 1 - 0.05 / SPAN
    expect(phase * SPAN).toBeGreaterThan(BEAT_WINDOW.late) // legacy-equivalent path can't fire
    expect(isOnBeat(phase, SPAN, 0.9, 999)).toBe(true)
  })

  it('refuses hits outside both windows', () => {
    expect(isOnBeat(0.5, SPAN, 0.9, 999)).toBe(false) // mid-beat
    expect(isOnBeat(0.3, SPAN, 0.9, 0.2)).toBe(false) // stale onset too
  })

  it('low confidence disables the grid but the onset fallback still credits', () => {
    expect(isOnBeat(0.95, SPAN, 0.1, 999)).toBe(false) // early hit, grid untrusted
    expect(isOnBeat(0.5, SPAN, 0.1, 0.05)).toBe(true) // onset path alive
  })

  it('zero span (no grid) degrades to pure legacy behavior', () => {
    expect(isOnBeat(0, 0, 1, 0.05)).toBe(true)
    expect(isOnBeat(0, 0, 1, 0.2)).toBe(false)
  })

  it('union property: whatever legacy credits, isOnBeat credits', () => {
    for (let ts = 0; ts <= 0.09; ts += 0.01) {
      for (let phase = 0; phase < 1; phase += 0.13) {
        expect(isOnBeat(phase, SPAN, 0, ts)).toBe(true)
      }
    }
  })
})
