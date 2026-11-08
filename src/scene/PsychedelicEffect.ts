import { BlendFunction, Effect, EffectAttribute } from 'postprocessing'
import { Uniform, type Texture } from 'three'

// The whole DMT stack in one fragment: breathing radial warp + traveling
// ripple, N-fold kaleidoscope (two integer Ns crossfaded so the fold count
// morphs seamlessly, blended against the unmirrored image so it fades in from
// reality), YIQ hue rotation (luma untouched -> bloom threshold stays stable),
// and fBm domain shimmer. <=4 texture taps.
//
// PLAYABILITY: uCenterClear carves a legible aim tunnel — the kaleidoscope
// and ripple only take hold beyond that screen radius, so the crosshair,
// targets, and flight path stay readable even at full trip.
const FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform float uWarp;
uniform float uRipple;
uniform float uKaleidoMix;
uniform float uKaleidoN1;
uniform float uKaleidoN2;
uniform float uKaleidoNMix;
uniform float uKaleidoSpin;
uniform float uHue;
uniform float uSat;
uniform float uShimmer;
uniform float uBlast;
uniform float uBlastAmp;
uniform float uCenterClear;

vec3 hueRotate(vec3 c, float a, float sat) {
  const mat3 toYIQ = mat3(0.299, 0.596, 0.211,
                          0.587, -0.274, -0.523,
                          0.114, -0.322, 0.312);
  const mat3 toRGB = mat3(1.0, 1.0, 1.0,
                          0.956, -0.272, -1.106,
                          0.621, -0.647, 1.703);
  vec3 yiq = toYIQ * c;
  float ca = cos(a);
  float sa = sin(a);
  yiq.yz = (mat2(ca, -sa, sa, ca) * yiq.yz) * sat;
  return toRGB * yiq;
}

vec2 kaleido(vec2 p, float n, float spin) {
  float ang = atan(p.y, p.x) + spin;
  float wedge = 3.14159265 / n;
  ang = abs(mod(ang, 2.0 * wedge) - wedge);
  return vec2(cos(ang), sin(ang)) * length(p);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 nz = texture2D(uNoise, uv * 2.2 + vec2(time * 0.013, -time * 0.007)).rg - 0.5;
  vec2 suv = uv + nz * uShimmer;

  vec2 p = suv - 0.5;
  p.x *= aspect;
  float r = length(p);

  // drop-impact blast: a one-shot expanding refraction ring from screen
  // center (zero extra taps — it just displaces the same radial warp)
  float blastRing = 0.0;
  if (uBlast < 1.0) {
    float ringR = mix(0.05, 1.2, 1.0 - pow(1.0 - uBlast, 2.0));
    blastRing = exp(-18.0 * abs(r - ringR)) * (1.0 - uBlast);
  }

  // aim tunnel: 0 at screen center -> 1 past the clear radius
  float edge = smoothstep(uCenterClear, uCenterClear + 0.35, r);

  float rw = r * (1.0 + uWarp * r * r * 2.4)
           + uRipple * sin(r * 18.0 - time * 2.4) * smoothstep(0.12, 0.55, r) * mix(0.3, 1.0, edge)
           + uBlastAmp * blastRing;
  vec2 pw = (r > 1e-5) ? p * (rw / r) : p;

  vec2 uvW = vec2(pw.x / aspect, pw.y) + 0.5;
  vec4 col;
  float kMixEff = uKaleidoMix * edge;
  if (kMixEff > 0.001) {
    vec2 k1 = kaleido(pw, uKaleidoN1, uKaleidoSpin);
    vec2 k2 = kaleido(pw, uKaleidoN2, uKaleidoSpin);
    vec2 uvK1 = vec2(k1.x / aspect, k1.y) + 0.5;
    vec2 uvK2 = vec2(k2.x / aspect, k2.y) + 0.5;
    vec4 cW = texture2D(inputBuffer, uvW);
    vec4 cK = mix(texture2D(inputBuffer, uvK1), texture2D(inputBuffer, uvK2), uKaleidoNMix);
    col = mix(cW, cK, kMixEff);
  } else {
    col = texture2D(inputBuffer, uvW);
  }

  col.rgb = hueRotate(col.rgb, uHue, uSat);
  col.rgb *= 1.0 + uBlastAmp * 10.0 * blastRing;
  outputColor = col;
}
`

/** Uniform-driven; Effects.tsx mutates values per frame from visualTuning. */
export class PsychedelicEffect extends Effect {
  constructor(noiseTexture: Texture) {
    super('PsychedelicEffect', FRAG, {
      blendFunction: BlendFunction.SRC,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, Uniform>([
        ['uNoise', new Uniform(noiseTexture)],
        ['uWarp', new Uniform(0)],
        ['uRipple', new Uniform(0)],
        ['uKaleidoMix', new Uniform(0)],
        ['uKaleidoN1', new Uniform(4)],
        ['uKaleidoN2', new Uniform(4)],
        ['uKaleidoNMix', new Uniform(0)],
        ['uKaleidoSpin', new Uniform(0)],
        ['uHue', new Uniform(0)],
        ['uSat', new Uniform(1)],
        ['uShimmer', new Uniform(0)],
        ['uBlast', new Uniform(1)],
        ['uBlastAmp', new Uniform(0)],
        ['uCenterClear', new Uniform(0.28)],
      ]),
    })
  }

  /** Drop-impact ring: progress 0..1 (>=1 inactive) + distortion amplitude. */
  setBlast(progress: number, amp: number): void {
    this.uniforms.get('uBlast')!.value = progress
    this.uniforms.get('uBlastAmp')!.value = amp
  }

  setParams(
    warp: number,
    ripple: number,
    kMix: number,
    kN1: number,
    kN2: number,
    kNMix: number,
    kSpin: number,
    hue: number,
    sat: number,
    shimmer: number,
    centerClear: number,
  ): void {
    const u = this.uniforms
    u.get('uWarp')!.value = warp
    u.get('uRipple')!.value = ripple
    u.get('uKaleidoMix')!.value = kMix
    u.get('uKaleidoN1')!.value = kN1
    u.get('uKaleidoN2')!.value = kN2
    u.get('uKaleidoNMix')!.value = kNMix
    u.get('uKaleidoSpin')!.value = kSpin
    u.get('uHue')!.value = hue
    u.get('uSat')!.value = sat
    u.get('uShimmer')!.value = shimmer
    u.get('uCenterClear')!.value = centerClear
  }
}
