/**
 * Per-realm ambience beds — recipes and the pure scheduler. Zero new WAV
 * bytes: every bed is layered from the existing baked tribal kit (the
 * phase-8 "layered voices" house style). The WebAudio driver lives in sfx.ts
 * (sfxRealmUpdate); THIS module never touches audio APIs so node tests can
 * drive the scheduler with fake clocks and injected rng.
 *
 * Gain discipline: loops cap at BED_MASTER, one-shots at SHOT_CEIL — through
 * sfxGain that lands ~15 dB under the music. The bed is an atmosphere, never
 * a competitor. heart_beat and latch_gnaw_loop are OWNED by the trip/dread
 * arbitration and must never appear here (test-guarded).
 */

export const BED_MASTER = 0.14
export const SHOT_CEIL = 0.16
/** Only these samples loop cleanly (bakeSfx loop points). */
export const LOOPABLE = ['chant_loop', 'trip_drone', 'trip_shimmer'] as const
export type LoopSample = (typeof LOOPABLE)[number]

/** One-shot samples the beds may layer. */
export type ShotSample =
  | 'frame_drum_1'
  | 'frame_drum_2'
  | 'frame_drum_sub'
  | 'log_drum_1'
  | 'log_drum_2'
  | 'log_drum_3'
  | 'bone_click_1'
  | 'bone_click_2'
  | 'bone_click_3'
  | 'rattle'
  | 'gong_dark'
  | 'gong_swell'
  | 'bells_cluster'
  | 'breath_whoosh'
  | 'didge_pulse'
  | 'trip_horn'
  | 'horror_hiss_1'
  | 'horror_hiss_2'
  | 'warden_roar'

export interface LoopRecipe {
  sample: LoopSample
  rate: number
  /** Pre-master loop gain (x BED_MASTER-relative energy shaping in driver). */
  gain: number
  wet: number
  /** Optional one-pole lowpass on the loop voice (Hz). */
  lowpass?: number
}

export type LayerMode = 'downbeat' | 'offbeat' | 'beat' | 'everyNBars' | 'random'

export interface LayerRule {
  sample: ShotSample
  rate: number
  gain: number
  wet: number
  mode: LayerMode
  /** everyNBars: fire when barWrapCount % n === 0. */
  n?: number
  /** random mode: uniform gap window in seconds. */
  minGap?: number
  maxGap?: number
  /** Gate: only fire while energy >= this. */
  minEnergy?: number
  /** Random stereo width (+-pan); 0 = centered. */
  panSpread?: number
}

export interface RealmBedRecipe {
  /** == REALMS[i].id, test-aligned. */
  id: string
  loop: LoopRecipe | null
  layers: readonly LayerRule[]
}

/** Index == realm index (depth % 6). */
export const REALM_BEDS: readonly RealmBedRecipe[] = [
  {
    id: 'astral',
    loop: { sample: 'trip_shimmer', rate: 0.5, gain: 0.1, wet: 0.6 },
    layers: [
      { sample: 'bells_cluster', rate: 0.6, gain: 0.12, wet: 0.6, mode: 'everyNBars', n: 2 },
    ],
  },
  {
    id: 'jungle',
    loop: { sample: 'chant_loop', rate: 0.85, gain: 0.08, wet: 0.25 },
    layers: [
      { sample: 'didge_pulse', rate: 1.15, gain: 0.14, wet: 0.25, mode: 'offbeat', minEnergy: 0.5 },
      { sample: 'log_drum_2', rate: 1.3, gain: 0.1, wet: 0.3, mode: 'everyNBars', n: 2 },
      { sample: 'rattle', rate: 1.8, gain: 0.08, wet: 0.2, mode: 'random', minGap: 0.6, maxGap: 1.4, panSpread: 0.6 },
    ],
  },
  {
    id: 'cathedral',
    loop: { sample: 'chant_loop', rate: 0.6, gain: 0.12, wet: 0.7 },
    layers: [
      { sample: 'gong_swell', rate: 0.7, gain: 0.13, wet: 0.7, mode: 'everyNBars', n: 4 },
      { sample: 'bells_cluster', rate: 1.2, gain: 0.08, wet: 0.7, mode: 'beat', minEnergy: 0.7 },
    ],
  },
  {
    id: 'ritual',
    loop: { sample: 'chant_loop', rate: 0.72, gain: 0.11, wet: 0.35 },
    layers: [
      { sample: 'frame_drum_sub', rate: 0.72, gain: 0.16, wet: 0.3, mode: 'downbeat' },
      { sample: 'rattle', rate: 0.8, gain: 0.07, wet: 0.25, mode: 'offbeat', minEnergy: 0.55 },
    ],
  },
  {
    id: 'collapse',
    loop: { sample: 'trip_drone', rate: 0.44, gain: 0.1, wet: 0.5, lowpass: 1400 },
    layers: [
      { sample: 'rattle', rate: 0.6, gain: 0.09, wet: 0.4, mode: 'random', minGap: 1.2, maxGap: 2.6, panSpread: 0.5 },
      { sample: 'horror_hiss_1', rate: 0.7, gain: 0.05, wet: 0.6, mode: 'random', minGap: 4, maxGap: 9, panSpread: 0.7 },
    ],
  },
  {
    id: 'lavacore',
    loop: { sample: 'trip_drone', rate: 0.6, gain: 0.13, wet: 0.35, lowpass: 900 },
    layers: [
      { sample: 'frame_drum_sub', rate: 0.5, gain: 0.12, wet: 0.35, mode: 'downbeat' },
      { sample: 'warden_roar', rate: 0.35, gain: 0.07, wet: 0.7, mode: 'random', minGap: 9, maxGap: 16 },
      { sample: 'breath_whoosh', rate: 0.4, gain: 0.06, wet: 0.4, mode: 'random', minGap: 5, maxGap: 11, panSpread: 0.5 },
    ],
  },
]

export function realmBedForDepth(depth: number): RealmBedRecipe {
  const d = Math.max(0, Math.floor(depth))
  return REALM_BEDS[d % REALM_BEDS.length]
}

// ---------------------------------------------------------------------------
// Scheduler — pure, fake-clock friendly.

export interface AmbienceInputs {
  /** Seconds clock (any monotonic base). */
  now: number
  /** 0..1 tier-derived energy (T(0.35,0.6,0.85,1) in the driver). */
  energy: number
  /** audioFrame.barWrapCount mirror — increments once per bar. */
  barWrap: number
  /** Beat-edge flags the driver derives from the beat grid (false when the
   * grid confidence is low — random layers then carry the bed alone). */
  onDownbeat: boolean
  onBeat: boolean
  onOffbeat: boolean
}

export interface PlayIntent {
  sample: ShotSample
  rate: number
  gain: number
  wet: number
  pan: number
}

export interface AmbienceState {
  lastBarWrap: number
  /** Per-layer next-fire clock for random mode (NaN = unarmed). */
  randomNextAt: number[]
}

export function makeAmbienceState(): AmbienceState {
  return { lastBarWrap: -1, randomNextAt: [] }
}

/**
 * Advance the bed one tick; returns the one-shots to fire. Deterministic
 * given (state, inputs, rng). Bar-mode layers fire once per bar wrap; random
 * layers keep their own gap timers; energy gates silence layers in the calm.
 */
export function stepAmbience(
  state: AmbienceState,
  recipe: RealmBedRecipe,
  inputs: AmbienceInputs,
  rng: () => number,
): PlayIntent[] {
  const out: PlayIntent[] = []
  const barWrapped = inputs.barWrap !== state.lastBarWrap && state.lastBarWrap >= 0
  const firstSeen = state.lastBarWrap < 0
  state.lastBarWrap = inputs.barWrap
  for (let li = 0; li < recipe.layers.length; li++) {
    const layer = recipe.layers[li]
    if (layer.minEnergy !== undefined && inputs.energy < layer.minEnergy) continue
    let fire = false
    switch (layer.mode) {
      case 'downbeat':
        fire = inputs.onDownbeat
        break
      case 'beat':
        fire = inputs.onBeat
        break
      case 'offbeat':
        fire = inputs.onOffbeat
        break
      case 'everyNBars':
        fire = barWrapped && inputs.barWrap % Math.max(1, layer.n ?? 1) === 0
        break
      case 'random': {
        let next = state.randomNextAt[li]
        if (next === undefined || Number.isNaN(next) || firstSeen) {
          next = inputs.now + (layer.minGap ?? 1) + ((layer.maxGap ?? 2) - (layer.minGap ?? 1)) * rng()
          state.randomNextAt[li] = next
        }
        if (inputs.now >= next) {
          fire = true
          state.randomNextAt[li] =
            inputs.now + (layer.minGap ?? 1) + ((layer.maxGap ?? 2) - (layer.minGap ?? 1)) * rng()
        }
        break
      }
    }
    if (fire) {
      out.push({
        sample: layer.sample,
        rate: layer.rate,
        gain: layer.gain,
        wet: layer.wet,
        pan: layer.panSpread ? (rng() * 2 - 1) * layer.panSpread : 0,
      })
    }
  }
  return out
}
