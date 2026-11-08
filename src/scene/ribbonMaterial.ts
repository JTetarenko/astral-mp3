/**
 * The hot-spine ribbon shader — verbatim the WardenRig lash language, shared
 * so every ribbon (player trail, aim thread, charm trails) speaks it. Bright
 * core falling to soft edges via the aEdge attribute; per-vertex HDR colors
 * carry all animation, so one material serves every consumer.
 */
import { AdditiveBlending, DoubleSide, ShaderMaterial } from 'three'

export const ribbonVert = /* glsl */ `
  attribute float aEdge;
  varying float vEdge;
  varying vec3 vCol;
  void main() {
    vEdge = aEdge;
    vCol = color;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const ribbonFrag = /* glsl */ `
  varying float vEdge;
  varying vec3 vCol;
  void main() {
    float core = 1.0 - abs(vEdge);
    gl_FragColor = vec4(vCol * (0.22 + 1.35 * core * core), 1.0);
  }
`

export function makeRibbonMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: ribbonVert,
    fragmentShader: ribbonFrag,
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  })
}
