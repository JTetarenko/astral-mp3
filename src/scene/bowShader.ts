/**
 * The Astral Crystal Bow's shader family: the player's iridescent-crystal
 * signature (the feather language from AvatarWings) fused with the horror
 * kit's two proven mechanics — the ignition crawl (combo heat climbing
 * riser->tips on the aData.x rank) and the dithered dissolve with a burning
 * frontier (materialize / vanish, computed in-shader from a per-part stagger
 * offset so assembly needs zero attribute churn). One vert/frag pair serves
 * two material instances (bow body, arrows): shared program, separate
 * uniforms, separate materialize clocks. Raw ShaderMaterial — HDR colors
 * feed the end-of-chain ACES like every emissive in the scene.
 */

import { Color, ShaderMaterial, Vector3 } from 'three'

export const bowVert = /* glsl */ `
  attribute float aV;
  attribute vec4 aData; // x bow-rank 0..1 (riser->tips), y side, z rand, w stagger
  uniform float uTime;
  uniform float uMat;
  uniform float uTremble;
  uniform float uBreath;
  uniform float uFlex;
  varying float vV;
  varying vec3 vN;
  varying vec3 vP;
  varying float vRand;
  varying float vRank;
  varying float vMat;
  varying vec3 vGlow;
  void main() {
    vV = aV;
    vRand = aData.z;
    vRank = aData.x;
    // per-part materialize: the bow crystallizes core->tips off one uniform
    vMat = clamp((uMat - aData.w) / 0.5, 0.0, 1.0);
    vGlow = color;
    vec3 p = position;
    float k = aV * aV;
    // overdraw strain shiver through the thin axis
    p.x += uTremble * sin(uTime * 43.0 + aData.z * 17.0 + aData.y * 2.1) * k;
    // draw micro-flex: crystal lags its matrix under load
    p.z += uFlex * k * aData.y;
    // bar breath along the normal — the bow inhales with the music
    p += normal * uBreath * (0.5 + 0.5 * aV);
    mat4 im = instanceMatrix;
    vec4 mv = modelViewMatrix * im * vec4(p, 1.0);
    vP = mv.xyz;
    vN = normalize(mat3(modelViewMatrix * im) * normal);
    gl_Position = projectionMatrix * mv;
  }
`

export const bowFrag = /* glsl */ `
  uniform vec3 uIce;
  uniform vec3 uDeep;
  uniform vec3 uEmber;
  uniform vec3 uGlintDir;
  uniform float uGlow;
  uniform float uSparkle;
  uniform float uFlash;
  uniform float uIrid;
  uniform float uHue;
  uniform float uHeat;
  uniform float uBurnGain;
  varying float vV;
  varying vec3 vN;
  varying vec3 vP;
  varying float vRand;
  varying float vRank;
  varying float vMat;
  varying vec3 vGlow;
  void main() {
    // dithered materialize (assembly / vanish share the one channel)
    float d = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + vRand * 43.7) * 43758.5453);
    if (d > vMat) discard;
    vec3 N = normalize(vN);
    vec3 E = normalize(-vP);
    float ndv = abs(dot(N, E));
    float fres = pow(1.0 - ndv, 2.2);
    // the player's faceted prism rainbow — same formula family as the wings,
    // so avatar and weapon share one aurora
    float h = dot(abs(N), vec3(0.6, 1.1, 0.8)) + vV * 2.6 + vRand * 3.1 + uHue;
    vec3 irid = 0.5 + 0.5 * cos(h + vec3(0.0, 2.094, 4.188));
    vec3 col = mix(uDeep, uIce, 0.3 + 0.7 * vV);
    col += irid * uIrid * (0.3 + 0.9 * fres);
    col += vec3(0.9) * fres;
    // rotating glint: facets aligned with the roving light flash HDR white
    float g = pow(max(dot(N, uGlintDir), 0.0), 30.0);
    col += vec3(3.4) * g * uSparkle;
    float rootAo = 0.58 + 0.55 * smoothstep(0.0, 0.3, vV);
    col *= uGlow * rootAo * (0.85 + 0.35 * vV);
    // internal growth bands — crystal, not plastic
    col *= 1.0 + 0.07 * sin(vV * 34.0 + vRand * 19.0) * (1.0 - fres);
    // combo-heat ignition crawl climbing riser->tips on the bow rank; the
    // string-side ridge (vGlow) carries it hottest
    float crawl = smoothstep(vRank - 0.15, vRank + 0.12, (uHeat - 0.15) * 1.4);
    col += uEmber * crawl * (0.25 + 1.2 * vGlow.r);
    // the ridge always smolders faintly so the bow reads at heat 0
    col += uEmber * vGlow.r * 0.12;
    // burning frontier of the dissolve (zero once fully materialized).
    // NB: smoothstep edges must ascend — descending edges are GLSL UB.
    float burn = (1.0 - smoothstep(0.0, 0.22, vMat - d)) * (1.0 - smoothstep(0.9, 1.0, vMat));
    col += uEmber * burn * uBurnGain;
    col += vec3(uFlash);
    gl_FragColor = vec4(col, 1.0);
  }
`

export interface BowUniforms {
  uTime: { value: number }
  /** 0..1 whole-bow materialize clock (per-part stagger lives in aData.w). */
  uMat: { value: number }
  uTremble: { value: number }
  uBreath: { value: number }
  uFlex: { value: number }
  uIce: { value: Color }
  uDeep: { value: Color }
  /** Heat/burn ember — palette.primary lerped toward white, HDR. */
  uEmber: { value: Color }
  uGlintDir: { value: Vector3 }
  uGlow: { value: number }
  uSparkle: { value: number }
  uFlash: { value: number }
  uIrid: { value: number }
  uHue: { value: number }
  /** 0..1 combo ignition driving the crawl. */
  uHeat: { value: number }
  uBurnGain: { value: number }
}

export function makeBowUniforms(): BowUniforms {
  return {
    uTime: { value: 0 },
    uMat: { value: 0 },
    uTremble: { value: 0 },
    uBreath: { value: 0 },
    uFlex: { value: 0 },
    uIce: { value: new Color('#eaf6ff') },
    uDeep: { value: new Color('#5a7a9a') },
    uEmber: { value: new Color('#ffb36b').multiplyScalar(2.4) },
    uGlintDir: { value: new Vector3(0, 1, 0) },
    uGlow: { value: 1 },
    uSparkle: { value: 0.4 },
    uFlash: { value: 0 },
    uIrid: { value: 0.3 },
    uHue: { value: 0 },
    uHeat: { value: 0 },
    uBurnGain: { value: 2.2 },
  }
}

export function makeBowMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: bowVert,
    fragmentShader: bowFrag,
    uniforms: makeBowUniforms() as unknown as ShaderMaterial['uniforms'],
    vertexColors: true,
  })
}

/** Typed uniform access (the horrorShader accessor pattern). */
export function bowUniformsOf(mat: ShaderMaterial): BowUniforms {
  return mat.uniforms as unknown as BowUniforms
}
