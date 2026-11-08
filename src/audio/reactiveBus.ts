import {
  bandEnergy,
  bandRanges,
  createBandTracker,
  createOnsetDetector,
  dbToLinear,
  ONSET_HIGH,
  ONSET_MID,
  updateEnvelope,
  updateOnset,
  type BandRange,
  type BandTracker,
  type OnsetDetector,
} from './analysis'
import * as engine from './audioEngine'
import { createBeatCursor, updateBeatFields, type BeatCursor } from './beatGrid'
import {
  advanceTierState,
  buildDropIndex,
  createSectionCursor,
  createTierState,
  sampleCurve,
  sampleRise,
  updateSectionFields,
  type DropIndex,
  type SectionCursor,
  type TierState,
} from './intensity'
import { sfxTierChange } from './sfx'
import type { BeatGrid, IntensitySection, TrackAnalysis } from '../types'

/**
 * THE mutable per-frame audio snapshot. Scene components and the HUD rAF loop
 * read fields directly; nothing here ever flows through React state.
 */
export interface AudioFrame {
  time: number
  duration: number
  bass: number
  mids: number
  highs: number
  loudness: number
  /** True for exactly the frame an onset fired. */
  onset: boolean
  /** Decaying envelope of the last onset's strength (0..2). */
  onsetStrength: number
  timeSinceOnset: number
  beatPhase: number
  bpm: number
  flux: number
  fluxThreshold: number
  /** Song intensity 0..1: offline structural curve blended with live loudness. */
  intensity: number
  intensityOffline: number
  /** Discrete tier 0 CALM / 1 RISING / 2 PEAK / 3 SHATTER, with crossfade. */
  tier: number
  tierFrom: number
  /** 0..1 progress of the tier crossfade (~1.5s). */
  tierBlend: number

  // --- song structure (offline sections, O(1) monotonic pointer) ---
  /** Index into analysis.intensity.sections. */
  sectionIndex: number
  /** 0..1 within the current section. */
  sectionProgress: number
  /** Sec to current section end (last section: to end of track). */
  timeToNextSection: number
  /** Tier of the next section, -1 in the last. */
  nextTier: number
  /** Sec to next SHATTER start; 0 inside one; Infinity if none ahead. */
  timeToDrop: number
  /** startSec of the most recent SHATTER section reached; -999 before any. */
  dropAt: number

  // --- stable offline beat grid (consumers gate on the confidences) ---
  /** 0..1 within the current grid beat; free-runs past the grid ends. */
  gridPhase: number
  /** Virtual beat index; negative during lead-in, -1 when no grid. */
  gridBeatIndex: number
  /** 0..1 within the bar (barBeats per bar). */
  barPhase: number
  /** Live inter-beat interval (sec); 0 when no grid (beatWindow input). */
  gridSpanSec: number
  gridConfidence: number
  barConfidence: number

  // --- per-band onsets (bass onset remains `onset`/`onsetStrength`) ---
  midOnset: boolean
  /** Decaying envelope (0..2), exp(-dt*7). */
  midOnsetStrength: number
  highOnset: boolean
  /** Decaying envelope (0..2), exp(-dt*10). */
  highOnsetStrength: number

  // --- riser + one-shot event counters (consumers diff their last-seen) ---
  /** 0..1 recent upward slope of the offline intensity curve. */
  rise: number
  /** ++ the frame a tier commits (same gate as the SFX hook). */
  tierCommitCount: number
  /** ++ the frame playback enters a SHATTER section (1s freshness-gated). */
  dropCommitCount: number
}

export const audioFrame: AudioFrame = {
  time: 0,
  duration: 0,
  bass: 0,
  mids: 0,
  highs: 0,
  loudness: 0,
  onset: false,
  onsetStrength: 0,
  timeSinceOnset: 999,
  beatPhase: 0,
  bpm: 0,
  flux: 0,
  fluxThreshold: 0,
  intensity: 0,
  intensityOffline: 0,
  tier: 0,
  tierFrom: 0,
  tierBlend: 1,
  sectionIndex: 0,
  sectionProgress: 0,
  timeToNextSection: Infinity,
  nextTier: -1,
  timeToDrop: Infinity,
  dropAt: -999,
  gridPhase: 0,
  gridBeatIndex: -1,
  barPhase: 0,
  gridSpanSec: 0,
  gridConfidence: 0,
  barConfidence: 0,
  midOnset: false,
  midOnsetStrength: 0,
  highOnset: false,
  highOnsetStrength: 0,
  rise: 0,
  tierCommitCount: 0,
  dropCommitCount: 0,
}

const EMPTY_F32 = new Float32Array(0)
const EMPTY_U8 = new Uint8Array(0)

interface BusState {
  ready: boolean
  db: Float32Array<ArrayBuffer>
  mag: Float32Array<ArrayBuffer>
  ranges: [BandRange, BandRange, BandRange] | null
  full: BandRange | null
  trackers: BandTracker[]
  loudTracker: BandTracker | null
  onset: OnsetDetector | null
  onsetMid: OnsetDetector | null
  onsetHigh: OnsetDetector | null
  lastOnsetTime: number
  curve: Float32Array
  tierCurve: Uint8Array
  curveRate: number
  tierState: TierState
  sections: IntensitySection[]
  dropIndex: DropIndex | null
  sectionCursor: SectionCursor
  beatGrid: BeatGrid | null
  beatCursor: BeatCursor
}

const bus: BusState = {
  ready: false,
  db: new Float32Array(0),
  mag: new Float32Array(0),
  ranges: null,
  full: null,
  trackers: [],
  loudTracker: null,
  onset: null,
  onsetMid: null,
  onsetHigh: null,
  lastOnsetTime: -999,
  curve: EMPTY_F32,
  tierCurve: EMPTY_U8,
  curveRate: 20,
  tierState: createTierState(0),
  sections: [],
  dropIndex: null,
  sectionCursor: createSectionCursor(),
  beatGrid: null,
  beatCursor: createBeatCursor(),
}

/** (Re)initialize for a run. Bin math derives from the real context sample rate. */
export function initBus(analysis: TrackAnalysis): void {
  const { bpm, duration } = analysis
  const sampleRate = engine.getSampleRate()
  const fftSize = engine.getFftSize()
  const bins = fftSize / 2
  bus.db = new Float32Array(bins)
  bus.mag = new Float32Array(bins)
  bus.ranges = bandRanges(sampleRate, fftSize)
  bus.full = { start: bus.ranges[0].start, end: bus.ranges[2].end }
  bus.trackers = [
    createBandTracker(0.01, 0.25), // bass
    createBandTracker(0.015, 0.35), // mids
    createBandTracker(0.005, 0.15), // highs
  ]
  bus.loudTracker = createBandTracker(0.02, 0.5)
  bus.onset = createOnsetDetector(bus.ranges[0])
  bus.onsetMid = createOnsetDetector(bus.ranges[1])
  bus.onsetHigh = createOnsetDetector(bus.ranges[2])
  bus.lastOnsetTime = -999
  audioFrame.bpm = bpm
  audioFrame.duration = duration
  audioFrame.time = 0
  audioFrame.bass = audioFrame.mids = audioFrame.highs = audioFrame.loudness = 0
  audioFrame.onset = false
  audioFrame.onsetStrength = 0
  audioFrame.timeSinceOnset = 999
  audioFrame.beatPhase = 0
  audioFrame.flux = 0
  audioFrame.fluxThreshold = 0
  bus.curve = analysis.intensity.curve
  bus.tierCurve = analysis.intensity.tierCurve
  bus.curveRate = analysis.intensity.curveRate
  bus.sections = analysis.intensity.sections
  bus.dropIndex = buildDropIndex(bus.sections)
  bus.sectionCursor = createSectionCursor(
    bus.dropIndex.prev.length > 0 ? bus.dropIndex.prev[0] : -999,
  )
  bus.beatGrid = analysis.beatGrid
  bus.beatCursor = createBeatCursor()
  audioFrame.sectionIndex = 0
  audioFrame.sectionProgress = 0
  audioFrame.timeToNextSection = Infinity
  audioFrame.nextTier = -1
  audioFrame.timeToDrop = Infinity
  audioFrame.dropAt = -999
  audioFrame.gridPhase = 0
  audioFrame.gridBeatIndex = -1
  audioFrame.barPhase = 0
  audioFrame.gridSpanSec = 0
  audioFrame.gridConfidence = analysis.beatGrid.confidence
  audioFrame.barConfidence = analysis.beatGrid.barConfidence
  audioFrame.midOnset = false
  audioFrame.midOnsetStrength = 0
  audioFrame.highOnset = false
  audioFrame.highOnsetStrength = 0
  audioFrame.rise = 0
  audioFrame.tierCommitCount = 0
  audioFrame.dropCommitCount = 0
  // Start from CALM and blend toward the opening tier: a track that slams
  // straight into PEAK fades the visuals in over the blend window.
  bus.tierState = createTierState(0)
  const openingTier = bus.tierCurve.length > 0 ? bus.tierCurve[0] : 0
  if (openingTier > 0) advanceTierState(bus.tierState, openingTier, 0)
  audioFrame.intensity = 0
  audioFrame.intensityOffline = 0
  audioFrame.tier = bus.tierState.tier
  audioFrame.tierFrom = bus.tierState.tierFrom
  audioFrame.tierBlend = bus.tierState.blend
  bus.ready = true
}

export function resetBus(): void {
  bus.ready = false
  bus.curve = EMPTY_F32
  bus.tierCurve = EMPTY_U8
  bus.tierState = createTierState(0)
  bus.sections = []
  bus.dropIndex = null
  bus.sectionCursor = createSectionCursor()
  bus.beatGrid = null
  bus.beatCursor = createBeatCursor()
  audioFrame.bass = audioFrame.mids = audioFrame.highs = audioFrame.loudness = 0
  audioFrame.onset = false
  audioFrame.onsetStrength = 0
  audioFrame.flux = 0
  audioFrame.intensity = 0
  audioFrame.intensityOffline = 0
  audioFrame.tier = 0
  audioFrame.tierFrom = 0
  audioFrame.tierBlend = 1
  audioFrame.sectionIndex = 0
  audioFrame.sectionProgress = 0
  audioFrame.timeToNextSection = Infinity
  audioFrame.nextTier = -1
  audioFrame.timeToDrop = Infinity
  audioFrame.dropAt = -999
  audioFrame.gridPhase = 0
  audioFrame.gridBeatIndex = -1
  audioFrame.barPhase = 0
  audioFrame.gridSpanSec = 0
  audioFrame.gridConfidence = 0
  audioFrame.barConfidence = 0
  audioFrame.midOnset = false
  audioFrame.midOnsetStrength = 0
  audioFrame.highOnset = false
  audioFrame.highOnsetStrength = 0
  audioFrame.rise = 0
  audioFrame.tierCommitCount = 0
  audioFrame.dropCommitCount = 0
}

/** Called once per frame by the PlayScene frame driver. Zero allocations. */
export function updateAudioFrame(dt: number): void {
  if (
    !bus.ready ||
    !bus.ranges ||
    !bus.onset ||
    !bus.onsetMid ||
    !bus.onsetHigh ||
    !bus.loudTracker ||
    !bus.full
  )
    return
  const analyser = engine.getAnalyser()
  if (!analyser) return

  analyser.getFloatFrequencyData(bus.db)
  for (let i = 0; i < bus.db.length; i++) bus.mag[i] = dbToLinear(bus.db[i])

  audioFrame.bass = updateEnvelope(bus.trackers[0], bandEnergy(bus.mag, bus.ranges[0]), dt)
  audioFrame.mids = updateEnvelope(bus.trackers[1], bandEnergy(bus.mag, bus.ranges[1]), dt)
  audioFrame.highs = updateEnvelope(bus.trackers[2], bandEnergy(bus.mag, bus.ranges[2]), dt)
  audioFrame.loudness = updateEnvelope(bus.loudTracker, bandEnergy(bus.mag, bus.full), dt)

  const time = engine.getTime()
  audioFrame.time = time

  const o = updateOnset(bus.onset, bus.mag, time)
  audioFrame.flux = o.flux
  audioFrame.fluxThreshold = o.threshold
  audioFrame.onset = o.onset
  if (o.onset) {
    bus.lastOnsetTime = time
    audioFrame.onsetStrength = o.strength
  } else {
    audioFrame.onsetStrength *= Math.exp(-dt * 6)
  }
  audioFrame.timeSinceOnset = time - bus.lastOnsetTime
  audioFrame.beatPhase =
    audioFrame.bpm > 0 ? (audioFrame.timeSinceOnset * (audioFrame.bpm / 60)) % 1 : 0

  // Per-band onsets: mids (snare-ish) and highs (hats/cymbals)
  const om = updateOnset(bus.onsetMid, bus.mag, time, ONSET_MID)
  audioFrame.midOnset = om.onset
  audioFrame.midOnsetStrength = om.onset
    ? om.strength
    : audioFrame.midOnsetStrength * Math.exp(-dt * 7)
  const oh = updateOnset(bus.onsetHigh, bus.mag, time, ONSET_HIGH)
  audioFrame.highOnset = oh.onset
  audioFrame.highOnsetStrength = oh.onset
    ? oh.strength
    : audioFrame.highOnsetStrength * Math.exp(-dt * 10)

  // Song intensity: offline structural curve blended with the live loudness envelope
  const off = sampleCurve(bus.curve, bus.curveRate, time)
  audioFrame.intensityOffline = off
  audioFrame.intensity = Math.min(1, off * 0.7 + audioFrame.loudness * 0.3)

  // Tier crossfade + entry SFX hook (the bus is the only module that knows the commit instant)
  const tn = bus.tierCurve.length
  const targetTier = tn > 0 ? bus.tierCurve[Math.min(tn - 1, (time * bus.curveRate) | 0)] : 0
  if (advanceTierState(bus.tierState, targetTier, time) && time > 0.25) {
    sfxTierChange(bus.tierState.tier, bus.tierState.tierFrom)
    audioFrame.tierCommitCount++
  }
  audioFrame.tier = bus.tierState.tier
  audioFrame.tierFrom = bus.tierState.tierFrom
  audioFrame.tierBlend = bus.tierState.blend

  // Song structure: section lookahead + drop one-shots + stable beat grid + riser
  if (bus.dropIndex) {
    updateSectionFields(bus.sectionCursor, bus.sections, bus.dropIndex, time, audioFrame)
  }
  if (bus.beatGrid) updateBeatFields(bus.beatCursor, bus.beatGrid, time, audioFrame)
  audioFrame.rise = sampleRise(bus.curve, bus.curveRate, time)
}
