/**
 * Two-tone vein injector shared by the FarRealm spires and the island
 * tendrils: the vertex-color channel is a 0/1 (or fractional) MASK that mixes
 * the near-black body tint toward a live HDR vein color — vertexColors alone
 * could never carry an emissive through a multiply against palette.islandBase.
 *
 * The uniform holds a REFERENCE to the caller's Color: mutate that Color per
 * frame and the GPU value follows — palette swaps stay color-writes-only.
 * Cache key 'spireVein1' (distinct from 'islandRuneWarp1'/'tripWarp'/'ashSize*'
 * — the documented onBeforeCompile collision law).
 */
import type { Color, MeshBasicMaterial } from 'three'

export function applySpireVein(material: MeshBasicMaterial, vein: Color): void {
  material.onBeforeCompile = shader => {
    shader.uniforms.uSpireVein = { value: vein }
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 uSpireVein;\nvoid main() {')
      .replace(
        '#include <color_fragment>',
        // REPLACES the stock vertex-color multiply: mask 0 keeps the body
        // tint, mask 1 swaps in the vein color outright
        'diffuseColor.rgb = mix(diffuseColor.rgb, uSpireVein, vColor.r);',
      )
  }
  material.customProgramCacheKey = () => 'spireVein1'
}
