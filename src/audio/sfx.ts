/**
 * Tribal/mythic sample player. The kit is synthesized offline by
 * scripts/bakeSfx.mjs into public/assets/sfx/ (frame drums, log drums, bone
 * clicks, rattles, dark gongs, breath whooshes, a didgeridoo stinger and a
 * seamless throat-chant loop) and played through a cavern convolution reverb.
 *
 * Everything routes sfxGain -> glue compressor -> destination, deliberately
 * BYPASSING the analyser so effects never pollute the music-reactivity
 * analysis.
 * The game degrades to silence gracefully if the kit is missing.
 *
 * (Beat-quantizing hits was evaluated and rejected: beatPhase re-anchors on
 * every detected onset — not a stable grid — and added latency is directly
 * felt at flick speeds.)
 */
import { getContext } from './audioEngine'
import { mulberry32 } from '../game/seededRandom'
import {
  makeAmbienceState,
  REALM_BEDS,
  stepAmbience,
  type RealmBedRecipe,
} from './realmAmbience'
import { audioFrame } from './reactiveBus'

const SFX_MASTER = 0.5
const WET_BUS_LEVEL = 0.35

const KIT_FILES = [
  'frame_drum_1',
  'frame_drum_2',
  'frame_drum_sub',
  'log_drum_1',
  'log_drum_2',
  'log_drum_3',
  'bone_click_1',
  'bone_click_2',
  'bone_click_3',
  'rattle',
  'gong_dark',
  'gong_swell',
  'bells_cluster',
  'breath_whoosh',
  'didge_pulse',
  'chant_loop',
  'trip_drone',
  'trip_shimmer',
  'heart_beat',
  'trip_horn',
  'horror_hiss_1',
  'horror_hiss_2',
  'bone_snap',
  'latch_gnaw_loop',
  'warden_roar',
  'bow_draw_loop',
  'heavy_release',
  'arcane_impact',
  'ir_cavern',
] as const

type SampleName = (typeof KIT_FILES)[number]
type KitStatus = 'idle' | 'loading' | 'ready' | 'failed'

interface DroneHandle {
  src: AudioBufferSourceNode
  fade: GainNode
}

interface SfxState {
  status: KitStatus
  buffers: Map<string, AudioBuffer>
  loaded: number
  droneWanted: boolean
  drone: DroneHandle | null
  volume: number
}

function freshState(): SfxState {
  return { status: 'idle', buffers: new Map(), loaded: 0, droneWanted: false, drone: null, volume: 0.85 }
}

const state: SfxState = import.meta.env.DEV
  ? (((globalThis as Record<string, unknown>).__astralSfx ??= freshState()) as SfxState)
  : freshState()

interface SfxNodes {
  ctx: AudioContext
  sfxGain: GainNode
  wetIn: AudioNode | null
}

let nodes: SfxNodes | null = null

function graph(): SfxNodes | null {
  const ctx = getContext()
  if (!ctx) return null
  if (!nodes || nodes.ctx !== ctx) {
    const sfxGain = ctx.createGain()
    sfxGain.gain.value = state.volume * SFX_MASTER
    // bus glue: catches drop-wave surges of stacked one-shots before the DAC
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.knee.value = 12
    comp.ratio.value = 3
    comp.attack.value = 0.004
    comp.release.value = 0.18
    sfxGain.connect(comp)
    comp.connect(ctx.destination)
    nodes = { ctx, sfxGain, wetIn: null }
    bindConvolver()
  }
  return nodes
}

function bindConvolver(): void {
  if (!nodes || nodes.wetIn) return
  const ir = state.buffers.get('ir_cavern')
  if (!ir) return
  const conv = nodes.ctx.createConvolver()
  conv.normalize = true
  conv.buffer = ir
  const wetGain = nodes.ctx.createGain()
  wetGain.gain.value = WET_BUS_LEVEL
  conv.connect(wetGain)
  wetGain.connect(nodes.sfxGain)
  nodes.wetIn = conv
}

export function setSfxVolume(v: number): void {
  state.volume = v
  if (nodes) nodes.sfxGain.gain.value = v * SFX_MASTER
}

/**
 * Fetch + decode the kit. Idempotent, never blocks the caller, tolerates
 * per-sample failures. Fired from selectTrack (in parallel with the track
 * download) and lazily by startDrone.
 */
export async function loadSfxKit(): Promise<void> {
  const ctx = getContext()
  if (!ctx) return // no gesture yet — a later call retries
  if (state.status === 'loading' || state.status === 'ready') return
  state.status = 'loading'
  await Promise.allSettled(
    KIT_FILES.map(async name => {
      if (state.buffers.has(name)) return
      const res = await fetch(`/assets/sfx/${name}.wav`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buffer = await ctx.decodeAudioData(await res.arrayBuffer())
      state.buffers.set(name, buffer)
    }),
  )
  state.loaded = state.buffers.size
  if (state.buffers.size === 0) {
    state.status = 'failed'
    console.warn('Astral Resonance: SFX kit missing — run `npm run bake:sfx` and reload.')
    return
  }
  state.status = 'ready'
  bindConvolver()
  if (state.droneWanted && !state.drone) startDrone()
}

export function getSfxKitStatus(): { status: KitStatus; loaded: number } {
  return { status: state.status, loaded: state.loaded }
}

interface PlayOpts {
  gain?: number
  rate?: number
  rateJitter?: number
  gainJitter?: number
  wet?: number
  delay?: number
  /** Stereo position -1..1. Pans the DRY path only — the cavern wet send taps
   * pre-pan, so reverb stays centered (correct acoustics). Loop voices never
   * pan. */
  pan?: number
}

function play(name: SampleName, opts: PlayOpts = {}): void {
  const g = graph()
  if (!g) return
  const buffer = state.buffers.get(name)
  if (!buffer) return
  const t0 = g.ctx.currentTime + (opts.delay ?? 0)
  const src = g.ctx.createBufferSource()
  src.buffer = buffer
  const rj = opts.rateJitter ?? 0.05
  src.playbackRate.value = (opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * rj)
  const gain = g.ctx.createGain()
  const gj = opts.gainJitter ?? 0.15
  gain.gain.value = (opts.gain ?? 1) * (1 + (Math.random() * 2 - 1) * gj)
  src.connect(gain)
  let panner: StereoPannerNode | null = null
  if (opts.pan !== undefined && opts.pan !== 0 && typeof g.ctx.createStereoPanner === 'function') {
    panner = g.ctx.createStereoPanner()
    panner.pan.value = Math.max(-1, Math.min(1, opts.pan))
    gain.connect(panner)
    panner.connect(g.sfxGain)
  } else {
    gain.connect(g.sfxGain)
  }
  let send: GainNode | null = null
  const wet = opts.wet ?? 0.12
  if (wet > 0 && g.wetIn) {
    send = g.ctx.createGain()
    send.gain.value = wet
    gain.connect(send)
    send.connect(g.wetIn)
  }
  src.onended = () => {
    src.disconnect()
    gain.disconnect()
    send?.disconnect()
    panner?.disconnect()
  }
  src.start(t0)
}

/** Per-family one-shot throttle: a drop-wave surge of windups must stay a few
 * voices, not a chorus. Returns true when the call should be dropped. */
const lastAt: Record<string, number> = {}
function throttled(key: string, minGap: number): boolean {
  const g = graph()
  if (!g) return true
  const now = g.ctx.currentTime
  if (now - (lastAt[key] ?? -999) < minGap) return true
  lastAt[key] = now
  return false
}

/** Round-robin variant selection with no immediate repeats. */
const lastVariant = new Map<string, number>()
function variant(base: string, n: number): SampleName {
  const last = lastVariant.get(base) ?? -1
  let next = Math.floor(Math.random() * n)
  if (n > 1 && next === last) next = (next + 1) % n
  lastVariant.set(base, next)
  return `${base}_${next + 1}` as SampleName
}

// ---------- event mapping (export names stable across the codebase) ----------

/** Menu/button tick: dry bone click. */
export function sfxUiClick(): void {
  play(variant('bone_click', 3), { gain: 0.5, rate: 0.9, wet: 0.08 })
}

/** Cursor passes over an interactive menu element — tiny high bone tick. */
export function sfxUiHover(): void {
  play(variant('bone_click', 3), { gain: 0.16, rate: 1.35, rateJitter: 0.08, wet: 0.05 })
}

/** Begin-rite plunge: slow breath + sub drum as the void takes the pointer. */
export function sfxBeginRite(): void {
  play('breath_whoosh', { gain: 0.7, rate: 0.72, wet: 0.3 })
  play('frame_drum_sub', { gain: 0.7, delay: 0.12, wet: 0.2 })
}

/** End-screen reveal: distant gong swell + bells while the stats engrave. */
export function sfxRunEnd(): void {
  play('gong_swell', { gain: 0.45, wet: 0.5 })
  play('bells_cluster', { gain: 0.3, rate: 0.85, delay: 0.35, wet: 0.5 })
}

/** Crosshair acquires a resonance point — fires constantly, stays subtle. */
export function sfxLock(): void {
  play(variant('bone_click', 3), { gain: 0.3, rate: 1.12, rateJitter: 0.06, wet: 0.08 })
}

/** Astral form launches: breath whoosh. */
export function sfxSnapLaunch(): void {
  play('breath_whoosh', { gain: 0.8, wet: 0.15 })
}

/** Body arrives: frame drum; on-beat adds tuned sub weight + log drum. */
export function sfxImpact(onBeat: boolean): void {
  play(variant('frame_drum', 2), { gain: onBeat ? 1.25 : 1.0, wet: 0.12 })
  if (onBeat) {
    play('frame_drum_sub', { gain: 0.9, rateJitter: 0, gainJitter: 0.05, wet: 0.1 })
    play(variant('log_drum', 3), { gain: 0.6, wet: 0.12 })
  }
}

/** Resonance point activation ritual: dark gong + seed rattle tail. */
export function sfxChime(): void {
  play('gong_dark', { gain: 0.75, wet: 0.45 })
  play('rattle', { gain: 0.5, delay: 0.06, wet: 0.18 })
}

/** All points activated: gong + bells + a frame-drum triplet on the track's pulse. */
export function sfxComplete(): void {
  play('gong_dark', { gain: 0.9, wet: 0.45 })
  play('bells_cluster', { gain: 0.7, delay: 0.15, wet: 0.45 })
  const step = audioFrame.bpm > 0 ? 30 / audioFrame.bpm : 0.18
  const gains = [0.7, 0.55, 0.85]
  for (let i = 0; i < 3; i++) {
    play(variant('frame_drum', 2), { gain: gains[i], delay: i * step, wet: 0.12 })
  }
}

/** Tier transitions (called by reactiveBus at the commit instant). */
export function sfxTierChange(tier: number, prev: number): void {
  if (tier === 3 && prev < 3) {
    play('didge_pulse', { gain: 0.9, rateJitter: 0.03, wet: 0.3 })
  } else if (tier === 2 && prev < 2) {
    play('gong_swell', { gain: 0.55, wet: 0.45 })
  }
  // downward transitions stay silent — the music itself is the cue
}

// ---------- horror combat layer (layered from the existing tribal kit;
// dedicated baked samples can upgrade these without touching call sites) ----------

/** A strike or bolt connects with a horror: dry knock + bone crack. */
export function sfxEnemyHit(): void {
  play(variant('log_drum', 3), { gain: 0.5, rate: 1.2, wet: 0.1 })
  play(variant('bone_click', 3), { gain: 0.5, rate: 1.3, wet: 0.08 })
}

/** A snap that finds nothing: a dry air-cut. Failure must be audible. */
export function sfxWhiff(): void {
  play('breath_whoosh', { gain: 0.22, rate: 2.1, wet: 0.05 })
  play(variant('bone_click', 3), { gain: 0.15, rate: 1.6, rateJitter: 0.05, wet: 0.04 })
}

/** An action refused (no charge, sealed gate): a dead knock. */
export function sfxDenied(): void {
  play(variant('log_drum', 3), { gain: 0.35, rate: 0.55, wet: 0.06 })
  play(variant('bone_click', 3), { gain: 0.3, rate: 0.7, wet: 0.05 })
}

/** A horror comes apart: dry bone crack + low log knock. */
export function sfxEnemyKill(): void {
  play('bone_snap', { gain: 0.85, wet: 0.18 })
  play(variant('log_drum', 3), { gain: 0.6, rate: 0.8, wet: 0.2 })
}

/** A horror latches on: wet bone bite + an inhale through teeth. */
export function sfxLatch(): void {
  play('bone_snap', { gain: 0.8, rate: 0.82, wet: 0.12 })
  play(variant('horror_hiss', 2), { gain: 0.7, wet: 0.15 })
}

/** Banish Nova: bright gong crack over a deep exhale. */
export function sfxBanish(): void {
  play('gong_dark', { gain: 0.7, rate: 1.25, wet: 0.35 })
  play('breath_whoosh', { gain: 0.6, rate: 0.6, wet: 0.4 })
}

// ---------- cast / draw layer (the RMB verb) ----------

const castAudio = { draw: null as LoopVoice | null }

/** Cast windup: a small inhale + click on every RMB press. */
export function sfxCastWindup(): void {
  if (throttled('castWindup', 0.1)) return
  play('breath_whoosh', { gain: 0.2, rate: 1.35, wet: 0.05 })
  play(variant('bone_click', 3), { gain: 0.2, rate: 1.2, wet: 0.04 })
}

/** Combo-tier escalation stacked on any release — the bow sounds hotter as
 * the ladder climbs, without any new samples. */
function playComboLayers(tier: number): void {
  if (tier >= 1) play(variant('bone_click', 3), { gain: 0.12 + 0.04 * tier, rate: 1.5, wet: 0.06 })
  if (tier >= 2) play('rattle', { gain: 0.15, rate: 1.35, wet: 0.1 })
  if (tier >= 3) play(variant('log_drum', 3), { gain: 0.2, rate: 1.9, wet: 0.1 })
}

/** The loose. power 0 = quick bolt flick; higher = the heavy bow release. */
export function sfxCastLoose(power: number, onBeat: boolean, comboTier = 0): void {
  const p = Math.min(1, Math.max(0, power))
  if (p < 0.05) {
    play('breath_whoosh', { gain: 0.4, rate: 1.55, wet: 0.06 })
    play(variant('bone_click', 3), { gain: 0.32, rate: 1.4, wet: 0.05 })
    play(variant('log_drum', 3), { gain: 0.25, rate: 1.7, wet: 0.08 })
  } else {
    play('heavy_release', { gain: 0.5 + 0.4 * p, rate: 1.15 - 0.35 * p, wet: 0.18 })
    if (p > 0.2) play('frame_drum_sub', { gain: 0.6 * p, wet: 0.15 })
    play('breath_whoosh', { gain: 0.3, rate: 1.1, wet: 0.1 })
  }
  if (onBeat) play('bells_cluster', { gain: 0.2 + 0.15 * p, rate: 1.3, wet: 0.3 })
  playComboLayers(comboTier)
}

/** Overdraw volley: three staggered releases leaving as one fanned breath.
 * Fixed 55ms stagger — the bolts leave near-simultaneously, so a BPM step
 * would desync sound from sight. */
export function sfxCastVolley(onBeat: boolean, comboTier = 0): void {
  const rates = [1.05, 0.98, 0.92]
  const gains = [0.42, 0.38, 0.44]
  for (let i = 0; i < 3; i++) {
    play('heavy_release', { gain: gains[i], rate: rates[i], delay: i * 0.055, wet: 0.15 })
  }
  play('frame_drum_sub', { gain: 0.55, wet: 0.15 })
  play('breath_whoosh', { gain: 0.3, rate: 1.2, wet: 0.1 })
  if (onBeat) play('bells_cluster', { gain: 0.3, rate: 1.3, wet: 0.3 })
  playComboLayers(comboTier)
}

/** Resonance storm: a ritual swell under five shards leaving in sequence. */
export function sfxCastStorm(onBeat: boolean): void {
  play('gong_swell', { gain: 0.55, rate: 1.1, wet: 0.4 })
  play('didge_pulse', { gain: 0.5, rate: 1.15, delay: 0.05, wet: 0.3 })
  play('heavy_release', { gain: 0.5, rate: 0.8, delay: 0.02, wet: 0.2 })
  for (let i = 0; i < 5; i++) {
    play(variant('bone_click', 3), {
      gain: 0.3,
      rate: 1.5 + i * 0.08,
      delay: 0.06 + i * 0.045,
      wet: 0.12,
    })
  }
  play('bells_cluster', { gain: 0.4, rate: 1.45, delay: 0.12, wet: 0.35 })
  if (onBeat) play('bells_cluster', { gain: 0.25, rate: 1.1, delay: 0.3, wet: 0.4 })
}

/** The storm arms — a low bell register: opportunity, not an impact. */
export function sfxStormArmed(): void {
  play('bells_cluster', { gain: 0.35, rate: 0.9, wet: 0.45 })
  play('gong_dark', { gain: 0.3, rate: 1.5, delay: 0.08, wet: 0.3 })
}

/** Bow-combo tier-up: escalating ritual accents. */
export function sfxComboTier(tier: number): void {
  if (throttled('comboTier', 0.15)) return
  play(variant('bone_click', 3), { gain: 0.3, rate: 1.3, wet: 0.08 })
  play(variant('log_drum', 3), { gain: 0.3, rate: 1.5, wet: 0.1 })
  if (tier >= 2) play('rattle', { gain: 0.25, rate: 1.2, wet: 0.12 })
  if (tier >= 3) {
    play('gong_dark', { gain: 0.4, rate: 1.4, wet: 0.3 })
    play('bells_cluster', { gain: 0.3, rate: 1.2, delay: 0.06, wet: 0.3 })
  }
}

/** The combo window lapses: one dry knuckle. Quiet — a lull, not a failure. */
export function sfxComboBreak(): void {
  if (throttled('comboBreak', 0.5)) return
  play(variant('bone_click', 3), { gain: 0.2, rate: 0.55, wet: 0.05 })
}

/** The nocked arrow splits into the volley fan — crystal crack + shimmer. */
export function sfxOverdrawSplit(): void {
  if (throttled('overdrawSplit', 0.3)) return
  play('bone_snap', { gain: 0.4, rate: 1.3, wet: 0.12 })
  play('bells_cluster', { gain: 0.2, rate: 1.6, wet: 0.25 })
}

/** Per-frame draw tension: a gain/rate-ramped creak loop — a ramped loop is
 * structurally unable to machine-gun. power 0 tears it silent; overdraw
 * strains the creak past the full-draw register. */
export function sfxDrawUpdate(power: number, over = 0): void {
  const g = graph()
  if (!g) return
  if (power > 0.01 && !castAudio.draw) castAudio.draw = startLoopVoice('bow_draw_loop', 0.2)
  if (castAudio.draw) {
    const now = g.ctx.currentTime
    const p = Math.min(1, power)
    const od = Math.min(1, Math.max(0, over))
    castAudio.draw.gain.gain.setTargetAtTime(0.5 * p * (1 + 0.4 * od), now, 0.15)
    castAudio.draw.src.playbackRate.value = 0.9 + 0.5 * p + 0.35 * od
    if (power <= 0.005) {
      stopLoopVoice(castAudio.draw)
      castAudio.draw = null
    }
  }
}

/** The draw tops out — a single ready shimmer. */
export function sfxDrawFull(): void {
  play('bells_cluster', { gain: 0.3, rate: 1.45, wet: 0.25 })
  play(variant('bone_click', 3), { gain: 0.3, rate: 1.6, wet: 0.06 })
}

/** A snap/shift tore the draw away: soft exhale fizzle. */
export function sfxDrawCancel(): void {
  play('breath_whoosh', { gain: 0.15, rate: 0.7, wet: 0.15 })
}

/** A charged shot connects: modal thud + crystalline debris, panned. */
export function sfxChargedImpact(pan = 0): void {
  if (throttled('chargedImpact', 0.09)) return
  play('arcane_impact', { gain: 0.7, wet: 0.2, pan })
  play(variant('log_drum', 3), { gain: 0.4, rate: 0.8, wet: 0.12, pan })
}

/** Warden windup telegraph: the roar with a didge growl under it. */
export function sfxWardenTell(): void {
  play('warden_roar', { gain: 0.75, rateJitter: 0.03, wet: 0.45 })
  play('didge_pulse', { gain: 0.35, rate: 0.85, delay: 0.1, wet: 0.4 })
}

/** Warden staggered: dark gong + triple bone crack. */
export function sfxWardenStagger(): void {
  play('gong_dark', { gain: 0.8, rate: 0.7, wet: 0.35 })
  for (let i = 0; i < 3; i++) {
    play(variant('bone_click', 3), { gain: 0.6, rate: 0.8, delay: i * 0.09, wet: 0.15 })
  }
}

/** A bolt chips a horror (non-lethal): high knock tick, panned to the victim. */
export function sfxBoltHit(pan = 0): void {
  if (throttled('boltHit', 0.07)) return
  play(variant('bone_click', 3), { gain: 0.35, rate: 1.6, wet: 0.06, pan })
  play(variant('log_drum', 3), { gain: 0.28, rate: 1.5, wet: 0.06, pan })
}

/** A swarm horror coils to leap — THE must-react telegraph: rising hiss + rattle. */
export function sfxSwarmWindup(pan = 0): void {
  if (throttled('swarmWindup', 0.12)) return
  play(variant('horror_hiss', 2), { gain: 0.45, rate: 1.25, wet: 0.12, pan })
  play('rattle', { gain: 0.3, rate: 1.4, wet: 0.1, pan })
}

/** The leap launches: air rip + a dry click. */
export function sfxSwarmLeap(pan = 0): void {
  if (throttled('swarmLeap', 0.09)) return
  play('breath_whoosh', { gain: 0.4, rate: 1.9, wet: 0.08, pan })
  play(variant('bone_click', 3), { gain: 0.25, rate: 1.8, wet: 0.05, pan })
}

/** The warden's carapace hinges open — the bright "opportunity" register. */
export function sfxWardenExposed(): void {
  play('bells_cluster', { gain: 0.5, rate: 1.15, wet: 0.4 })
  play('gong_dark', { gain: 0.4, rate: 1.35, delay: 0.08, wet: 0.35 })
}

/** A warden blow lands on the player: sub thud + hiss + bone knock. */
export function sfxWardenHitPlayer(pan = 0): void {
  play('frame_drum_sub', { gain: 0.9, rate: 0.8, wet: 0.15, pan })
  play(variant('horror_hiss', 2), { gain: 0.5, wet: 0.15, pan })
  play(variant('bone_click', 3), { gain: 0.55, rate: 0.7, delay: 0.05, wet: 0.1, pan })
}

/** The warden falls — the biggest kill in the game (~2.5s layered collapse). */
export function sfxWardenDeath(): void {
  play('warden_roar', { gain: 0.9, rate: 0.55, wet: 0.5 })
  play('gong_swell', { gain: 0.7, rate: 0.5, delay: 0.25, wet: 0.5 })
  for (let i = 0; i < 3; i++) {
    play(variant('bone_click', 3), { gain: 0.5, rate: 0.75 - i * 0.08, delay: 0.5 + i * 0.22, wet: 0.25 })
  }
  play('frame_drum_sub', { gain: 0.85, rate: 0.65, delay: 0.9, wet: 0.2 })
}

/** The corpse detonates free of the relic (DEAD <- DYING). */
export function sfxWardenDetonate(): void {
  play('gong_dark', { gain: 0.8, rate: 1.15, wet: 0.35 })
  play('frame_drum_sub', { gain: 0.9, wet: 0.2 })
  play('bells_cluster', { gain: 0.45, delay: 0.15, wet: 0.45 })
}

/** The gate's seal chain shatters: the way down opens. */
export function sfxGateUnsealed(): void {
  play('gong_swell', { gain: 0.7, wet: 0.5 })
  play('bells_cluster', { gain: 0.5, rate: 1.1, delay: 0.2, wet: 0.5 })
}

/** Consumable rite voices — one identity per effect (purge reuses the nova). */
export function sfxRite(effect: string): void {
  switch (effect) {
    case 'purgeLatches':
      sfxBanish()
      break
    case 'stasisAura':
      play('gong_swell', { gain: 0.6, rate: 0.7, wet: 0.5 })
      play('bells_cluster', { gain: 0.35, rate: 0.7, delay: 0.2, wet: 0.5 })
      break
    case 'veil':
      play('breath_whoosh', { gain: 0.55, rate: 0.5, wet: 0.5 })
      play('bells_cluster', { gain: 0.3, rate: 1.2, delay: 0.15, wet: 0.4 })
      break
    case 'frenzy':
      play('didge_pulse', { gain: 0.7, rate: 1.2, wet: 0.3 })
      play('rattle', { gain: 0.5, rate: 1.3, delay: 0.05, wet: 0.15 })
      break
    case 'overcharge':
      play('gong_dark', { gain: 0.7, rate: 1.3, wet: 0.4 })
      play('bells_cluster', { gain: 0.5, delay: 0.12, wet: 0.45 })
      break
    default:
      sfxChime()
  }
}

/** A latched rider's gnaw tick bites through (discrete HP-loss voice over the bed). */
export function sfxGnawTick(): void {
  if (throttled('gnaw', 0.15)) return
  play(variant('bone_click', 3), { gain: 0.4, rate: 0.6, wet: 0.08 })
}

/** Sprint engages: a committed exhale. */
export function sfxSprintStart(): void {
  play('breath_whoosh', { gain: 0.35, rate: 1.3, wet: 0.08 })
}

/** Descent HP refill: the new realm restores the body. */
export function sfxHpRefill(delay = 0): void {
  play('bells_cluster', { gain: 0.4, rate: 1.05, wet: 0.4, delay })
  play('gong_swell', { gain: 0.35, rate: 1.2, wet: 0.4, delay: delay + 0.1 })
}

/** Snap grade confirm at arrival: bells, brighter and higher for PERFECT. */
export function sfxGradeConfirm(tier: 'perfect' | 'good'): void {
  if (throttled('grade', 0.1)) return
  play('bells_cluster', {
    gain: tier === 'perfect' ? 0.45 : 0.28,
    rate: tier === 'perfect' ? 1.3 : 1.0,
    wet: 0.3,
  })
}

/** Dragged from the sky: slow gong swell into a long falling breath. */
export function sfxDowned(): void {
  play('gong_swell', { gain: 0.9, rate: 0.55, wet: 0.5 })
  play('breath_whoosh', { gain: 0.6, rate: 0.5, delay: 0.2, wet: 0.4 })
  play('frame_drum_sub', { gain: 0.8, rate: 0.7, delay: 0.05, wet: 0.2 })
}

// ---------- DMT-trip layer (driven per-frame by visualTuning) ----------

interface LoopVoice {
  src: AudioBufferSourceNode
  gain: GainNode
}

const trip = {
  drone: null as LoopVoice | null,
  shimmer: null as LoopVoice | null,
  lastHornAt: -999,
  wasDeep: false,
  heartTimer: 0,
}

function startLoopVoice(name: SampleName, wet: number): LoopVoice | null {
  const g = graph()
  if (!g) return null
  const buffer = state.buffers.get(name)
  if (!buffer) {
    if (state.status === 'idle') void loadSfxKit()
    return null
  }
  const src = g.ctx.createBufferSource()
  src.buffer = buffer
  src.loop = true
  const gain = g.ctx.createGain()
  gain.gain.value = 0
  src.connect(gain)
  gain.connect(g.sfxGain)
  if (g.wetIn && wet > 0) {
    const send = g.ctx.createGain()
    send.gain.value = wet
    gain.connect(send)
    send.connect(g.wetIn)
  }
  src.start(0, Math.random() * buffer.duration)
  return { src, gain }
}

function stopLoopVoice(v: LoopVoice | null): void {
  if (!v) return
  const ctx = nodes?.ctx
  if (!ctx) return
  v.gain.gain.cancelScheduledValues(ctx.currentTime)
  v.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3)
  try {
    v.src.stop(ctx.currentTime + 1.5)
  } catch {
    // already stopped
  }
}

/**
 * Per-frame trip audio: a didge-drone bed that swells with the trip, spirit
 * shimmer that only joins when deep, a conch horn on the plunge, a soft
 * exhale on the return, and a heartbeat that accelerates as the drop nears.
 * Safe to call headless/node — degrades to a no-op without an AudioContext.
 */
export function sfxTripUpdate(tripLevel: number, charge: number, dt: number): void {
  const g = graph()
  if (!g) return
  const now = g.ctx.currentTime

  if (tripLevel > 0.05 && !trip.drone) trip.drone = startLoopVoice('trip_drone', 0.4)
  if (trip.drone) {
    trip.drone.gain.gain.setTargetAtTime(Math.min(1, tripLevel) * 0.6, now, 0.25)
    trip.drone.src.playbackRate.value = 1 + 0.05 * tripLevel
    if (tripLevel < 0.02) {
      stopLoopVoice(trip.drone)
      trip.drone = null
    }
  }

  const deep = Math.max(0, (tripLevel - 0.55) / 0.45)
  if (deep > 0.05 && !trip.shimmer) trip.shimmer = startLoopVoice('trip_shimmer', 0.5)
  if (trip.shimmer) {
    trip.shimmer.gain.gain.setTargetAtTime(deep * 0.5, now, 0.4)
    if (deep <= 0.01 && tripLevel < 0.4) {
      stopLoopVoice(trip.shimmer)
      trip.shimmer = null
    }
  }

  if (tripLevel > 0.5 && !trip.wasDeep) {
    trip.wasDeep = true
    if (now - trip.lastHornAt > 8) {
      trip.lastHornAt = now
      play('trip_horn', { gain: 0.85, rateJitter: 0.02, wet: 0.5 })
    }
  } else if (tripLevel < 0.15 && trip.wasDeep) {
    trip.wasDeep = false
    play('breath_whoosh', { gain: 0.5, rate: 0.55, wet: 0.35 })
    play('bells_cluster', { gain: 0.22, rate: 0.8, delay: 0.1, wet: 0.5 })
  }

  // heartbeat while approaching (pauses once fully inside the trip)
  if (charge > 0.12 && tripLevel < 0.6) {
    trip.heartTimer -= dt
    if (trip.heartTimer <= 0) {
      trip.heartTimer = 1.15 - 0.7 * Math.min(1, charge)
      play('heart_beat', { gain: 0.35 + 0.5 * charge, rateJitter: 0.02, wet: 0.15 })
    }
  } else {
    trip.heartTimer = Math.min(trip.heartTimer, 0.15)
  }
}

/** Hard-stop the trip layer (run teardown / quit-to-menu). */
export function sfxTripStop(): void {
  stopLoopVoice(trip.drone)
  stopLoopVoice(trip.shimmer)
  trip.drone = null
  trip.shimmer = null
  stopLoopVoice(castAudio.draw)
  castAudio.draw = null
  trip.wasDeep = false
  trip.heartTimer = 0
  stopLoopVoice(dread.gnaw)
  dread.gnaw = null
  dread.heartTimer = 0
  stopRealmBed()
}

// ---------- latch-dread layer (driven per-frame by visualTuning) ----------

const dread = {
  gnaw: null as LoopVoice | null,
  heartTimer: 0,
}

/**
 * Per-frame dread audio: the wet gnaw bed swells with the latch load and a
 * second heartbeat accelerates under it. The dread heart YIELDS to the trip
 * heart (sfxTripUpdate's charge-driven one) so the two never double-thump —
 * whichever pressure is higher owns the pulse. Downed slows everything to a
 * dying crawl. Torn down with the trip layer in sfxTripStop.
 */
export function sfxDreadUpdate(
  dreadLevel: number,
  downedFade: number,
  dropCharge: number,
  dt: number,
): void {
  const g = graph()
  if (!g) return
  const now = g.ctx.currentTime
  const level = Math.max(dreadLevel, downedFade * 0.8)

  if (level > 0.05 && !dread.gnaw) dread.gnaw = startLoopVoice('latch_gnaw_loop', 0.25)
  if (dread.gnaw) {
    dread.gnaw.gain.gain.setTargetAtTime(Math.min(1, level) * 0.42, now, 0.3)
    dread.gnaw.src.playbackRate.value = (1 + 0.15 * level) * (1 - 0.45 * downedFade)
    if (level < 0.02) {
      stopLoopVoice(dread.gnaw)
      dread.gnaw = null
    }
  }

  if (dreadLevel > 0.15 && dropCharge <= dreadLevel) {
    dread.heartTimer -= dt
    if (dread.heartTimer <= 0) {
      dread.heartTimer = (1.05 - 0.55 * Math.min(1, dreadLevel)) * (1 + 0.8 * downedFade)
      play('heart_beat', {
        gain: 0.3 + 0.5 * dreadLevel,
        rate: (1 + 0.4 * dreadLevel) * (1 - 0.35 * downedFade),
        rateJitter: 0.02,
        wet: 0.15,
      })
    }
  } else {
    dread.heartTimer = Math.min(dread.heartTimer, 0.2)
  }
}

// ---------- per-realm ambience bed (driven per-frame by visualTuning) ----------

interface RealmLoopVoice extends LoopVoice {
  filter: BiquadFilterNode | null
}

const realmBed = {
  idx: -1,
  loop: null as RealmLoopVoice | null,
  /** ctx time the incoming loop may start (0.6s out of the whiteout). */
  startAt: 0,
  sched: makeAmbienceState(),
  rng: mulberry32(0x50fa),
  prevBeatIdx: -1,
  prevGridPhase: 0,
  prevBarWrap: -1,
  /** Low-confidence fallback pseudo-beat clock (comet timer precedent). */
  fbTimer: 0,
  fbCount: 0,
}

/** Loop voice with an optional one-pole lowpass (magma/collapse darkening). */
function startRealmLoop(recipe: NonNullable<RealmBedRecipe['loop']>): RealmLoopVoice | null {
  const v = startLoopVoice(recipe.sample, recipe.wet)
  if (!v) return null
  let filter: BiquadFilterNode | null = null
  if (recipe.lowpass && nodes) {
    filter = nodes.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = recipe.lowpass
    // re-route src -> filter -> gain (the voice was src -> gain)
    v.src.disconnect()
    v.src.connect(filter)
    filter.connect(v.gain)
  }
  v.src.playbackRate.value = recipe.rate
  return { ...v, filter }
}

/**
 * Per-frame realm ambience: each realm hums its own bed layered from the
 * existing tribal kit — chant + didge + crickets in the jungle, monastic
 * chant + gongs in the cathedral, lowpassed drone + geological roars in the
 * core. Quiet by discipline (~15 dB under the music), ducks under combat
 * dread and the shift whiteout, crossfades across the realm swap. Beat-mode
 * layers ride the beat grid when confident and fall back to a seconds clock
 * when not. Safe headless — degrades to a no-op without an AudioContext.
 */
export function sfxRealmUpdate(
  dt: number,
  realmIdx: number,
  energy: number,
  duck: number,
  barWrapCount: number,
): void {
  const g = graph()
  if (!g) return
  const now = g.ctx.currentTime
  const bed = realmBed

  // realm crossfade: the old bed fades on the house stopLoopVoice ramp; the
  // new one starts 0.6s later, rising out of the whiteout
  if (bed.idx !== realmIdx) {
    bed.idx = realmIdx
    stopLoopVoice(bed.loop)
    bed.loop = null
    bed.startAt = now + 0.6
    bed.sched = makeAmbienceState()
    bed.rng = mulberry32((0x50fa ^ (realmIdx * 0x9e37)) >>> 0)
    bed.prevBeatIdx = -1
    bed.prevBarWrap = -1
    bed.fbTimer = 0
    bed.fbCount = 0
  }
  const recipe = REALM_BEDS[((realmIdx % REALM_BEDS.length) + REALM_BEDS.length) % REALM_BEDS.length]

  if (recipe.loop && !bed.loop && now >= bed.startAt && duck > 0.05) {
    bed.loop = startRealmLoop(recipe.loop)
  }
  if (bed.loop && recipe.loop) {
    const target = recipe.loop.gain * (0.7 + 0.3 * energy) * duck
    bed.loop.gain.gain.setTargetAtTime(Math.max(0.0001, target), now, 0.4)
  }

  // beat edges from the grid when confident; pseudo-clock otherwise
  let onBeat = false
  let onDownbeat = false
  let onOffbeat = false
  if (audioFrame.gridConfidence >= 0.35 && audioFrame.gridBeatIndex >= 0) {
    onBeat = audioFrame.gridBeatIndex !== bed.prevBeatIdx && bed.prevBeatIdx >= 0
    bed.prevBeatIdx = audioFrame.gridBeatIndex
    onOffbeat = bed.prevGridPhase < 0.5 && audioFrame.gridPhase >= 0.5
    bed.prevGridPhase = audioFrame.gridPhase
    onDownbeat = barWrapCount !== bed.prevBarWrap && bed.prevBarWrap >= 0
    bed.prevBarWrap = barWrapCount
  } else {
    bed.prevBeatIdx = -1
    bed.fbTimer -= dt
    if (bed.fbTimer <= 0) {
      bed.fbTimer = 0.6
      bed.fbCount++
      onBeat = true
      onDownbeat = bed.fbCount % 4 === 0
    }
  }

  if (duck > 0.1) {
    const intents = stepAmbience(
      bed.sched,
      recipe,
      { now, energy, barWrap: barWrapCount, onDownbeat, onBeat, onOffbeat },
      bed.rng,
    )
    for (const intent of intents) {
      play(intent.sample, {
        gain: intent.gain * duck * (0.75 + 0.25 * energy),
        rate: intent.rate,
        rateJitter: 0.03,
        wet: intent.wet,
        pan: intent.pan,
      })
    }
  }
}

/** Hard-stop the realm bed (rides the sfxTripStop teardown path). */
function stopRealmBed(): void {
  stopLoopVoice(realmBed.loop)
  realmBed.loop = null
  realmBed.idx = -1
}

// ---------- menu / end-screen chant drone ----------

export function startDrone(): void {
  state.droneWanted = true
  if (state.drone) return
  const g = graph()
  if (!g) return
  const buffer = state.buffers.get('chant_loop')
  if (!buffer) {
    if (state.status === 'idle') void loadSfxKit()
    return
  }
  const src = g.ctx.createBufferSource()
  src.buffer = buffer
  src.loop = true
  const fade = g.ctx.createGain()
  fade.gain.setValueAtTime(0, g.ctx.currentTime)
  fade.gain.linearRampToValueAtTime(0.5, g.ctx.currentTime + 2.5)
  // chant sits "in the cave": lowered dry + generous wet send
  const dry = g.ctx.createGain()
  dry.gain.value = 0.7
  src.connect(fade)
  fade.connect(dry)
  dry.connect(g.sfxGain)
  if (g.wetIn) {
    const send = g.ctx.createGain()
    send.gain.value = 0.5
    fade.connect(send)
    send.connect(g.wetIn)
  }
  src.start(0, Math.random() * buffer.duration)
  state.drone = { src, fade }
}

export function stopDrone(): void {
  state.droneWanted = false
  const d = state.drone
  if (!d) return
  state.drone = null
  const ctx = nodes?.ctx
  if (!ctx) return
  d.fade.gain.cancelScheduledValues(ctx.currentTime)
  d.fade.gain.setValueAtTime(d.fade.gain.value, ctx.currentTime)
  d.fade.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 1.2)
  try {
    d.src.stop(ctx.currentTime + 1.4)
  } catch {
    // already stopped
  }
}
