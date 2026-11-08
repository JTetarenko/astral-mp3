import type { Material } from 'three'

/** Structural subset of the onBeforeCompile parameter (three renames the
 * full type across versions; we only touch these two fields). */
interface WarpShader {
  uniforms: Record<string, { value: unknown }>
  vertexShader: string
}

/**
 * GPU vertex morph for the trip: a slow twist around each object's local Y
 * plus a breathing ripple along the normal. Injected into any built-in
 * material via onBeforeCompile — zero per-frame CPU, and instanced meshes
 * warp in LOCAL space so every island writhes around its own axis.
 * Amplitude 0 short-circuits to the un-warped position.
 */
export interface TripWarpUniforms {
  uTripAmp: { value: number }
  uTripTime: { value: number }
}

const VERTEX_HEAD = /* glsl */ `
uniform float uTripAmp;
uniform float uTripTime;

vec3 tripWarp(vec3 p, vec3 nrm) {
  float a = uTripAmp;
  if (a <= 0.001) return p;
  float tw = sin(p.y * 1.7 + uTripTime * 0.9) * 0.35 * a;
  float cs = cos(tw);
  float sn = sin(tw);
  p = vec3(cs * p.x - sn * p.z, p.y, sn * p.x + cs * p.z);
  float ripple = sin(p.x * 2.3 + uTripTime * 1.4)
               * sin(p.z * 2.1 - uTripTime * 1.1)
               * sin(p.y * 2.7 + uTripTime * 0.7);
  return p + nrm * ripple * 0.22 * a;
}
`

export function applyTripWarp(material: Material): TripWarpUniforms {
  const uniforms: TripWarpUniforms = {
    uTripAmp: { value: 0 },
    uTripTime: { value: 0 },
  }
  material.onBeforeCompile = (shader: WarpShader) => {
    shader.uniforms.uTripAmp = uniforms.uTripAmp
    shader.uniforms.uTripTime = uniforms.uTripTime
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n\ttransformed = tripWarp(transformed, normal);`,
      )
  }
  material.customProgramCacheKey = () => 'tripWarp'
  return uniforms
}
