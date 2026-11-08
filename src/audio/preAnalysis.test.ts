import { describe, expect, it } from 'vitest'
import { estimateBpm, preAnalyze, type PcmLike } from './preAnalysis'

function makeBuffer(samples: Float32Array, sampleRate: number): PcmLike {
  return {
    numberOfChannels: 1,
    sampleRate,
    duration: samples.length / sampleRate,
    getChannelData: () => samples,
  }
}

/** Clicks (short bursts) at the given BPM over `seconds` at `sr`. */
function clickTrack(bpm: number, seconds: number, sr: number): Float32Array {
  const out = new Float32Array(Math.floor(seconds * sr))
  const interval = (60 / bpm) * sr
  const burst = Math.floor(sr * 0.03)
  for (let k = 0; k * interval < out.length; k++) {
    const start = Math.round(k * interval)
    for (let i = 0; i < burst && start + i < out.length; i++) {
      out[start + i] = 0.5 * (i % 2 === 0 ? 1 : -1)
    }
  }
  return out
}

describe('preAnalyze', () => {
  it('produces an energy profile peaking where the audio is loud', async () => {
    const sr = 8000
    const samples = new Float32Array(sr * 10) // 10s of silence...
    for (let i = sr * 4; i < sr * 5; i++) samples[i] = 0.8 * Math.sin(i * 0.3) // ...1s burst at t=4..5
    const a = await preAnalyze(makeBuffer(samples, sr))
    let maxIdx = 0
    for (let i = 0; i < a.energyProfile.length; i++) {
      if (a.energyProfile[i] > a.energyProfile[maxIdx]) maxIdx = i
    }
    const peakTime = maxIdx / a.profileRate
    expect(peakTime).toBeGreaterThan(3.5)
    expect(peakTime).toBeLessThan(5.5)
    expect(a.peakEnergy).toBeGreaterThan(a.avgEnergy)
  })

  it('produces a deterministic seed that differs for different audio', async () => {
    const sr = 8000
    const s1 = clickTrack(120, 8, sr)
    const s2 = clickTrack(97, 8, sr)
    const a1 = await preAnalyze(makeBuffer(s1, sr))
    const a1again = await preAnalyze(makeBuffer(s1, sr))
    const a2 = await preAnalyze(makeBuffer(s2, sr))
    expect(a1.seed).toBe(a1again.seed)
    expect(a1.seed).not.toBe(a2.seed)
  })

  it('estimates BPM of a 130 BPM click track within ±2', async () => {
    const sr = 8000
    const a = await preAnalyze(makeBuffer(clickTrack(130, 30, sr), sr))
    expect(Math.abs(a.bpm - 130)).toBeLessThanOrEqual(2)
  })

  it('octave-folds slow tempos into the 70-180 window', async () => {
    const sr = 8000
    const a = await preAnalyze(makeBuffer(clickTrack(65, 40, sr), sr))
    expect(Math.abs(a.bpm - 130)).toBeLessThanOrEqual(2)
  })

  it('reports progress up to 1', async () => {
    const sr = 8000
    const progress: number[] = []
    await preAnalyze(makeBuffer(clickTrack(120, 5, sr), sr), p => progress.push(p))
    expect(progress.length).toBeGreaterThan(0)
    expect(progress[progress.length - 1]).toBe(1)
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1])
    }
  })
})

describe('estimateBpm', () => {
  it('returns the fallback for flat envelopes', () => {
    expect(estimateBpm(new Float32Array(1000), 100)).toBe(120)
  })
})

describe('beat grid integration', () => {
  it('locks a stable, confident grid onto a 130 BPM click track', async () => {
    const sr = 8000
    const a = await preAnalyze(makeBuffer(clickTrack(130, 30, sr), sr))
    expect(Math.abs(a.beatGrid.gridBpm - 130)).toBeLessThanOrEqual(2)
    expect(a.beatGrid.confidence).toBeGreaterThan(0.6)
    const period = 60 / 130
    const m = a.beatGrid.beatTimes[0] % period
    expect(Math.min(m, period - m)).toBeLessThan(0.03) // phase-locked to the clicks
  })

  it('yields a zero/low-confidence grid on silent or tonal material without throwing', async () => {
    const sr = 8000
    const silent = await preAnalyze(makeBuffer(new Float32Array(sr * 10), sr))
    expect(silent.beatGrid.beatTimes.length).toBe(0)
    expect(silent.beatGrid.confidence).toBe(0)
    const tone = new Float32Array(sr * 10)
    for (let i = 0; i < tone.length; i++) tone[i] = 0.4 * Math.sin(i * 0.2)
    const tonal = await preAnalyze(makeBuffer(tone, sr))
    expect(tonal.beatGrid.confidence).toBeLessThan(0.3)
  })
})

describe('intensity integration', () => {
  it('quiet half / loud half PCM yields ordered tiers covering the track', async () => {
    const sr = 8000
    const seconds = 60
    const samples = new Float32Array(sr * seconds)
    for (let i = 0; i < samples.length; i++) {
      const loud = i >= samples.length / 2
      samples[i] = Math.sin(i * 0.4) * (loud ? 0.6 : 0.05)
    }
    const a = await preAnalyze(makeBuffer(samples, sr))
    expect(a.intensity.curve.length).toBeGreaterThan(0)
    const sections = a.intensity.sections
    expect(sections[0].startSec).toBe(0)
    expect(sections[sections.length - 1].endSec).toBeCloseTo(a.duration, 3)
    const tierAt = (t: number) =>
      sections.find(s => t >= s.startSec && t < s.endSec)?.tier ?? -1
    expect(tierAt(45)).toBeGreaterThan(tierAt(10))
  })
})
