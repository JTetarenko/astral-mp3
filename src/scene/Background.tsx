import { useFrame, useLoader } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BackSide,
  Color,
  NormalBlending,
  TextureLoader,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
} from 'three'
import { audioFrame } from '../audio/reactiveBus'
import { worldState } from '../game/worldState'
import { governor } from './perfGovernor'
import { skyIdentityForDepth, type SkyIdentity } from './skyIdentity'
import { snapController } from './snapController'
import { T, visuals } from './visualTuning'
import type { Palette } from '../theme/palettes'

/**
 * Murky-void backdrop from the baked equirect assets: a sparse mote sphere
 * plus two counter-rotating mist shells tinted from the palette (the layered
 * drift reads as parallax). The whole sky follows the player's XZ so the
 * horizon is unreachable in the endless world. All sky materials disable fog —
 * the scene fog would otherwise wash them out entirely at this radius; the
 * depth-aware post fog handles their horizon blend instead.
 */
export function Background({ palette }: { palette: Palette }) {
  const [nebulaTex, starsTex, nebulaBTex, canopyTex, cracksTex, vortexTex] = useLoader(
    TextureLoader,
    [
      '/assets/mist.png',
      '/assets/stars.png',
      '/assets/nebula_b.png',
      '/assets/sky_canopy.png',
      '/assets/sky_cracks.png',
      '/assets/sky_vortex.png',
    ],
  )
  const sky = useRef<Group>(null)
  const stars = useRef<Mesh>(null)
  const nebA = useRef<Mesh>(null)
  const nebB = useRef<Mesh>(null)
  const nebAMat = useRef<MeshBasicMaterial>(null)
  const nebBMat = useRef<MeshBasicMaterial>(null)
  const feature = useRef<Mesh>(null)
  const featureMat = useRef<MeshBasicMaterial>(null)
  const lastEpoch = useRef(-1)
  const skyId = useRef<SkyIdentity>(skyIdentityForDepth(0))

  const tintA = useMemo(() => new Color(palette.secondary).multiplyScalar(0.5), [palette])
  const tintB = useMemo(() => new Color(palette.primary).multiplyScalar(0.32), [palette])
  // lighter hand than the old mote tint: the bake carries per-star color
  // temperature now, and a hard palette multiply would crush it
  const starTint = useMemo(
    () => new Color(palette.secondary).lerp(new Color('#ffffff'), 0.5).multiplyScalar(0.5),
    [palette],
  )
  const tmp = useMemo(() => new Color(), [])
  // bass-lit fog: the medium itself is the bass channel (sky stays mids/highs)
  const baseFog = useMemo(() => new Color(palette.fog), [palette])
  const glowFog = useMemo(
    () => new Color(palette.primary).lerp(new Color(palette.fog), 0.35),
    [palette],
  )
  // pre-parsed role colors for the feature tint (never parse hex per frame)
  const roleColors = useMemo(
    () => ({
      primary: new Color(palette.primary),
      secondary: new Color(palette.secondary),
      rune: new Color(palette.rune),
      fog: new Color(palette.fog),
    }),
    [palette],
  )

  useFrame((state, dt) => {
    // the sky chases the player: infinite horizon, zero parallax
    if (sky.current) {
      sky.current.position.set(snapController.pos.x, 0, snapController.pos.z)
    }
    // Epoch guard: the feature shell swaps identity under the whiteout —
    // texture-pointer / blending-state / tilt writes only (map is never null,
    // so USE_MAP never flips and the program survives).
    if (lastEpoch.current !== worldState.epoch) {
      lastEpoch.current = worldState.epoch
      const id = skyIdentityForDepth(worldState.depth)
      skyId.current = id
      const fm = featureMat.current
      const f = feature.current
      if (fm && f) {
        if (id.feature) {
          fm.map =
            id.feature === 'sky_canopy' ? canopyTex : id.feature === 'sky_cracks' ? cracksTex : vortexTex
          fm.blending = id.blend === 'normal' ? NormalBlending : AdditiveBlending
          fm.opacity = id.opacity
        }
        f.rotation.set(id.tilt[0], f.rotation.y, id.tilt[1])
      }
    }
    // tier-driven spin x realm mood (reduced-motion caps the whirl) + SHATTER roll
    let spin = T(0.6, 1.0, 1.6, 2.4) * worldState.modsCur.skySpinMult
    if (visuals.rm) spin = Math.min(spin, 1.2)
    if (stars.current) stars.current.rotation.y += dt * 0.0015 * spin
    if (nebA.current) {
      nebA.current.rotation.y += dt * 0.004 * spin
      if (!visuals.rm) nebA.current.rotation.z += dt * 0.012 * visuals.w3
      nebA.current.scale.setScalar(1 + 0.012 * visuals.breath * T(0, 0.5, 1, 1.3))
    }
    if (nebB.current) {
      nebB.current.rotation.y -= dt * 0.006 * spin
      if (!visuals.rm) nebB.current.rotation.z -= dt * 0.009 * visuals.w3
      nebB.current.scale.setScalar(1 + 0.012 * visuals.breath * T(0, 0.5, 1, 1.3))
    }
    // tier gain × mids breathing, plus the drop-impact sky flash; hats kick
    // the star tint. Realm gain trims + arrival bloom ride the same writes.
    const id = skyId.current
    const arrival = 1 + 0.8 * visuals.arrivalPulse
    const swell =
      T(0.55, 0.85, 1.25, 1.5) *
      (1 + audioFrame.mids * 0.25 * visuals.midsReact) *
      (1 + 1.2 * visuals.skyFlash) *
      arrival
    if (nebAMat.current) {
      nebAMat.current.color.copy(tmp.copy(tintA).multiplyScalar(swell * id.mistGain))
    }
    if (nebBMat.current) {
      nebBMat.current.color.copy(tmp.copy(tintB).multiplyScalar(swell * id.nebBGain))
    }
    const starsMat = stars.current?.material as MeshBasicMaterial | undefined
    if (starsMat) {
      const starGain =
        (1 + 0.5 * visuals.skyFlash) *
        (1 + 0.2 * audioFrame.highOnsetStrength * visuals.highsReact)
      starsMat.color.copy(tmp.copy(starTint).multiplyScalar(starGain * id.starGain))
    }
    // feature shell: per-realm celestial signature (canopy / cracks / vortex)
    const f = feature.current
    const fm = featureMat.current
    if (f && fm) {
      f.visible = id.feature !== null && governor.level < 3
      if (f.visible) {
        f.rotation.y += dt * 0.004 * spin * id.featureSpin
        let band = 0
        if (id.audioBand === 'bass') band = audioFrame.bass * visuals.bassReact
        else if (id.audioBand === 'mids') band = audioFrame.mids * visuals.midsReact
        else if (id.audioBand === 'highs') {
          band = audioFrame.highOnsetStrength * visuals.highsReact * (visuals.rm ? 0.3 : 1)
        }
        fm.color
          .copy(roleColors[id.tintRole])
          .multiplyScalar(
            id.tintScale * (1 + id.audioGain * band) * (1 + 0.8 * visuals.skyFlash) * arrival,
          )
      }
    }
    // fog distances are realm-tuned in visualTuning (tier x realm x flash);
    // the color lerp is the bass-lit "illuminated from within" pulse
    const fog = state.scene.fog as { near: number; far: number; color: Color } | null
    if (fog) {
      fog.near = visuals.fogNear
      fog.far = visuals.fogFar
      fog.color.copy(baseFog).lerp(glowFog, 0.45 * visuals.fogGlow)
    }
  })

  return (
    <>
      <color attach="background" args={[palette.voidBottom]} />
      <fog attach="fog" args={[palette.fog, 40, 220]} />
      <group ref={sky}>
        <mesh ref={stars}>
          <sphereGeometry args={[430, 48, 24]} />
          <meshBasicMaterial
            map={starsTex}
            color={starTint}
            side={BackSide}
            blending={AdditiveBlending}
            depthWrite={false}
            fog={false}
            toneMapped={false}
          />
        </mesh>
        <mesh ref={nebA} rotation={[0.3, 0, 0.1]}>
          <sphereGeometry args={[410, 48, 24]} />
          <meshBasicMaterial
            ref={nebAMat}
            map={nebulaTex}
            color={tintA}
            side={BackSide}
            blending={AdditiveBlending}
            transparent
            depthWrite={false}
            fog={false}
            toneMapped={false}
          />
        </mesh>
        <mesh ref={nebB} rotation={[-0.4, Math.PI, -0.15]}>
          <sphereGeometry args={[390, 48, 24]} />
          <meshBasicMaterial
            ref={nebBMat}
            map={nebulaBTex}
            color={tintB}
            side={BackSide}
            blending={AdditiveBlending}
            transparent
            depthWrite={false}
            fog={false}
            toneMapped={false}
          />
        </mesh>
        {/* per-realm feature shell — renderOrder 1 so the canopy's NORMAL
            blend darkens the additive shells behind it (their shared sort
            position is otherwise order-unstable); map inits real and only
            ever swaps tex->tex */}
        <mesh ref={feature} renderOrder={1} visible={false}>
          <sphereGeometry args={[384, 48, 24]} />
          <meshBasicMaterial
            ref={featureMat}
            map={vortexTex}
            side={BackSide}
            blending={AdditiveBlending}
            transparent
            depthWrite={false}
            fog={false}
            toneMapped={false}
          />
        </mesh>
      </group>
    </>
  )
}
