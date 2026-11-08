/**
 * Per-variant sculpting styles for the four baked island geometries: two
 * jagged obsidian boulders and two tilted shattered monoliths. Pure data —
 * worldState reads the clearance/placement factors (variantTop, radial*) so
 * gameplay geometry (point spawns, dressing) tracks the visual silhouettes.
 * Exactly 4 styles: chunks.ts hardcodes rangeInt(rng, 0, 3), and changing the
 * variant count would break world-generation determinism.
 */

export interface VariantStyle {
  kind: 'jagged' | 'monolith'
  /** Anisotropic scale after displacement (y > xz = monolith). */
  yScale: number
  xzScale: number
  /** Sine-lobe displacement amplitudes (the rolling boulder mass). */
  lobeA: number
  lobeB: number
  /** Abs-ridged crease amplitude (sharp obsidian facets). */
  ridge: number
  /** Baked tilt range in radians (monoliths lean like shattered steles). */
  lean: number
  /** Safe clearance multiplier on island scale: the surface never reaches
   * above scale * topFactor (verified against the baked variants in tests). */
  topFactor: number
  /** Dressing placement radial factors (CrystalShards hug the silhouette). */
  radialX: number
  radialY: number
}

export const VARIANT_STYLES: VariantStyle[] = [
  {
    kind: 'jagged',
    yScale: 0.85,
    xzScale: 1.0,
    lobeA: 0.26,
    lobeB: 0.14,
    ridge: 0.2,
    lean: 0,
    topFactor: 1.28, // measured maxY 1.208 at seed 1000 + ~6% headroom
    radialX: 1,
    radialY: 1,
  },
  {
    kind: 'jagged',
    yScale: 0.8,
    xzScale: 1.05,
    lobeA: 0.22,
    lobeB: 0.16,
    ridge: 0.26,
    lean: 0,
    topFactor: 1.0, // measured maxY 0.930 at seed 1001
    radialX: 1,
    radialY: 1,
  },
  {
    kind: 'monolith',
    yScale: 1.35,
    xzScale: 0.62,
    lobeA: 0.14,
    lobeB: 0.08,
    ridge: 0.3,
    lean: 0.09,
    topFactor: 1.65, // measured maxY 1.549 at seed 1002
    radialX: 0.72,
    radialY: 1.3,
  },
  {
    kind: 'monolith',
    yScale: 1.5,
    xzScale: 0.55,
    lobeA: 0.12,
    lobeB: 0.07,
    ridge: 0.34,
    lean: 0.12,
    topFactor: 1.78, // measured maxY 1.674 at seed 1003
    radialX: 0.66,
    radialY: 1.45,
  },
]

/** Clearance factor for a variant index (masked to the 4-variant pool). */
export function variantTop(v: number): number {
  return VARIANT_STYLES[v & 3].topFactor
}

export function variantRadialX(v: number): number {
  return VARIANT_STYLES[v & 3].radialX
}

export function variantRadialY(v: number): number {
  return VARIANT_STYLES[v & 3].radialY
}
