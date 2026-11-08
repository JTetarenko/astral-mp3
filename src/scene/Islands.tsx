import { useFrame, useLoader } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  DynamicDrawUsage,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  RepeatWrapping,
  TextureLoader,
  Vector2,
  type InstancedMesh,
  type Texture,
} from 'three'
import { Color } from 'three'
import { audioFrame } from '../audio/reactiveBus'
import { VARIANT_STYLES } from '../game/islandVariants'
import { WORLD, worldState } from '../game/worldState'
import { makeIslandGeometry } from './islandGeometry'
import { applyIslandShader } from './islandShader'
import { surfaceForDepth, VEIN_TEXTURES } from './realmSurface'
import { snapController } from './snapController'
import { combatWavePush, dropWavePush, smoothstep, T, visuals } from './visualTuning'
import type { Palette } from '../theme/palettes'
import type { IslandSpec } from '../types'

// DebrisRing imports the recipe from here — keep the re-export stable.
export { makeIslandGeometry } from './islandGeometry'

/** Island vertical position — shared with CrystalShards/DebrisRing so
 * everything riding an island stays welded to its bob by construction. */
export function islandY(spec: IslandSpec, t: number, bass: number, liftGain: number): number {
  return (
    spec.y +
    Math.sin(t * spec.bobSpeed * 2 + spec.bobPhase) * spec.bobAmp * T(0.75, 1.0, 1.15, 1.0) +
    bass * 0.6 * spec.bassGain * liftGain
  )
}

/** Grow-in ease for a freshly streamed island (hides pop-in at the fog line). */
export function islandGrowScale(bornAt: number, t: number): number {
  return smoothstep(0, 0.5, t - bornAt)
}

const dummy = new Object3D()
const tmpHeat = new Color()
const white = new Color('#ffffff')
const hiddenMatrix = new Matrix4().makeScale(1e-4, 1e-4, 1e-4)

/**
 * Endless terrain: four fixed-capacity InstancedMeshes rendering the
 * worldState island slot pool. Free slots collapse to a hidden matrix; fresh
 * slots grow in over 0.5s ("the realm crystallizing").
 */
export function Islands({ palette }: { palette: Palette }) {
  const meshRefs = useRef<(InstancedMesh | null)[]>(new Array(WORLD.VARIANTS).fill(null))
  const heatWas = useRef(false)
  const [rockNormal, rockAlbedo, ...veinTexList] = useLoader(TextureLoader, [
    '/assets/rock_normal.png',
    '/assets/rock_albedo.png',
    ...VEIN_TEXTURES.map(n => `/assets/${n}.png`),
  ])
  const veinByName = useMemo(() => {
    const map = new Map<string, Texture>()
    VEIN_TEXTURES.forEach((n, i) => {
      veinTexList[i].wrapS = veinTexList[i].wrapT = RepeatWrapping
      map.set(n, veinTexList[i])
    })
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...veinTexList])
  const surfRef = useRef(surfaceForDepth(0))
  const heatColor = useMemo(() => new Color(palette.primary).multiplyScalar(1.3), [palette])

  const geometries = useMemo(
    () =>
      Array.from({ length: WORLD.VARIANTS }, (_, i) =>
        makeIslandGeometry(1000 + i, 2, VARIANT_STYLES[i & 3]),
      ),
    [],
  )
  const material = useMemo(() => {
    rockNormal.wrapS = rockNormal.wrapT = RepeatWrapping
    rockNormal.repeat.set(2, 2)
    // albedo co-registered with the normal map (same repeat, same baked
    // height field) so cavity darkening lands in the recesses
    rockAlbedo.wrapS = rockAlbedo.wrapT = RepeatWrapping
    rockAlbedo.repeat.set(2, 2)
    return new MeshStandardMaterial({
      flatShading: true,
      roughness: 0.9,
      metalness: 0.05,
      vertexColors: true,
      map: rockAlbedo,
      normalMap: rockNormal,
      normalScale: new Vector2(0.7, 0.7),
    })
  }, [rockNormal, rockAlbedo])
  const warp = useMemo(() => {
    return applyIslandShader(material, veinByName.get('rune_emissive')!)
  }, [material, veinByName])

  // Realm swap = texture-pointer + color/uniform writes only, no material or
  // program rebuild. By effect time worldState.depth is already committed
  // (performSwap sets it before onDepthChange), so surfaceForDepth here is
  // the incoming realm — including ?depth= boots.
  useEffect(() => {
    const surf = surfaceForDepth(worldState.depth)
    surfRef.current = surf
    material.color.set(palette.islandBase)
    // HDR moss emission — crosses the bloom threshold when veins light up.
    // 1.4 (was 2.4): the old per-material ACES silently crushed this before
    // the composer; with the end-of-chain transform the raw value shows.
    warp.uRuneColor.value.set(palette.rune).multiplyScalar(1.4 * surf.veinGain)
    warp.uRuneTex.value = veinByName.get(surf.veinTex) ?? warp.uRuneTex.value
    warp.uSurfColor.value
      .set(
        surf.surfRole === 'primary'
          ? palette.primary
          : surf.surfRole === 'rune'
            ? palette.rune
            : palette.secondary,
      )
      .lerp(white, surf.surfWhiteMix)
      .multiplyScalar(surf.surfScale)
  }, [palette, material, warp, veinByName])

  useEffect(() => {
    return () => {
      geometries.forEach(g => g.dispose())
      material.dispose()
    }
  }, [geometries, material])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const bass = audioFrame.bass
    const liftGain = visuals.liftGain
    const pulseGain = T(0.5, 0.9, 1.3, 1.6)
    // SHATTER tremble + pre-drop rumble ramp, both through the same rm cap
    const trembleAmp =
      (visuals.w3 + 0.7 * visuals.dropCharge) * (0.4 + 0.6 * bass) * (visuals.rm ? 0.3 : 1)
    const heatNow = visuals.w3 > 0.01 || visuals.barPulse > 0.01
    const sw = snapController.shockwave
    const swAge = t - sw.t0
    const swLive = sw.active && swAge >= 0 && swAge < 1.2
    const swPulse = swLive ? Math.exp(-3 * swAge) * Math.sin(10 * swAge) * sw.strength * 1.5 : 0
    const dropWaveLive = visuals.dropWaveAge < 1.2 && visuals.dropWaveStrength > 0
    const waveCx = snapController.pos.x
    const waveCy = snapController.pos.y
    const waveCz = snapController.pos.z
    // combat shockwave (warden death / nova) — the dropWave's twin slot
    const combatWaveLive = visuals.combatWaveAge < 0.9 && visuals.combatWaveStrength > 0
    const cwX = visuals.combatWaveX
    const cwY = visuals.combatWaveY
    const cwZ = visuals.combatWaveZ
    const slots = worldState.slots

    // trip morph: the rock itself twists and breathes as the trip approaches
    warp.uTripAmp.value = visuals.tripLevel * (visuals.rm ? 0.25 : 1)
    warp.uTripTime.value = t
    // runic bioluminescence: proximity wake + the mid-onset tribal pulse
    warp.uPlayerPos.value.copy(snapController.pos)
    warp.uRuneGlow.value = visuals.runeGlow
    warp.uMidWavePhase.value = visuals.midWavePhase
    warp.uRuneRadius.value = 11 + 2.5 * visuals.breath
    // realm surface params — sparkle rm-capped live (settings can flip mid-run)
    const surf = surfRef.current
    warp.uSurfParams.value.set(surf.up, surf.down, surf.sparkle * (visuals.rm ? 0.4 : 1))

    for (let v = 0; v < WORLD.VARIANTS; v++) {
      const mesh = meshRefs.current[v]
      if (!mesh) continue
      const base = v * WORLD.SLOTS_PER_VARIANT
      for (let j = 0; j < WORLD.SLOTS_PER_VARIANT; j++) {
        const spec = slots[base + j]
        if (!spec.used) {
          mesh.setMatrixAt(j, hiddenMatrix)
          continue
        }
        let ox = 0
        let oy = 0
        let oz = 0
        if (swLive) {
          const dx = spec.x - sw.x
          const dy = spec.y - sw.y
          const dz = spec.z - sw.z
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-3
          const falloff = Math.max(0, 1 - dist / 40)
          if (falloff > 0) {
            const push = swPulse * falloff
            ox = (dx / dist) * push
            oy = (dy / dist) * push
            oz = (dz / dist) * push
          }
        }
        if (trembleAmp > 0.001) {
          // SHATTER tremble: deterministic high-frequency jitter, phase-split per island
          const s = 0.05 * spec.scale * trembleAmp
          ox += Math.sin(t * 31 + spec.bobPhase * 7) * s
          oy += Math.sin(t * 29 + spec.bobPhase * 5) * s
          oz += Math.sin(t * 37 + spec.bobPhase * 3) * s
        }
        if (dropWaveLive) {
          // impact shockwave radiating from the player (drops + realm arrival)
          const dx = spec.x - waveCx
          const dy = spec.y - waveCy
          const dz = spec.z - waveCz
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-3
          const push = dropWavePush(dist)
          if (push > 1e-4) {
            ox += (dx / dist) * push
            oy += (dy / dist) * push
            oz += (dz / dist) * push
          }
        }
        if (combatWaveLive) {
          const dx = spec.x - cwX
          const dy = spec.y - cwY
          const dz = spec.z - cwZ
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-3
          const push = combatWavePush(dist)
          if (push > 1e-4) {
            ox += (dx / dist) * push
            oy += (dy / dist) * push
            oz += (dz / dist) * push
          }
        }
        const y = islandY(spec, t, bass, liftGain)
        // bass slam: heavy kicks shove the island down and it settles back,
        // phase-split per island so the realm doesn't move as one sheet
        const slamDip =
          visuals.bassSlam *
          visuals.bassReact *
          spec.scale *
          0.1 *
          (0.6 + 0.4 * Math.sin(spec.bobPhase * 5)) *
          (visuals.rm ? 0.3 : 1)
        // downbeat bob accent rides on top of the shared lift
        dummy.position.set(
          spec.x + ox,
          y + oy - slamDip + 0.1 * spec.scale * visuals.barPulse,
          spec.z + oz,
        )
        dummy.rotation.set(0, spec.rotY + t * 0.02, 0)
        dummy.scale.setScalar(
          spec.scale * (1 + bass * 0.05 * pulseGain) * islandGrowScale(spec.bornAt, t),
        )
        dummy.updateMatrix()
        mesh.setMatrixAt(j, dummy.matrix)
        if (heatNow) {
          // heat flush toward the primary during SHATTER + downbeat accent
          mesh.setColorAt(
            j,
            tmpHeat
              .copy(white)
              .lerp(heatColor, Math.min(1, 0.35 * visuals.w3 * bass + 0.15 * visuals.barPulse)),
          )
        } else if (heatWas.current) {
          mesh.setColorAt(j, white)
        }
      }
      mesh.instanceMatrix.needsUpdate = true
      if ((heatNow || heatWas.current) && mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true
      }
    }
    heatWas.current = heatNow
  })

  return (
    <>
      {geometries.map((geo, v) => (
        <instancedMesh
          key={v}
          ref={el => {
            meshRefs.current[v] = el
            if (el) el.instanceMatrix.setUsage(DynamicDrawUsage)
          }}
          args={[geo, material, WORLD.SLOTS_PER_VARIANT]}
          frustumCulled={false}
        />
      ))}
    </>
  )
}
