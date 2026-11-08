/**
 * Baked island geometry: vertex displacement applied once per variant.
 * Displacement depends only on vertex position so duplicated (non-indexed)
 * vertices stay welded; crevice depth is baked into vertex colors as cheap
 * ambient occlusion. The optional style adds an abs-ridged crease term (sharp
 * obsidian facets under flat shading) and anisotropic scale (monoliths).
 * Without a style this is the legacy boulder recipe, bit-identical — the
 * DebrisRing reuses it at detail 1 and must not change.
 */
import { Float32BufferAttribute, IcosahedronGeometry, Vector3, type BufferAttribute } from 'three'
import type { VariantStyle } from '../game/islandVariants'
import { mulberry32, range } from '../game/seededRandom'

/** Legacy boulder recipe (kept as the no-style default for DebrisRing). */
const LEGACY_STYLE: VariantStyle = {
  kind: 'jagged',
  yScale: 0.85,
  xzScale: 1,
  lobeA: 0.3,
  lobeB: 0.18,
  ridge: 0,
  lean: 0,
  topFactor: 1.15,
  radialX: 1,
  radialY: 1,
}

export function makeIslandGeometry(
  variantSeed: number,
  detail = 2,
  style: VariantStyle = LEGACY_STYLE,
): IcosahedronGeometry {
  const geo = new IcosahedronGeometry(1, detail)
  const rng = mulberry32(variantSeed)
  // rng draw order is a compatibility contract: k1/k2 first (the legacy
  // draws), THEN the style-only draws — legacy output stays bit-identical.
  const k1 = new Vector3(range(rng, 1, 3), range(rng, 1, 3), range(rng, 1, 3))
  const k2 = new Vector3(range(rng, 2.5, 5), range(rng, 2.5, 5), range(rng, 2.5, 5))
  const k3 = new Vector3(range(rng, 4, 7), range(rng, 4, 7), range(rng, 4, 7))
  const leanX = style.lean > 0 ? range(rng, -style.lean, style.lean) : 0
  const leanZ = style.lean > 0 ? range(rng, -style.lean, style.lean) : 0
  const pos = geo.attributes.position as BufferAttribute
  const v = new Vector3()
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    // sharp creases: the abs-ridge is C0 at its peaks; with flat shading and
    // non-indexed verts that reads as faceted obsidian, not smooth rock
    const ridge =
      style.ridge > 0
        ? style.ridge * (Math.pow(1 - Math.abs(Math.sin(v.dot(k3))), 2.2) - 0.35)
        : 0
    const d = 1 + style.lobeA * Math.sin(v.dot(k1)) + style.lobeB * Math.sin(v.dot(k2)) + ridge
    v.multiplyScalar(d)
    pos.setXYZ(i, v.x * style.xzScale, v.y * style.yScale, v.z * style.xzScale)
    // deeper displacement -> darker crevice
    const shade = 0.5 + 0.5 * Math.min(1, Math.max(0, (d - 0.6) / 0.85))
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = shade
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3))
  // shattered-stele tilt is baked so all 48 instances of a variant lean alike
  // (per-instance rotY/scale keeps them varied)
  if (leanX !== 0) geo.rotateX(leanX)
  if (leanZ !== 0) geo.rotateZ(leanZ)
  geo.computeVertexNormals()
  return geo
}
