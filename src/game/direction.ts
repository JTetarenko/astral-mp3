/**
 * Camera-relative direction math for panned audio and screen-edge threat
 * markers. Matches snapController's yaw convention exactly:
 * forward = (-sin yaw, _, -cos yaw), right = (cos yaw, _, -sin yaw).
 * Pure module, zero imports, zero allocation.
 */

/**
 * Stereo pan (-1..1) for a world offset (dx, dz) from the listener, x0.8 so
 * even a fully-lateral source keeps presence in both ears.
 */
export function stereoPanFor(dx: number, dz: number, yaw: number): number {
  const len = Math.hypot(dx, dz)
  if (len < 1e-6) return 0
  const p = ((dx * Math.cos(yaw) - dz * Math.sin(yaw)) / len) * 0.8
  return p < -1 ? -1 : p > 1 ? 1 : p
}

/**
 * Screen-space bearing of a world offset: 0 = dead ahead, +PI/2 = right,
 * ±PI = behind. Feeds CSS rotate() on damage arcs / edge chevrons (0deg = up).
 */
export function screenAngleFor(dx: number, dz: number, yaw: number): number {
  const s = Math.sin(yaw)
  const c = Math.cos(yaw)
  const fwd = -dx * s - dz * c
  const right = dx * c - dz * s
  return Math.atan2(right, fwd)
}

export interface EdgeOut {
  x: number
  y: number
  edge: boolean
}

/**
 * Clamp an NDC position into the pad-inset screen rect for off-screen threat
 * markers; out.edge flags that clamping happened. Behind-camera projections
 * flip — the caller negates nx/ny first when w < 0.
 */
export function edgeClamp(nx: number, ny: number, pad: number, out: EdgeOut): void {
  const lim = 1 - pad
  let x = nx
  let y = ny
  let edge = false
  if (x < -lim) {
    x = -lim
    edge = true
  } else if (x > lim) {
    x = lim
    edge = true
  }
  if (y < -lim) {
    y = -lim
    edge = true
  } else if (y > lim) {
    y = lim
    edge = true
  }
  out.x = x
  out.y = y
  out.edge = edge
}
