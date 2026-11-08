/**
 * The one shared shader family for every horror entity (swarm + warden — the
 * two rigs previously carried near-identical inline copies). Matte dark mass
 * with HDR vein/eye accents; NO iridescence — the rainbow stays the player's
 * signature. AAA reads layered in:
 *
 *  - cold fresnel rim: separates the dark silhouettes from the dark sky
 *    (the single most load-bearing light for black-on-black horror)
 *  - root AO: parts shade darker toward their attachment, so stacked
 *    carapace reads as carved mass instead of a flat cutout
 *  - ignition crawl: vein heat is a FRONT that climbs root->tip with vHeat,
 *    so a windup visibly sets the body on fire from the ground up
 *  - burning dissolve edge: the dithered spawn/death/teleport/burrow channel
 *    gains an ember frontier instead of a bare discard cliff
 *  - breathing: a slow bar-locked chest swell (they belong to the song)
 *  - eye life: fresnel-cored gems with hash-desynced blinks that lock open
 *    under heat — a swarm of eyes that never blink in unison
 */
import { Color, type ShaderMaterial } from 'three'

export const horrorBodyVert = /* glsl */ `
  attribute float aV;
  attribute vec4 aData;  // x enemy idx, y part rank, z hash, w spare
  attribute vec4 aState; // x materialize, y hit flash, z heat, w tremble
  uniform float uTime;
  uniform float uBreath;
  varying float vV;
  varying vec3 vN;
  varying vec3 vP;
  varying float vMat;
  varying float vHit;
  varying float vHeat;
  varying float vRand;
  varying vec3 vGlow;
  void main() {
    vV = aV;
    vMat = aState.x;
    vHit = aState.y;
    vHeat = aState.z;
    vRand = aData.z;
    vGlow = color;
    vec3 p = position;
    float k = aV * aV;
    // windup quiver + spawn coalescing pull toward the part root
    p.x += aState.w * 0.07 * sin(uTime * 31.0 + aData.z * 17.0 + aData.y * 3.1) * k;
    p.z += aState.w * 0.06 * sin(uTime * 27.0 + aData.z * 23.0) * k;
    // bar-locked breathing swell, desynced per part hash
    p += normal * uBreath * (0.4 + 0.6 * aV) * (0.7 + 0.6 * sin(vRand * 21.7));
    p *= 0.35 + 0.65 * aState.x;
    mat4 im = instanceMatrix;
    vec4 mv = modelViewMatrix * im * vec4(p, 1.0);
    vP = mv.xyz;
    vN = normalize(mat3(modelViewMatrix * im) * normal);
    gl_Position = projectionMatrix * mv;
  }
`

export const horrorBodyFrag = /* glsl */ `
  uniform vec3 uBody;
  uniform vec3 uVein;
  uniform vec3 uRim;
  uniform float uVeinGain;
  uniform float uBurnGain;
  varying float vV;
  varying vec3 vN;
  varying vec3 vP;
  varying float vMat;
  varying float vHit;
  varying float vHeat;
  varying float vRand;
  varying vec3 vGlow;
  void main() {
    // dithered dissolve: spawn-in, death, teleport flicker, burrow submersion
    float d = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + vRand * 43.7) * 43758.5453);
    if (d > vMat) discard;
    vec3 N = normalize(vN);
    vec3 V = normalize(-vP);
    // faceted key shade so the dark mass still reads as carved surfaces
    float shade = 0.5 + 0.5 * max(0.0, dot(N, normalize(vec3(0.45, 0.65, 0.6))));
    // root AO: attachment ends sink into shadow, tips catch the key
    float ao = 0.45 + 0.55 * smoothstep(0.0, 0.6, vV);
    vec3 col = uBody * shade * ao;
    // cold fresnel rim pulls the silhouette off the dark sky; heat warms it.
    // The floor matters: an idle stalker must still catch the cold edge.
    float rim = pow(1.0 - max(dot(N, V), 0.0), 2.6);
    col += uRim * rim * (0.55 + 0.45 * vHeat);
    // ignition crawl: the vein front climbs root->tip as heat rises
    float crawl = smoothstep(vV - 0.18, vV + 0.12, (vHeat - 0.2) * 1.45);
    col += uVein * vGlow.r * uVeinGain * (0.2 + 1.15 * crawl);
    // burning frontier of the dissolve (zero once fully materialized).
    // NB: smoothstep edges must ascend — descending edges are GLSL UB.
    float burn = (1.0 - smoothstep(0.0, 0.22, vMat - d)) * (1.0 - smoothstep(0.9, 1.0, vMat));
    col += uVein * burn * uBurnGain * (0.5 + 0.5 * vHeat);
    // hit flash concentrates at the rim: impact shock, not a flat overlay
    col += vec3(1.0) * vHit * (0.45 + 0.75 * rim);
    gl_FragColor = vec4(col, 1.0);
  }
`

export const horrorEyeVert = /* glsl */ `
  attribute vec4 aData;
  attribute vec4 aState;
  varying vec3 vN;
  varying vec3 vP;
  varying float vMat;
  varying float vHit;
  varying float vHeat;
  varying float vRand;
  void main() {
    vMat = aState.x;
    vHit = aState.y;
    vHeat = aState.z;
    vRand = aData.z;
    vec3 p = position * (0.35 + 0.65 * aState.x);
    mat4 im = instanceMatrix;
    vec4 mv = modelViewMatrix * im * vec4(p, 1.0);
    vP = mv.xyz;
    vN = normalize(mat3(modelViewMatrix * im) * normal);
    gl_Position = projectionMatrix * mv;
  }
`

export const horrorEyeFrag = /* glsl */ `
  uniform vec3 uEye;
  uniform float uEyeGain;
  uniform float uTime;
  varying vec3 vN;
  varying vec3 vP;
  varying float vMat;
  varying float vHit;
  varying float vHeat;
  varying float vRand;
  void main() {
    float d = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + vRand * 43.7) * 43758.5453);
    if (d > vMat) discard;
    vec3 N = normalize(vN);
    vec3 V = normalize(-vP);
    // fresnel core: a burning pupil facing you, falling off at the limb —
    // the gem reads as a lens, and EchoPass smears the HDR core into tracers
    float core = pow(max(dot(N, V), 0.0), 1.7);
    // out-of-phase gutter so a swarm's eyes never pulse in unison
    float gutter = 0.82 + 0.18 * sin(uTime * 5.3 + vRand * 37.0);
    // hash-desynced blink train (~4-7s cadence, 0.1s lid); heat locks it open
    float cyc = fract(uTime / (3.8 + 2.8 * vRand) + vRand * 7.31);
    float lid = smoothstep(0.955, 0.968, cyc) * (1.0 - smoothstep(0.982, 0.995, cyc));
    lid *= 1.0 - smoothstep(0.5, 0.75, vHeat);
    vec3 col = uEye * uEyeGain * (0.3 + 1.5 * core) * gutter * (0.35 + 1.0 * vHeat);
    col *= 1.0 - 0.92 * lid;
    // hit flash pierces even a mid-blink lid — the eyes whiten with the body
    col += vec3(1.0) * vHit * (0.6 + 1.2 * core);
    gl_FragColor = vec4(col, 1.0);
  }
`

export interface HorrorBodyUniforms {
  uTime: { value: number }
  uBreath: { value: number }
  uBody: { value: Color }
  uVein: { value: Color }
  uRim: { value: Color }
  uVeinGain: { value: number }
  uBurnGain: { value: number }
}

export function makeHorrorBodyUniforms(): HorrorBodyUniforms {
  return {
    uTime: { value: 0 },
    uBreath: { value: 0 },
    uBody: { value: new Color('#07090a') },
    uVein: { value: new Color('#ff3b30') },
    uRim: { value: new Color('#3a4a5c') },
    uVeinGain: { value: 1 },
    uBurnGain: { value: 2.2 },
  }
}

export interface HorrorEyeUniforms {
  uTime: { value: number }
  uEye: { value: Color }
  uEyeGain: { value: number }
}

export function makeHorrorEyeUniforms(): HorrorEyeUniforms {
  return {
    uTime: { value: 0 },
    uEye: { value: new Color('#ff3b30') },
    uEyeGain: { value: 3 },
  }
}

/** Typed uniform access for the shared materials (wrapper-prop clobbering is
 * the postprocessing gotcha; raw ShaderMaterials are safe, this just types). */
export function bodyUniformsOf(mat: ShaderMaterial): HorrorBodyUniforms {
  return mat.uniforms as unknown as HorrorBodyUniforms
}

export function eyeUniformsOf(mat: ShaderMaterial): HorrorEyeUniforms {
  return mat.uniforms as unknown as HorrorEyeUniforms
}
