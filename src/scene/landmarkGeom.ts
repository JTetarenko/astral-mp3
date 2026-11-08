/**
 * Per-realm far hero landmarks — one colossal fog-shrouded silhouette per
 * realm beyond gameplay space (seated colossus, world-tree, cathedral facade,
 * obelisk, shattered planet, erupting caldera). Pure TriSoup builders, unit
 * height (y 0..1), instance scale = world height; the component welds the
 * group to the player's XZ with a clamped counter-parallax so the horizon is
 * epic but unreachable.
 *
 * Placement law: LANDMARK_DIST window + parallax cap + per-spec footprint are
 * jointly test-bounded so no corner ever crosses the camera far plane (500),
 * and the azimuth window excludes the Eclipse's fixed -Z berth.
 */
import { hashInts } from '../game/seededRandom'
import { ringSolid, type TriSoup } from './wingGeom'
import { buildSpirePrism } from './spireGeom'

export const LANDMARK_CORE_TRI_BUDGET = 1000
export const LANDMARK_ORBIT_TRI_BUDGET = 400
export const LANDMARK_PARALLAX = 0.08
export const LANDMARK_PARALLAX_CAP = 25
export const LANDMARK_DIST_MIN = 330
export const LANDMARK_DIST_SPAN = 25
/** Farthest corner (dist + parallax + footprint, vs height) must stay under. */
export const LANDMARK_FAR_SAFE = 495

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

/** Yaw + anisotropic scale + tilt (+Y toward (sin tilt cos dir, cos tilt,
 * sin tilt sin dir)) + full offset. Rigid + positive scales: winding kept. */
function appendTransformed(
  into: SoupAcc,
  soup: TriSoup,
  rotY: number,
  scaleXZ: number,
  scaleY: number,
  tilt: number,
  tiltDir: number,
  offX: number,
  offY: number,
  offZ: number,
): void {
  const cY = Math.cos(rotY)
  const sY = Math.sin(rotY)
  const cT = Math.cos(tilt)
  const sT = Math.sin(tilt)
  const cD = Math.cos(tiltDir)
  const sD = Math.sin(tiltDir)
  const n = soup.positions.length / 3
  for (let i = 0; i < n; i++) {
    let x = soup.positions[i * 3]
    let y = soup.positions[i * 3 + 1]
    let z = soup.positions[i * 3 + 2]
    const x1 = cY * x + sY * z
    const z1 = -sY * x + cY * z
    x = x1 * scaleXZ
    y = y * scaleY
    z = z1 * scaleXZ
    const r = x * cD + z * sD
    const tcomp = -x * sD + z * cD
    const r2 = r * cT + y * sT
    const y2 = -r * sT + y * cT
    x = r2 * cD - tcomp * sD
    z = r2 * sD + tcomp * cD
    y = y2
    into.positions.push(x + offX, y + offY, z + offZ)
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

/** n-gon lens/plate: top+bottom fans + glowing-or-dark side wall, y 0..1. */
function discLens(seed: number, n: number, sideGlow: number, faceGlow: number): TriSoup {
  const rnd = prng(seed)
  const ax: number[] = []
  const az: number[] = []
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2 + (rnd() - 0.5) * (2.0 / n)
    const r = 0.5 * (0.76 + 0.48 * rnd())
    ax.push(Math.cos(th) * r)
    az.push(Math.sin(th) * r)
  }
  const acc: SoupAcc = { positions: [], along: [], glow: [] }
  const push = (x: number, y: number, z: number, g: number) => {
    acc.positions.push(x, y, z)
    acc.along.push(y)
    acc.glow.push(g)
  }
  for (let i = 1; i < n - 1; i++) {
    push(ax[0], 1, az[0], faceGlow)
    push(ax[i + 1], 1, az[i + 1], faceGlow)
    push(ax[i], 1, az[i], faceGlow)
    push(ax[0], 0, az[0], faceGlow)
    push(ax[i], 0, az[i], faceGlow)
    push(ax[i + 1], 0, az[i + 1], faceGlow)
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    push(ax[i], 0, az[i], sideGlow)
    push(ax[i], 1, az[i], sideGlow)
    push(ax[j], 0, az[j], sideGlow)
    push(ax[j], 0, az[j], sideGlow)
    push(ax[i], 1, az[i], sideGlow)
    push(ax[j], 1, az[j], sideGlow)
  }
  return accToSoup(acc)
}

/** Astral: seated deity abstraction — stacked faceted mass, chakra glow
 * bands up the spine, cowled head, shoulder slabs. */
export function buildAstralColossus(seed: number): TriSoup {
  const rnd = prng(seed)
  const sway = (rnd() - 0.5) * 0.04
  // chakra bands mix 45% toward the vein color — soft lights up the spine,
  // kept under the lit-restraint threshold so the mass stays silhouette
  const body = ringSolid(
    [
      { y: 0.05, hx: 0.3, hz: 0.22 },
      { y: 0.16, hx: 0.27, hz: 0.2, glow: 0.45 },
      { y: 0.33, hx: 0.2, hz: 0.15 },
      { y: 0.46, hx: 0.17, hz: 0.13, glow: 0.45 },
      { y: 0.6, hx: 0.14, hz: 0.11 },
      { y: 0.67, hx: 0.12, hz: 0.1, glow: 0.45 },
    ],
    0,
    0.76,
  )
  for (let i = 0; i < body.positions.length; i += 3) {
    body.positions[i] += sway * body.positions[i + 1]
  }
  const acc: SoupAcc = { positions: [], along: [], glow: [] }
  appendTransformed(acc, body, 0, 1, 1, 0, 0, 0, 0, 0)
  // cowled head: hollow-dark octahedron with a third-eye glow station
  const head = ringSolid(
    [
      { y: 0.35, hx: 0.085, hz: 0.075 },
      { y: 0.6, hx: 0.07, hz: 0.06, glow: 1 },
    ],
    0,
    1,
  )
  appendTransformed(acc, head, 0, 1, 0.26, 0, 0, sway * 0.76, 0.74, 0)
  // shoulder slabs
  for (const sgn of [-1, 1]) {
    const slab = ringSolid([{ y: 0.5, hx: 0.34, hz: 0.5 }], 0, 1)
    appendTransformed(acc, slab, 0, 0.2, 0.1, 0.5 * sgn, sgn > 0 ? 0 : Math.PI, sgn * 0.185, 0.6, 0)
  }
  return accToSoup(acc)
}

/** Jungle: world-tree — flared ridged trunk under 3 offset canopy lenses,
 * biolum spots on the canopy undersides. */
export function buildWorldTree(seed: number): TriSoup {
  const rnd = prng(seed)
  const acc: SoupAcc = { positions: [], along: [], glow: [] }
  const trunk = buildSpirePrism(
    seed ^ 0x77ee,
    7,
    [
      [0, 1.7],
      [0.2, 1],
      [0.5, 0.72],
      [0.78, 0.5],
    ],
    0.06,
  )
  appendTransformed(acc, trunk, 0, 0.13, 0.96, 0, 0, 0, 0, 0)
  // root skirt: 4 buttress flares
  for (let k = 0; k < 4; k++) {
    const dir = (k / 4) * Math.PI * 2 + rnd() * 0.7
    const root = buildSpirePrism((seed * 17 + k * 131) | 0, 4, [
      [0, 1],
      [0.6, 0.5],
    ], 0.15)
    appendTransformed(acc, root, 0, 0.05, 0.1 + 0.05 * rnd(), 0.9, dir, Math.cos(dir) * 0.1, 0, Math.sin(dir) * 0.1)
  }
  // canopy lenses: underside faces carry the biolum (faceGlow burns from below)
  // radii + offsets sized against the far-plane footprint budget (test-bound)
  const canopies: Array<[number, number, number, number]> = [
    [0.62, 0.38, 0.08, 0],
    [0.78, 0.42, -0.07, 0.06],
    [0.91, 0.32, 0.03, -0.07],
  ]
  for (let k = 0; k < canopies.length; k++) {
    const [cy, r, ox, oz] = canopies[k]
    const lens = discLens((seed * 13 + k * 313) | 0, 9, 0.45, 0)
    appendTransformed(acc, lens, rnd() * Math.PI, r, 0.07, 0, 0, ox, cy, oz)
  }
  // tilted root flares dip under the base plane — meet the ground instead
  for (let i = 1; i < acc.positions.length; i += 3) {
    if (acc.positions[i] < 0) acc.positions[i] = 0
  }
  return accToSoup(acc)
}

/** Cathedral: titanic twin-tower facade, rose-window disc + lancet slits. */
export function buildCathedralFacade(seed: number): TriSoup {
  const rnd = prng(seed)
  const acc: SoupAcc = { positions: [], along: [], glow: [] }
  // twin towers
  for (const sgn of [-1, 1]) {
    const tower = ringSolid(
      [
        { y: 0.06, hx: 0.105, hz: 0.075 },
        { y: 0.45, hx: 0.09, hz: 0.065 },
        { y: 0.78, hx: 0.075, hz: 0.055 },
      ],
      0,
      1,
    )
    appendTransformed(acc, tower, 0, 1, 0.98 - 0.04 * rnd(), 0, 0, sgn * 0.24, 0, 0)
  }
  // nave block + gable
  const nave = ringSolid(
    [
      { y: 0.1, hx: 0.2, hz: 0.09 },
      { y: 0.55, hx: 0.18, hz: 0.08 },
    ],
    0,
    0.78,
  )
  appendTransformed(acc, nave, 0, 1, 1, 0, 0, 0, 0, 0)
  // rose window: glowing 8-gon disc facing forward (+Z)
  const rose = discLens(seed ^ 0x805e, 8, 1, 1)
  appendTransformed(acc, rose, 0, 0.2, 0.03, Math.PI / 2, Math.PI / 2, 0, 0.5, 0.075)
  // three lancet slits below the rose
  for (let k = -1; k <= 1; k++) {
    const lancet = ringSolid([{ y: 0.5, hx: 0.016, hz: 0.012 }], 0, 1)
    appendTransformed(acc, lancet, 0, 1, 0.17, Math.PI / 2, Math.PI / 2, k * 0.07, 0.24, 0.078)
  }
  return accToSoup(acc)
}

/** Ritual: colossal glyph-veined obelisk on a plinth, two kneel-stones. */
export function buildObelisk(seed: number): TriSoup {
  const rnd = prng(seed)
  const acc: SoupAcc = { positions: [], along: [], glow: [] }
  const shaft = buildSpirePrism(
    seed ^ 0x0b31,
    4,
    [
      [0, 1],
      [0.4, 0.82],
      [0.78, 0.62],
      [0.9, 0.5],
    ],
    0.02,
  )
  // trim the spire vein band so the glyph column reads as a carved stripe,
  // not a light tube (restraint law)
  for (let i = 0; i < shaft.glow.length; i++) {
    if (shaft.glow[i] > 0 && shaft.positions[i * 3 + 1] > 0.75) shaft.glow[i] = 0
  }
  appendTransformed(acc, shaft, Math.PI / 4, 0.15, 1, 0, 0, 0, 0, 0)
  const plinth = ringSolid([{ y: 0.5, hx: 0.24, hz: 0.24 }], 0, 1)
  appendTransformed(acc, plinth, 0, 1, 0.07, 0, 0, 0, 0, 0)
  for (const sgn of [-1, 1]) {
    const stone = ringSolid([{ y: 0.4, hx: 0.05, hz: 0.035, glow: 0.45 }], 0, 1)
    appendTransformed(acc, stone, rnd(), 1, 0.12, 0.06 * sgn, 0, sgn * 0.2, 0, 0.1)
  }
  return accToSoup(acc)
}

/** Collapse: shattered planet — burning core octa inside a broken shell of
 * tangent crust plates (golden-angle spread with a torn-open gap). */
export function buildShatteredPlanet(seed: number): TriSoup {
  const rnd = prng(seed)
  const acc: SoupAcc = { positions: [], along: [], glow: [] }
  const core = ringSolid([{ y: 0.5, hx: 0.27, hz: 0.27, glow: 1 }], 0.2, 0.8)
  appendTransformed(acc, core, rnd(), 1, 1, 0, 0, 0, 0, 0)
  const GOLDEN = 2.399963229728653
  const PLATES = 9
  for (let k = 0; k < PLATES; k++) {
    // leave the last berth empty — the wound the core burns through
    if (k === PLATES - 1) continue
    const polar = Math.acos(1 - (2 * (k + 0.5)) / PLATES)
    const azim = k * GOLDEN + rnd() * 0.25
    const dx = Math.sin(polar) * Math.cos(azim)
    const dy = Math.cos(polar)
    const dz = Math.sin(polar) * Math.sin(azim)
    const plate = discLens((seed * 29 + k * 401) | 0, 6, 0.45, 0)
    appendTransformed(
      acc,
      plate,
      rnd() * Math.PI,
      0.3 + 0.14 * rnd(),
      0.045,
      polar,
      azim,
      dx * 0.4,
      0.5 + dy * 0.4,
      dz * 0.4,
    )
  }
  return accToSoup(acc)
}

/** Lavacore: wide caldera cone with a broken rim and a glowing lava-lake
 * floor sealing the crater — closed solid, fissure corners on the flanks. */
export function buildCalderaCone(seed: number): TriSoup {
  const rnd = prng(seed)
  const N = 10
  const cr = new Float32Array(N)
  const ca = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    cr[i] = 0.8 + 0.4 * rnd()
    ca[i] = (i / N) * Math.PI * 2 + (rnd() - 0.5) * (2.0 / N)
  }
  // two fissure corners glow down the outer flank; one rim corner is notched
  const fisA = Math.floor(rnd() * N)
  const fisB = (fisA + 3 + Math.floor(rnd() * (N - 5))) % N
  const notch = (fisA + Math.floor(N / 2)) % N
  // outer flank stations then the inner crater wall, floor last
  const stations: Array<[number, number]> = [
    [0, 0.42],
    [0.42, 0.3],
    [0.78, 0.19],
    [0.92, 0.13],
    [0.8, 0.075],
  ]
  const acc: SoupAcc = { positions: [], along: [], glow: [] }
  const push = (x: number, y: number, z: number, g: number) => {
    acc.positions.push(x, y, z)
    acc.along.push(y)
    acc.glow.push(g)
  }
  const P = (c: number, s: number) => {
    const rimDip = s >= 3 && c === notch ? -0.055 : 0
    return [Math.cos(ca[c]) * cr[c] * stations[s][1], stations[s][0] + rimDip, Math.sin(ca[c]) * cr[c] * stations[s][1]]
  }
  const flankGlow = (c: number, s: number) =>
    (c === fisA || c === fisB) && s >= 1 && s <= 3 ? 1 : 0
  for (let s = 0; s < stations.length - 1; s++) {
    const inner = s >= 3 // crater wall glows faintly, lit by the lake
    for (let c = 0; c < N; c++) {
      const c2 = (c + 1) % N
      const [aX, aY, aZ] = P(c, s)
      const [bX, bY, bZ] = P(c2, s)
      const [cX, cY, cZ] = P(c2, s + 1)
      const [dX, dY, dZ] = P(c, s + 1)
      const gA = inner ? 0.35 : flankGlow(c, s)
      const gB = inner ? 0.35 : flankGlow(c2, s)
      const gC = inner ? 0.35 : flankGlow(c2, s + 1)
      const gD = inner ? 0.35 : flankGlow(c, s + 1)
      push(aX, aY, aZ, gA)
      push(dX, dY, dZ, gD)
      push(bX, bY, bZ, gB)
      push(bX, bY, bZ, gB)
      push(dX, dY, dZ, gD)
      push(cX, cY, cZ, gC)
    }
  }
  // lava-lake floor (upward fan, full glow) + base cap (downward fan)
  const last = stations.length - 1
  for (let c = 0; c < N; c++) {
    const c2 = (c + 1) % N
    const [aX, aY, aZ] = P(c, last)
    const [bX, bY, bZ] = P(c2, last)
    push(aX, aY, aZ, 1)
    push(bX, bY, bZ, 1)
    push(0, stations[last][0], 0, 1)
    const [pX, pY, pZ] = P(c, 0)
    const [qX, qY, qZ] = P(c2, 0)
    push(pX, pY, pZ, 0)
    push(qX, qY, qZ, 0)
    push(0, 0, 0, 0)
  }
  return accToSoup(acc)
}

/** Orbit ring: glyph slabs (or flat crust plates) around a unit-radius ring
 * at y=0.5 — the instance scales radius and the component spins it. */
export function buildRuneRing(seed: number, slabs: number, flat: boolean): TriSoup {
  const rnd = prng(seed)
  const acc: SoupAcc = { positions: [], along: [], glow: [] }
  for (let k = 0; k < slabs; k++) {
    const th = (k / slabs) * Math.PI * 2 + (rnd() - 0.5) * 0.1
    const piece = flat
      ? discLens((seed * 7 + k * 211) | 0, 5, 0.8, 0)
      : ringSolid([{ y: 0.5, hx: 0.045, hz: 0.014, glow: 1 }], 0, 1)
    appendTransformed(
      acc,
      piece,
      flat ? rnd() * Math.PI : Math.PI / 2 - th,
      flat ? 0.14 : 1,
      flat ? 0.02 : 0.11 + 0.03 * rnd(),
      flat ? (rnd() - 0.5) * 0.5 : 0,
      th,
      Math.cos(th),
      0.5 + (flat ? (rnd() - 0.5) * 0.1 : -0.055),
      Math.sin(th),
    )
  }
  return accToSoup(acc)
}

export type LandmarkPulse = 'breath' | 'bar' | 'bass' | 'onset' | 'shatter'

export interface LandmarkVisual {
  /** == REALMS[i].id, test-aligned. */
  id: string
  /** World height in units (unit-height geometry x this). */
  height: number
  baseY: number
  /** Core yaw rad/s (rm / governor freeze). */
  spinRate: number
  orbit: null | { radiusFrac: number; yFrac: number; rate: number; tilt: number }
  veinSource: 'primary' | 'rune' | 'secondary'
  veinGainBase: number
  /** Which existing music signal drives the glow. */
  pulse: LandmarkPulse
}

/** Index == realm index (depth % 6). */
export const LANDMARK_VISUALS: readonly LandmarkVisual[] = [
  {
    id: 'astral',
    height: 190,
    baseY: -70,
    spinRate: 0.02,
    orbit: { radiusFrac: 0.4, yFrac: 0.55, rate: 0.03, tilt: 0.1 },
    veinSource: 'rune',
    veinGainBase: 1.6,
    pulse: 'breath',
  },
  {
    id: 'jungle',
    height: 225,
    baseY: -70,
    spinRate: 0,
    orbit: null,
    veinSource: 'rune',
    veinGainBase: 1.2,
    pulse: 'bass',
  },
  {
    id: 'cathedral',
    height: 220,
    baseY: -70,
    spinRate: 0,
    orbit: null,
    veinSource: 'primary',
    veinGainBase: 2.2,
    pulse: 'bar',
  },
  {
    id: 'ritual',
    height: 225,
    baseY: -70,
    spinRate: 0,
    orbit: { radiusFrac: 0.3, yFrac: 0.6, rate: 0.035, tilt: 0.15 },
    veinSource: 'rune',
    veinGainBase: 1.8,
    pulse: 'onset',
  },
  {
    id: 'collapse',
    height: 150,
    baseY: -10,
    spinRate: 0.008,
    orbit: { radiusFrac: 0.5, yFrac: 0.5, rate: 0.012, tilt: 0.35 },
    veinSource: 'primary',
    veinGainBase: 1.5,
    pulse: 'shatter',
  },
  {
    id: 'lavacore',
    height: 170,
    baseY: -70,
    spinRate: 0,
    orbit: null,
    veinSource: 'primary',
    veinGainBase: 2.4,
    pulse: 'bass',
  },
]

export const LANDMARK_CORE_BUILDERS: ReadonlyArray<(seed: number) => TriSoup> = [
  buildAstralColossus,
  buildWorldTree,
  buildCathedralFacade,
  buildObelisk,
  buildShatteredPlanet,
  buildCalderaCone,
]

/** Orbit soups per realm (null where the spec has none). Slab counts and the
 * flat-plate mode are realm identity, so they live here beside the specs. */
export function buildLandmarkOrbit(realmIdx: number, seed: number): TriSoup | null {
  const spec = LANDMARK_VISUALS[realmIdx % LANDMARK_VISUALS.length]
  if (!spec.orbit) return null
  if (spec.id === 'collapse') return buildRuneRing(seed, 10, true)
  return buildRuneRing(seed, spec.id === 'astral' ? 12 : 10, false)
}

export interface LandmarkPlacement {
  azimuth: number
  dist: number
  scaleJitter: number
}

/** Pure placement: azimuth clears the Eclipse's fixed -Z berth (az = PI) by
 * >= 0.65 rad; distance and jitter windows are far-plane-safe by test. */
export function landmarkPlacement(trackSeed: number, depth: number): LandmarkPlacement {
  const u = (k: number) => hashInts(trackSeed | 0, depth | 0, 0x1a7d, k) / 4294967296
  const azimuth = (Math.PI + 0.65 + u(1) * (Math.PI * 2 - 1.3)) % (Math.PI * 2)
  const dist = LANDMARK_DIST_MIN + LANDMARK_DIST_SPAN * u(2)
  const scaleJitter = 0.92 + 0.16 * u(3)
  return { azimuth, dist, scaleJitter }
}
