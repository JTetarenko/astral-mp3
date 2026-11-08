import { fnv1a } from '../game/seededRandom'
import { computeBeatGrid } from './beatGrid'
import { computeIntensity } from './intensity'
import type { TrackAnalysis } from '../types'

/** Duck-typed AudioBuffer so tests can pass a plain object with PCM arrays. */
export interface PcmLike {
  numberOfChannels: number
  sampleRate: number
  duration: number
  getChannelData(channel: number): Float32Array
}

const HOP_SEC = 0.01 // 10ms RMS hop -> 100Hz envelope
const PROFILE_DECIMATE = 5 // 100Hz -> 20Hz energy profile

// Timer-free macrotask yield (the React-scheduler trick): setTimeout in hidden
// or occluded tabs is throttled to seconds-per-tick, MessageChannel never is.
const yieldChannel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null
function yieldToBrowser(): Promise<void> {
  if (!yieldChannel) return new Promise(r => setTimeout(r, 0))
  return new Promise(r => {
    yieldChannel.port1.onmessage = () => r()
    yieldChannel.port2.postMessage(null)
  })
}

/**
 * One-time offline pass over decoded PCM. Chunked with setTimeout(0) yields so
 * the loading screen can animate; total CPU is well under a second.
 */
export async function preAnalyze(
  buffer: PcmLike,
  onProgress?: (p: number) => void,
): Promise<TrackAnalysis> {
  const sr = buffer.sampleRate
  const hop = Math.max(1, Math.round(sr * HOP_SEC))
  const channels: Float32Array[] = []
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c))
  const totalSamples = channels[0]?.length ?? 0
  const nFrames = Math.max(1, Math.floor(totalSamples / hop))
  const rms = new Float32Array(nFrames)

  const chunkFrames = 100 // ~1s of audio per chunk
  const nCh = channels.length
  // Yield on a wall-clock budget so the loading bar can paint without
  // ballooning total time.
  let lastYield = performance.now()
  for (let f0 = 0; f0 < nFrames; f0 += chunkFrames) {
    const f1 = Math.min(nFrames, f0 + chunkFrames)
    for (let f = f0; f < f1; f++) {
      let sum = 0
      const s0 = f * hop
      const s1 = s0 + hop
      for (let s = s0; s < s1; s++) {
        let m = 0
        for (let c = 0; c < nCh; c++) m += channels[c][s]
        m /= nCh
        sum += m * m
      }
      rms[f] = Math.sqrt(sum / hop)
    }
    onProgress?.(f1 / nFrames)
    if (f1 < nFrames && performance.now() - lastYield > 30) {
      await yieldToBrowser()
      lastYield = performance.now()
    }
  }

  const onsetEnv = new Float32Array(nFrames)
  for (let i = 1; i < nFrames; i++) onsetEnv[i] = Math.max(0, rms[i] - rms[i - 1])

  const pn = Math.max(1, Math.floor(nFrames / PROFILE_DECIMATE))
  const profile = new Float32Array(pn)
  for (let i = 0; i < pn; i++) {
    let s = 0
    for (let j = 0; j < PROFILE_DECIMATE; j++) s += rms[i * PROFILE_DECIMATE + j]
    profile[i] = s / PROFILE_DECIMATE
  }

  let avgEnergy = 0
  let peakEnergy = 0
  for (let i = 0; i < nFrames; i++) {
    avgEnergy += rms[i]
    if (rms[i] > peakEnergy) peakEnergy = rms[i]
  }
  avgEnergy /= nFrames

  const bpm = estimateBpm(onsetEnv, 1 / HOP_SEC)
  // Keep the tail chunk under budget now that it also does grid + intensity.
  await yieldToBrowser()
  const beatGrid = computeBeatGrid(onsetEnv, 1 / HOP_SEC, bpm, buffer.duration)

  const bytes = new Uint8Array(pn + 4)
  for (let i = 0; i < pn; i++) bytes[i] = Math.min(255, Math.round(profile[i] * 255 * 4))
  const ms = Math.max(0, Math.round(buffer.duration * 1000))
  bytes[pn] = ms & 0xff
  bytes[pn + 1] = (ms >>> 8) & 0xff
  bytes[pn + 2] = (ms >>> 16) & 0xff
  bytes[pn + 3] = (ms >>> 24) & 0xff
  const seed = fnv1a(bytes)

  const profileRate = 1 / HOP_SEC / PROFILE_DECIMATE
  return {
    duration: buffer.duration,
    seed,
    bpm,
    energyProfile: profile,
    profileRate,
    avgEnergy,
    peakEnergy,
    intensity: computeIntensity(profile, profileRate, buffer.duration),
    beatGrid,
  }
}

/**
 * BPM via normalized autocorrelation of the onset envelope over the middle
 * 120s, parabolic peak interpolation, octave-folded into 70..180.
 * Wrong-but-stable on ambient material is acceptable (BPM only drives trail
 * fade and idle pulses).
 */
export function estimateBpm(onsetEnv: Float32Array, rate: number): number {
  const fallback = 120
  const maxLen = Math.round(120 * rate)
  let arr = onsetEnv
  if (arr.length > maxLen) {
    const start = (arr.length - maxLen) >> 1
    arr = arr.subarray(start, start + maxLen)
  }
  const n = arr.length
  const minLag = Math.max(1, Math.round((rate * 60) / 240))
  const maxLag = Math.min(Math.round((rate * 60) / 40), n - 2)
  if (maxLag <= minLag) return fallback

  let mean = 0
  for (let i = 0; i < n; i++) mean += arr[i]
  mean /= n
  let r0 = 0
  for (let i = 0; i < n; i++) {
    const d = arr[i] - mean
    r0 += d * d
  }
  if (r0 <= 1e-12) return fallback

  const corr = new Float32Array(maxLag + 2)
  let bestLag = -1
  let bestVal = -Infinity
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0
    for (let i = 0; i + lag < n; i++) s += (arr[i] - mean) * (arr[i + lag] - mean)
    corr[lag] = s / r0
    if (corr[lag] > bestVal) {
      bestVal = corr[lag]
      bestLag = lag
    }
  }
  if (bestLag < 0 || bestVal <= 0) return fallback

  let lag = bestLag
  if (bestLag > minLag && bestLag < maxLag) {
    const y1 = corr[bestLag - 1]
    const y2 = corr[bestLag]
    const y3 = corr[bestLag + 1]
    const denom = y1 - 2 * y2 + y3
    if (Math.abs(denom) > 1e-9) lag = bestLag + (0.5 * (y1 - y3)) / denom
  }

  let bpm = (60 * rate) / lag
  while (bpm < 70) bpm *= 2
  while (bpm > 180) bpm /= 2
  return Math.round(bpm * 10) / 10
}
