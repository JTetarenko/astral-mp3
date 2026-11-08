/**
 * Pure math for the horror swarm and gate wardens: four unit part solids
 * (husk shell / limb spike / veil shred / eye gem) shared by every archetype,
 * per-realm part-layout tables, the pose evaluator with its C1 envelope
 * curves, and the latch-cling pose. No three.js — node-testable, in the
 * wingGeom mold. All parts extend along local +Y (the wing convention), so
 * splay/pitch mirror for free via the spec's mirror sign.
 */
import { ringSolid, type TriSoup } from './wingGeom'

export type { TriSoup }

// ---------------------------------------------------------------------------
// unit part solids
// ---------------------------------------------------------------------------

/** Tapered diamond body segment along +Y with an HDR vein ridge on the +Z
 * spine (strut-slab idiom): the universal husk/carapace mass. */
export function buildHuskShell(): TriSoup {
  const soup = ringSolid(
    [
      { y: 0.02, hx: 0.3, hz: 0.26, glow: 0.06 },
      { y: 0.22, hx: 0.46, hz: 0.4, glow: 0.06 },
      { y: 0.55, hx: 0.5, hz: 0.42, glow: 0.06 },
      { y: 0.82, hx: 0.34, hz: 0.3, glow: 0.06 },
      { y: 0.96, hx: 0.18, hz: 0.16, glow: 0.06 },
    ],
    0,
    1,
  )
  // vein ridge: verts on the +Z spine burn
  for (let i = 0; i < soup.glow.length; i++) {
    const z = soup.positions[i * 3 + 2]
    const x = soup.positions[i * 3]
    if (z > 0.14 && Math.abs(x) < 1e-6) soup.glow[i] = 2.2
  }
  return soup
}

/** Thin needle blade along +Y — legs, arms, spikes, talons. All dark. */
export function buildLimbSpike(): TriSoup {
  return ringSolid(
    [
      { y: 0.0, hx: 0.09, hz: 0.07 },
      { y: 0.45, hx: 0.06, hz: 0.05 },
      { y: 0.85, hx: 0.03, hz: 0.025 },
    ],
    -0.03,
    1,
  )
}

/** Ragged flat membrane plate, root at y=0 hanging to y=1 (tip-down when the
 * spec pitches it): cloak petals, wing membranes, flame tongues. The torn
 * outer third carries a dim rim glow that ignites on windup. */
export function buildVeilShred(): TriSoup {
  const t = 0.03
  // jagged outline: root edge pair, waist, two torn tips
  const pts: Array<[number, number]> = [
    [-0.28, 0],
    [0.28, 0],
    [0.34, 0.45],
    [0.12, 0.78],
    [0.2, 1.0],
    [-0.05, 0.86],
    [-0.24, 0.98],
    [-0.32, 0.5],
  ]
  const glowOf = (p: [number, number]) => (p[1] > 0.7 ? 1.6 : 0.08)
  // fan triangulation from the root center
  const C: [number, number] = [0, 0.06]
  const tris: Array<Array<{ p: [number, number]; z: number }>> = []
  for (let e = 0; e < pts.length; e++) {
    const P = pts[e]
    const Q = pts[(e + 1) % pts.length]
    tris.push([
      { p: C, z: t },
      { p: P, z: t },
      { p: Q, z: t },
    ])
    tris.push([
      { p: C, z: -t },
      { p: Q, z: -t },
      { p: P, z: -t },
    ])
  }
  const positions = new Float32Array(tris.length * 9)
  const along = new Float32Array(tris.length * 3)
  const glow = new Float32Array(tris.length * 3)
  let ptr = 0
  for (const tri of tris) {
    for (const v of tri) {
      positions[ptr * 3] = v.p[0]
      positions[ptr * 3 + 1] = v.p[1]
      positions[ptr * 3 + 2] = v.z
      along[ptr] = Math.max(0, Math.min(1, v.p[1]))
      glow[ptr] = glowOf(v.p)
      ptr++
    }
  }
  return { positions, along, glow }
}

/** Tiny 8-face eye gem centered on origin, glow 1 everywhere (the material
 * multiplies it into HDR). */
export function buildEyeGem(): TriSoup {
  const r = 0.5
  const top: [number, number, number] = [0, r, 0]
  const bot: [number, number, number] = [0, -r, 0]
  const ring: Array<[number, number, number]> = [
    [r, 0, 0],
    [0, 0, r],
    [-r, 0, 0],
    [0, 0, -r],
  ]
  const faces: Array<Array<[number, number, number]>> = []
  for (let i = 0; i < 4; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % 4]
    faces.push([a, top, b]) // outward winding, apex up
    faces.push([a, b, bot]) // outward winding, apex down
  }
  const positions = new Float32Array(faces.length * 9)
  const along = new Float32Array(faces.length * 3)
  const glow = new Float32Array(faces.length * 3).fill(1)
  let ptr = 0
  for (const tri of faces) {
    for (const v of tri) {
      positions[ptr * 3] = v[0]
      positions[ptr * 3 + 1] = v[1]
      positions[ptr * 3 + 2] = v[2]
      along[ptr] = (v[1] + r) / (2 * r)
      ptr++
    }
  }
  return { positions, along, glow }
}

// ---------------------------------------------------------------------------
// part layout tables
// ---------------------------------------------------------------------------

/** Per-enemy instanced-buffer budget (the overflow guard lives in tests). */
export const HUSK_PER = 5
export const LIMB_PER = 8
export const SHRED_PER = 4
export const EYE_PER = 3

export interface HorrorPartSpec {
  /** 0 husk | 1 limb | 2 shred | 3 eye. */
  part: 0 | 1 | 2 | 3
  /** -1 = enemy root, else index into this archetype's husk list. */
  parent: number
  /** Attachment along the parent's +Y (may exceed 1 for gapped stacks). */
  t: number
  len: number
  wid: number
  /** Rest orientation (radians): splay about local Z (mirror-flipped), pitch
   * about local X, yawO about local Y. */
  splay: number
  pitch: number
  yawO: number
  /** Gait/ripple phase offset. */
  phaseOff: number
  /** -1 | 0 | 1 side sign for paired parts. */
  mirror: -1 | 0 | 1
  /** Leading-axis offset (overlap layering). */
  zOff: number
}

export interface HorrorVisual {
  id: string
  /** Overall enemy scale (world units per part unit). */
  scale: number
  parts: HorrorPartSpec[]
  /** Gait cycle rate (Hz at cruise). */
  gaitRate: number
  /** Spine wave amplitude (worm/pilgrim tail). */
  segWaveAmp: number
  /** Standing spine curl bias. */
  curlBias: number
  /** Two-tone levels. */
  bodyDim: number
  eyeHdr: number
}

const P = (
  part: 0 | 1 | 2 | 3,
  parent: number,
  t: number,
  len: number,
  wid: number,
  splay: number,
  pitch: number,
  yawO: number,
  phaseOff: number,
  mirror: -1 | 0 | 1 = 0,
  zOff = 0,
): HorrorPartSpec => ({ part, parent, t, len, wid, splay, pitch, yawO, phaseOff, mirror, zOff })

/** The six swarm silhouettes. Index == realm index. */
export const HORROR_VISUALS: readonly HorrorVisual[] = [
  {
    // HUSK PILGRIM — a hollowed mockery of the player's own cowled wraith
    id: 'astral',
    scale: 1.55,
    parts: [
      P(0, -1, 0, 0.95, 0.52, 0, 0, 0, 0), // torso
      P(0, 0, 0.92, 0.45, 0.6, 0, 0.25, 0, 0.5), // cowl, tipped forward
      P(0, 0, 0.04, 0.62, 0.3, 0, Math.PI, 0, 1), // tail taper, hanging
      P(1, 0, 0.72, 0.85, 0.14, 0.55, 0.95, 0, 0.2, 1), // reaching arms
      P(1, 0, 0.72, 0.85, 0.14, 0.55, 0.95, 0, 0.7, -1),
      P(2, 0, 0.3, 0.55, 0.8, 0.25, 2.9, 0.7, 0, 1), // torn cloak petals
      P(2, 0, 0.3, 0.55, 0.8, 0.25, 2.9, -0.7, 0.4, -1),
      P(2, 0, 0.45, 0.5, 0.7, 0.15, 3.0, 2.2, 0.6, 1),
      P(2, 0, 0.45, 0.5, 0.7, 0.15, 3.0, -2.2, 0.9, -1),
      P(3, 1, 0.4, 0.11, 1, 0.22, 1.35, 0, 0, 1, 0.16), // blood-red pinpoints
      P(3, 1, 0.4, 0.11, 1, 0.22, 1.35, 0, 0.5, -1, 0.16),
    ],
    gaitRate: 0.5,
    segWaveAmp: 0.12,
    curlBias: 0.28,
    bodyDim: 0.07,
    eyeHdr: 3.2,
  },
  {
    // VINE STRIDER — harvestman sky-spider on needle legs
    id: 'jungle',
    scale: 1.35,
    parts: [
      P(0, -1, 0, 0.5, 0.55, 0, Math.PI, 0, 0), // abdomen, hung inverted
      ...[0, 1, 2, 3].flatMap(i => [
        P(1, 0, 0.15, 1.7, 0.07, 1.25 - 0.14 * i, 0.35, -0.7 + 0.47 * i, i * 0.25, 1 as const),
        P(1, 0, 0.15, 1.7, 0.07, 1.25 - 0.14 * i, 0.35, 0.7 - 0.47 * i, i * 0.25 + 0.5, -1 as const),
      ]),
      P(3, 0, 0.1, 0.09, 1, 0.3, 1.5, 0, 0, 1, 0.12), // amber tri-cluster
      P(3, 0, 0.1, 0.09, 1, 0.3, 1.5, 0, 0.33, -1, 0.12),
      P(3, 0, 0.02, 0.1, 1, 0, 1.5, 0, 0.66, 0, 0.14),
    ],
    gaitRate: 2.6,
    segWaveAmp: 0,
    curlBias: 0,
    bodyDim: 0.06,
    eyeHdr: 2.8,
  },
  {
    // ROOD SHRIKE — gargoyle-bat, broken crucifix in glide
    id: 'cathedral',
    scale: 1.45,
    parts: [
      P(0, -1, 0, 0.75, 0.4, 0, 1.35, 0, 0), // keel body, prone
      P(0, 0, 0.95, 0.38, 0.34, 0, -0.8, 0, 0.5), // hooked head
      P(1, 0, 0.15, 0.5, 0.1, 0.3, 2.6, 0, 0.2, 1), // dangling talons
      P(1, 0, 0.15, 0.5, 0.1, 0.3, 2.6, 0, 0.7, -1),
      P(2, 0, 0.62, 1.35, 1.15, 1.35, 0.15, 0, 0, 1), // wing membranes
      P(2, 0, 0.62, 1.35, 1.15, 1.35, 0.15, 0, 0.5, -1),
      P(2, 0, 0.42, 1.0, 0.95, 1.5, 0.28, 0, 0.25, 1, 0.03),
      P(2, 0, 0.42, 1.0, 0.95, 1.5, 0.28, 0, 0.75, -1, 0.03),
      P(3, 1, 0.5, 0.09, 1, 0.2, 1.3, 0, 0, 1, 0.14), // cold mint slits
      P(3, 1, 0.5, 0.09, 1, 0.2, 1.3, 0, 0.5, -1, 0.14),
    ],
    gaitRate: 0.8,
    segWaveAmp: 0.05,
    curlBias: 0.1,
    bodyDim: 0.07,
    eyeHdr: 2.9,
  },
  {
    // EFFIGY PUPPET — gapped bone stack on unseen strings
    id: 'ritual',
    scale: 1.5,
    parts: [
      P(0, -1, 0, 0.5, 0.42, 0, 0, 0, 0), // pelvis
      P(0, 0, 1.35, 0.55, 0.5, 0, 0, 0, 0.3), // ribcage, floating gap
      P(0, 1, 1.3, 0.34, 0.36, 0, 0, 0, 0.6), // skull, floating gap
      P(1, 1, 0.75, 0.7, 0.1, 0.9, 0.6, 0, 0.1, 1), // arms
      P(1, 1, 0.75, 0.7, 0.1, 0.9, 0.6, 0, 0.6, -1),
      P(1, 0, 0.1, 0.75, 0.11, 0.25, 2.9, 0, 0.35, 1), // legs, dangling
      P(1, 0, 0.1, 0.75, 0.11, 0.25, 2.9, 0, 0.85, -1),
      P(1, 1, 0.4, 0.45, 0.07, 1.5, 0.2, 0, 0.2, 1), // rib stakes
      P(2, 1, 0.2, 0.5, 0.6, 0.2, 3.0, 0.5, 0, 1), // hanging rags
      P(2, 1, 0.2, 0.5, 0.6, 0.2, 3.0, -0.5, 0.5, -1),
      P(3, 2, 0.5, 0.1, 1, 0.2, 1.4, 0, 0, 1, 0.12), // white-hot sockets
      P(3, 2, 0.5, 0.1, 1, 0.2, 1.4, 0, 0.5, -1, 0.12),
    ],
    gaitRate: 1.2,
    segWaveAmp: 0.08,
    curlBias: 0.05,
    bodyDim: 0.08,
    eyeHdr: 3.4,
  },
  {
    // CARRION WORM — five-segment breacher
    id: 'collapse',
    scale: 1.65,
    parts: [
      P(0, -1, 0, 0.6, 0.52, 0, 1.45, 0, 0), // head segment, prone
      P(0, 0, 1.02, 0.58, 0.48, 0, 0.06, 0, 0.2),
      P(0, 1, 1.02, 0.55, 0.42, 0, 0.06, 0, 0.4),
      P(0, 2, 1.02, 0.5, 0.34, 0, 0.06, 0, 0.6),
      P(0, 3, 1.02, 0.45, 0.26, 0, 0.06, 0, 0.8),
      P(2, 0, 0.08, 0.42, 0.5, 0.8, -0.9, 0, 0, 1), // mandible flaps
      P(2, 0, 0.08, 0.42, 0.5, 0.8, -0.9, 0, 0.5, -1),
      P(3, 0, 0.06, 0.16, 1, 0, 1.5, 0, 0, 0, 0.1), // throat furnace
    ],
    gaitRate: 0.7,
    segWaveAmp: 0.3,
    curlBias: 0.12,
    bodyDim: 0.06,
    eyeHdr: 3.0,
  },
  {
    // CINDER WISP — a coal that hates, cold blue core
    id: 'lavacore',
    scale: 1.0,
    parts: [
      P(0, -1, 0, 0.55, 0.5, 0, 0, 0, 0), // charcoal heart
      P(1, 0, 0.5, 0.7, 0.11, 1.35, 0, 0, 0, 1), // radial ember spikes
      P(1, 0, 0.5, 0.7, 0.11, 1.35, 0, Math.PI / 2, 0.25, 1),
      P(1, 0, 0.5, 0.7, 0.11, 1.35, 0, Math.PI, 0.5, 1),
      P(1, 0, 0.5, 0.7, 0.11, 1.35, 0, -Math.PI / 2, 0.75, 1),
      P(2, 0, 0.25, 0.75, 0.55, 0.35, 2.75, 0.4, 0, 1), // trailing flame tongues
      P(2, 0, 0.25, 0.75, 0.55, 0.35, 2.75, -0.4, 0.33, -1),
      P(2, 0, 0.4, 0.65, 0.5, 0.2, 2.9, 0, 0.66, 0),
      P(3, 0, 0.5, 0.15, 1, 0, 0, 0, 0, 0, 0.3), // cold blue core
    ],
    gaitRate: 1.6,
    segWaveAmp: 0,
    curlBias: 0,
    bodyDim: 0.05,
    eyeHdr: 3.2,
  },
]

/** Warden rigs reuse the same spec schema at boss scale. Budgets: 24 husk /
 * 12 limb / 10 shred / 6 eye instances (guarded in tests). */
export const WARDEN_HUSK_CAP = 24
export const WARDEN_LIMB_CAP = 12
export const WARDEN_SHRED_CAP = 10
export const WARDEN_EYE_CAP = 6

function wardenRing(
  part: 0 | 1 | 2,
  count: number,
  parent: number,
  t: number,
  len: number,
  wid: number,
  splay: number,
  pitch: number,
  phase0: number,
): HorrorPartSpec[] {
  const out: HorrorPartSpec[] = []
  for (let i = 0; i < count; i++) {
    out.push(P(part, parent, t, len, wid, splay, pitch, (i / count) * Math.PI * 2, phase0 + i / count, 0))
  }
  return out
}

export const WARDEN_VISUALS: readonly HorrorVisual[] = HORROR_VISUALS.map((v, idx) => ({
  id: v.id,
  scale: 5.6,
  parts: [
    // spine column of stacked carapace shells
    P(0, -1, 0, 1, 0.66, 0, 0, 0, 0),
    P(0, 0, 0.9, 0.8, 0.58, 0, 0.08, 0, 0.25),
    P(0, 1, 0.9, 0.6, 0.46, 0, 0.1, 0, 0.5),
    // cowl / crown mass
    P(0, 2, 0.85, 0.5, 0.55, 0, 0.3, 0, 0.75),
    // carapace plate ring around the torso (hinges open when EXPOSED)
    ...wardenRing(0, 8, 1, 0.4, 0.55, 0.3, 0.9, 0.55, 0),
    ...wardenRing(0, 8, 0, 0.55, 0.6, 0.34, 1.05, 0.7, 0.5),
    ...wardenRing(0, 4, 2, 0.5, 0.45, 0.26, 0.8, 0.5, 0.3),
    // limb spears
    ...wardenRing(1, 8, 1, 0.25, 1.6, 0.09, 1.2, 0.5, 0),
    P(1, 0, 0.1, 1.3, 0.1, 0.5, 2.8, 0.6, 0.1, 1),
    P(1, 0, 0.1, 1.3, 0.1, 0.5, 2.8, -0.6, 0.6, -1),
    P(1, 2, 0.8, 1.1, 0.08, 0.9, 0.4, 0, 0.4, 1),
    P(1, 2, 0.8, 1.1, 0.08, 0.9, 0.4, 0, 0.9, -1),
    // veil shrouds hanging off the shoulders
    ...wardenRing(2, 8, 1, 0.15, 1.2, 0.8, 0.4, 2.9, 0),
    P(2, 3, 0.6, 0.9, 0.7, 0.3, 3.0, 0.5, 0.2, 1),
    P(2, 3, 0.6, 0.9, 0.7, 0.3, 3.0, -0.5, 0.7, -1),
    // eye cluster in the cowl
    P(3, 3, 0.45, 0.12, 1, 0.25, 1.4, 0, 0, 1, 0.2),
    P(3, 3, 0.45, 0.12, 1, 0.25, 1.4, 0, 0.5, -1, 0.2),
    P(3, 3, 0.6, 0.1, 1, 0.12, 1.45, 0, 0.25, 1, 0.22),
    P(3, 3, 0.6, 0.1, 1, 0.12, 1.45, 0, 0.75, -1, 0.22),
    P(3, 3, 0.3, 0.09, 1, 0.35, 1.3, 0, 0.4, 1, 0.18),
    P(3, 3, 0.3, 0.09, 1, 0.35, 1.3, 0, 0.9, -1, 0.18),
  ],
  gaitRate: 0.3 + 0.05 * idx,
  segWaveAmp: v.segWaveAmp * 0.5,
  curlBias: 0.1,
  bodyDim: 0.07,
  eyeHdr: 3.4,
}))

// ---------------------------------------------------------------------------
// envelope curves (all C1 at their joins)
// ---------------------------------------------------------------------------

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const frac = (v: number) => v - Math.floor(v)

/**
 * Sparse hash-gated twitch train: most windows are dead still, then a sharp
 * snap-and-settle jerk (attack in one frame, ~0.3s ring-down). Smooth sines
 * read as animals; the sudden wrongness of a twitch reads as horror. Output
 * bounded in [-1, 1], deterministic in (t, seed), zero allocation.
 */
export function twitchPulse(t: number, seed: number, rate = 1): number {
  const phase = t * 0.55 * rate + seed * 31.7
  const cell = Math.floor(phase)
  const h = frac(Math.sin(cell * 127.1 + seed * 311.7) * 43758.5453)
  if (h < 0.45) return 0 // this window stays dead still
  const at = frac(Math.sin(cell * 269.5 + seed * 97.3) * 12543.21) * 0.6
  const u = frac(phase) - at
  if (u <= 0) return 0
  return Math.exp(-u * 14) * Math.sin(u * 34) * (h > 0.72 ? 1 : -1)
}

/** Crouch-and-quiver anticipation, 0..1 with zero-slope ends. */
export function windupCurve(u: number): number {
  const k = clamp01(u)
  return 0.5 - 0.5 * Math.cos(Math.PI * k)
}

/** Lunge envelope: fast attack, zero-slope settle at 1. */
export function leapCurve(u: number): number {
  const k = clamp01(u)
  const inv = 1 - k
  return 1 - inv * inv * inv
}

/** Damped gnaw cycle, period 1, C1 (in fact C-inf) at the wrap. */
export function latchCurve(u: number): number {
  const p = frac(u)
  const g = 0.5 - 0.5 * Math.cos(Math.PI * 2 * p)
  return g * g
}

/** Radial part-scatter kick: rises fast, settles to 0 by u~0.71, C1. */
export function deathFling(u: number): number {
  const k = Math.min(1, Math.max(0, u) * 1.4)
  const s = Math.sin(Math.PI * k)
  return s * s
}

/** Shared droop ease (downed wings, dying horrors). */
export function crumple(u: number): number {
  const k = clamp01(u)
  return k * k * (3 - 2 * k)
}

// ---------------------------------------------------------------------------
// pose evaluator
// ---------------------------------------------------------------------------

/** Mirrors enemyState's ES ordinals (kept literal — no game import so the
 * scene geometry module stays dependency-free). */
export const POSE_STATE = {
  STALK: 1,
  CIRCLE: 2,
  WINDUP: 3,
  LEAP: 4,
  LATCHED: 5,
  STAGGER: 6,
  DYING: 7,
  RETREAT: 8,
} as const

export interface HorrorPose {
  bobY: number
  pitch: number
  roll: number
  yawJitter: number
  /** Gait leg-lift oscillator the limb specs sample via phaseOff. */
  gaitLift: number
  limbSplayMul: number
  /** Spine channels: standing curl + traveling wave amplitude. */
  segCurl: number
  segWave: number
  /** 0..1 membrane/cloak/mandible flare. */
  shredFlare: number
  /** Lunge elongation along the facing axis. */
  stretch: number
  /** 0..1 -> eye HDR multiplier. */
  eyeHeat: number
  /** GPU high-frequency tremble amplitude. */
  tremble: number
  /** 0..1 part-scatter kick (DYING). */
  fling: number
}

export function freshHorrorPose(): HorrorPose {
  return {
    bobY: 0,
    pitch: 0,
    roll: 0,
    yawJitter: 0,
    gaitLift: 0,
    limbSplayMul: 1,
    segCurl: 0,
    segWave: 0,
    shredFlare: 0,
    stretch: 0,
    eyeHeat: 0.35,
    tremble: 0,
    fling: 0,
  }
}

export interface HorrorPoseIn {
  /** enemyState ES ordinal. */
  state: number
  /** Seconds in state. */
  stateT: number
  /** Normalized progress for timed states (windup/leap/dying), else 0. */
  stateU: number
  t: number
  speed: number
  /** Audio entrainment (confidence-gated upstream). */
  barPulse: number
  /** 0..1 per-enemy hash. */
  seed: number
}

/**
 * Evaluate the shared pose channels for one horror. Caller owns `out`
 * (zero allocation per frame). Table-weighted blends in the flapPose idiom.
 */
export function horrorPose(out: HorrorPose, p: HorrorPoseIn, a: HorrorVisual): HorrorPose {
  const gait = p.t * a.gaitRate * Math.PI * 2 + p.seed * 12.9
  const speedK = Math.min(1, p.speed / 8)
  out.bobY = 0.06 * Math.sin(gait * 0.5 + p.seed * 5) + 0.04 * p.barPulse
  out.pitch = a.curlBias * 0.4
  out.roll = 0.05 * Math.sin(gait * 0.35 + p.seed * 9)
  out.yawJitter = 0
  out.gaitLift = Math.sin(gait) * (0.25 + 0.6 * speedK)
  out.limbSplayMul = 1
  out.segCurl = a.curlBias
  out.segWave = a.segWaveAmp * (0.4 + 0.6 * speedK)
  out.shredFlare = 0.12 + 0.08 * Math.sin(gait * 0.7)
  out.stretch = 0
  out.eyeHeat = 0.35 + 0.15 * p.barPulse
  out.tremble = 0
  out.fling = 0

  switch (p.state) {
    case POSE_STATE.STALK:
    case POSE_STATE.CIRCLE: {
      // the wrongness layer: dead stillness broken by hash-timed head snaps —
      // the whole body jerks toward you, eyes flaring, then settles
      const tw = twitchPulse(p.t, p.seed)
      out.yawJitter = 0.26 * tw
      out.pitch += 0.07 * tw
      out.eyeHeat += 0.3 * Math.abs(tw)
      break
    }
    case POSE_STATE.WINDUP: {
      const w = windupCurve(p.stateU)
      out.bobY -= 0.22 * w // crouch
      out.pitch += 0.4 * w // coil back
      out.segCurl += 0.5 * w
      out.limbSplayMul = 1 + 0.4 * w
      out.shredFlare = Math.max(out.shredFlare, w) // membranes ignite
      out.eyeHeat = 0.35 + 0.65 * w
      out.tremble = 0.5 * w + 0.5 * w * w
      break
    }
    case POSE_STATE.LEAP: {
      const l = leapCurve(p.stateU)
      out.stretch = 0.9 * l * (1 - 0.4 * p.stateU)
      out.pitch = -0.5 * l // nose into the dive
      // corkscrew pounce: half-roll through the arc, handedness per seed
      out.roll = 0.55 * Math.sin(p.stateU * Math.PI) * (p.seed > 0.5 ? 1 : -1)
      out.segCurl = -0.2 * l
      out.limbSplayMul = 0.55 // limbs pinned
      out.shredFlare = 0.9
      out.eyeHeat = 1
      break
    }
    case POSE_STATE.LATCHED:
      return latchClingPose(out, p, a)
    case POSE_STATE.STAGGER: {
      const d = Math.exp(-3 * p.stateT)
      out.pitch = -0.55 * d * Math.cos(p.stateT * 14)
      out.roll = 0.3 * d * Math.sin(p.stateT * 11 + p.seed * 6)
      out.gaitLift *= 0.3
      out.limbSplayMul = 1.3
      out.eyeHeat = 0.25
      break
    }
    case POSE_STATE.DYING: {
      out.fling = deathFling(p.stateU)
      const c = crumple(p.stateU)
      out.pitch += 0.7 * c
      out.segCurl += 0.8 * c
      // keel over sideways with a final spasm, not a flat forward fold
      out.roll += (0.7 * c + 0.15 * out.fling) * (p.seed > 0.5 ? 1 : -1)
      out.yawJitter = 0.2 * (1 - c) * Math.sin(p.stateT * 21 + p.seed * 9)
      out.shredFlare = 1 - c
      out.eyeHeat = Math.max(0, 1 - 1.6 * p.stateU)
      out.gaitLift = 0
      break
    }
    case POSE_STATE.RETREAT: {
      // cowed limp: hunched, uneven gait, glancing back over the shoulder
      out.pitch += 0.25
      out.segCurl += 0.3
      out.gaitLift *= 0.55 + 0.35 * Math.sin(p.seed * 7.3)
      out.yawJitter = 0.18 * twitchPulse(p.t, p.seed, 1.4)
      out.eyeHeat = 0.2
      break
    }
  }
  return out
}

/** Cling pose while riding a latch anchor: gnaw pulses, limbs wrapped. */
export function latchClingPose(out: HorrorPose, p: HorrorPoseIn, a: HorrorVisual): HorrorPose {
  const gnaw = latchCurve(p.stateT * 1.4 + p.seed * 3)
  out.bobY = 0
  out.pitch = 0.5 + 0.12 * gnaw
  out.roll = 0.08 * Math.sin(p.t * 7 + p.seed * 11)
  // the worrying shake: occasional violent side-to-side wrench mid-gnaw
  out.yawJitter = 0.06 * Math.sin(p.t * 9 + p.seed * 5) + 0.2 * twitchPulse(p.t, p.seed, 1.7)
  out.gaitLift = 0
  out.limbSplayMul = -0.5 // legs wrap INWARD around the body
  out.segCurl = a.curlBias + 0.6
  out.segWave = 0
  out.shredFlare = 0.25
  out.stretch = -0.15 * gnaw // compress toward the anchor on each bite
  out.eyeHeat = 0.8 + 0.2 * gnaw
  out.tremble = 0.2 * gnaw
  out.fling = 0
  return out
}

/** Warden boss channels layered on the shared pose. */
export interface WardenPoseIn extends HorrorPoseIn {
  /** 0..1 windup telegraph. */
  telegraphT: number
  /** 0..1 weak-point openness. */
  weakOpen: number
  hpFrac: number
}

export function wardenPose(out: HorrorPose, p: WardenPoseIn, a: HorrorVisual): HorrorPose {
  horrorPose(out, p, a)
  const tele = clamp01(p.telegraphT)
  // looming presence: a slow deep bob + a scanning head sweep (boss scale
  // turns these whispers into weather)
  out.bobY += 0.05 * Math.sin(p.t * 0.7 + p.seed * 4)
  out.yawJitter += 0.07 * Math.sin(p.t * 0.33 + p.seed * 8)
  // windup: plates rise + shrouds ignite + a rising tremble
  out.limbSplayMul = 1 + 0.5 * windupCurve(tele) + 0.5 * p.weakOpen
  out.shredFlare = Math.max(out.shredFlare, tele, 0.6 * p.weakOpen)
  out.eyeHeat = Math.max(out.eyeHeat, tele, 0.9 * p.weakOpen)
  out.tremble = Math.max(out.tremble, 0.7 * tele * tele)
  // a wounded warden slumps — and past the last third it seethes: a rage
  // tremble and vein heat that never cools again
  const wound = 1 - p.hpFrac
  out.bobY -= 0.15 * wound
  out.pitch += 0.1 * wound
  const rage = clamp01((0.35 - p.hpFrac) / 0.35)
  out.tremble = Math.max(out.tremble, 0.3 * rage)
  out.eyeHeat = Math.max(out.eyeHeat, 0.35 + 0.35 * rage)
  return out
}

/** Budget guard helper used by tests and the renderer alike. */
export function partCounts(v: HorrorVisual): [number, number, number, number] {
  const c: [number, number, number, number] = [0, 0, 0, 0]
  for (const p of v.parts) c[p.part]++
  return c
}
