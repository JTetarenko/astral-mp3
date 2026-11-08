/**
 * The visual twin of reactiveBus: one mutable per-frame snapshot every scene
 * component and post-effect reads. Computed once per frame (FrameDriver at
 * priority -90, right after the audio bus at -100). All per-tier constants go
 * through T() so every look change crossfades over the tier blend window —
 * nothing pops. Every reducedMotion cap is applied centrally here.
 */
import { audioFrame } from '../audio/reactiveBus'
import { sfxDreadUpdate, sfxRealmUpdate, sfxTripStop, sfxTripUpdate } from '../audio/sfx'
import { feel } from '../game/feelSignals'
import { runState } from '../game/runState'
import { SCORING } from '../game/scoring'
import { hashInts } from '../game/seededRandom'
import { updateRealmBlend, worldState } from '../game/worldState'
import { governor } from './perfGovernor'
// NB: runState is imported here for auraGlow — keep runState free of any
// import back into scene/ modules or this becomes a cycle.

/**
 * Peak styles: each PEAK/SHATTER stretch rolls one of four personalities so
 * consecutive drops feel different. All styles reweight existing uniforms —
 * no extra GPU cost.
 *  0 KALEIDO — the classic mandala fold (edge-masked, aim tunnel stays clear)
 *  1 TUNNEL  — no folding; heavy radial warp + ripple + long echo trails
 *  2 STROBE  — beat-locked sky pulses + fast hue travel (never under rm)
 *  3 FRACTAL — high-fold, low-mix kaleido drift + strong shimmer
 */
export const PEAK_STYLES = ['KALEIDO', 'TUNNEL', 'STROBE', 'FRACTAL'] as const

export interface VisualFrame {
  // tier crossfade weights (sum = 1)
  w0: number
  w1: number
  w2: number
  w3: number
  /** Effective song intensity (forced value in debug). */
  eI: number
  /** Settings mirror — pushed by PlayScene's store subscription. */
  vi: number
  rm: boolean
  /** Shared -1..1 breathing oscillator (camera, warp, mandala, nebula). */
  breath: number
  // slewed scene signals
  runeIgnition: number // 0..12 continuous
  shardGrowth: number
  debrisAmount: number
  auroraGate: number
  godrayGate: number
  // reactivity dials (multiply the audio-driven terms at existing sites)
  bassReact: number
  midsReact: number
  highsReact: number
  onsetReact: number
  // ---- cinematic band envelopes (vi-coupled via the dials) ----
  /** Bass-onset slam: fast attack / slow release — islands dip, ripples
   * flare, bloom kicks, camera feels the kick land. */
  bassSlam: number
  /** Traveling rune-glow wave phase (rad), advanced by mids + mid onsets. */
  midWavePhase: number
  /** Hi-hat/shimmer envelope feeding streak-spark emission. */
  highSparkle: number
  // post-FX targets (Effects.tsx copies into uniforms)
  echoDamp: number
  warpAmp: number
  rippleAmp: number
  kaleidoMix: number
  kaleidoN1: number
  kaleidoN2: number
  kaleidoNMix: number
  kaleidoSpin: number
  hue: number
  satBoost: number
  shimmerAmp: number
  fovBreathAmp: number

  // ---- song-structure: drop anticipation (continuous, false-positive safe) ----
  /** 0..1 charge-up over the ~3.5s before a known SHATTER start. */
  dropCharge: number
  /** 0..1 sharpener for the last ~0.5s (vignette close, desat, FOV pull). */
  dropInhale: number
  /** Degrees of FOV pull-in during the inhale. rm -> always 0. */
  dropFovPull: number

  // ---- song-structure: drop impact one-shots ----
  /** Impact envelope, 1 at the commit frame, exp(-5dt) decay. rm cap 0.6. */
  impactPulse: number
  /** Degrees of FOV kick, decays with impactPulse. */
  impactFov: number
  /** 0..1 screen blast ring progress; >= 1 means inactive. */
  blastProgress: number
  /** Blast distortion amplitude (vi-scaled, rm-capped). */
  blastAmp: number
  /** Monotonic counter; Particles diffs it to emit a nova burst. */
  novaCount: number
  /** Nebula/star flash envelope, exp(-6dt) decay. rm cap 0.5. */
  skyFlash: number
  /** World shockwave from the mandala (separate from the snap shockwave):
   * age advances here each frame so consumers share one time base. */
  dropWaveAge: number
  dropWaveStrength: number

  // ---- beat-locked layer (offline grid, confidence-gated) ----
  /** Musical pulse envelope per grid beat, pow(1-phase, 3). */
  beatPulse: number
  /** Downbeat pulse envelope per bar, pow(1-phase, 2.5). */
  barPulse: number
  /** Monotonic counter incremented on each bar wrap (consumers diff). */
  barWrapCount: number
  /** 0..1 effective bar-sync availability (comets fall back to timers at 0). */
  barSync: number

  // ---- shared scene gains ----
  /** Centralized island/shard/debris bass-lift gain (was triplicated T()). */
  liftGain: number
  /** Continuous 0..10 count of live energy tethers. */
  tetherCount: number
  /** Downbeat pluck envelope for tethers. rm -> always 0. */
  tetherPluck: number
  /** Mid-onset shard glint gain (0 when vi < 0.25). */
  glintGain: number
  /** Bass-onset ground ripple gain (0 when vi < 0.3). */
  onsetRippleGain: number
  /** 0..1 trip proximity: rises with dropCharge, saturates while the
   * kaleidoscope is engaged. Drives geometry morphing + the trip SFX bed.
   * rm cap 0.3. */
  tripLevel: number
  /** Stardust fall spawn rate, particles/sec (governor-scaled). */
  fallRate: number
  /** Fall direction sign from the realm: +1 stardust falls, -1 embers rise. */
  fallDir: number
  /** Comet spawn probability per bar (0 outside PEAK/SHATTER or governor >= 3). */
  cometRate: number
  /** rm cap 0.6. */
  cometSpeedMult: number
  /** FarRealm brightness gains. */
  cloudGlow: number
  spireGlow: number

  // ---- realm-driven scene atmosphere ----
  /** Scene fog distances (tier-crossfaded x realm mods; Background copies). */
  fogNear: number
  fogFar: number
  /** 0..1 bass-lit fog illumination (scene fog color lerp + post-fog glow).
   * Slewed; rm cap 0.5. */
  fogGlow: number
  /** Post-fog medium density gain for FogVolumeEffect (0 disables the pass).
   * Governor: 0 at L>=3, x0.7 at L2. */
  fogDensity: number
  /** Island rune-vein emission gain (tier base + mid-onset pulse). */
  runeGlow: number
  /** Ambient ash drifter count for Particles (governor-capped). */
  ambientCount: number
  /** Bass-onset ember flare gain for the ambient ash field. rm x0.5. */
  emberFlareGain: number

  // ---- diegetic HUD signals ----
  /** 0..1 score-multiplier aura (trail/avatar/rune-stone brightness).
   * Slewed; deliberately vi-independent — it is a gameplay readout. */
  auraGlow: number
  /** Aim-thread brightness gain (floored — the thread is UX, never vanishes). */
  threadGlow: number
  /** Aim-thread organic-noise amplitude gain. rm x0.4. */
  threadNoise: number
  /** PlayerTrail ribbon half-width gain. rm cap 1.0. */
  trailWidthGain: number
  /** AimThread ribbon half-width gain (floored >0 — the thread is UX). rm cap 1.0. */
  threadWidthGain: number
  /** Live island-tendril instance cap (tier x governor govScale x realm
   * dressing density; 0 at governor L4). */
  tendrilCount: number
  /** Live realm-dressing instance cap (tier x governor x realm density; 0 at
   * governor L4). RealmDressing reads it as a plain number. */
  dressingCount: number
  /** Far hero-landmark glow gain — floored at CALM (the skyline must always
   * read) and lifted by skyFlash/impact. rm cap 1.0. */
  landmarkGlow: number
  /** Realm-arrival bloom: 1 at the swap (rm 0.6), exp(-dt/0.9) decay — it
   * outlives the whiteout so the new realm blooms as the white clears. */
  arrivalPulse: number
  /** 1 the frame the realm gate opens, exp(-3t) decay. rm cap 0.5. */
  gateOpenPulse: number
  /** 0..1 track progress driving the background eclipse alignment. */
  eclipseProgress: number
  /** Eclipse corona brightness (drop charge / impact flares ride inside). */
  eclipseGlow: number
  /** 0..1 bass-weighted tunnel-vision depth (vignette + CA surge). rm cap 0.5. */
  tunnelDepth: number
  /** Vignette shaping (Effects copies; shiftFlash lift applied there). */
  vignetteDark: number
  vignetteOffset: number
  /** Realm-shift whiteout envelope, 1 at the gate snap, exp(-3.5t) decay. */
  shiftFlash: number
  /** Active peak personality (index into PEAK_STYLES). */
  peakStyle: number
  /** Radius of the legible aim tunnel the psyche stack leaves untouched. */
  centerClear: number

  // ---- per-tier color grade (Effects.tsx copies into ColorGradeEffect) ----
  gradeTempR: number
  gradeTempG: number
  gradeTempB: number
  gradeLift: number
  gradeSat: number
  gradeContrast: number
  gradeGrain: number

  // ---- horror combat layer ----
  /** 0..1 latch corruption load (latched / maxLatch, slewed). Gameplay
   * readout like auraGlow — vi-independent. rm value cap 0.6. */
  latchDread: number
  /** 0..1 low-blood dread: rises below 35% hp, squared shaping (slewed).
   * Feeds vignette + grade beside latchDread. rm cap 0.6. */
  hpDread: number
  /** One-shot on each new latch, exp(-6dt). rm start 0.6. */
  latchBite: number
  /** Combat impact envelope (kills / heavy hits), exp(-5dt). rm start 0.6. */
  combatPulse: number
  /** 0..1 proximity dread while a warden lives (slewed). rm x0.7. */
  wardenPresence: number
  /** 0..1 shaped copy of the warden windup telegraph. rm x0.6. */
  wardenTelegraph: number
  /** 0..1 Banish Nova ring progress; >= 1 means inactive. */
  banishProgress: number
  banishStrength: number
  /** World shockwave from combat events (warden death, nova) — twin of the
   * dropWave, separate slot so a drop and a kill never fight. */
  combatWaveAge: number
  combatWaveStrength: number
  combatWaveX: number
  combatWaveY: number
  combatWaveZ: number
  /** 0..1 death fade while phase === 'downed' (grade desat + vignette close). */
  downedFade: number
  /** 0..1 bolt-weapon readiness accent (avatar hand glow + reticle tick). */
  boltGlow: number
  /** 0..1 draw tension while charging a cast (HUD ring, FOV pinch, orb,
   * wing tension). rm cap 0.6 for screen-space uses. */
  castCharge: number
  /** 0..1 bow-combo ignition heat (slewed castComboTier/3). Gameplay readout
   * like auraGlow — vi-independent. rm cap 0.6. */
  bowHeat: number
  /** 0..1 storm-armed glow (slewed). rm cap 0.6. */
  stormGlow: number
  /** 0..1 stasis rite aura (slewed from runState.activeEffects.stasisT;
   * blinks ~2 Hz in the final 1.5s). rm: no blink, cap 0.6. */
  stasisAura: number
  /** 0..1 veil rite aura (same envelope contract as stasisAura). rm cap 0.6. */
  veilAura: number
  /** 0..1 frenzy rite aura (same envelope contract). rm cap 0.6. */
  frenzyAura: number
  /** 0..1 hit-stop signature: jumps with feel.hitStopT while frozen, exp(-18dt)
   * release. Applied centrally to gradeSat/gradeContrast/vignetteDark — no
   * component reads it directly. rm cap 0.5. */
  freezeFrame: number
}

export const visuals: VisualFrame = {
  w0: 1,
  w1: 0,
  w2: 0,
  w3: 0,
  eI: 0,
  vi: 0.8,
  rm: false,
  breath: 0,
  runeIgnition: 0,
  shardGrowth: 0,
  debrisAmount: 0,
  auroraGate: 0,
  godrayGate: 0,
  bassReact: 0.55,
  midsReact: 0.6,
  highsReact: 0.75,
  onsetReact: 0.8,
  bassSlam: 0,
  midWavePhase: 0,
  highSparkle: 0,
  echoDamp: 0,
  warpAmp: 0,
  rippleAmp: 0,
  kaleidoMix: 0,
  kaleidoN1: 4,
  kaleidoN2: 4,
  kaleidoNMix: 0,
  kaleidoSpin: 0,
  hue: 0,
  satBoost: 1,
  shimmerAmp: 0,
  fovBreathAmp: 0,
  dropCharge: 0,
  dropInhale: 0,
  dropFovPull: 0,
  impactPulse: 0,
  impactFov: 0,
  blastProgress: 1,
  blastAmp: 0,
  novaCount: 0,
  skyFlash: 0,
  dropWaveAge: 999,
  dropWaveStrength: 0,
  beatPulse: 0,
  barPulse: 0,
  barWrapCount: 0,
  barSync: 0,
  liftGain: 0.5,
  tetherCount: 0,
  tetherPluck: 0,
  glintGain: 0,
  onsetRippleGain: 0,
  tripLevel: 0,
  fallRate: 0,
  fallDir: 1,
  cometRate: 0,
  cometSpeedMult: 1,
  cloudGlow: 0,
  spireGlow: 0,
  fogNear: 40,
  fogFar: 220,
  fogGlow: 0,
  fogDensity: 0,
  runeGlow: 0,
  ambientCount: 240,
  emberFlareGain: 0,
  auraGlow: 0,
  threadGlow: 0.9,
  threadNoise: 0.5,
  trailWidthGain: 1,
  threadWidthGain: 1,
  tendrilCount: 0,
  dressingCount: 0,
  landmarkGlow: 0,
  arrivalPulse: 0,
  gateOpenPulse: 0,
  eclipseProgress: 0,
  eclipseGlow: 0.5,
  tunnelDepth: 0,
  vignetteDark: 0.55,
  vignetteOffset: 0.3,
  shiftFlash: 0,
  peakStyle: 0,
  centerClear: 0.28,
  gradeTempR: 1,
  gradeTempG: 1,
  gradeTempB: 1,
  gradeLift: 0,
  gradeSat: 1,
  gradeContrast: 1,
  gradeGrain: 0,
  latchDread: 0,
  hpDread: 0,
  latchBite: 0,
  combatPulse: 0,
  wardenPresence: 0,
  wardenTelegraph: 0,
  banishProgress: 1,
  banishStrength: 0,
  combatWaveAge: 999,
  combatWaveStrength: 0,
  combatWaveX: 0,
  combatWaveY: 0,
  combatWaveZ: 0,
  downedFade: 0,
  boltGlow: 0,
  castCharge: 0,
  bowHeat: 0,
  stormGlow: 0,
  stasisAura: 0,
  veilAura: 0,
  frenzyAura: 0,
  freezeFrame: 0,
}

/**
 * Combat inputs written by the game loop (EnemyDirector / snapController run
 * AFTER visualTuning's -90 tick, so these are read one frame late — invisible
 * behind the slews). Kept as a plain struct so visualTuning never has to
 * import enemyState (snapController already imports this module).
 */
export const combatSignals = {
  latchedCount: 0,
  maxLatch: 3,
  /** 0..1 player blood pool fraction (EnemyDirector writes). */
  hpFrac: 1,
  /** Distance to the live warden (999 when none). */
  wardenDist: 999,
  wardenAlive: false,
  /** 0..1 raw windup telegraph from the warden state machine. */
  wardenTelegraph: 0,
  downed: false,
  /** 0..1 cast readiness from the controller (1 = ready to cast). */
  boltCharge: 0,
  /** 0..1 draw power while the cast machine is in CHARGE. */
  castCharge: 0,
  /** Mirror of castState CP.* phase (renderers read, never step). */
  castPhase: 0,
  /** 0..1 held past full draw — the volley split ramp. */
  castOver: 0,
  /** Live bow-combo hit count (HUD widget reads). */
  castComboCount: 0,
  /** Bow-combo tier 0..3 — the bow's ignition level. */
  castComboTier: 0,
  /** A full-draw release will burst into the Resonance Storm. */
  stormArmed: false,
}

/**
 * Cross-module one-shot signals that are not per-frame values. Effects.tsx
 * diffs echoClear to flush the afterimage history (run start / replay).
 */
export const fxSignals = { echoClear: 0 }

/**
 * Realm-shift impact suite: the drop-impact one-shots plus the whiteout
 * envelope that masks the world swap. Fired from the snap controller the
 * moment the player arrives at the gate.
 */
export function triggerShiftBurst(strength: number): void {
  const { vi, rm } = visuals
  const s = Math.max(0.5, Math.min(1.5, strength))
  visuals.impactPulse = rm ? 0.6 : 1
  visuals.impactFov = (rm ? 3 : 10) * s
  visuals.blastProgress = 0
  visuals.blastAmp = 0.06 * vi * (rm ? 0.35 : 1) * s
  visuals.novaCount++
  visuals.skyFlash = Math.min(rm ? 0.5 : 1, (0.7 + 0.3 * vi) * s)
  visuals.dropWaveAge = 0
  visuals.dropWaveStrength = 1.4 * (0.6 + 0.4 * vi) * (rm ? 0.5 : 1) * s
  visuals.shiftFlash = rm ? 0.65 : 1
}

/**
 * Combat impact suite: kills and heavy warden hits. Deliberately does NOT
 * touch novaCount (the 350-particle player nova stays reserved for musical
 * drops/shifts) and never fires shiftFlash — the whiteout is sacred to
 * descent. Particle bursts go through snapController.pendingBursts instead.
 */
export function triggerCombatImpact(strength: number, x: number, y: number, z: number): void {
  const { vi, rm } = visuals
  const s = Math.max(0.2, Math.min(1.5, strength))
  // max, not set: a swarm kill must never dampen a live warden detonation —
  // but the rm ceiling stays a hard clamp on the result (accessibility law)
  visuals.combatPulse = Math.max(visuals.combatPulse, Math.min(rm ? 0.6 : 1, s))
  if (rm) visuals.combatPulse = Math.min(visuals.combatPulse, 0.6)
  // punchier kill FOV (still under the 8-degree drop-impact crown)
  visuals.impactFov = Math.max(visuals.impactFov, (rm ? 2 : 6) * Math.min(1.25, s))
  visuals.combatWaveX = x
  visuals.combatWaveY = y
  visuals.combatWaveZ = z
  visuals.combatWaveAge = 0
  visuals.combatWaveStrength = 0.9 * (0.6 + 0.4 * vi) * (rm ? 0.5 : 1) * s
}

/** Banish Nova one-shot: drives the BanishNova ring + a screen kick. */
export function triggerBanishNova(strength: number): void {
  const { vi, rm } = visuals
  const s = Math.max(0.4, Math.min(1.5, strength))
  visuals.banishProgress = 0
  visuals.banishStrength = (0.6 + 0.4 * vi) * (rm ? 0.6 : 1) * s
  visuals.combatPulse = Math.max(visuals.combatPulse, rm ? 0.5 : 0.8)
}

/** Per-tier lookup through the current crossfade weights. */
export function T(a: number, b: number, c: number, d: number): number {
  return a * visuals.w0 + b * visuals.w1 + c * visuals.w2 + d * visuals.w3
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** Rate limiter: approaches target at upRate rising, downRate falling (units/sec). */
export function slew(cur: number, target: number, upRate: number, downRate: number, dt: number): number {
  if (target > cur) return Math.min(target, cur + upRate * dt)
  return Math.max(target, cur - downRate * dt)
}

/** One rite-aura envelope step: slews toward 1 while the rite runs, blinks
 * ~2 Hz through the final 1.5s (steady under rm), decays to 0 after. */
function riteAuraStep(cur: number, left: number, rm: boolean, clock: number, dt: number): number {
  let target = left > 0 ? 1 : 0
  if (!rm && left > 0 && left < 1.5) target = 0.55 + 0.45 * Math.sin(clock * 12.6)
  let v = slew(cur, target, 6, 3, dt)
  if (rm && v > 0.6) v = 0.6
  return v
}

/** Ignition order of the 12 mandala runes (stride-5 permutation — matches the
 * glyph-picking stride, so the visual order feels ritual, not sequential). */
export function runeRank(i: number): number {
  return (5 * i) % 12
}

/**
 * Radial push of the drop-impact world shockwave at `dist` units from the
 * mandala, read against visuals.dropWaveAge/dropWaveStrength. A gaussian ring
 * expanding at ~111 u/s, dead after 1.2s. Islands/debris add this beside the
 * existing snap-shockwave push (the snap struct is single-slot — never share).
 */
export function dropWavePush(dist: number): number {
  const age = visuals.dropWaveAge
  if (age < 0 || age >= 1.2 || visuals.dropWaveStrength <= 0) return 0
  const g = (dist - (100 * age) / 0.9) / 9
  return visuals.dropWaveStrength * Math.exp(-g * g) * (1 - age / 1.2)
}

/**
 * Radial push of the combat shockwave (warden death / nova) at `dist` units
 * from combatWaveX/Y/Z — the dropWave's twin on its own slot: ~70 u/s ring,
 * dead after 0.9s. Consumed by Islands beside dropWavePush.
 */
export function combatWavePush(dist: number): number {
  const age = visuals.combatWaveAge
  if (age < 0 || age >= 0.9 || visuals.combatWaveStrength <= 0) return 0
  const g = (dist - 70 * age) / 7
  return visuals.combatWaveStrength * Math.exp(-g * g) * (1 - age / 0.9)
}

/**
 * Life for a dust-stream particle so it dies roughly on arrival at the
 * mandala, solved against the particle system's exp(-0.5t) velocity damping:
 * distance(T) = 2*v0*(1 - e^(-T/2))  =>  T = -2*ln(1 - d/(2*v0)).
 */
export function streamLife(dist: number, speed: number): number {
  const reach = 2 * speed
  if (dist >= reach * 0.999) return 3.5
  return Math.max(0.8, Math.min(3.5, -2 * Math.log(1 - dist / reach)))
}

/** Debug forcing (DebugOverlay keys + ?tier= / ?int= URL params). -1 = live. */
export const forcing = {
  tier: -1,
  intensity: -1,
  /** 0 off, 1 warp, 2 warp+kaleido, 3 all — debug preview of the psyche stack. */
  psychePreview: 0,
  echoPreview: false,
  /** -1 live, else forced dropCharge/dropInhale level (G key, ?dropcharge=). */
  dropCharge: -1,
  /** One-shot: fire the drop impact suite next frame (H key). */
  impactNow: false,
  /** One-shot: spawn a comet next frame (J key). */
  cometNow: false,
  /** -1 live, else pin the peak style (N key cycles). */
  peakStyle: -1,
  /** -1 live, else pin a horror archetype (0..5): HorrorSwarm self-drives a
   * posed demo ring for headless/visual verification without gameplay. */
  horrorDemo: -1,
  /** Display-transform exposure (gl.toneMappingExposure, read by Effects each
   * frame). 1.12 compensates ACES mid-tone dimming on a dark scene; live-tune
   * via ?exposure=. */
  exposure: 1.12,
}

if (typeof location !== 'undefined') {
  const params = new URLSearchParams(location.search)
  // NB: Number(null) === 0, so the missing-param case MUST be guarded or an
  // absent ?tier= silently forces CALM forever
  const t = Number(params.get('tier'))
  if (params.get('tier') !== null && Number.isInteger(t) && t >= 0 && t <= 3) forcing.tier = t
  const i = Number(params.get('int'))
  if (Number.isFinite(i) && params.get('int') !== null) forcing.intensity = clamp01(i)
  const dc = Number(params.get('dropcharge'))
  if (Number.isFinite(dc) && params.get('dropcharge') !== null) forcing.dropCharge = clamp01(dc)
  const ex = Number(params.get('exposure'))
  if (Number.isFinite(ex) && params.get('exposure') !== null && ex > 0.1 && ex <= 4) forcing.exposure = ex
}

export function setVisualSettings(visualIntensity: number, reducedMotion: boolean): void {
  visuals.vi = visualIntensity
  visuals.rm = reducedMotion
}

interface TuningState {
  breathPhase: number
  prevTier: number
  lastSeenTier: number
  flashPulse: number
  kaleidoEngaged: boolean
  kaleidoDir: number
  lastNStepAt: number
  clock: number
  /** Last-seen audioFrame.dropCommitCount (impact trigger diff). */
  lastDropCommit: number
  /** Previous frame's barPhase (bar-wrap detection). */
  prevBarPhase: number
  /** Previous frame's gridPhase (STROBE beat detection). */
  prevGridPhase: number
  /** Monotonic count of peak-style rolls (feeds the style hash). */
  peakRolls: number
  lastStrobeAt: number
  /** Slewed bass envelope feeding tunnelDepth (raw bass is too spiky). */
  bassSlew: number
  /** Last-seen gate.openedAt (gateOpenPulse edge detection). */
  lastGateOpenedAt: number
  /** Last-seen runState.combat.latchesSuffered (latchBite edge detection). */
  lastLatchSuffered: number
  /** Last-seen worldState.epoch (arrivalPulse edge detection). */
  lastEpoch: number
}

const st: TuningState = {
  breathPhase: 0,
  prevTier: 0,
  lastSeenTier: 0,
  flashPulse: 0,
  kaleidoEngaged: false,
  kaleidoDir: 1,
  lastNStepAt: -999,
  clock: 0,
  lastDropCommit: 0,
  prevBarPhase: 0,
  prevGridPhase: 0,
  peakRolls: 0,
  lastStrobeAt: -999,
  bassSlew: 0,
  lastGateOpenedAt: 0,
  lastLatchSuffered: 0,
  lastEpoch: 0,
}

/** Roll the next peak personality — deterministic per (track, depth, count). */
function rollPeakStyle(): void {
  st.peakRolls++
  let style =
    forcing.peakStyle >= 0
      ? forcing.peakStyle
      : hashInts(worldState.trackSeed, worldState.depth, st.peakRolls, 0x9eaf) % 4
  // never strobe under reduced motion (photosensitivity) — take the tunnel
  if (visuals.rm && style === 2) style = 1
  visuals.peakStyle = style
}

export function resetVisuals(): void {
  st.breathPhase = 0
  st.prevTier = 0
  st.lastSeenTier = 0
  st.flashPulse = 0
  st.kaleidoEngaged = false
  st.lastNStepAt = -999
  st.lastDropCommit = 0
  st.prevBarPhase = 0
  st.prevGridPhase = 0
  st.lastStrobeAt = -999
  st.bassSlew = 0
  st.lastGateOpenedAt = 0
  visuals.kaleidoMix = 0
  visuals.kaleidoN1 = 4
  visuals.kaleidoN2 = 4
  visuals.kaleidoNMix = 0
  visuals.echoDamp = 0
  visuals.hue = 0
  visuals.runeIgnition = 0
  visuals.shardGrowth = 0
  visuals.debrisAmount = 0
  visuals.auroraGate = 0
  visuals.godrayGate = 0
  visuals.dropCharge = 0
  visuals.dropInhale = 0
  visuals.dropFovPull = 0
  visuals.impactPulse = 0
  visuals.impactFov = 0
  visuals.blastProgress = 1
  visuals.blastAmp = 0
  visuals.skyFlash = 0
  visuals.dropWaveAge = 999
  visuals.dropWaveStrength = 0
  visuals.shiftFlash = 0
  visuals.beatPulse = 0
  visuals.barPulse = 0
  visuals.tetherCount = 0
  visuals.tetherPluck = 0
  visuals.glintGain = 0
  visuals.onsetRippleGain = 0
  visuals.tripLevel = 0
  visuals.fallRate = 0
  visuals.cometRate = 0
  visuals.liftGain = 0.5
  visuals.fogGlow = 0
  visuals.auraGlow = 0
  visuals.gateOpenPulse = 0
  visuals.tunnelDepth = 0
  visuals.latchDread = 0
  visuals.hpDread = 0
  visuals.latchBite = 0
  visuals.combatPulse = 0
  visuals.wardenPresence = 0
  visuals.wardenTelegraph = 0
  visuals.banishProgress = 1
  visuals.banishStrength = 0
  visuals.combatWaveAge = 999
  visuals.combatWaveStrength = 0
  visuals.downedFade = 0
  visuals.boltGlow = 0
  visuals.castCharge = 0
  visuals.bowHeat = 0
  visuals.stormGlow = 0
  visuals.stasisAura = 0
  visuals.veilAura = 0
  visuals.frenzyAura = 0
  visuals.freezeFrame = 0
  visuals.dressingCount = 0
  visuals.landmarkGlow = 0
  visuals.arrivalPulse = 0
  visuals.bassSlam = 0
  visuals.midWavePhase = 0
  visuals.highSparkle = 0
  // arm the arrival edge against the CURRENT epoch so the run-start world
  // reset never fires a phantom bloom
  st.lastEpoch = worldState.epoch
  st.lastLatchSuffered = 0
  combatSignals.latchedCount = 0
  combatSignals.maxLatch = 3
  combatSignals.hpFrac = 1
  combatSignals.wardenDist = 999
  combatSignals.wardenAlive = false
  combatSignals.wardenTelegraph = 0
  combatSignals.downed = false
  combatSignals.boltCharge = 0
  combatSignals.castCharge = 0
  combatSignals.castPhase = 0
  combatSignals.castOver = 0
  combatSignals.castComboCount = 0
  combatSignals.castComboTier = 0
  combatSignals.stormArmed = false
  // novaCount/barWrapCount stay monotonic across runs — consumers diff them,
  // so resetting would fire phantom events on components that stay mounted.
  fxSignals.echoClear++
  sfxTripStop()
}

const TAU = Math.PI * 2

export function updateVisualFrame(dt: number): void {
  const af = audioFrame
  st.clock += dt

  // Realm modifiers: blend first, then multiply slew TARGETS and rate outputs
  // below (never post-slew state — that would compound through the feedback).
  updateRealmBlend(dt)
  const R = worldState.modsCur

  const liveTier = forcing.tier >= 0 ? forcing.tier : af.tier
  const liveFrom = forcing.tier >= 0 ? forcing.tier : af.tierFrom
  const blend = forcing.tier >= 0 ? 1 : af.tierBlend
  const eI = forcing.intensity >= 0 ? forcing.intensity : af.intensity
  visuals.eI = eI

  // ---- tier crossfade weights ----
  if (liveTier !== st.lastSeenTier) {
    st.prevTier = st.lastSeenTier
    st.lastSeenTier = liveTier
    // entering SHATTER without a committed drop still rolls a fresh peak style
    if (liveTier === 3) rollPeakStyle()
  }
  const from = blend < 1 ? liveFrom : liveTier
  const e = blend * blend * (3 - 2 * blend)
  visuals.w0 = visuals.w1 = visuals.w2 = visuals.w3 = 0
  addWeight(liveTier, e)
  addWeight(from, 1 - e)

  const { vi, rm } = visuals

  // ---- realm-arrival bloom: epoch diff fires under the whiteout, the decay
  //      outlives it so the new realm blooms as the white clears ----
  if (worldState.epoch !== st.lastEpoch) {
    st.lastEpoch = worldState.epoch
    visuals.arrivalPulse = rm ? 0.6 : 1
  }
  visuals.arrivalPulse *= Math.exp(-dt / 0.9)
  if (visuals.arrivalPulse < 0.001) visuals.arrivalPulse = 0

  // ---- shared breathing oscillator ----
  st.breathPhase += dt * TAU * (0.12 + 0.1 * eI)
  visuals.breath = 0.7 * Math.sin(st.breathPhase) + 0.3 * Math.min(1, af.bass * 1.4)

  // ---- reactivity dials: vi-coupled, so HARD/EXTREME realms visibly
  //      thrash harder and SERENE realms breathe gently ----
  const reactVi = 0.85 + 0.3 * vi
  visuals.bassReact = T(0.55, 0.85, 1.0, 1.25) * reactVi
  visuals.midsReact = T(0.6, 0.9, 1.0, 1.2) * reactVi
  visuals.highsReact = T(0.75, 0.9, 1.0, 1.15) * reactVi
  visuals.onsetReact = T(0.8, 0.9, 1.0, 1.1) * reactVi

  // ---- cinematic band envelopes ----
  // slam: the kick landing — fast attack, heavy-body release
  visuals.bassSlam = slew(
    visuals.bassSlam,
    Math.min(1, af.onsetStrength * (0.35 + 0.65 * af.bass)),
    11,
    2.0,
    dt,
  )
  // traveling rune wave: mids push the phase around, snares kick it forward
  visuals.midWavePhase =
    (visuals.midWavePhase +
      dt * (0.8 + 2.4 * af.mids * visuals.midsReact) +
      (af.midOnset ? 0.9 * af.midOnsetStrength : 0)) %
    TAU
  // shimmer: hi-hat/cymbal energy for streak sparks
  visuals.highSparkle = slew(
    visuals.highSparkle,
    Math.min(1, af.highOnsetStrength * (0.4 + 0.6 * af.highs)),
    14,
    3.2,
    dt,
  )

  // ---- slewed scene signals ----
  const igniteTarget = Math.min(
    12,
    Math.max(12 * smoothstep(0.1, 0.8, eI), T(0, 3, 12, 12)),
  )
  visuals.runeIgnition = slew(visuals.runeIgnition, igniteTarget, 6, 2, dt)
  const shardTarget = T(0, 0.55, 1, 1) * (0.5 + 0.5 * smoothstep(0.15, 0.7, eI))
  visuals.shardGrowth = slew(visuals.shardGrowth, shardTarget, 0.5, 0.25, dt)
  visuals.debrisAmount = slew(
    visuals.debrisAmount,
    Math.max(visuals.w3, R.debrisFloor) * R.debrisMult,
    0.8,
    0.45,
    dt,
  )
  visuals.auroraGate = slew(visuals.auroraGate, T(0, 0.15, 0.8, 1) * R.auroraMax, 0.6, 0.6, dt)
  visuals.godrayGate = slew(
    visuals.godrayGate,
    (T(0, 0, 0.7, 1) + 0.35 * visuals.arrivalPulse) * R.godrayMax,
    0.5,
    0.5,
    dt,
  )

  // ---- song structure: drop anticipation (continuous; a false-positive
  //      prediction simply breathes back out via the slew decay path) ----
  const chargeGate = af.nextTier === 3 && af.timeToDrop < 3.5
  let chargeTarget = chargeGate
    ? Math.pow(1 - af.timeToDrop / 3.5, 1.5) * (0.55 + 0.45 * af.rise)
    : 0
  let inhaleTarget = chargeGate ? smoothstep(0.5, 0.15, af.timeToDrop) : 0
  if (forcing.dropCharge >= 0) {
    chargeTarget = forcing.dropCharge
    inhaleTarget = forcing.dropCharge
  }
  visuals.dropCharge = slew(visuals.dropCharge, chargeTarget, 3.0, 1.5, dt)
  visuals.dropInhale = slew(visuals.dropInhale, inhaleTarget, 12, 4, dt)
  visuals.dropFovPull = rm ? 0 : 3.5 * visuals.dropInhale * Math.min(1, vi + 0.2)

  // ---- drop impact one-shots (offline section start is canonical; the
  //      dropCommitCount edge arrives the same frame playback crosses it) ----
  let impact = false
  if (af.dropCommitCount !== st.lastDropCommit) {
    st.lastDropCommit = af.dropCommitCount
    impact = true
    rollPeakStyle() // every landed drop gets its own personality
  }
  if (forcing.impactNow) {
    forcing.impactNow = false
    impact = true
  }
  if (impact) {
    visuals.impactPulse = rm ? 0.6 : 1
    visuals.impactFov = rm ? 3 : 8
    visuals.blastProgress = 0
    visuals.blastAmp = 0.05 * vi * (rm ? 0.35 : 1)
    visuals.novaCount++
    visuals.skyFlash = Math.min(rm ? 0.5 : 1, 0.6 + 0.4 * vi)
    visuals.dropWaveAge = 0
    visuals.dropWaveStrength = 1.2 * (0.6 + 0.4 * vi) * (rm ? 0.5 : 1)
  } else {
    visuals.impactPulse *= Math.exp(-5 * dt)
    if (visuals.impactPulse < 1e-3) visuals.impactPulse = 0
    visuals.impactFov *= Math.exp(-5 * dt)
    if (visuals.impactFov < 1e-3) visuals.impactFov = 0
    visuals.skyFlash *= Math.exp(-6 * dt)
    if (visuals.skyFlash < 1e-3) visuals.skyFlash = 0
  }
  if (visuals.blastProgress < 1) {
    visuals.blastProgress = Math.min(1, visuals.blastProgress + dt / 0.6)
  }
  if (visuals.dropWaveAge < 10) visuals.dropWaveAge += dt

  // realm-shift whiteout envelope (set by triggerShiftBurst)
  visuals.shiftFlash *= Math.exp(-3.5 * dt)
  if (visuals.shiftFlash < 1e-3) visuals.shiftFlash = 0

  // ---- horror combat layer (inputs via combatSignals + runState.combat;
  //      both are written after this -90 tick, one-frame lag hides in slews) ----
  const cs = combatSignals
  const dreadTarget = clamp01(cs.latchedCount / Math.max(1, cs.maxLatch))
  visuals.latchDread = slew(visuals.latchDread, dreadTarget, 1.5, 0.6, dt)
  if (rm) visuals.latchDread = Math.min(visuals.latchDread, 0.6)
  // low blood closes in on the screen the same way the riders do
  const hpRaw = clamp01((0.35 - cs.hpFrac) / 0.35)
  visuals.hpDread = slew(visuals.hpDread, hpRaw * hpRaw, 1.5, 0.8, dt)
  if (rm) visuals.hpDread = Math.min(visuals.hpDread, 0.6)
  if (runState.combat.latchesSuffered !== st.lastLatchSuffered) {
    st.lastLatchSuffered = runState.combat.latchesSuffered
    visuals.latchBite = rm ? 0.6 : 1
  } else {
    visuals.latchBite *= Math.exp(-6 * dt)
    if (visuals.latchBite < 1e-3) visuals.latchBite = 0
  }
  visuals.combatPulse *= Math.exp(-5 * dt)
  if (visuals.combatPulse < 1e-3) visuals.combatPulse = 0
  // hit-stop signature: the frozen frame desaturates and bites. Consumes the
  // feel.hitStop mirrors (stamped at -95, so same-frame here at -90); applied
  // centrally to gradeSat/gradeContrast/vignetteDark below.
  if (feel.hitStopActive) {
    visuals.freezeFrame = Math.min(1, 0.5 + feel.hitStopT / 0.08)
  } else {
    visuals.freezeFrame *= Math.exp(-18 * dt)
    if (visuals.freezeFrame < 1e-3) visuals.freezeFrame = 0
  }
  if (rm) visuals.freezeFrame = Math.min(visuals.freezeFrame, 0.5)
  // consumable rite auras (runState.activeEffects ticks at -80 — the 1-frame
  // lag hides in the slews); an expiring rite blinks ~2 Hz, never under rm
  visuals.stasisAura = riteAuraStep(visuals.stasisAura, runState.activeEffects.stasisT, rm, st.clock, dt)
  visuals.veilAura = riteAuraStep(visuals.veilAura, runState.activeEffects.veilT, rm, st.clock, dt)
  visuals.frenzyAura = riteAuraStep(visuals.frenzyAura, runState.activeEffects.frenzyT, rm, st.clock, dt)
  const presenceTarget = cs.wardenAlive ? smoothstep(60, 22, cs.wardenDist) : 0
  visuals.wardenPresence = slew(visuals.wardenPresence, presenceTarget, 1.2, 0.5, dt)
  if (rm) visuals.wardenPresence = Math.min(visuals.wardenPresence, 0.7)
  const teleRaw = clamp01(cs.wardenTelegraph)
  visuals.wardenTelegraph = teleRaw * teleRaw * (rm ? 0.6 : 1)
  if (visuals.banishProgress < 1) {
    visuals.banishProgress = Math.min(1, visuals.banishProgress + dt / 0.55)
  }
  if (visuals.combatWaveAge < 10) visuals.combatWaveAge += dt
  visuals.downedFade = cs.downed
    ? slew(visuals.downedFade, 1, 1 / 1.2, 4, dt)
    : slew(visuals.downedFade, 0, 4, 4, dt)
  // snappy readiness edge (<90ms) so the RMB cadence reads on the hand glow
  visuals.boltGlow = slew(visuals.boltGlow, clamp01(cs.boltCharge), 12, 14, dt)
  // draw tension: quick rise, quicker release snap-back; rm caps screen uses
  visuals.castCharge = slew(
    visuals.castCharge,
    Math.min(clamp01(cs.castCharge), rm ? 0.6 : 1),
    10,
    12,
    dt,
  )
  // bow-combo ignition: tier-ups flare on fast, heat cools slow enough to read
  visuals.bowHeat = slew(visuals.bowHeat, clamp01(cs.castComboTier / 3), 2.5, 0.8, dt)
  if (rm) visuals.bowHeat = Math.min(visuals.bowHeat, 0.6)
  visuals.stormGlow = slew(visuals.stormGlow, cs.stormArmed ? 1 : 0, 6, 4, dt)
  if (rm) visuals.stormGlow = Math.min(visuals.stormGlow, 0.6)

  // ---- beat-locked pulses (hard off below gridConfidence ~0.35; bar-level
  //      effects additionally need barConfidence — odd meters degrade to
  //      beat-only instead of guessing downbeats) ----
  const conf = smoothstep(0.35, 0.6, af.gridConfidence)
  const barConf = conf * smoothstep(0.3, 0.6, af.barConfidence)
  visuals.barSync = barConf
  const viAmp = 0.4 + 0.6 * vi
  let beatPulse =
    conf * Math.pow(Math.max(0, 1 - af.gridPhase), 3) * T(0.15, 0.6, 1.0, 1.25) * viAmp
  let barPulse =
    barConf * Math.pow(Math.max(0, 1 - af.barPhase), 2.5) * T(0, 0.5, 1.0, 1.2) * viAmp
  if (rm) {
    beatPulse = Math.min(0.6, beatPulse * 0.5)
    barPulse = Math.min(0.6, barPulse * 0.5)
  }
  visuals.beatPulse = beatPulse
  visuals.barPulse = barPulse
  const barWrap = barConf > 0.01 && st.prevBarPhase > 0.8 && af.barPhase < 0.2
  st.prevBarPhase = af.barPhase
  if (barWrap) {
    visuals.barWrapCount++
    if (!rm) visuals.tetherPluck = 1
  }
  visuals.tetherPluck = rm ? 0 : visuals.tetherPluck * Math.exp(-6 * dt)
  if (visuals.tetherPluck < 1e-3) visuals.tetherPluck = 0

  // ---- shared scene gains ----
  visuals.liftGain = T(0.5, 0.9, 1.3, 1.5) * (1 + 0.4 * visuals.dropCharge) * R.liftMult
  visuals.tetherCount = slew(visuals.tetherCount, T(0, 3, 6, 10), 2.5, 1.5, dt)
  visuals.glintGain = vi < 0.25 ? 0 : T(0, 0.5, 0.9, 1.1) * (0.5 + 0.5 * vi)
  visuals.onsetRippleGain = vi < 0.3 ? 0 : T(0, 0, 0.8, 1) * (rm ? 0.5 : 1)
  const govScale =
    governor.level >= 4 ? 0 : governor.level === 3 ? 0.35 : governor.level === 2 ? 0.6 : 1
  visuals.fallRate = T(0, 10, 25, 35) * (0.5 + 0.5 * vi) * govScale * R.fallRateMult
  // underside dressing rides the realm's dressing-density knob and the same
  // governor ladder as fallRate (0 at L4 — tendrils vanish entirely)
  visuals.tendrilCount = Math.round(T(20, 36, 52, 64) * govScale * R.shardDensity)
  // per-realm dressing rides its own density knob; identity must read even at
  // CALM, hence the nonzero floor (govScale still zeroes it at L4)
  visuals.dressingCount = Math.round(T(64, 96, 128, 144) * govScale * R.dressingDensity)
  visuals.landmarkGlow =
    T(0.35, 0.55, 0.8, 1.0) *
    (0.7 + 0.3 * vi) *
    (1 + 0.5 * visuals.skyFlash + 0.35 * visuals.impactPulse)
  if (rm) visuals.landmarkGlow = Math.min(visuals.landmarkGlow, 1.0)
  visuals.fallDir = R.fallDir
  visuals.cometRate = governor.level >= 3 ? 0 : T(0, 0, 0.45, 0.7) * R.cometRateMult
  visuals.cometSpeedMult = rm ? 0.6 : 1
  visuals.cloudGlow =
    (0.1 + 0.25 * eI) *
    T(0.6, 0.85, 1.1, 1.25) *
    (0.7 + 0.3 * vi) *
    (1 + 0.8 * visuals.skyFlash) *
    R.cloudGlowMult
  visuals.spireGlow = T(0.25, 0.4, 0.6, 0.7) * (0.8 + 0.2 * eI)

  // ---- realm fog (Background copies these into the scene fog). Denser than
  //      the old space look: islands become silhouettes, HDR targets survive. ----
  visuals.fogNear = (T(26, 34, 46, 52) + 10 * visuals.skyFlash) * R.fogNearMult
  visuals.fogFar = (T(140, 180, 250, 280) + 80 * visuals.skyFlash) * R.fogFarMult

  // ---- fog medium: bass-lit glow + post-fog density. Bass reaches the
  //      atmosphere ONLY through the fog (the sky shells stay mids/highs). ----
  const fogGlowTarget = clamp01(
    T(0.12, 0.28, 0.5, 0.68) *
      (0.25 + 0.75 * Math.min(1, af.bass * 1.3 * visuals.bassReact)) *
      (0.5 + 0.5 * vi) *
      R.fogGlowMult +
      0.4 * visuals.impactPulse +
      0.6 * visuals.shiftFlash,
  )
  visuals.fogGlow = slew(visuals.fogGlow, fogGlowTarget, 5, 2.5, dt)
  if (rm) visuals.fogGlow = Math.min(visuals.fogGlow, 0.5)
  const govFog = governor.level >= 3 ? 0 : governor.level === 2 ? 0.7 : 1
  visuals.fogDensity =
    T(0.6, 0.75, 0.9, 1.05) *
    (1 + 0.05 * visuals.breath) *
    R.fogDensityMult *
    smoothstep(0.05, 0.25, vi) *
    govFog

  // ---- obsidian rune veins: tier base + tribal mid-onset pulse ----
  visuals.runeGlow = Math.min(
    rm ? 1.0 : 1.6,
    (T(0.08, 0.3, 0.6, 0.9) * (0.4 + 0.6 * smoothstep(0.1, 0.75, eI)) +
      0.55 * Math.min(1, af.midOnsetStrength) * visuals.midsReact * T(0.3, 0.6, 0.9, 1.1)) *
      smoothstep(0.02, 0.15, vi) *
      (1 + 0.5 * visuals.arrivalPulse),
  )

  // ---- ash field (Particles reads; CALM raised — ash IS the atmosphere) ----
  const govAmb = governor.level >= 4 ? 0.35 : governor.level === 3 ? 0.6 : 1
  visuals.ambientCount = Math.round(T(240, 330, 400, 400) * govAmb)
  visuals.emberFlareGain = T(0, 0.5, 0.9, 1.2) * (0.4 + 0.6 * vi) * (rm ? 0.5 : 1)

  // ---- diegetic HUD signals ----
  const auraTarget = clamp01(
    (runState.scoreState.multiplier - 1) / (SCORING.multiplierCap - 1),
  )
  visuals.auraGlow = slew(visuals.auraGlow, auraTarget, 2.5, 0.8, dt)
  visuals.threadGlow = (0.55 + 0.45 * vi) * T(0.85, 1.0, 1.15, 1.3)
  visuals.threadNoise = T(0.5, 0.7, 1.0, 1.3) * (0.6 + 0.4 * vi) * (rm ? 0.4 : 1)
  // ribbon half-width gains: tier + slider fatten the strips; rm caps at 1
  visuals.trailWidthGain = T(0.7, 1.0, 1.25, 1.5) * (0.6 + 0.4 * vi)
  if (rm) visuals.trailWidthGain = Math.min(visuals.trailWidthGain, 1)
  visuals.threadWidthGain = (0.75 + 0.25 * vi) * T(0.8, 1.0, 1.15, 1.3)
  if (rm) visuals.threadWidthGain = Math.min(visuals.threadWidthGain, 1)
  const gate = worldState.gate
  if (gate.active && gate.openedAt !== st.lastGateOpenedAt) {
    st.lastGateOpenedAt = gate.openedAt
    visuals.gateOpenPulse = rm ? 0.5 : 1
  } else {
    visuals.gateOpenPulse *= Math.exp(-3 * dt)
    if (visuals.gateOpenPulse < 1e-3) visuals.gateOpenPulse = 0
  }
  visuals.eclipseProgress = clamp01(af.time / Math.max(1, af.duration))
  visuals.eclipseGlow = Math.min(
    rm ? 1.6 : 99,
    T(0.5, 0.75, 1.1, 1.35) *
      (0.7 + 0.3 * vi) *
      (1 + 1.4 * visuals.dropCharge + 0.8 * visuals.impactPulse + 0.6 * visuals.skyFlash),
  )

  // ---- tunnel vision: slewed bass drives vignette/CA depth ----
  st.bassSlew = slew(st.bassSlew, af.bass, 6, 3, dt)
  visuals.tunnelDepth = T(0, 0.25, 0.6, 1.0) * (0.35 + 0.65 * st.bassSlew) * vi
  if (rm) visuals.tunnelDepth = Math.min(visuals.tunnelDepth, 0.5)
  visuals.vignetteDark = Math.min(
    rm ? 0.85 : 0.88,
    0.55 +
      0.14 * T(0, 0.35, 0.75, 1) * (0.5 + 0.5 * visuals.breath) * vi +
      0.2 * visuals.dropInhale +
      0.12 * visuals.tunnelDepth +
      0.16 * visuals.latchDread +
      0.12 * visuals.hpDread +
      0.07 * visuals.wardenPresence +
      0.06 * visuals.freezeFrame +
      0.2 * visuals.downedFade,
  )
  visuals.vignetteOffset = Math.max(
    0.18,
    0.3 -
      0.05 * (0.5 + 0.5 * visuals.breath) * vi * T(0, 0.3, 0.7, 1) -
      0.07 * visuals.dropInhale -
      0.05 * visuals.tunnelDepth,
  )
  // Combat corruption tightens past the musical floor (its own deeper floor
  // so the 0.18 no-combat contract holds).
  if (visuals.latchDread > 0.001 || visuals.downedFade > 0.001 || visuals.hpDread > 0.001) {
    visuals.vignetteOffset = Math.max(
      0.15,
      visuals.vignetteOffset -
        0.05 * visuals.latchDread -
        0.04 * visuals.hpDread -
        0.08 * visuals.downedFade,
    )
  }

  // ---- trip proximity: geometry-morph + trip-SFX driver. Reads last
  //      frame's kaleidoMix (slewed, so the 1-frame lag is invisible). ----
  const tripTarget = Math.max(
    visuals.kaleidoMix,
    0.85 * visuals.dropCharge * (0.4 + 0.6 * vi),
    R.tripBias * vi,
  )
  visuals.tripLevel = slew(visuals.tripLevel, tripTarget, 2.5, 1.2, dt)
  if (rm) visuals.tripLevel = Math.min(visuals.tripLevel, 0.3)
  sfxTripUpdate(visuals.tripLevel, visuals.dropCharge, dt)
  // the gnaw bed + second heartbeat ride the latch dread (yields to the trip
  // heart via the dropCharge comparison inside)
  sfxDreadUpdate(visuals.latchDread, visuals.downedFade, visuals.dropCharge, dt)
  // per-realm ambience bed — quiet under the music, ducked by combat dread
  // and the shift whiteout, silent before a track is loaded
  sfxRealmUpdate(
    dt,
    ((worldState.depth % 6) + 6) % 6,
    T(0.35, 0.6, 0.85, 1),
    (1 - 0.6 * visuals.wardenPresence) *
      (1 - 0.5 * visuals.latchDread) *
      (1 - 0.8 * visuals.downedFade) *
      (1 - 0.7 * visuals.shiftFlash) *
      (af.duration > 0 ? 1 : 0),
    visuals.barWrapCount,
  )

  // ---- psychedelic post targets (debug preview can override gating) ----
  const preview = forcing.psychePreview
  const style = visuals.peakStyle
  // per-style reweighting of the same uniforms (bites only at PEAK/SHATTER
  // where the underlying T() terms are non-zero)
  const warpStyleMult = style === 1 ? 2.2 : 1
  const rippleStyleMult = style === 1 ? 1.8 : 1
  const shimmerStyleMult = style === 3 ? 1.6 : 1
  const hueStyleMult = style === 2 ? 2 : 1
  // TUNNEL widens the aim tunnel further; rm always gets a wider one
  visuals.centerClear = rm ? 0.34 : style === 1 ? 0.4 : 0.28

  let warp =
    0.14 *
    vi *
    smoothstep(0.15, 1, eI) *
    T(0.15, 0.4, 0.75, 1.0) *
    visuals.breath *
    R.warpMult *
    warpStyleMult
  let ripple =
    0.01 *
    vi *
    T(0, 0.25, 0.7, 1) *
    (0.4 + 0.6 * af.bass) *
    (1 + 0.8 * visuals.tripLevel) *
    rippleStyleMult
  if (preview >= 1) {
    warp = 0.1 * visuals.breath
    ripple = 0.006
  }
  if (rm) {
    warp *= 0.25
    ripple *= 0.25
  }
  visuals.warpAmp = warp
  visuals.rippleAmp = ripple

  // kaleidoscope engage/disengage — only the KALEIDO and FRACTAL styles fold;
  // the mix is capped below full so the world never fully dissolves, and the
  // shader's edge mask keeps the aim tunnel clean regardless.
  const styleFolds = style === 0 || style === 3
  const kaleidoCap = style === 3 ? 0.45 : 0.8
  const wantKaleido =
    preview >= 2 ||
    (!rm && vi >= 0.35 && visuals.w3 > 0.5 && styleFolds && forcing.psychePreview === 0)
  if (wantKaleido && !st.kaleidoEngaged) {
    st.kaleidoEngaged = true
    st.kaleidoDir *= -1
    // FRACTAL opens already deep in the fold ladder
    visuals.kaleidoN1 = style === 3 ? 7 : 4
    visuals.kaleidoN2 = visuals.kaleidoN1
    visuals.kaleidoNMix = 0
  } else if (!wantKaleido && st.kaleidoEngaged) {
    st.kaleidoEngaged = false
  }
  let mixBase = visuals.kaleidoMix - (st.flashPulse > 0 ? st.flashPulse : 0)
  mixBase = clamp01(slew(mixBase, st.kaleidoEngaged ? kaleidoCap : 0, 0.5, 0.7, dt))
  // PEAK flash: brief kaleido pulse on very strong onsets
  if (!rm && vi >= 0.6 && af.onset && af.onsetStrength >= 1.35 && liveTier === 2) {
    st.flashPulse = 0.35
  }
  st.flashPulse *= Math.exp(-3 * dt)
  if (st.flashPulse < 0.01) st.flashPulse = 0
  visuals.kaleidoMix = rm && preview < 2 ? 0 : clamp01(mixBase + st.flashPulse)

  // N-fold stepping on onsets while engaged
  if (st.kaleidoEngaged) {
    if (visuals.kaleidoNMix >= 1) {
      visuals.kaleidoN1 = visuals.kaleidoN2
      visuals.kaleidoNMix = 0
    } else if (visuals.kaleidoNMix > 0) {
      visuals.kaleidoNMix = Math.min(1, visuals.kaleidoNMix + dt / 0.35)
    }
    // fold count morphs on bar boundaries when the grid is trustworthy,
    // falling back to raw onsets on gridless material
    const foldTrigger = conf > 0.01 ? barWrap : af.onset
    if (
      foldTrigger &&
      st.clock - st.lastNStepAt > 0.5 &&
      visuals.kaleidoNMix === 0 &&
      visuals.kaleidoN2 < 8
    ) {
      st.lastNStepAt = st.clock
      visuals.kaleidoN1 = visuals.kaleidoN2
      visuals.kaleidoN2 += 1
      visuals.kaleidoNMix = Math.min(1, dt / 0.35)
    }
    // FRACTAL drifts slowly; KALEIDO spins with the song
    visuals.kaleidoSpin += dt * (0.05 + 0.1 * eI) * st.kaleidoDir * (style === 3 ? 0.4 : 1)
  }

  // STROBE: beat-locked sky pulses while the drop rages (grid-gated, capped
  // at ~2.5Hz, never under reduced motion)
  const gridWrap = conf > 0.3 && st.prevGridPhase > 0.8 && af.gridPhase < 0.2
  st.prevGridPhase = af.gridPhase
  if (
    style === 2 &&
    !rm &&
    visuals.w3 > 0.5 &&
    gridWrap &&
    st.clock - st.lastStrobeAt > 0.4
  ) {
    st.lastStrobeAt = st.clock
    visuals.skyFlash = Math.max(visuals.skyFlash, 0.25 + 0.25 * vi)
  }

  // hue drift — accumulate only while the stack is visibly active, unwind otherwise
  const stackActive = visuals.kaleidoMix > 0.002 || visuals.warpAmp !== 0 || visuals.shimmerAmp > 1e-5
  const hueRateDeg = vi * (2 + 16 * eI * eI) * T(0.5, 0.8, 1.0, 1.25) * (rm ? 0.5 : 1) * hueStyleMult
  if (stackActive && eI > 0.02) {
    visuals.hue = (visuals.hue + ((dt * hueRateDeg * Math.PI) / 180)) % TAU
  } else if (visuals.hue !== 0) {
    // unwind toward the nearest multiple of 2π so colors settle back to true
    const target = visuals.hue > Math.PI ? TAU : 0
    visuals.hue = slew(visuals.hue, target, 3, 3, dt)
    if (visuals.hue >= TAU || visuals.hue <= 0) visuals.hue = 0
  }

  // the melt intensifies as the trip nears: both the amount and its ceiling
  let shimmer =
    0.005 *
    vi *
    T(0.1, 0.4, 0.8, 1) *
    (1 + 0.5 * af.bass) *
    (1 + 1.5 * visuals.tripLevel) *
    shimmerStyleMult
  if (preview >= 3) shimmer = 0.004
  if (rm) shimmer *= 0.5
  visuals.shimmerAmp = Math.min(0.006 * shimmerStyleMult * (1 + visuals.tripLevel), shimmer)

  visuals.satBoost = 1 + 0.22 * smoothstep(0.5, 1, eI) * vi

  // afterimage tracers (TUNNEL rides longer trails through the drop)
  let dampTarget = Math.min(
    0.92,
    vi * (T(0, 0.42, 0.74, 0.9) + 0.05 * Math.min(1, af.onsetStrength)) +
      (style === 1 ? 0.08 * visuals.w3 : 0),
  )
  if (forcing.echoPreview) dampTarget = 0.85
  if (rm) dampTarget = Math.min(dampTarget, 0.5)
  visuals.echoDamp = slew(visuals.echoDamp, dampTarget, 1.5, 1.5, dt)

  visuals.fovBreathAmp = rm ? 0 : T(0, 0.6, 1.2, 1.8) * vi

  // ---- per-tier color grade (identity at vi=0; total saturation is bounded
  //      so the psyche uSat x grade product can never oversaturate) ----
  const gradeMix = smoothstep(0, 0.15, vi) * (0.35 + 0.65 * vi)
  visuals.gradeTempR = 1 + (T(0.96, 1.0, 1.05, 1.09) - 1) * gradeMix
  visuals.gradeTempG = 1 + (T(1.0, 1.0, 1.0, 0.98) - 1) * gradeMix
  visuals.gradeTempB = 1 + (T(1.07, 1.0, 0.95, 0.92) - 1) * gradeMix
  visuals.gradeLift = T(0.004, 0, 0, -0.004) * gradeMix
  const satTarget = T(0.92, 1.0, 1.08, 1.12) * (1 - 0.25 * visuals.dropInhale)
  visuals.gradeSat = Math.min(
    1 + (satTarget - 1) * gradeMix,
    1.35 / Math.max(1e-6, visuals.satBoost),
  )
  let gradeContrast = 1 + (T(0.98, 1.0, 1.03, 1.08) - 1) * gradeMix
  if (rm) gradeContrast = Math.max(0.95, Math.min(1.05, gradeContrast))
  visuals.gradeContrast = gradeContrast
  visuals.gradeGrain = rm ? 0 : 0.035 * visuals.w3 * gradeMix

  // ---- corpse-cold corruption: latch dread + downed fade drain the grade;
  //      a living warden lays a cold desaturating pall over its arena ----
  const dread = visuals.latchDread
  const dfade = visuals.downedFade
  const loom = visuals.wardenPresence
  if (dread > 0.001 || dfade > 0.001 || loom > 0.001) {
    visuals.gradeSat *= Math.max(0.3, 1 - 0.28 * dread - 0.45 * dfade - 0.1 * loom)
    visuals.gradeTempR *= 1 - 0.06 * dread - 0.08 * dfade - 0.03 * loom
    visuals.gradeTempB *= 1 + 0.05 * dread + 0.06 * dfade + 0.03 * loom
    if (!rm) visuals.gradeGrain += 0.04 * dread + 0.03 * dfade + 0.02 * loom
  }

  // ---- hit-stop freeze signature: the held frame reads cold and bitten ----
  const ff = visuals.freezeFrame
  if (ff > 0.001) {
    visuals.gradeSat *= 1 - 0.3 * ff
    visuals.gradeContrast *= 1 + 0.05 * ff
    // the rm contrast contract ([0.95, 1.05]) survives the bite
    if (rm) visuals.gradeContrast = Math.max(0.95, Math.min(1.05, visuals.gradeContrast))
  }
}

function addWeight(tier: number, w: number): void {
  if (tier <= 0) visuals.w0 += w
  else if (tier === 1) visuals.w1 += w
  else if (tier === 2) visuals.w2 += w
  else visuals.w3 += w
}
