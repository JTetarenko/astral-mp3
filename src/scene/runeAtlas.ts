/**
 * Shared helpers for the baked 4x3 rune glyph atlas (/assets/runes.png).
 * Used by the gate mandala, resonance-point glyph sprites, and the
 * camera-orbiting rune stones. Pure geometry/UV math — no scene state.
 */
import { PlaneGeometry, type BufferAttribute } from 'three'

export const ATLAS_COLS = 4
export const ATLAS_ROWS = 3
export const RUNE_GLYPHS = ATLAS_COLS * ATLAS_ROWS

/** PlaneGeometry whose UVs map to one glyph cell of the baked rune atlas. */
export function runePlaneGeometry(glyph: number, size: number): PlaneGeometry {
  const geo = new PlaneGeometry(size, size)
  const uv = geo.attributes.uv as BufferAttribute
  const col = glyph % ATLAS_COLS
  const row = Math.floor(glyph / ATLAS_COLS) % ATLAS_ROWS
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (col + uv.getX(i)) / ATLAS_COLS, 1 - (row + (1 - uv.getY(i))) / ATLAS_ROWS)
  }
  return geo
}

/** Texture repeat/offset for one glyph cell (for cloned-texture sprites). */
export function glyphUvOffset(glyph: number): { x: number; y: number } {
  const g = glyph % RUNE_GLYPHS
  return {
    x: (g % ATLAS_COLS) / ATLAS_COLS,
    y: 1 - (Math.floor(g / ATLAS_COLS) + 1) / ATLAS_ROWS,
  }
}

/** Per-realm gate flavor: which glyph procession the 12 rune planes walk
 * (stride coprime with 12 -> all 12 glyphs, realm-distinct order), plus ring
 * spin accents and outer-group tilt adds Mandala applies at the epoch swap. */
export interface GateStyle {
  stride: number
  offset: number
  /** Signed multiplier per ring on the base spin rates [r0, r1, r2]. */
  spinMult: readonly [number, number, number]
  /** Static tilt adds on the ring groups' [x, z] — [r0, r1, r2] pairs. */
  tiltAdd: readonly [number, number, number]
}

/** Index == realm index (depth % 6). */
export const GATE_STYLES: readonly GateStyle[] = [
  /* astral    */ { stride: 5, offset: 0, spinMult: [1, 1, 1], tiltAdd: [0, 0, 0] },
  /* jungle    */ { stride: 7, offset: 2, spinMult: [1, 1, 1], tiltAdd: [0.12, -0.08, 0.1] },
  /* cathedral */ { stride: 1, offset: 0, spinMult: [0.7, -0.7, 0.7], tiltAdd: [-0.2, -0.25, -0.15] },
  /* ritual    */ { stride: 11, offset: 9, spinMult: [-1, -1, -1], tiltAdd: [0, 0, 0] },
  /* collapse  */ { stride: 5, offset: 4, spinMult: [1.5, 1.5, 1.5], tiltAdd: [0.2, 0.15, -0.2] },
  /* lavacore  */ { stride: 7, offset: 6, spinMult: [1.2, 1.2, 1.2], tiltAdd: [0.1, 0, 0.08] },
]

export function gateStyleForDepth(depth: number): GateStyle {
  const d = Math.max(0, Math.floor(depth))
  return GATE_STYLES[d % GATE_STYLES.length]
}

/** Glyph for gate rune plane i at a given depth — a full 12-glyph procession
 * in a realm-distinct order (strides are coprime with 12, test-guarded). */
export function gateGlyph(depth: number, i: number): number {
  const s = gateStyleForDepth(depth)
  return (s.offset + s.stride * (((i % RUNE_GLYPHS) + RUNE_GLYPHS) % RUNE_GLYPHS)) % RUNE_GLYPHS
}
