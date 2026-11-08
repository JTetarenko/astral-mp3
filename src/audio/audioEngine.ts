/**
 * Web Audio singleton. Chain: BufferSource -> Analyser -> MasterGain -> out
 * (analyser sits before the gain so volume never affects analysis).
 *
 * Stored on globalThis in dev so Vite HMR reuses one AudioContext instead of
 * stacking new ones (browsers cap ~6 contexts per page).
 */

interface EngineState {
  ctx: AudioContext | null
  analyser: AnalyserNode | null
  masterGain: GainNode | null
  source: AudioBufferSourceNode | null
  buffer: AudioBuffer | null
  startedAt: number
  playing: boolean
  volume: number
}

function freshState(): EngineState {
  return {
    ctx: null,
    analyser: null,
    masterGain: null,
    source: null,
    buffer: null,
    startedAt: 0,
    playing: false,
    volume: 0.85,
  }
}

const state: EngineState = import.meta.env.DEV
  ? (((globalThis as Record<string, unknown>).__astralAudio ??= freshState()) as EngineState)
  : freshState()

/** Must be called from inside a user-gesture handler (autoplay policy). */
export function ensureContext(): AudioContext {
  if (!state.ctx) {
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0 // we do our own asymmetric smoothing
    const gain = ctx.createGain()
    gain.gain.value = state.volume
    analyser.connect(gain)
    gain.connect(ctx.destination)
    state.ctx = ctx
    state.analyser = analyser
    state.masterGain = gain
  }
  if (state.ctx.state === 'suspended') void state.ctx.resume()
  return state.ctx
}

async function fetchWithProgress(
  url: string,
  onProgress?: (p: number) => void,
): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} while fetching track`)
  const total = Number(res.headers.get('content-length')) || 0
  if (!res.body || !total) return res.arrayBuffer()
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    onProgress?.(received / total)
  }
  const out = new Uint8Array(received)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out.buffer
}

export async function loadTrack(
  url: string,
  onProgress?: (p: number) => void,
): Promise<AudioBuffer> {
  const ctx = ensureContext()
  stopPlayback()
  state.buffer = null
  const data = await fetchWithProgress(url, onProgress)
  const buffer = await ctx.decodeAudioData(data)
  state.buffer = buffer
  return buffer
}

export function startPlayback(onEnded?: () => void): void {
  const ctx = ensureContext()
  if (!state.buffer || !state.analyser) throw new Error('No track loaded')
  stopPlayback()
  const src = ctx.createBufferSource()
  src.buffer = state.buffer
  src.connect(state.analyser)
  src.onended = () => {
    state.playing = false
    onEnded?.()
  }
  src.start()
  state.source = src
  state.startedAt = ctx.currentTime
  state.playing = true
}

export function stopPlayback(): void {
  const src = state.source
  if (!src) return
  // Detach the callback BEFORE stopping: a superseded source must never fire
  // onEnded later (a hidden tab can delay the event past the next startPlayback).
  src.onended = null
  try {
    src.stop()
  } catch {
    // already stopped
  }
  src.disconnect()
  state.source = null
  state.playing = false
}

/** Pause. ctx.currentTime freezes while suspended, so getTime() stays consistent. */
export function suspendAudio(): void {
  void state.ctx?.suspend()
}

export function resumeAudio(): void {
  void state.ctx?.resume()
}

/** Sample-accurate playback position in seconds. */
export function getTime(): number {
  if (!state.ctx || !state.buffer) return 0
  return Math.min(Math.max(0, state.ctx.currentTime - state.startedAt), state.buffer.duration)
}

export function getDuration(): number {
  return state.buffer?.duration ?? 0
}

export function isPlaying(): boolean {
  return state.playing
}

export function getAnalyser(): AnalyserNode | null {
  return state.analyser
}

/** Existing context or null — never creates one (that needs a user gesture). */
export function getContext(): AudioContext | null {
  return state.ctx
}

export function getSampleRate(): number {
  return state.ctx?.sampleRate ?? 48000
}

export function getFftSize(): number {
  return state.analyser?.fftSize ?? 2048
}

export function setVolume(v: number): void {
  state.volume = v
  if (state.masterGain) state.masterGain.gain.value = v
}

export function getBuffer(): AudioBuffer | null {
  return state.buffer
}

/** Drop the decoded PCM (~23 MB/min) when leaving play. */
export function releaseBuffer(): void {
  stopPlayback()
  state.buffer = null
}
