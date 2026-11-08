import { BlendFunction, Effect } from 'postprocessing'
import { Uniform, Vector3 } from 'three'

/**
 * Per-tier cinematic grade: temperature tint, black lift, saturation,
 * contrast, and SHATTER-only grain. Non-convolution (single tap), so it merges
 * into the final EffectPass alongside bloom/CA/vignette for free. It sits
 * AFTER bloom (threshold input stays stable) and BEFORE vignette (corners stay
 * neutral black). All values arrive pre-mixed/capped from visualTuning.
 */
const fragmentShader = /* glsl */ `
  uniform vec3 uTemp;
  uniform float uLift;
  uniform float uSatG;
  uniform float uContrast;
  uniform float uGrain;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 c = inputColor.rgb * uTemp + vec3(uLift);
    float luma = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(luma), c, uSatG);
    c = (c - 0.5) * uContrast + 0.5;
    if (uGrain > 0.0) {
      float g = fract(sin(dot(uv * resolution + vec2(fract(time) * 61.7, fract(time) * 83.3), vec2(12.9898, 78.233))) * 43758.5453);
      c += (g - 0.5) * uGrain;
    }
    outputColor = vec4(c, inputColor.a);
  }
`

export class ColorGradeEffect extends Effect {
  constructor() {
    super('ColorGradeEffect', fragmentShader, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, Uniform>([
        ['uTemp', new Uniform(new Vector3(1, 1, 1))],
        ['uLift', new Uniform(0)],
        ['uSatG', new Uniform(1)],
        ['uContrast', new Uniform(1)],
        ['uGrain', new Uniform(0)],
      ]),
    })
  }

  setParams(
    tempR: number,
    tempG: number,
    tempB: number,
    lift: number,
    sat: number,
    contrast: number,
    grain: number,
  ): void {
    ;(this.uniforms.get('uTemp')!.value as Vector3).set(tempR, tempG, tempB)
    this.uniforms.get('uLift')!.value = lift
    this.uniforms.get('uSatG')!.value = sat
    this.uniforms.get('uContrast')!.value = contrast
    this.uniforms.get('uGrain')!.value = grain
  }
}
