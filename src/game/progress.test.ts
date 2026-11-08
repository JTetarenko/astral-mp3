import { describe, expect, it } from 'vitest'
import { applyRun, defaultProgress, parseProgress } from './progress'

describe('parseProgress', () => {
  it('returns defaults for null, garbage, and wrong types', () => {
    expect(parseProgress(null)).toEqual(defaultProgress())
    expect(parseProgress('not json {')).toEqual(defaultProgress())
    expect(parseProgress('"a string"')).toEqual(defaultProgress())
    expect(
      parseProgress(JSON.stringify({ bestDepth: 'nine', bestByTrack: 7, runs: null })),
    ).toEqual(defaultProgress())
  })

  it('round-trips valid data and drops invalid track entries', () => {
    const p = parseProgress(
      JSON.stringify({
        bestDepth: 4.9,
        runs: 12,
        bestByTrack: { 'a.mp3': 3, 'b.mp3': 'x', 'c.mp3': 0, 'd.mp3': 2.7 },
      }),
    )
    expect(p.bestDepth).toBe(4)
    expect(p.runs).toBe(12)
    expect(p.bestByTrack).toEqual({ 'a.mp3': 3, 'd.mp3': 2 })
  })

  it('clamps negatives', () => {
    expect(parseProgress(JSON.stringify({ bestDepth: -5, runs: -1 }))).toEqual(defaultProgress())
  })
})

describe('applyRun', () => {
  it('first run sets both bests', () => {
    const { next, newBest, newTrackBest } = applyRun(defaultProgress(), 't.mp3', 3)
    expect(next.bestDepth).toBe(3)
    expect(next.bestByTrack['t.mp3']).toBe(3)
    expect(next.runs).toBe(1)
    expect(newBest).toBe(true)
    expect(newTrackBest).toBe(true)
  })

  it('never regresses bests but always counts runs', () => {
    const p1 = applyRun(defaultProgress(), 't.mp3', 5).next
    const { next, newBest, newTrackBest } = applyRun(p1, 't.mp3', 2)
    expect(next.bestDepth).toBe(5)
    expect(next.bestByTrack['t.mp3']).toBe(5)
    expect(next.runs).toBe(2)
    expect(newBest).toBe(false)
    expect(newTrackBest).toBe(false)
  })

  it('per-track best is independent of the global best', () => {
    const p1 = applyRun(defaultProgress(), 'a.mp3', 6).next
    const { next, newBest, newTrackBest } = applyRun(p1, 'b.mp3', 4)
    expect(next.bestDepth).toBe(6)
    expect(next.bestByTrack['b.mp3']).toBe(4)
    expect(newBest).toBe(false)
    expect(newTrackBest).toBe(true)
  })

  it('does not mutate the input', () => {
    const p = defaultProgress()
    applyRun(p, 't.mp3', 9)
    expect(p).toEqual(defaultProgress())
  })
})
