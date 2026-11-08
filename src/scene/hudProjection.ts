/**
 * The world->screen bridge for DOM combat UI (damage bubbles, the warden
 * weak-point marker). HudBridge copies the camera's view-projection matrix
 * here every frame; the HUD rAF projects points with plain scalar math —
 * no three.js import, so the projection is node-testable and the HUD stays
 * three-free. Column-major 4x4, the three.js convention.
 */

export const hudProjection = {
  /** Monotonic generation — bumps every bridge write (staleness checks). */
  gen: 0,
  /** Viewport CSS pixels. */
  vw: 0,
  vh: 0,
  /** Column-major viewProjection = projection * viewInverse. */
  m: new Float32Array(16),
}

export interface ScreenPoint {
  x: number
  y: number
  /** Clip-space w (rough depth); larger = farther. */
  depth: number
  visible: boolean
}

export function makeScreenPoint(): ScreenPoint {
  return { x: 0, y: 0, depth: 0, visible: false }
}

/** NDC overshoot tolerance: bubbles just off-frame still spawn (they drift). */
const NDC_PAD = 1.08

/** Project world (wx,wy,wz) to CSS pixels. Zero allocation — caller owns out. */
export function projectToScreen(
  m: Float32Array,
  wx: number,
  wy: number,
  wz: number,
  vw: number,
  vh: number,
  out: ScreenPoint,
): void {
  const cx = m[0] * wx + m[4] * wy + m[8] * wz + m[12]
  const cy = m[1] * wx + m[5] * wy + m[9] * wz + m[13]
  const cw = m[3] * wx + m[7] * wy + m[11] * wz + m[15]
  if (cw <= 1e-6) {
    // behind the camera
    out.visible = false
    out.depth = 0
    return
  }
  const nx = cx / cw
  const ny = cy / cw
  out.depth = cw
  out.visible = nx >= -NDC_PAD && nx <= NDC_PAD && ny >= -NDC_PAD && ny <= NDC_PAD
  out.x = (nx * 0.5 + 0.5) * vw
  out.y = (1 - (ny * 0.5 + 0.5)) * vh
}
