/**
 * Faceted crystalline monolith clusters for the FarRealm silhouette ring —
 * the untextured nudged-cone spires were the most primitive geometry in the
 * world layer. Pure TriSoup builders (no three imports), node-tested with the
 * wingGeom soup invariants + a tri-budget cap guard.
 *
 * Convention matches FarRealm's instancing: unit height (base y=0, tip y=1),
 * instance scale.set(w, h, w). The glow channel is a 0/1 vein MASK on seeded
 * corner columns (y 0.30..0.90) that the spire shader mixes toward the HDR
 * vein color — the near-black body tint could never carry an emissive alone.
 */
import type { TriSoup } from './wingGeom'

export const SPIRE_TRI_BUDGET = 170

function prng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * One irregular k-gon prism lofted through `stations` ([y, radiusMul] pairs,
 * ascending y), apex point at y=1 offset laterally by `apexOffset` (the
 * asymmetric-splinter silhouette), base capped downward at y=0.
 */
export function buildSpirePrism(
  seed: number,
  corners: number,
  stations: ReadonlyArray<readonly [number, number]>,
  apexOffset: number,
): TriSoup {
  const rnd = prng(seed)
  const nS = stations.length
  // per-corner irregular radius + angle jitter (shared down the column)
  const cr = new Float32Array(corners)
  const ca = new Float32Array(corners)
  for (let i = 0; i < corners; i++) {
    cr[i] = 0.72 + 0.56 * rnd()
    ca[i] = (i / corners) * Math.PI * 2 + (rnd() - 0.5) * (2.2 / corners)
  }
  // two vein corner columns
  const veinA = Math.floor(rnd() * corners)
  const veinB = (veinA + 1 + Math.floor(rnd() * (corners - 1))) % corners
  const isVein = (c: number, y: number) => (c === veinA || c === veinB) && y >= 0.3 && y <= 0.9 ? 1 : 0

  const faces = corners * (nS - 1) * 2 + corners * 2
  const positions = new Float32Array(faces * 9)
  const along = new Float32Array(faces * 3)
  const glow = new Float32Array(faces * 3)
  let ptr = 0
  const push = (x: number, y: number, z: number, g: number) => {
    positions[ptr * 3] = x
    positions[ptr * 3 + 1] = y
    positions[ptr * 3 + 2] = z
    along[ptr] = y
    glow[ptr] = g
    ptr++
  }
  const px = (c: number, s: number) => Math.cos(ca[c]) * cr[c] * stations[s][1] + apexOffset * stations[s][0] * stations[s][0]
  const py = (s: number) => stations[s][0]
  const pz = (c: number, s: number) => Math.sin(ca[c]) * cr[c] * stations[s][1]

  // side quads: (A, D, B) + (B, D, C) — outward for CCW rings viewed from +Y
  for (let s = 0; s < nS - 1; s++) {
    for (let c = 0; c < corners; c++) {
      const c2 = (c + 1) % corners
      const gA = isVein(c, py(s))
      const gB = isVein(c2, py(s))
      const gC = isVein(c2, py(s + 1))
      const gD = isVein(c, py(s + 1))
      push(px(c, s), py(s), pz(c, s), gA)
      push(px(c, s + 1), py(s + 1), pz(c, s + 1), gD)
      push(px(c2, s), py(s), pz(c2, s), gB)
      push(px(c2, s), py(s), pz(c2, s), gB)
      push(px(c, s + 1), py(s + 1), pz(c, s + 1), gD)
      push(px(c2, s + 1), py(s + 1), pz(c2, s + 1), gC)
    }
  }
  // apex fan to the tip point at y=1
  const tipX = apexOffset
  const last = nS - 1
  for (let c = 0; c < corners; c++) {
    const c2 = (c + 1) % corners
    push(px(c, last), py(last), pz(c, last), 0)
    push(tipX, 1, 0, 0)
    push(px(c2, last), py(last), pz(c2, last), 0)
  }
  // base fan facing down
  for (let c = 0; c < corners; c++) {
    const c2 = (c + 1) % corners
    push(px(c, 0), py(0), pz(c, 0), 0)
    push(px(c2, 0), py(0), pz(c2, 0), 0)
    push(0, 0, 0, 0)
  }
  return { positions, along, glow }
}

function appendTransformed(
  into: { positions: number[]; along: number[]; glow: number[] },
  soup: TriSoup,
  scaleXZ: number,
  scaleY: number,
  tilt: number,
  tiltDir: number,
  offX: number,
  offZ: number,
): void {
  const cT = Math.cos(tilt)
  const sT = Math.sin(tilt)
  const cD = Math.cos(tiltDir)
  const sD = Math.sin(tiltDir)
  // first pass to find the post-transform min y (lift keeps the base at >= 0)
  let minY = Infinity
  const n = soup.positions.length / 3
  const tx = new Float32Array(n)
  const ty = new Float32Array(n)
  const tz = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let x = soup.positions[i * 3] * scaleXZ
    let y = soup.positions[i * 3 + 1] * scaleY
    let z = soup.positions[i * 3 + 2] * scaleXZ
    // tilt about the axis perpendicular to tiltDir (rigid, det +1)
    const r = x * cD + z * sD // radial component along tiltDir
    const t = -x * sD + z * cD // tangential (unchanged)
    const r2 = r * cT + y * sT
    const y2 = -r * sT + y * cT
    x = r2 * cD - t * sD
    z = r2 * sD + t * cD
    y = y2
    x += offX
    z += offZ
    tx[i] = x
    ty[i] = y
    tz[i] = z
    if (y < minY) minY = y
  }
  const lift = minY < 0 ? -minY : 0
  for (let i = 0; i < n; i++) {
    into.positions.push(tx[i], ty[i] + lift, tz[i])
    into.along.push(soup.along[i])
    into.glow.push(soup.glow[i])
  }
}

/**
 * The streamed silhouette unit: a 6-corner main monolith fused with two
 * smaller 4-corner child splinters tilted outward at its feet. ~96 tris,
 * one geometry shared by all 48 instances.
 */
export function buildSpireCluster(seed: number): TriSoup {
  const rnd = prng(seed ^ 0x9e3779b9)
  const acc = { positions: [] as number[], along: [] as number[], glow: [] as number[] }
  const main = buildSpirePrism(seed, 6, [
    [0, 1],
    [0.3, 0.85],
    [0.62, 0.6],
    [0.86, 0.3],
  ], 0.18 + 0.2 * rnd())
  appendTransformed(acc, main, 1, 1, 0, 0, 0, 0)
  for (let k = 0; k < 2; k++) {
    const child = buildSpirePrism((seed * 31 + k * 977) | 0, 4, [
      [0, 1],
      [0.45, 0.7],
      [0.8, 0.35],
    ], 0.12)
    const dir = rnd() * Math.PI * 2
    appendTransformed(
      acc,
      child,
      0.45 + 0.15 * rnd(),
      0.35 + 0.15 * rnd(),
      0.08 + 0.08 * rnd(),
      dir,
      Math.cos(dir) * (0.55 + 0.25 * rnd()),
      Math.sin(dir) * (0.55 + 0.25 * rnd()),
    )
  }
  return {
    positions: new Float32Array(acc.positions),
    along: new Float32Array(acc.along),
    glow: new Float32Array(acc.glow),
  }
}
