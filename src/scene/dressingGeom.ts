/**
 * Per-realm island dressing vocabulary — the mid-range silhouettes that make
 * each realm readable before palette even lands: crystal halos (astral),
 * canopy fronds (jungle), buttress ribs (cathedral), menhir circles (ritual),
 * orbiting crust plates (collapse), obsidian vents (lavacore).
 *
 * Pure TriSoup builders (no three imports), node-tested with the spireGeom
 * invariants. Unit height (y 0..1, small embed spikes may dip below 0);
 * instances scale.set(sx, sy, sx). Glow channel is the spire-vein mask —
 * fractional values mix partway toward the HDR vein color.
 *
 * placeDressing derives every piece from the island's chunk-stable id via
 * hashInts/mulberry32 (NEVER the chunks.ts rng stream), with a FIXED draw
 * count per piece, so a rebuilt binding at the same depth is bit-identical
 * regardless of stream order.
 */
import { hashInts, mulberry32, range } from '../game/seededRandom'
import { ringSolid, type TriSoup } from './wingGeom'
import { buildSpirePrism } from './spireGeom'

export const DRESSING_POOL = 144
export const DRESSING_MAX_PER_ISLAND = 8
export const DRESSING_TRI_BUDGET = 110

export type DressingFamily = 'orbit' | 'canopy' | 'arch' | 'ring' | 'plate' | 'vent'

function prng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface SoupAcc {
  positions: number[]
  along: number[]
  glow: number[]
}

/** Yaw + anisotropic scale + outward tilt + offset, base lifted to y >= liftFloor.
 * Rigid rotations and positive scales only — winding stays outward. */
function appendTransformed(
  into: SoupAcc,
  soup: TriSoup,
  rotY: number,
  scaleXZ: number,
  scaleY: number,
  tilt: number,
  tiltDir: number,
  offX: number,
  offZ: number,
  liftFloor: number,
): void {
  const cY = Math.cos(rotY)
  const sY = Math.sin(rotY)
  const cT = Math.cos(tilt)
  const sT = Math.sin(tilt)
  const cD = Math.cos(tiltDir)
  const sD = Math.sin(tiltDir)
  const n = soup.positions.length / 3
  const tx = new Float32Array(n)
  const ty = new Float32Array(n)
  const tz = new Float32Array(n)
  let minY = Infinity
  for (let i = 0; i < n; i++) {
    let x = soup.positions[i * 3]
    let y = soup.positions[i * 3 + 1]
    let z = soup.positions[i * 3 + 2]
    // yaw about Y first
    const x1 = cY * x + sY * z
    const z1 = -sY * x + cY * z
    x = x1 * scaleXZ
    y = y * scaleY
    z = z1 * scaleXZ
    // tilt about the axis perpendicular to tiltDir (rigid, det +1)
    const r = x * cD + z * sD
    const tcomp = -x * sD + z * cD
    const r2 = r * cT + y * sT
    const y2 = -r * sT + y * cT
    x = r2 * cD - tcomp * sD
    z = r2 * sD + tcomp * cD
    y = y2
    tx[i] = x + offX
    ty[i] = y
    tz[i] = z + offZ
    if (y < minY) minY = y
  }
  const lift = minY < liftFloor ? liftFloor - minY : 0
  for (let i = 0; i < n; i++) {
    into.positions.push(tx[i], ty[i] + lift, tz[i])
    into.along.push(soup.along[i])
    into.glow.push(soup.glow[i])
  }
}

function accToSoup(acc: SoupAcc): TriSoup {
  return {
    positions: new Float32Array(acc.positions),
    along: new Float32Array(acc.along),
    glow: new Float32Array(acc.glow),
  }
}

/** Astral: slim floating crystal bipyramid with a glowing heart band. */
export function buildOrbitNeedle(seed: number): TriSoup {
  const rnd = prng(seed)
  const g = 0.14 + 0.08 * rnd()
  const soup = ringSolid(
    [
      { y: 0.28, hx: g * 0.85, hz: g * 0.68 },
      { y: 0.5, hx: g, hz: g * 0.8, glow: 1 },
      { y: 0.72, hx: g * 0.58, hz: g * 0.46 },
    ],
    0,
    1,
  )
  // lateral shear (det 1): the crystal drifts off-plumb like a caught shard
  const bend = (rnd() - 0.5) * 0.3
  for (let i = 0; i < soup.positions.length; i += 3) {
    soup.positions[i] += bend * (soup.positions[i + 1] - 0.5)
  }
  return soup
}

/** Jungle: two crossed tapered fronds from one root, tips drooping. */
export function buildCanopyFrond(seed: number): TriSoup {
  const rnd = prng(seed)
  const blade = (width: number, droop: number): TriSoup => {
    const soup = ringSolid(
      [
        { y: 0.08, hx: width * 0.35, hz: 0.035 },
        { y: 0.34, hx: width, hz: 0.05 },
        { y: 0.66, hx: width * 0.78, hz: 0.038, glow: 0.25 },
        { y: 0.88, hx: width * 0.4, hz: 0.028, glow: 0.5 },
      ],
      0,
      1,
    )
    // droop through the thin axis, quadratic to the tip (tendril bend idiom)
    for (let i = 0; i < soup.positions.length; i += 3) {
      const y = soup.positions[i + 1]
      soup.positions[i + 2] += droop * y * y
    }
    return soup
  }
  const acc: SoupAcc = { positions: [], along: [], glow: [] }
  const droop = 0.3 + 0.25 * rnd()
  appendTransformed(acc, blade(0.16 + 0.06 * rnd(), droop), 0, 1, 1, 0, 0, 0, 0, -0.02)
  appendTransformed(
    acc,
    blade(0.12 + 0.05 * rnd(), droop * 1.25),
    0.35 + 0.3 * rnd(),
    0.78,
    0.82,
    0.12,
    rnd() * Math.PI * 2,
    0,
    0,
    -0.02,
  )
  return accToSoup(acc)
}

/** Cathedral: buttress pier leaning inward, crowned by a pinnacle spike. */
export function buildArchRib(seed: number): TriSoup {
  const rnd = prng(seed)
  const lean = 0.28 + 0.16 * rnd()
  const w = 0.07 + 0.03 * rnd()
  const pier = ringSolid(
    [
      { y: 0.1, hx: w * 1.25, hz: w * 0.95 },
      { y: 0.34, hx: w * 1.05, hz: w * 0.8 },
      { y: 0.55, hx: w * 0.9, hz: w * 0.7, glow: 1 },
      { y: 0.74, hx: w * 0.75, hz: w * 0.6 },
    ],
    -0.06,
    0.84,
  )
  // the gothic lean: quadratic drift toward +X (rotated at placement to aim
  // at the island heart), det-1 shear so winding stays outward
  for (let i = 0; i < pier.positions.length; i += 3) {
    const y = Math.max(0, pier.positions[i + 1])
    pier.positions[i] += lean * y * y
  }
  const acc: SoupAcc = { positions: [], along: [], glow: [] }
  appendTransformed(acc, pier, 0, 1, 1, 0, 0, 0, 0, -0.06)
  const pin = ringSolid([{ y: 0.5, hx: w * 0.7, hz: w * 0.55 }], 0, 1)
  appendTransformed(acc, pin, 0, 1, 0.22, 0, 0, lean * 0.62, 0, 0.78)
  return accToSoup(acc)
}

/** Ritual: tapered standing slab, carved band aglow at chest height. */
export function buildMenhir(seed: number): TriSoup {
  const rnd = prng(seed)
  const soup = ringSolid(
    [
      { y: 0.14, hx: 0.3, hz: 0.1 },
      { y: 0.5, hx: 0.26, hz: 0.09, glow: 1 },
      { y: 0.78, hx: 0.2, hz: 0.075 },
    ],
    -0.08,
    1,
  )
  const lean = (rnd() - 0.5) * 0.16
  for (let i = 0; i < soup.positions.length; i += 3) {
    soup.positions[i] += lean * soup.positions[i + 1]
  }
  return soup
}

/** Collapse: irregular flat crust plate, fracture edges aglow. y spans 0..1
 * thickness-wise — the instance's sy IS the plate thickness. */
export function buildPlateShard(seed: number): TriSoup {
  const rnd = prng(seed)
  const n = 5 + (rnd() < 0.5 ? 0 : 1)
  const ax: number[] = []
  const az: number[] = []
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2 + (rnd() - 0.5) * (2.4 / n)
    const r = 0.5 * (0.7 + 0.56 * rnd())
    ax.push(Math.cos(th) * r)
    az.push(Math.sin(th) * r)
  }
  const acc: SoupAcc = { positions: [], along: [], glow: [] }
  const push = (x: number, y: number, z: number, g: number) => {
    acc.positions.push(x, y, z)
    acc.along.push(y)
    acc.glow.push(g)
  }
  // top fan (+Y) and bottom fan (-Y) from corner 0; faces stay dark
  for (let i = 1; i < n - 1; i++) {
    push(ax[0], 1, az[0], 0)
    push(ax[i + 1], 1, az[i + 1], 0)
    push(ax[i], 1, az[i], 0)
    push(ax[0], 0, az[0], 0)
    push(ax[i], 0, az[i], 0)
    push(ax[i + 1], 0, az[i + 1], 0)
  }
  // side walls carry the fracture-edge glow (the identity read)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    push(ax[i], 0, az[i], 1)
    push(ax[i], 1, az[i], 1)
    push(ax[j], 0, az[j], 1)
    push(ax[j], 0, az[j], 1)
    push(ax[i], 1, az[i], 1)
    push(ax[j], 1, az[j], 1)
  }
  return accToSoup(acc)
}

/** Lavacore: obsidian vent spike fused with a child splinter, fissure-veined. */
export function buildVentSpike(seed: number): TriSoup {
  const rnd = prng(seed ^ 0x51ab)
  const acc: SoupAcc = { positions: [], along: [], glow: [] }
  const main = buildSpirePrism(
    seed,
    5,
    [
      [0, 1],
      [0.35, 0.78],
      [0.7, 0.44],
    ],
    0.1 + 0.16 * rnd(),
  )
  // spirePrism footprint is ~unit radius; vents are slim spikes
  appendTransformed(acc, main, 0, 0.24, 1, 0, 0, 0, 0, 0)
  const child = buildSpirePrism(
    (seed * 31 + 977) | 0,
    4,
    [
      [0, 1],
      [0.5, 0.62],
    ],
    0.1,
  )
  const dir = rnd() * Math.PI * 2
  appendTransformed(
    acc,
    child,
    0,
    0.14,
    0.4 + 0.15 * rnd(),
    0.12 + 0.18 * rnd(),
    dir,
    Math.cos(dir) * 0.22,
    Math.sin(dir) * 0.22,
    0,
  )
  return accToSoup(acc)
}

export const DRESSING_BUILDERS: Record<DressingFamily, (seed: number) => TriSoup> = {
  orbit: buildOrbitNeedle,
  canopy: buildCanopyFrond,
  arch: buildArchRib,
  ring: buildMenhir,
  plate: buildPlateShard,
  vent: buildVentSpike,
}

export interface DressingVisual {
  /** == REALMS[i].id, test-aligned. */
  id: string
  family: DressingFamily
  /** want = clamp(round((countBase + countPerScale*scale) * density), 0, MAX). */
  countBase: number
  countPerScale: number
  /** Islands below this scale get nothing. */
  minIslandScale: number
  /** Placement ring radius as fraction of slot.scale (x variantRadialX). */
  radial: [number, number]
  /** Anchor: island top surface / rim edge / floating halo around center. */
  yMode: 'top' | 'rim' | 'orbit'
  /** x slot.scale. */
  yJitter: [number, number]
  /** Piece xz scale = slot.scale * range(...). */
  size: [number, number]
  /** Vertical mult on sx (needles > 1, plates < 1). */
  stretch: [number, number]
  /** Radians away from vertical, tilted along the placement radial. */
  tiltOut: [number, number]
  /** rad/s yaw drift around the island (0 = static; rm forces 0). */
  orbitRate: number
  /** Vein color multiplier fed to the spire-vein shader. */
  veinGain: number
  /** 0..0.5 opt-in vertical trip morph (CrystalShards idiom). */
  tripStretch: number
}

/** Index == realm index (depth % 6). */
export const DRESSING_VISUALS: readonly DressingVisual[] = [
  {
    id: 'astral',
    family: 'orbit',
    countBase: 2,
    countPerScale: 0.5,
    minIslandScale: 2.0,
    radial: [1.15, 1.55],
    yMode: 'orbit',
    yJitter: [-0.2, 0.55],
    size: [0.5, 0.9],
    stretch: [1.5, 2.2],
    tiltOut: [-0.15, 0.15],
    orbitRate: 0.05,
    veinGain: 1.3,
    tripStretch: 0.5,
  },
  {
    id: 'jungle',
    family: 'canopy',
    countBase: 3,
    countPerScale: 0.6,
    minIslandScale: 2.5,
    radial: [0.55, 0.85],
    yMode: 'rim',
    yJitter: [-0.05, 0.1],
    size: [0.55, 0.95],
    stretch: [0.8, 1.1],
    tiltOut: [0.55, 1.0],
    orbitRate: 0,
    veinGain: 0.9,
    tripStretch: 0.2,
  },
  {
    id: 'cathedral',
    family: 'arch',
    countBase: 1,
    countPerScale: 0.35,
    minIslandScale: 3.5,
    radial: [0.35, 0.6],
    yMode: 'top',
    yJitter: [0, 0.05],
    size: [0.9, 1.5],
    stretch: [1.3, 1.8],
    tiltOut: [0.12, 0.3],
    orbitRate: 0,
    veinGain: 1.6,
    tripStretch: 0.15,
  },
  {
    id: 'ritual',
    family: 'ring',
    countBase: 5,
    countPerScale: 0.35,
    minIslandScale: 3.2,
    radial: [0.42, 0.5],
    yMode: 'top',
    yJitter: [0, 0.03],
    size: [0.35, 0.5],
    stretch: [1.2, 1.6],
    tiltOut: [0.02, 0.08],
    orbitRate: 0,
    veinGain: 1.4,
    tripStretch: 0,
  },
  {
    id: 'collapse',
    family: 'plate',
    countBase: 3,
    countPerScale: 0.55,
    minIslandScale: 2.0,
    radial: [1.1, 1.7],
    yMode: 'orbit',
    yJitter: [-0.6, 0.8],
    size: [0.4, 0.85],
    stretch: [0.18, 0.3],
    tiltOut: [0.3, 1.2],
    orbitRate: 0.09,
    veinGain: 1.1,
    tripStretch: 0,
  },
  {
    id: 'lavacore',
    family: 'vent',
    countBase: 3,
    countPerScale: 0.5,
    minIslandScale: 2.0,
    radial: [0.3, 0.8],
    yMode: 'top',
    yJitter: [0, 0.12],
    size: [0.4, 0.75],
    stretch: [1.3, 2.0],
    tiltOut: [0.05, 0.45],
    orbitRate: 0,
    veinGain: 2.2,
    tripStretch: 0.25,
  },
]

export interface DressingPiece {
  /** Island-local offsets, already scale-multiplied. */
  ox: number
  oy: number
  oz: number
  ry: number
  tilt: number
  tiltDir: number
  sx: number
  sy: number
  /** Orbit stagger / per-piece anim phase. */
  phase: number
  /** Ritual k=0 center altar flag. */
  altar: 0 | 1
}

const FAMILY_SALT: Record<DressingFamily, number> = {
  orbit: 0x0a51,
  canopy: 0x0c47,
  arch: 0x0a2c,
  ring: 0x0217,
  plate: 0x091a,
  vent: 0x0f1e,
}

/**
 * Deterministic per (islandId, family): fixed draw count per piece, no
 * external state — a rebuilt binding at the same depth is bit-identical.
 * Approximate dome law anchors top/rim pieces just under the variant's
 * measured silhouette; the small embed hides the seam through bob.
 */
export function placeDressing(
  spec: DressingVisual,
  islandId: number,
  islandScale: number,
  radialX: number,
  radialY: number,
  topFactor: number,
  density: number,
  out: DressingPiece[],
): number {
  out.length = 0
  if (islandScale < spec.minIslandScale) return 0
  const rng = mulberry32(hashInts(islandId | 0, FAMILY_SALT[spec.family], 0x0d5e55, 1))
  const want = Math.max(
    0,
    Math.min(
      DRESSING_MAX_PER_ISLAND,
      Math.round((spec.countBase + spec.countPerScale * islandScale) * density),
    ),
  )
  const isRing = spec.family === 'ring'
  for (let k = 0; k < want; k++) {
    // fixed draw order — every branch below only REUSES these values
    const thetaDraw = range(rng, 0, Math.PI * 2)
    const radialFrac = range(rng, spec.radial[0], spec.radial[1])
    const yJit = range(rng, spec.yJitter[0], spec.yJitter[1])
    const size = range(rng, spec.size[0], spec.size[1])
    const stretch = range(rng, spec.stretch[0], spec.stretch[1])
    const tilt = range(rng, spec.tiltOut[0], spec.tiltOut[1])
    const dirJit = (rng() - 0.5) * 0.6
    const ryJit = (rng() - 0.5) * 0.5
    const phase = range(rng, 0, Math.PI * 2)

    const theta = isRing ? (k / want) * Math.PI * 2 + (thetaDraw - Math.PI) * 0.032 : thetaDraw
    const altar: 0 | 1 = isRing && k === 0 ? 1 : 0
    const rFrac = altar ? 0.12 : radialFrac
    let sx = size * islandScale * 0.32
    let sy = sx * stretch
    if (altar) {
      sx *= 1.4
      sy = sx * 0.35
    }
    const ox = Math.cos(theta) * rFrac * islandScale * radialX
    const oz = Math.sin(theta) * rFrac * islandScale * radialX
    let oy: number
    if (spec.yMode === 'orbit') {
      oy = yJit * islandScale * radialY
    } else {
      // dome approximation of the variant silhouette, slightly embedded
      const f = Math.min(1.05, rFrac / Math.max(0.2, radialX))
      const embed = spec.family === 'vent' ? 0.1 : 0.05
      oy = (topFactor * (0.78 - 0.42 * f * f) - embed + yJit) * islandScale
    }
    // menhirs face the circle center; everything else yaws freely
    const ry = isRing && !altar ? Math.PI / 2 - theta + ryJit * 0.3 : thetaDraw * 1.7 + ryJit
    out.push({
      ox,
      oy,
      oz,
      ry,
      tilt: altar ? tilt * 0.3 : tilt,
      tiltDir: theta + dirJit,
      sx,
      sy,
      phase,
      altar,
    })
  }
  return out.length
}
