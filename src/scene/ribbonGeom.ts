/**
 * Camera-facing ribbon strips — the shared upgrade path off 1px Lines.
 * WardenRig's lash proved the technique (Line width is locked to 1px on every
 * ANGLE backend); PlayerTrail, AimThread and the charm trails build on this
 * extraction. Pure module: no three imports, raw Float32Array fills, zero
 * allocation — node-tested.
 *
 * Layout: n centerline points -> 2n vertices (left/right pairs) -> (n-1)*2
 * triangles. The aEdge attribute alternates -1/+1 so the fragment shader can
 * shape a hot spine with soft edges.
 */

/** Index list for an n-point strip: (n-1) quads, 6 indices each. */
export function ribbonIndices(n: number): Uint16Array {
  const idx = new Uint16Array(Math.max(0, n - 1) * 6)
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2
    const o = i * 6
    idx[o] = a
    idx[o + 1] = a + 1
    idx[o + 2] = a + 2
    idx[o + 3] = a + 1
    idx[o + 4] = a + 3
    idx[o + 5] = a + 2
  }
  return idx
}

/** aEdge attribute: alternating [-1, +1] per centerline point (2n floats). */
export function ribbonEdges(n: number): Float32Array {
  const e = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) {
    e[i * 2] = -1
    e[i * 2 + 1] = 1
  }
  return e
}

/**
 * Fill 2n x 3 positions for a camera-facing tapered strip around `pts`
 * (n x 3 centerline). Tangents are central differences (one-sided at the
 * ends); side_i = normalize(cross(tangent, camPos - p_i)). A degenerate cross
 * (view parallel to the tangent, or a zero-length segment) reuses the
 * previous side, falling back to +Y at the strip head. widths[i] is the
 * HALF-width at point i.
 */
export function fillRibbonPositions(
  out: Float32Array,
  pts: Float32Array,
  n: number,
  widths: Float32Array,
  camX: number,
  camY: number,
  camZ: number,
): void {
  let psx = 0
  let psy = 1
  let psz = 0
  for (let i = 0; i < n; i++) {
    const i0 = (i === 0 ? 0 : i - 1) * 3
    const i1 = (i === n - 1 ? n - 1 : i + 1) * 3
    const tx = pts[i1] - pts[i0]
    const ty = pts[i1 + 1] - pts[i0 + 1]
    const tz = pts[i1 + 2] - pts[i0 + 2]
    const px = pts[i * 3]
    const py = pts[i * 3 + 1]
    const pz = pts[i * 3 + 2]
    const vx = camX - px
    const vy = camY - py
    const vz = camZ - pz
    let sx = ty * vz - tz * vy
    let sy = tz * vx - tx * vz
    let sz = tx * vy - ty * vx
    const sl = sx * sx + sy * sy + sz * sz
    if (sl < 1e-10) {
      sx = psx
      sy = psy
      sz = psz
    } else {
      const inv = 1 / Math.sqrt(sl)
      sx *= inv
      sy *= inv
      sz *= inv
      psx = sx
      psy = sy
      psz = sz
    }
    const w = widths[i]
    const o = i * 6
    out[o] = px - sx * w
    out[o + 1] = py - sy * w
    out[o + 2] = pz - sz * w
    out[o + 3] = px + sx * w
    out[o + 4] = py + sy * w
    out[o + 5] = pz + sz * w
  }
}

/** Duplicate per-point rgb (n x 3) into the 2n ribbon vertices (2n x 3). */
export function fillRibbonColors(out: Float32Array, rgb: Float32Array, n: number): void {
  for (let i = 0; i < n; i++) {
    const s = i * 3
    const o = i * 6
    out[o] = rgb[s]
    out[o + 1] = rgb[s + 1]
    out[o + 2] = rgb[s + 2]
    out[o + 3] = rgb[s]
    out[o + 4] = rgb[s + 1]
    out[o + 5] = rgb[s + 2]
  }
}
