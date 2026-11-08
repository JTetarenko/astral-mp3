/**
 * Pure math for the Astral Crystal Bow: triangle soups for the limb segments /
 * riser plates / arrow (non-indexed so computeVertexNormals gives crisp
 * facets), the limb-curl pose evaluator, the string polyline with post-release
 * vibration, the volley fan, and the materialize stagger. No three.js —
 * node-testable in the wingGeom mold.
 *
 * Local space (stated once, used everywhere): +Y = bow spine up, -Z = arrow
 * flight (matches avatar local -Z = world forward), +Z = string/draw side.
 * The upper limb is built along +Y from the riser top; the lower limb is the
 * SAME chain under a root rotated pi about Z, so X-axis curls mirror for free
 * (the wing convention).
 */

import { COMBAT } from '../game/combat'
import { ringSolid, type TriSoup } from './wingGeom'

export { type TriSoup } from './wingGeom'

/** Riser half-height — limb chains root at y = +-RISER_HALF. */
export const RISER_HALF = 0.18

/** Per-limb segment lengths root->tip: 5 body blades + 2 recurve prongs. */
export const LIMB_LENS = [0.15, 0.14, 0.12, 0.1, 0.08, 0.06, 0.05] as const

/** Per-segment world half-widths (X) for the component's instance scaling. */
export const LIMB_WIDTHS = [0.055, 0.048, 0.042, 0.035, 0.03, 0.024, 0.02] as const

export const SEG_COUNT = LIMB_LENS.length

/** Brace pose: gentle string-side sweep, recurve prongs hooking away. */
const BRACE = [0.05, 0.09, 0.13, 0.1, 0.02, -0.55, -0.85] as const
/** Full-draw curl added on top of brace (body bends, hooks straighten). */
const DRAW = [0.08, 0.12, 0.17, 0.21, 0.24, 0.18, 0.1] as const
/** Overdraw strain column — small, the limbs are already near their limit. */
const OVER = [0.015, 0.03, 0.05, 0.07, 0.09, 0.06, 0.04] as const

/** Concatenate soups (positions/along/glow appended; along stays per-part). */
export function mergeSoups(...soups: TriSoup[]): TriSoup {
  let verts = 0
  for (const s of soups) verts += s.along.length
  const positions = new Float32Array(verts * 3)
  const along = new Float32Array(verts)
  const glow = new Float32Array(verts)
  let ptr = 0
  for (const s of soups) {
    positions.set(s.positions, ptr * 3)
    along.set(s.along, ptr)
    glow.set(s.glow, ptr)
    ptr += s.along.length
  }
  return { positions, along, glow }
}

/** Translate a soup in place (returns it for chaining into mergeSoups). */
export function translateSoup(soup: TriSoup, dx: number, dy: number, dz: number): TriSoup {
  const p = soup.positions
  for (let i = 0; i < p.length; i += 3) {
    p[i] += dx
    p[i + 1] += dy
    p[i + 2] += dz
  }
  return soup
}

/**
 * Unit limb segment: length 1 along +Y, chunky diamond prism with a facet
 * waist. The +Z spine verts carry an HDR ridge (the string-side vein the
 * ignition crawl climbs). One soup serves all 14 instances via non-uniform
 * per-instance scale.
 */
export function buildBowSegment(): TriSoup {
  const soup = ringSolid(
    [
      { y: 0.0, hx: 0.3, hz: 0.2 },
      { y: 0.35, hx: 0.42, hz: 0.26 },
      { y: 0.65, hx: 0.4, hz: 0.24 },
      { y: 1.0, hx: 0.16, hz: 0.1 },
    ],
    -0.04,
    1.03,
  )
  for (let i = 0; i < soup.glow.length; i++) {
    const x = soup.positions[i * 3]
    const z = soup.positions[i * 3 + 2]
    if (z > 0.15 && Math.abs(x) < 1e-6) soup.glow[i] = 2.2
  }
  return soup
}

/**
 * Riser: a floating core column + two chevron studs on the sight-window side
 * + the arrow-shelf ledge on the flight side (-Z). World units; one merged
 * soup, one draw.
 */
export function buildBowRiser(): TriSoup {
  const core = ringSolid(
    [
      { y: -RISER_HALF, hx: 0.035, hz: 0.05, glow: 0.1 },
      { y: -0.06, hx: 0.05, hz: 0.075 },
      { y: 0.06, hx: 0.05, hz: 0.075 },
      { y: RISER_HALF, hx: 0.035, hz: 0.05, glow: 0.1 },
    ],
    -RISER_HALF - 0.03,
    RISER_HALF + 0.03,
  )
  // string-side spine of the core glows (the crawl's rank-0 ember bed)
  for (let i = 0; i < core.glow.length; i++) {
    const x = core.positions[i * 3]
    const z = core.positions[i * 3 + 2]
    if (z > 0.045 && Math.abs(x) < 1e-6) core.glow[i] = 1.6
  }
  const chevron = () =>
    ringSolid(
      [
        { y: -0.07, hx: 0.008, hz: 0.014 },
        { y: 0, hx: 0.02, hz: 0.036, glow: 0.8 },
        { y: 0.07, hx: 0.008, hz: 0.014 },
      ],
      -0.085,
      0.085,
    )
  const shelf = ringSolid(
    [
      { y: -0.018, hx: 0.03, hz: 0.02, glow: 0.6 },
      { y: 0.018, hx: 0.022, hz: 0.014, glow: 0.6 },
    ],
    -0.03,
    0.03,
  )
  return mergeSoups(
    core,
    translateSoup(chevron(), 0.045, 0.2, 0),
    translateSoup(chevron(), 0.045, -0.2, 0),
    translateSoup(shelf, 0, 0.02, -0.055),
  )
}

/**
 * Arrow: shaft along +Y (nock at 0, head at ~1.11), HDR spike head (the
 * absorbed muzzle orb), two crossed fletch slabs, a nock bead. The component
 * maps +Y onto the aim ray.
 */
export function buildArrow(): TriSoup {
  const shaft = ringSolid(
    [
      { y: 0.0, hx: 0.014, hz: 0.014, glow: 0.3 },
      { y: 0.5, hx: 0.012, hz: 0.012, glow: 0.5 },
      { y: 0.97, hx: 0.01, hz: 0.01, glow: 0.8 },
    ],
    -0.01,
    0.98,
  )
  const head = ringSolid(
    [
      { y: 1.0, hx: 0.035, hz: 0.035, glow: 2.6 },
      { y: 1.06, hx: 0.02, hz: 0.02, glow: 2.6 },
    ],
    0.99,
    1.11,
  )
  const fletchA = ringSolid(
    [
      { y: 0.02, hx: 0.018, hz: 0.005, glow: 0.4 },
      { y: 0.09, hx: 0.05, hz: 0.006, glow: 0.6 },
      { y: 0.16, hx: 0.012, hz: 0.004, glow: 0.4 },
    ],
    0.01,
    0.17,
  )
  const fletchB = ringSolid(
    [
      { y: 0.02, hx: 0.005, hz: 0.018, glow: 0.4 },
      { y: 0.09, hx: 0.006, hz: 0.05, glow: 0.6 },
      { y: 0.16, hx: 0.004, hz: 0.012, glow: 0.4 },
    ],
    0.01,
    0.17,
  )
  const nockBead = ringSolid(
    [
      { y: -0.02, hx: 0.02, hz: 0.02, glow: 1.4 },
      { y: 0.015, hx: 0.014, hz: 0.014, glow: 1.4 },
    ],
    -0.035,
    0.025,
  )
  return mergeSoups(shaft, head, fletchA, fletchB, nockBead)
}

/**
 * Per-segment X-rotations (rad) for one limb at a given draw. Positive curls
 * toward +Z (the string side); the recurve prongs carry negative brace angles
 * that straighten under load. Same array serves both limbs — the lower root's
 * pi-about-Z mirror flips the geometry, not the angles.
 */
export function limbCurl(out: Float32Array, draw: number, overdraw: number): void {
  const d = Math.min(1, Math.max(0, draw))
  const od = Math.min(1, Math.max(0, overdraw))
  for (let i = 0; i < SEG_COUNT; i++) {
    out[i] = BRACE[i] + DRAW[i] * d + OVER[i] * od
  }
}

/**
 * Forward-kinematic string attach point of a limb chain in bow space (upper
 * limb; the lower mirrors y). Heading starts along +Y from the riser top;
 * each curl rotates it toward +Z.
 */
export function limbTipPos(out: { y: number; z: number }, curls: ArrayLike<number>): void {
  let y = RISER_HALF
  let z = 0
  let ang = 0
  for (let i = 0; i < SEG_COUNT; i++) {
    ang += curls[i]
    y += LIMB_LENS[i] * Math.cos(ang)
    z += LIMB_LENS[i] * Math.sin(ang)
  }
  out.y = y
  out.z = z
}

/** How far the nock stands off the tip chord at a given draw. */
export function drawDist(draw: number, overdraw: number): number {
  return 0.34 * Math.min(1, Math.max(0, draw)) + 0.08 * Math.min(1, Math.max(0, overdraw))
}

/**
 * Nock point from the live tip attach points: the tip-chord midpoint pushed
 * +Z by the draw. At draw 0 it sits exactly on the chord — a straight string.
 */
export function nockPos(
  out: { y: number; z: number },
  tipTopY: number,
  tipTopZ: number,
  tipBotY: number,
  tipBotZ: number,
  draw: number,
  overdraw: number,
): void {
  out.y = (tipTopY + tipBotY) / 2
  out.z = (tipTopZ + tipBotZ) / 2 + drawDist(draw, overdraw)
}

/**
 * String polyline tipTop -> nock -> tipBot into out (n points * xyz), sample
 * density biased toward the nock (k^1.35 leg remap). Post-release vibration
 * superimposes a transverse X standing wave pinned at the tips; the CALLER
 * decays vibAmp (exp(-9t)) and advances vibPhase (~55 rad/s).
 */
export function bowStringPoints(
  out: Float32Array,
  n: number,
  tipTopY: number,
  tipTopZ: number,
  tipBotY: number,
  tipBotZ: number,
  draw: number,
  overdraw: number,
  vibAmp: number,
  vibPhase: number,
): void {
  const ny = (tipTopY + tipBotY) / 2
  const nz = (tipTopZ + tipBotZ) / 2 + drawDist(draw, overdraw)
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1)
    let y: number
    let z: number
    if (u <= 0.5) {
      const k = Math.pow(1 - u / 0.5, 1.35)
      y = ny + (tipTopY - ny) * k
      z = nz + (tipTopZ - nz) * k
    } else {
      const k = Math.pow((u - 0.5) / 0.5, 1.35)
      y = ny + (tipBotY - ny) * k
      z = nz + (tipBotZ - nz) * k
    }
    const x = vibAmp * Math.sin(Math.PI * u) * Math.sin(vibPhase + u * 2.1)
    out[i * 3] = x
    out[i * 3 + 1] = y
    out[i * 3 + 2] = z
  }
  // exact endpoints regardless of the bias remap (float pow can smear 1e-17)
  out[0] = 0
  out[1] = tipTopY
  out[2] = tipTopZ
  out[(n - 1) * 3] = 0
  out[(n - 1) * 3 + 1] = tipBotY
  out[(n - 1) * 3 + 2] = tipBotZ
}

/**
 * Yaw fan (rad) for the three nocked volley arrows. Ballistic contract: the
 * outer angles equal COMBAT.cast.volleySpreadRad so the visible fan IS the
 * flight fan.
 */
export function volleyFanAngles(out: Float32Array, fan01: number): void {
  const f = Math.min(1, Math.max(0, fan01))
  out[0] = -COMBAT.cast.volleySpreadRad * f
  out[1] = 0
  out[2] = COMBAT.cast.volleySpreadRad * f
}

/**
 * Per-part materialize progress: the bow crystallizes core->tips. rank01 0 =
 * riser, 1 = outer prongs. Full matT always fully reveals every rank (the
 * 0.5/0.5 split keeps that exact in floats: v(1, r) = 2 - r >= 1).
 */
export function assemblyStagger(matT: number, rank01: number): number {
  const v = (Math.min(1, Math.max(0, matT)) - 0.5 * rank01) / 0.5
  return Math.min(1, Math.max(0, v))
}

export interface IdleFloatPose {
  y: number
  yaw: number
  roll: number
  /** Extra inter-segment gap (bar-wrap breath). */
  gap: number
}

/** Idle levitation: slow bob/sway, segments micro-separating on bar wraps. */
export function idleFloatPose(
  out: IdleFloatPose,
  t: number,
  beatPulse: number,
  barPulse: number,
): void {
  out.y = 0.03 * Math.sin(1.1 * t) + 0.006 * beatPulse
  out.yaw = 0.06 * Math.sin(0.7 * t)
  out.roll = 0.04 * Math.sin(0.9 * t + 1.3)
  out.gap = 0.004 * barPulse
}
