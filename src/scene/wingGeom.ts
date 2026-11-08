/**
 * Pure math for the crystalline seraph wings and avatar adornments: triangle
 * soups for the feather blade / armature strut / collar plate (non-indexed so
 * downstream computeVertexNormals gives crisp facets), the authored per-wing
 * feather layout, the flap-cycle joint evaluator with its asymmetric stroke
 * waveform, and the chest-gem lathe profile. No three.js — node-testable.
 *
 * Conventions (mirroring-safe, see AvatarWings): every bone and blade extends
 * along its local +Y; the wing-root group rotates that +Y outward, so fan /
 * fold / sweep rotations happen about local X and mirror for free. Only lift
 * (local Z) and axis twist (local Y) need a per-side sign flip.
 */

export interface TriSoup {
  /** Non-indexed triangle positions, 9 floats per face. */
  positions: Float32Array
  /** Per-vertex 0 root -> 1 tip parameter (gradients / GPU flex). */
  along: Float32Array
  /** Per-vertex emissive mask (0 body .. HDR ridge); all-zero when unused. */
  glow: Float32Array
}

interface RingStation {
  y: number
  hx: number
  hz: number
  glow?: number
}

/**
 * Solid of 4-vertex diamond rings lofted along +Y, capped with apex points.
 * Ring order: +X, +Z, -X, -Z. Winding is outward (positive signed volume).
 */
export function ringSolid(stations: RingStation[], rootY: number, tipY: number): TriSoup {
  const n = stations.length
  const faces = (n - 1) * 8 + 8
  const positions = new Float32Array(faces * 9)
  const along = new Float32Array(faces * 3)
  const glow = new Float32Array(faces * 3)
  const minY = rootY
  const maxY = tipY
  const span = Math.max(1e-6, maxY - minY)
  let ptr = 0

  const ringX = (s: RingStation, i: number) => (i === 0 ? s.hx : i === 2 ? -s.hx : 0)
  const ringZ = (s: RingStation, i: number) => (i === 1 ? s.hz : i === 3 ? -s.hz : 0)

  const push = (
    x: number,
    y: number,
    z: number,
    g: number,
  ) => {
    positions[ptr * 3] = x
    positions[ptr * 3 + 1] = y
    positions[ptr * 3 + 2] = z
    along[ptr] = (y - minY) / span
    glow[ptr] = g
    ptr++
  }

  for (let k = 0; k < n - 1; k++) {
    const a = stations[k]
    const b = stations[k + 1]
    const ga = a.glow ?? 0
    const gb = b.glow ?? 0
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4
      // (a_i, b_j, a_j) and (a_i, b_i, b_j) — outward winding (derived)
      push(ringX(a, i), a.y, ringZ(a, i), ga)
      push(ringX(b, j), b.y, ringZ(b, j), gb)
      push(ringX(a, j), a.y, ringZ(a, j), ga)
      push(ringX(a, i), a.y, ringZ(a, i), ga)
      push(ringX(b, i), b.y, ringZ(b, i), gb)
      push(ringX(b, j), b.y, ringZ(b, j), gb)
    }
  }
  // tip cap: (r_i, apex, r_j)
  const top = stations[n - 1]
  const gt = top.glow ?? 0
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    push(ringX(top, i), top.y, ringZ(top, i), gt)
    push(0, tipY, 0, gt)
    push(ringX(top, j), top.y, ringZ(top, j), gt)
  }
  // root cap: (r_j, apex, r_i)
  const bot = stations[0]
  const gb0 = bot.glow ?? 0
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    push(ringX(bot, j), bot.y, ringZ(bot, j), gb0)
    push(0, rootY, 0, gb0)
    push(ringX(bot, i), bot.y, ringZ(bot, i), gb0)
  }
  return { positions, along, glow }
}

/**
 * Unit crystal feather blade: length 1 along +Y, flat diamond cross-section
 * (width X, thickness Z), a facet break near the tip for glint edges.
 */
export function buildFeatherBlade(): TriSoup {
  return ringSolid(
    [
      { y: 0.0, hx: 0.14, hz: 0.05 },
      { y: 0.34, hx: 0.5, hz: 0.11 },
      { y: 0.66, hx: 0.44, hz: 0.09 },
      { y: 0.87, hx: 0.24, hz: 0.055 },
    ],
    -0.05,
    1.0,
  )
}

/**
 * Armature strut slab: dark faceted bar along +Y 0..1 with an HDR ridge line
 * on the +Z spine (the "engraved rune-lit" hint of the reference armature).
 */
export function buildStrutSlab(): TriSoup {
  const soup = ringSolid(
    [
      { y: 0.02, hx: 0.3, hz: 0.34, glow: 0.05 },
      { y: 0.16, hx: 0.5, hz: 0.5, glow: 0.05 },
      { y: 0.84, hx: 0.46, hz: 0.5, glow: 0.05 },
      { y: 0.98, hx: 0.26, hz: 0.3, glow: 0.05 },
    ],
    0.0,
    1.0,
  )
  // ridge: verts sitting on the +Z spine glow HDR
  for (let i = 0; i < soup.glow.length; i++) {
    const z = soup.positions[i * 3 + 2]
    const x = soup.positions[i * 3]
    if (z > 0.2 && Math.abs(x) < 1e-6) soup.glow[i] = 2.6
  }
  return soup
}

/**
 * Collar pauldron plate: flat triangular slab, apex down at y=-1, top edge at
 * y=0, thickness Z. Apex rim glows (engraved trim); faces stay dark steel.
 */
export function buildCollarPlate(): TriSoup {
  const t = 0.16
  const A = [0, -1]
  const R = [0.5, 0]
  const L = [-0.5, 0]
  const glowOf = (p: number[]) => (p === A ? 2.4 : 0.22)
  const faces: Array<Array<{ p: number[]; z: number }>> = []
  // front (+z) and back (-z) faces
  faces.push([
    { p: A, z: t },
    { p: R, z: t },
    { p: L, z: t },
  ])
  faces.push([
    { p: A, z: -t },
    { p: L, z: -t },
    { p: R, z: -t },
  ])
  // side walls around edges A->R->L->A: (P_f, Q_b, Q_f) + (P_f, P_b, Q_b)
  const loop = [A, R, L]
  for (let e = 0; e < 3; e++) {
    const P = loop[e]
    const Q = loop[(e + 1) % 3]
    faces.push([
      { p: P, z: t },
      { p: Q, z: -t },
      { p: Q, z: t },
    ])
    faces.push([
      { p: P, z: t },
      { p: P, z: -t },
      { p: Q, z: -t },
    ])
  }
  const positions = new Float32Array(faces.length * 9)
  const along = new Float32Array(faces.length * 3)
  const glow = new Float32Array(faces.length * 3)
  let ptr = 0
  for (const tri of faces) {
    for (const v of tri) {
      positions[ptr * 3] = v.p[0]
      positions[ptr * 3 + 1] = v.p[1]
      positions[ptr * 3 + 2] = v.z
      along[ptr] = 1 + v.p[1]
      glow[ptr] = glowOf(v.p)
      ptr++
    }
  }
  return { positions, along, glow }
}

// ---------------------------------------------------------------------------
// Wing layout
// ---------------------------------------------------------------------------

export interface FeatherSpec {
  /** Armature segment the feather roots on: 0 humerus, 1 forearm, 2 hand. */
  bone: 0 | 1 | 2
  /** 0..1 attachment along the bone. */
  t: number
  /** Blade length / width scale (unit blade is 1 long). */
  len: number
  wid: number
  /** Rest fan angle: 0 = straight along the bone, positive swings the blade
   * tip-ward DOWN within the wing plane (local Z, side-flipped). Radians. */
  splay: number
  /** Rest twist about the blade's own long axis. Radians. */
  pitch: number
  /** 0 primaries, 1 secondaries, 2 coverts (overlay row). */
  layer: 0 | 1 | 2
  /** Continuous root->tip rank (bone + t) for ripple cascades / unfold. */
  ripple: number
  /** Leading-side (-Z) lift so coverts overlay the row beneath. */
  zOff: number
}

/** Humerus, forearm, hand lengths (avatar units). */
export const BONE_LENGTHS: readonly [number, number, number] = [0.34, 0.46, 0.42]

export function buildWingLayout(): FeatherSpec[] {
  const f: FeatherSpec[] = []
  // primaries — rooted along the hand, outermost longest and straightest
  const P = 6
  for (let i = 0; i < P; i++) {
    const u = i / (P - 1)
    f.push({
      bone: 2,
      t: 0.2 + 0.8 * u,
      len: 0.72 + 0.5 * u,
      wid: 0.16 - 0.03 * u,
      splay: 0.78 - 0.72 * u,
      pitch: 0.1 - 0.05 * u,
      layer: 0,
      ripple: 2 + (0.2 + 0.8 * u),
      zOff: 0,
    })
  }
  // secondaries — the fan curtain along the forearm
  const S = 5
  for (let i = 0; i < S; i++) {
    const u = i / (S - 1)
    f.push({
      bone: 1,
      t: 0.12 + 0.76 * u,
      len: 0.48 + 0.22 * u,
      wid: 0.17,
      splay: 1.18 - 0.32 * u,
      pitch: 0.16,
      layer: 1,
      ripple: 1 + (0.12 + 0.76 * u),
      zOff: 0.012,
    })
  }
  // coverts — short overlay row hugging the humerus and inner forearm
  const cov: Array<[0 | 1, number]> = [
    [0, 0.38],
    [0, 0.78],
    [1, 0.22],
    [1, 0.55],
  ]
  for (let i = 0; i < cov.length; i++) {
    const [bone, t] = cov[i]
    f.push({
      bone,
      t,
      len: 0.32 + 0.06 * (i % 2),
      wid: 0.14,
      splay: 0.95,
      pitch: 0.2,
      layer: 2,
      ripple: bone + t,
      zOff: -0.04,
    })
  }
  return f
}

// ---------------------------------------------------------------------------
// Flap cycle
// ---------------------------------------------------------------------------

/** Downstroke fraction of the cycle (fast power stroke, slow recovery). */
const DOWN = 0.42

/**
 * Asymmetric stroke waveform, period 1: +1 wings at top, -1 at bottom.
 * Phase 0 is the top of the stroke; the bottom lands at phase DOWN. Piecewise
 * cosine — C1-continuous at both joins (zero slope), so joint lag offsets
 * never pop.
 */
export function flapWave(p: number): number {
  const u = p - Math.floor(p)
  return u < DOWN
    ? Math.cos(Math.PI * (u / DOWN))
    : -Math.cos(Math.PI * ((u - DOWN) / (1 - DOWN)))
}

export interface FlapPose {
  /** + raises the wing tip above the shoulder (local Z, side-flipped). */
  shoulderLift: number
  /** + sweeps the wing toward the trailing edge (local X). */
  shoulderSweep: number
  /** + pitches the leading edge up (about the bone axis, side-flipped). */
  shoulderTwist: number
  /** In-plane arc: + bends the forearm / hand tip-ward DOWN within the wing
   * plane (local Z, side-flipped). Negative curves the tip upward. */
  elbowBend: number
  handBend: number
  /** Out-of-plane fold toward the trailing edge (local X) — tuck / cocoon. */
  elbowFold: number
  handFold: number
  /** Feather fan multiplier (1 = authored rest splay). */
  splayMul: number
  /** Added blade twist (leading edge bite through the stroke). */
  featherPitch: number
}

export interface FlapParams {
  /** 0..1 cycle position. */
  phase: number
  /** Stroke amplitude 0..~1.6 (power flaps overdrive past 1). */
  amp: number
  /** Overhead raise 0..~1.1 (drop-charge anticipation pose). */
  raise: number
  /** Extra trailing sweep (glide / dive). */
  sweep: number
  /** 0..1.2 fold toward the body (streak tuck, shift cocoon past 1). */
  fold: number
  /** 0..1 flare (landing / impact full spread). */
  spread: number
}

/** Joint-lag offsets: shoulder leads, elbow then hand follow through. */
const LAG_ELBOW = 0.07
const LAG_HAND = 0.14
const LAG_FEATHER = 0.2

export function flapPose(out: FlapPose, p: FlapParams): FlapPose {
  const w = flapWave(p.phase)
  const wE = flapWave(p.phase - LAG_ELBOW)
  const wH = flapWave(p.phase - LAG_HAND)
  const wF = flapWave(p.phase - LAG_FEATHER)
  // quarter-cycle lead approximates the stroke velocity (twist bites into it)
  const vel = flapWave(p.phase + 0.25)
  const fold1 = Math.min(p.fold, 1)

  out.shoulderLift = p.raise + p.amp * 0.5 * w - 0.2 * fold1 + 0.2 * p.spread
  out.shoulderSweep = p.sweep + 0.7 * fold1 - 0.1 * p.spread + p.amp * 0.05 * wE
  out.shoulderTwist = 0.14 * p.amp * vel - 0.16 * p.spread
  // in-plane arc: shoulder up-out, forearm to horizontal, hand down-out —
  // straightening as the wing spreads or raises, tips curving UP at flare
  out.elbowBend =
    0.1 - 0.35 * fold1 - 0.24 * p.spread - 0.1 * p.raise + p.amp * 0.24 * (0.5 - 0.5 * wE)
  out.handBend =
    0.14 - 0.35 * fold1 - 0.45 * p.spread - 0.08 * p.raise + p.amp * 0.2 * (0.5 - 0.5 * wH)
  // out-of-plane fold: the tuck / cocoon channel
  out.elbowFold = 0.08 + 1.25 * p.fold + p.amp * 0.06 * (0.5 - 0.5 * wE)
  out.handFold = 0.05 + 1.5 * p.fold
  out.splayMul = Math.min(1.7, Math.max(0.22, 1 + 0.16 * p.amp * wF + 0.55 * p.spread - 0.6 * fold1))
  out.featherPitch = 0.22 * p.amp * vel + 0.12 * p.spread
  return out
}

// ---------------------------------------------------------------------------
// Tricks + charge charms
// ---------------------------------------------------------------------------

const clamp01T = (v: number) => Math.max(0, Math.min(1, v))

/** Per-charm 0..1 ignition for the gate-charge meter: charm i fills over the
 * i-th third of the shift charge. */
export function charmIgnition(charge: number, cost: number, index: number): number {
  if (cost <= 0) return 1
  return clamp01T((charge / cost) * 3 - index)
}

// ---------------------------------------------------------------------------
// Chest gem
// ---------------------------------------------------------------------------

/**
 * Brilliant-cut lathe profile as [radius, y] pairs, culet (tip) down at y=-1,
 * table up. Unit-ish; the component scales into avatar units.
 */
export function gemProfile(): Array<[number, number]> {
  return [
    [0, -1],
    [0.58, -0.34],
    [1, 0.02],
    [0.8, 0.36],
    [0.36, 0.6],
    [0, 0.6],
  ]
}
