import { BlendFunction, Effect, EffectAttribute } from 'postprocessing'
import { Color, Matrix4, Uniform, Vector2, Vector3, type PerspectiveCamera, type Texture } from 'three'

/**
 * Volumetric-feel ground fog: analytic (closed-form, loop-free) exponential
 * height fog integrated along each pixel's view ray, modulated by two
 * scrolling noise taps that fake rolling volume, with a bass-lit inner glow.
 *
 * DEPTH-attributed (not convolution): the composer auto-creates a stable
 * depth target and blits resolved depth after RenderPass, so this pass sits
 * directly after RenderPass and echo/bloom operate on the fogged image.
 *
 * Density is concentrated below the play band (uHeightY/uFalloff) so
 * eye-level rays stay legible and upward rays to the eclipse thin naturally;
 * uCap leaves additive HDR sprites a punch-through margin. The glow term is
 * attenuated inside uCenterClear (the protected aim tunnel) — the fog VEIL is
 * never carved (a screen-space hole in a world medium reads wrong).
 */
const fragmentShader = /* glsl */ `
  uniform sampler2D uNoise;
  uniform mat4 uInvProj;
  uniform mat4 uCamWorld;
  uniform vec3 uCamPos;
  uniform vec3 uFogColor;
  uniform vec3 uGlowColor;
  uniform float uDensity;
  uniform float uGlow;
  uniform float uHeightY;
  uniform float uFalloff;
  uniform float uCap;
  uniform float uCenterClear;
  uniform vec2 uDrift;

  void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    // world position from depth — valid for a standard PerspectiveCamera
    // (clip.w == -viewZ; the game never uses ortho or skewed projections)
    float viewZ = getViewZ(depth);
    vec4 ndc = vec4(vec3(uv, depth) * 2.0 - 1.0, 1.0);
    vec4 clipPos = ndc * (-viewZ);
    vec4 viewPos = uInvProj * clipPos;
    vec3 wp = (uCamWorld * vec4(viewPos.xyz, 1.0)).xyz;

    vec3 rd = wp - uCamPos;
    float t = length(rd);
    rd /= max(t, 1e-4);

    // closed-form optical depth of exp(-falloff * (y - H)) along the segment
    float bo = uFalloff * (uCamPos.y - uHeightY);
    float br = uFalloff * rd.y * t;
    float seg = abs(br) > 1e-4 ? (1.0 - exp(-br)) / br : 1.0;
    float od = uDensity * t * exp(-bo) * seg;

    // rolling volume fake: one tap warps the other, anchored in world XZ
    vec2 w = texture2D(uNoise, wp.xz * 0.004 + uDrift).rg - 0.5;
    float n = texture2D(uNoise, wp.xz * 0.012 - uDrift * 1.7 + w * 0.35).b;
    od *= 0.62 + 0.55 * n;

    float f = min(uCap, 1.0 - exp(-od));

    // bass inner illumination — attenuated inside the aim tunnel only
    vec2 pc = uv - 0.5;
    pc.x *= aspect;
    float edge = smoothstep(uCenterClear, uCenterClear + 0.3, length(pc));
    vec3 col = mix(inputColor.rgb, uFogColor, f);
    col += uGlowColor * (f * f) * uGlow * mix(0.55, 1.0, edge);
    outputColor = vec4(col, inputColor.a);
  }
`

export class FogVolumeEffect extends Effect {
  constructor(noiseTex: Texture) {
    super('FogVolumeEffect', fragmentShader, {
      blendFunction: BlendFunction.SRC,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ['uNoise', new Uniform(noiseTex)],
        ['uInvProj', new Uniform(new Matrix4())],
        ['uCamWorld', new Uniform(new Matrix4())],
        ['uCamPos', new Uniform(new Vector3())],
        ['uFogColor', new Uniform(new Color(0.06, 0.08, 0.06))],
        ['uGlowColor', new Uniform(new Color(1, 0.42, 0.18))],
        ['uDensity', new Uniform(0)],
        ['uGlow', new Uniform(0)],
        ['uHeightY', new Uniform(-28)],
        ['uFalloff', new Uniform(0.045)],
        ['uCap', new Uniform(0.82)],
        ['uCenterClear', new Uniform(0.28)],
        ['uDrift', new Uniform(new Vector2())],
      ]),
    })
  }

  /** Copy the camera's frame state (call after updateMatrixWorld). */
  setCamera(camera: PerspectiveCamera): void {
    ;(this.uniforms.get('uInvProj')!.value as Matrix4).copy(camera.projectionMatrixInverse)
    ;(this.uniforms.get('uCamWorld')!.value as Matrix4).copy(camera.matrixWorld)
    ;(this.uniforms.get('uCamPos')!.value as Vector3).setFromMatrixPosition(camera.matrixWorld)
  }

  setParams(density: number, glow: number, centerClear: number): void {
    this.uniforms.get('uDensity')!.value = density
    this.uniforms.get('uGlow')!.value = glow
    this.uniforms.get('uCenterClear')!.value = centerClear
  }

  setColors(fog: Color, glow: Color): void {
    ;(this.uniforms.get('uFogColor')!.value as Color).copy(fog)
    ;(this.uniforms.get('uGlowColor')!.value as Color).copy(glow)
  }

  /** CPU-accumulated scroll (no shader-time precision drift; rm halves it). */
  advanceDrift(dt: number): void {
    const d = this.uniforms.get('uDrift')!.value as Vector2
    d.x += dt * 0.006
    d.y -= dt * 0.0042
  }
}
