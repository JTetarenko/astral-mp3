import { CopyMaterial, Pass } from 'postprocessing'
import {
  HalfFloatType,
  LinearFilter,
  ShaderMaterial,
  Uniform,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three'

const BLEND_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`

// max(), not mix/add: strictly decay-only, so the HDR additive scene can never
// positive-feedback to white and the current frame is never dimmed.
const BLEND_FRAG = /* glsl */ `
uniform sampler2D tCur;
uniform sampler2D tHist;
uniform float uDamp;
varying vec2 vUv;
void main() {
  vec4 cur = texture2D(tCur, vUv);
  vec4 hist = texture2D(tHist, vUv) * uDamp;
  gl_FragColor = max(cur, hist);
}
`

/**
 * Afterimage/persistence tracers (postprocessing v6 has no built-in): ping-pong
 * HalfFloat targets so >1.0 HDR trail values keep blooming as they fade — that
 * IS the psychedelic smear. Costs nothing when disabled (damp ~ 0 at CALM).
 */
export class EchoPass extends Pass {
  damp = 0
  resolutionScale = 1

  private rtRead: WebGLRenderTarget
  private rtWrite: WebGLRenderTarget
  private blendMaterial: ShaderMaterial
  private copyMaterial: CopyMaterial
  private historyValid = false
  private width = 1
  private height = 1

  constructor() {
    super('EchoPass')
    this.needsSwap = true
    const opts = {
      type: HalfFloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    }
    this.rtRead = new WebGLRenderTarget(1, 1, opts)
    this.rtWrite = new WebGLRenderTarget(1, 1, opts)
    this.blendMaterial = new ShaderMaterial({
      vertexShader: BLEND_VERT,
      fragmentShader: BLEND_FRAG,
      uniforms: {
        tCur: new Uniform(null),
        tHist: new Uniform(null),
        uDamp: new Uniform(0),
      },
      depthTest: false,
      depthWrite: false,
    })
    this.copyMaterial = new CopyMaterial()
  }

  /** Forget all history (run start, resize, level changes). */
  clear(): void {
    this.historyValid = false
  }

  setResolutionScale(scale: number): void {
    if (scale === this.resolutionScale) return
    this.resolutionScale = scale
    this.setSize(this.width, this.height)
  }

  override setSize(width: number, height: number): void {
    this.width = width
    this.height = height
    const w = Math.max(1, Math.round(width * this.resolutionScale))
    const h = Math.max(1, Math.round(height * this.resolutionScale))
    this.rtRead.setSize(w, h)
    this.rtWrite.setSize(w, h)
    this.historyValid = false
  }

  override render(
    renderer: WebGLRenderer,
    inputBuffer: WebGLRenderTarget,
    outputBuffer: WebGLRenderTarget,
  ): void {
    const blend = this.blendMaterial
    blend.uniforms.tCur.value = inputBuffer.texture
    blend.uniforms.tHist.value = this.rtRead.texture
    blend.uniforms.uDamp.value = this.historyValid ? this.damp : 0
    this.historyValid = true

    this.fullscreenMaterial = blend
    renderer.setRenderTarget(this.rtWrite)
    renderer.render(this.scene, this.camera)

    const copyUniforms = (this.copyMaterial as unknown as ShaderMaterial).uniforms
    copyUniforms.inputBuffer.value = this.rtWrite.texture
    this.fullscreenMaterial = this.copyMaterial
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer)
    renderer.render(this.scene, this.camera)

    const tmp = this.rtRead
    this.rtRead = this.rtWrite
    this.rtWrite = tmp
  }

  override dispose(): void {
    this.rtRead.dispose()
    this.rtWrite.dispose()
    this.blendMaterial.dispose()
    this.copyMaterial.dispose()
    super.dispose()
  }
}
