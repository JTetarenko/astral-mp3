import { useFrame, useLoader, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BloomEffect,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing'
import { Color, HalfFloatType, PerspectiveCamera, RepeatWrapping, TextureLoader, Vector2 } from 'three'
import { audioFrame } from '../audio/reactiveBus'
import { snapController } from './snapController'
import { ColorGradeEffect } from './ColorGradeEffect'
import { EchoPass } from './EchoPass'
import { FogVolumeEffect } from './FogVolumeEffect'
import { governor, perfStats, updateGovernor } from './perfGovernor'
import { PsychedelicEffect } from './PsychedelicEffect'
import { forcing, fxSignals, T, visuals } from './visualTuning'
import type { Palette } from '../theme/palettes'

/**
 * Vanilla `postprocessing` chain, driven manually (the @react-three JSX
 * wrapper stays banned — it caused two fatal bugs). Order matters:
 *
 *   RenderPass -> EffectPass(FogVolume) -> EchoPass -> EffectPass(Psychedelic)
 *     -> EffectPass(Bloom+CA+Vignette)
 *
 * Fog first (echo trails smear the already-fogged image, bloom re-lights the
 * murk); echo before the warp keeps trails as crisp geometry echoes; the warp
 * before bloom/vignette means the vignette is never mirrored into kaleidoscope
 * wedges and every mirrored copy re-blooms ("fractal bloom"). PsychedelicEffect
 * is CONVOLUTION-attributed and must own its pass (v6.39 hard-errors
 * otherwise); FogVolume is DEPTH-attributed, which makes the composer create
 * and blit a stable depth target automatically.
 */
export function Effects({ palette }: { palette: Palette }) {
  const gl = useThree(s => s.gl)
  const scene = useThree(s => s.scene)
  const camera = useThree(s => s.camera)
  const size = useThree(s => s.size)
  const setDpr = useThree(s => s.setDpr)
  const noiseTex = useLoader(TextureLoader, '/assets/shimmer_noise.png')
  const fxRef = useRef({ echoClear: fxSignals.echoClear, echoWasEnabled: false })

  const bundle = useMemo(() => {
    noiseTex.wrapS = noiseTex.wrapT = RepeatWrapping
    const composer = new EffectComposer(gl, {
      frameBufferType: HalfFloatType,
      multisampling: 4,
    })
    const bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: 1,
      luminanceSmoothing: 0.2,
      intensity: 0.8,
      radius: 0.75,
    })
    // radialModulation is a shader DEFINE in v6.39 — set it here for life and
    // never toggle at runtime (the setter recompiles the whole pass). Offsets
    // are ~2x the old uniform values because modulation scales the effective
    // shift by <=0.85 at corners and 0 inside the clear center.
    const ca = new ChromaticAberrationEffect({
      offset: new Vector2(0.0012, 0.0012),
      radialModulation: true,
      modulationOffset: 0.56,
    })
    const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.55 })
    const echo = new EchoPass()
    const psyche = new PsychedelicEffect(noiseTex)
    const psychePass = new EffectPass(camera, psyche)
    const fog = new FogVolumeEffect(noiseTex)
    const fogPass = new EffectPass(camera, fog)
    // grade after bloom (threshold input stays stable), before vignette
    // (corners stay neutral black); non-convolution so it merges for free
    const grade = new ColorGradeEffect()
    // The ONE display transform: the Canvas is `flat` (materials write raw
    // scene-linear HDR), so bloom/CA operate scene-referred and this ACES
    // rolloff replaces the old hue-skewed channel clip at the sRGB encode.
    // It sits AFTER bloom+CA (they want HDR input) and BEFORE grade/vignette
    // (ColorGradeEffect is authored display-referred — 0.5-pivot contrast,
    // flat lift; the realm-shift whiteout lift lands post-tone so it still
    // blows out). No mainUv, so it merges into this pass legally beside the
    // CONVOLUTION-attributed CA. Exposure knob: gl.toneMappingExposure.
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })
    composer.addPass(new RenderPass(scene, camera))
    composer.addPass(fogPass)
    composer.addPass(echo)
    composer.addPass(psychePass)
    composer.addPass(new EffectPass(camera, bloom, ca, tone, grade, vignette))
    return { composer, bloom, ca, vignette, echo, psyche, psychePass, grade, fog, fogPass }
  }, [gl, scene, camera, noiseTex])

  useEffect(() => {
    bundle.composer.setSize(size.width, size.height)
  }, [bundle, size])

  // Realm palette swap = fog color writes only — the composer chain must
  // never rebuild mid-run (palette is deliberately NOT a memo dependency).
  useEffect(() => {
    const fogTint = new Color(palette.fog)
    const glowTint = new Color(palette.primary).lerp(new Color(palette.rune), 0.25)
    bundle.fog.setColors(fogTint, glowTint)
  }, [palette, bundle])

  useEffect(() => {
    return () => bundle.composer.dispose()
  }, [bundle])

  useFrame(({ clock }, dt) => {
    const v = visuals

    // adaptive quality: L0 full -> L4 echo off + no MSAA
    const newLevel = updateGovernor(governor, dt * 1000, clock.elapsedTime)
    if (newLevel !== null) {
      const devicePR = typeof window !== 'undefined' ? window.devicePixelRatio : 1
      if (newLevel === 0) setDpr(Math.min(2, devicePR))
      else if (newLevel === 1) setDpr(Math.min(1.5, devicePR))
      else setDpr(Math.min(1.25, devicePR))
      bundle.echo.setResolutionScale(newLevel >= 3 ? 0.5 : 1)
      bundle.composer.multisampling = newLevel >= 4 ? 0 : newLevel >= 3 ? 2 : 4
    }
    perfStats.calls = gl.info.render.calls
    perfStats.dpr = gl.getPixelRatio()

    // Live display-transform exposure (?exposure= / forcing.exposure). three
    // uploads toneMappingExposure to every program that declares it — the
    // ToneMappingEffect's shader does — so this is a plain uniform write.
    gl.toneMappingExposure = forcing.exposure

    // volumetric-feel fog: analytic height fog + bass inner glow. The vi fade
    // and governor ladder arrive pre-applied in v.fogDensity (central law).
    camera.updateMatrixWorld()
    bundle.fog.setCamera(camera as PerspectiveCamera)
    bundle.fog.setParams(0.02 * v.fogDensity, 0.55 * v.fogGlow, v.centerClear)
    bundle.fog.advanceDrift(v.rm ? dt * 0.5 : dt)
    bundle.fogPass.enabled = v.fogDensity > 0.005

    // vi factor anchors "unchanged feel" at the 0.8 slider default; the
    // impact spike rides on top, inside the same clamp. The realm-shift
    // whiteout raises both the term and the ceiling — it must blow out.
    bundle.bloom.intensity = Math.min(
      2.2 + 2.5 * v.shiftFlash,
      (T(0.45, 0.7, 0.95, 1.15) * (0.6 + audioFrame.mids * 1.4 * v.midsReact) +
        0.25 * snapController.fxPulse) *
        (1 + 0.35 * (v.vi - 0.8)) +
        0.35 * v.bassSlam * (0.5 + 0.5 * v.vi) +
        0.6 * v.impactPulse +
        0.5 * v.combatPulse +
        2.2 * v.shiftFlash,
    )
    bundle.bloom.mipmapBlurPass.radius = T(0.6, 0.7, 0.85, 0.95)

    // tunnel-vision aberration: edge-only (radial), the clear hole tracking
    // the psyche aim tunnel (CA's uv distance is aspect-uncorrected, so its
    // hole is WIDER horizontally than centerClear — the safe direction).
    // rm cap 0.005 raw ~= the old uniform 0.0035 at corners, with a
    // guaranteed-clean center — a net accessibility improvement.
    bundle.ca.modulationOffset = 2 * v.centerClear
    let caOff =
      0.0012 * T(0.7, 1.0, 1.4, 1.9) +
      snapController.fxPulse * 0.005 +
      audioFrame.onsetStrength * 0.002 * T(0.5, 1, 1.2, 1.5) +
      v.impactPulse * 0.007 +
      v.combatPulse * 0.006 +
      v.latchBite * 0.003 +
      // subliminal danger cue: aberration climbs with the warden's windup
      v.wardenTelegraph * 0.0045 +
      // HARD/EXTREME signature: heavy kicks split the frame for a moment
      (v.vi >= 0.8 && !v.rm ? v.bassSlam * 0.0022 : 0) +
      0.004 * v.tunnelDepth
    if (v.rm) caOff = Math.min(caOff, 0.005)
    const caUniform = bundle.ca.uniforms.get('offset')?.value as
      | { set?: (x: number, y: number) => void }
      | undefined
    caUniform?.set?.(caOff, caOff)

    // vignette shaping (breath/inhale/tunnelDepth) is centralized in
    // visualTuning; only the shift-whiteout lift is applied here, where the
    // whiteout is orchestrated
    const darkness = bundle.vignette.uniforms.get('darkness')
    if (darkness) darkness.value = v.vignetteDark * (1 - 0.7 * v.shiftFlash)
    const vigOffset = bundle.vignette.uniforms.get('offset')
    if (vigOffset) vigOffset.value = v.vignetteOffset

    // flush afterimage history on run start/replay, and when the echo comes
    // back after an L4 stint (its render targets hold a stale frame)
    if (fxRef.current.echoClear !== fxSignals.echoClear) {
      fxRef.current.echoClear = fxSignals.echoClear
      bundle.echo.clear()
    }
    const echoEnabled = v.echoDamp > 0.05 && governor.level < 4
    if (echoEnabled && !fxRef.current.echoWasEnabled) bundle.echo.clear()
    fxRef.current.echoWasEnabled = echoEnabled
    bundle.echo.damp = v.echoDamp
    bundle.echo.enabled = echoEnabled

    bundle.grade.setParams(
      v.gradeTempR,
      v.gradeTempG,
      v.gradeTempB,
      v.gradeLift + 0.3 * v.shiftFlash, // whiteout lift over the world swap
      v.gradeSat * (1 - 0.5 * v.shiftFlash),
      v.gradeContrast,
      v.gradeGrain,
    )

    // blastProgress < 1 must keep the pass alive even at vi=0 — a drop
    // landing with the stack idle still gets its shockwave
    bundle.psyche.setBlast(v.blastProgress, v.blastAmp)
    const psycheActive =
      Math.abs(v.warpAmp) > 0.002 ||
      v.rippleAmp > 0.002 ||
      v.kaleidoMix > 0.002 ||
      v.hue !== 0 ||
      v.shimmerAmp > 1e-4 ||
      v.satBoost > 1.001 ||
      v.blastProgress < 1
    bundle.psychePass.enabled = psycheActive
    if (psycheActive) {
      bundle.psyche.setParams(
        v.warpAmp,
        v.rippleAmp,
        v.kaleidoMix,
        v.kaleidoN1,
        v.kaleidoN2,
        v.kaleidoNMix,
        v.kaleidoSpin,
        v.hue,
        v.satBoost,
        v.shimmerAmp,
        v.centerClear,
      )
    }

    bundle.composer.render(dt)
  }, 1)

  return null
}
