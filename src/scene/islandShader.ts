/**
 * Combined onBeforeCompile injector for the shared Islands material: the trip
 * vertex warp (verbatim from tripWarp.ts) PLUS the runic bioluminescence
 * emissive layer. One injector because chained onBeforeCompile assignments
 * overwrite each other — a material gets exactly one.
 *
 * The rune mask samples the baked rune_emissive tile in LOCAL space (the
 * pattern sticks to the rock through bob/rotation); proximity glow uses world
 * space against uPlayerPos. Emission is HDR (uRuneColor is pre-multiplied
 * past 1) so lit veins cross the bloom threshold.
 *
 * customProgramCacheKey MUST differ from DebrisRing's 'tripWarp' — same-key
 * materials with different injections would reuse the wrong program.
 */
import { Color, Vector3, type Material, type Texture } from 'three'

interface IslandShaderProgram {
  uniforms: Record<string, { value: unknown }>
  vertexShader: string
  fragmentShader: string
}

export interface IslandShaderUniforms {
  uTripAmp: { value: number }
  uTripTime: { value: number }
  uPlayerPos: { value: Vector3 }
  uRuneGlow: { value: number }
  /** Traveling mid-band wave phase: rune light radiates outward from the
   * player as snares/mids push it (visuals.midWavePhase). */
  uMidWavePhase: { value: number }
  uRuneColor: { value: Color }
  uRuneRadius: { value: number }
  /** Exposed for the per-realm vein swap — a sampler VALUE write, never a
   * program rebuild. Only ever swap texture -> texture (all preloaded). */
  uRuneTex: { value: Texture }
  /** Realm surface tint (moss / seep / magma / frost), pre-scaled HDR-safe. */
  uSurfColor: { value: Color }
  /** x = up-facing diffuse tint amount, y = down-facing HDR underglow,
   * z = per-facet frost sparkle. All realm-swapped uniform writes. */
  uSurfParams: { value: Vector3 }
}

const VERTEX_HEAD = /* glsl */ `
uniform float uTripAmp;
uniform float uTripTime;
varying vec3 vRuneLocal;
varying vec3 vRuneWorld;

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

const VERTEX_BODY = /* glsl */ `#include <begin_vertex>
transformed = tripWarp(transformed, normal);
vRuneLocal = transformed;
{
  vec4 rwp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    rwp = instanceMatrix * rwp;
  #endif
  vRuneWorld = (modelMatrix * rwp).xyz;
}
`

const FRAGMENT_HEAD = /* glsl */ `
uniform sampler2D uRuneTex;
uniform vec3 uPlayerPos;
uniform float uRuneGlow;
uniform float uMidWavePhase;
uniform vec3 uRuneColor;
uniform float uRuneRadius;
uniform float uTripTime;
uniform vec3 uSurfColor;
uniform vec3 uSurfParams;
varying vec3 vRuneLocal;
varying vec3 vRuneWorld;
`

const FRAGMENT_BODY = /* glsl */ `#include <emissivemap_fragment>
{
  vec3 rp = vRuneLocal * 1.4;
  // 2-tap planar blend: crags hide the projection seams well enough that a
  // full triplanar isn't worth the extra taps
  float runeMask = max(
    texture2D(uRuneTex, rp.xz + 0.37).r,
    texture2D(uRuneTex, vec2(rp.x + rp.z, rp.y) * 0.9).r
  );
  float prox = 1.0 - smoothstep(uRuneRadius * 0.35, uRuneRadius, distance(vRuneWorld, uPlayerPos));
  // mid-band wavefront: rune light pulses outward from the player with the
  // snare/vocal band, so the realm reads as answering the music
  float midWave = 0.78 + 0.5 * sin(distance(vRuneWorld, uPlayerPos) * 0.28 - uMidWavePhase);
  totalEmissiveRadiance += uRuneColor * runeMask * (uRuneGlow * midWave + 1.4 * prox);
}
{
  // realm surface character — up-facing moss/sheen tints the LIT diffuse
  // (feeds the BRDF, does not glow), down-facing bellies take HDR underglow
  // (lavacore ember light / collapse seep), and a per-facet hashed twinkle
  // gives astral its frost. All three ride swap-time uniforms.
  vec3 upView = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  float upD = dot(normal, upView);
  float upM = smoothstep(0.2, 0.75, upD);
  float dnM = smoothstep(0.2, 0.75, -upD);
  diffuseColor.rgb = mix(
    diffuseColor.rgb,
    uSurfColor * 0.9 + diffuseColor.rgb * 0.35,
    upM * uSurfParams.x
  );
  totalEmissiveRadiance += uSurfColor * dnM * uSurfParams.y * (0.8 + 0.4 * uRuneGlow);
  float facet = fract(sin(dot(floor(vRuneLocal * 2.7), vec3(127.1, 311.7, 74.7))) * 43758.5453);
  float tw = smoothstep(0.92, 1.0, 0.5 + 0.5 * sin(uTripTime * (0.6 + facet) + facet * 6.2831));
  totalEmissiveRadiance += uSurfColor * tw * uSurfParams.z * 0.6;
}
`

export function applyIslandShader(material: Material, runeTex: Texture): IslandShaderUniforms {
  const uniforms: IslandShaderUniforms = {
    uTripAmp: { value: 0 },
    uTripTime: { value: 0 },
    uPlayerPos: { value: new Vector3() },
    uRuneGlow: { value: 0 },
    uMidWavePhase: { value: 0 },
    uRuneColor: { value: new Color(0, 0, 0) },
    uRuneRadius: { value: 11 },
    uRuneTex: { value: runeTex },
    uSurfColor: { value: new Color(0, 0, 0) },
    uSurfParams: { value: new Vector3(0, 0, 0) },
  }
  material.onBeforeCompile = (shader: IslandShaderProgram) => {
    shader.uniforms.uTripAmp = uniforms.uTripAmp
    shader.uniforms.uTripTime = uniforms.uTripTime
    shader.uniforms.uRuneTex = uniforms.uRuneTex
    shader.uniforms.uPlayerPos = uniforms.uPlayerPos
    shader.uniforms.uRuneGlow = uniforms.uRuneGlow
    shader.uniforms.uMidWavePhase = uniforms.uMidWavePhase
    shader.uniforms.uRuneColor = uniforms.uRuneColor
    shader.uniforms.uRuneRadius = uniforms.uRuneRadius
    shader.uniforms.uSurfColor = uniforms.uSurfColor
    shader.uniforms.uSurfParams = uniforms.uSurfParams
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
      .replace('#include <begin_vertex>', VERTEX_BODY)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}`)
      .replace('#include <emissivemap_fragment>', FRAGMENT_BODY)
  }
  // v2: surface-character block added — the GLSL changed, the key MUST move
  material.customProgramCacheKey = () => 'islandRuneWarp2'
  return uniforms
}
