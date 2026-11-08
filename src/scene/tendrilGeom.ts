/**
 * Hanging stalactite tendrils dressing the undersides of large islands —
 * the cheap mass that finally sells "floating rock torn out of a world".
 * Pure builder on wingGeom's ringSolid (no three imports), node-tested.
 *
 * Convention: root at y=0 (welded to the island underside), tip hanging to
 * y ~ -1; instances scale by island size. Tip verts carry a dim glow (0.6)
 * the shared spire-vein shader turns into a faint ember point — deliberately
 * below the bloom threshold.
 */
import { ringSolid, type TriSoup } from './wingGeom'

export const TENDRIL_POOL = 64
export const TENDRIL_TRI_BUDGET = 40
/** Instanced-buffer ceiling (pool x tris) — documented, test-guarded. */
export const TENDRIL_VERT_BUDGET = 4096

function prng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function buildTendril(seed: number): TriSoup {
  const rnd = prng(seed)
  const girth = 0.09 + 0.07 * rnd()
  const soup = ringSolid(
    [
      { y: 0, hx: girth * 1.4, hz: girth * 1.25 },
      { y: 0.3, hx: girth * 1.05, hz: girth * 0.95 },
      { y: 0.65, hx: girth * 0.66, hz: girth * 0.6, glow: 0.15 },
      { y: 0.92, hx: girth * 0.28, hz: girth * 0.24, glow: 0.6 },
    ],
    -0.05,
    1,
  )
  // rigid pi-about-X flip (y -> -y, z -> -z: winding preserved) so the spike
  // HANGS, then a lateral y^2 shear drift (det 1) so it isn't a plumb line
  const bend = (rnd() - 0.5) * 0.5
  for (let i = 0; i < soup.positions.length; i += 3) {
    const y = soup.positions[i + 1]
    soup.positions[i + 1] = -y
    soup.positions[i + 2] = -soup.positions[i + 2]
    soup.positions[i] += bend * y * y
  }
  return soup
}
