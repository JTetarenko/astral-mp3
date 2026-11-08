import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Color, Group, MeshBasicMaterial, type Mesh } from 'three'
import { worldState } from '../game/worldState'
import { soupToGeometry } from './AvatarWings'
import {
  buildLandmarkOrbit,
  LANDMARK_CORE_BUILDERS,
  LANDMARK_PARALLAX,
  LANDMARK_PARALLAX_CAP,
  LANDMARK_VISUALS,
  landmarkPlacement,
} from './landmarkGeom'
import { governor } from './perfGovernor'
import { snapController } from './snapController'
import { applySpireVein } from './spireShader'
import { smoothstep, visuals } from './visualTuning'
import type { Palette } from '../theme/palettes'

const CORE_SEED = 0x1a7d01
const bodyColor = new Color()
const veinScratch = new Color()

/**
 * The realm's far hero — one colossal fog-shrouded silhouette per realm
 * (seated colossus, world-tree, cathedral facade, obelisk, shattered planet,
 * caldera), swapped at the epoch guard under the whiteout. The group welds to
 * the player's XZ (Background law: the horizon is unreachable) with a small
 * CLAMPED counter-parallax so the mountain visibly lags the player instead of
 * reading painted-on. Two draws max; orbit hides at governor L3.
 */
export function RealmLandmark({ palette }: { palette: Palette }) {
  const group = useRef<Group>(null)
  const core = useRef<Mesh>(null)
  const orbit = useRef<Mesh>(null)
  const state = useRef({
    lastEpoch: -1,
    realmIdx: 0,
    anchorX: 0,
    anchorZ: 0,
    swapAt: -999,
    coreScale: 1,
    orbitSpin: 0,
  })

  const coreGeos = useMemo(
    () => LANDMARK_CORE_BUILDERS.map(b => soupToGeometry(b(CORE_SEED), true)),
    [],
  )
  const orbitGeos = useMemo(
    () =>
      LANDMARK_VISUALS.map((_, i) => {
        const soup = buildLandmarkOrbit(i, CORE_SEED ^ 0x0b17)
        return soup ? soupToGeometry(soup, true) : null
      }),
    [],
  )
  const coreVein = useMemo(() => new Color(0, 0, 0), [])
  const orbitVein = useMemo(() => new Color(0, 0, 0), [])
  const coreMaterial = useMemo(() => {
    const m = new MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false })
    applySpireVein(m, coreVein)
    return m
  }, [coreVein])
  const orbitMaterial = useMemo(() => {
    const m = new MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false })
    applySpireVein(m, orbitVein)
    return m
  }, [orbitVein])

  useEffect(() => {
    return () => {
      for (const g of coreGeos) g.dispose()
      for (const g of orbitGeos) g?.dispose()
      coreMaterial.dispose()
      orbitMaterial.dispose()
    }
  }, [coreGeos, orbitGeos, coreMaterial, orbitMaterial])

  useFrame(({ clock }, dt) => {
    const g = group.current
    const c = core.current
    const o = orbit.current
    if (!g || !c || !o) return
    const st = state.current
    const t = clock.elapsedTime

    // Epoch guard: swap identity + placement under the whiteout.
    if (st.lastEpoch !== worldState.epoch) {
      st.lastEpoch = worldState.epoch
      st.realmIdx = ((worldState.depth % 6) + 6) % 6
      const spec = LANDMARK_VISUALS[st.realmIdx]
      const place = landmarkPlacement(worldState.trackSeed, worldState.depth)
      c.geometry = coreGeos[st.realmIdx]
      const og = orbitGeos[st.realmIdx]
      if (og) o.geometry = og
      const h = spec.height * place.scaleJitter
      st.coreScale = h
      const lx = Math.sin(place.azimuth) * place.dist
      const lz = Math.cos(place.azimuth) * place.dist
      c.position.set(lx, spec.baseY, lz)
      // face the play space so facade/colossus fronts read
      c.rotation.set(0, place.azimuth + Math.PI, 0)
      if (spec.orbit) {
        const R = spec.orbit.radiusFrac * h
        o.position.set(lx, spec.baseY + spec.orbit.yFrac * h - 0.5 * R, lz)
        o.rotation.set(0, 0, spec.orbit.tilt)
        o.scale.setScalar(Math.max(1e-4, R))
      }
      st.anchorX = snapController.pos.x
      st.anchorZ = snapController.pos.z
      st.swapAt = t
      st.orbitSpin = 0
    }
    const spec = LANDMARK_VISUALS[st.realmIdx]

    // Follow + clamped counter-parallax: the mountain lags the player.
    let offX = (st.anchorX - snapController.pos.x) * LANDMARK_PARALLAX
    let offZ = (st.anchorZ - snapController.pos.z) * LANDMARK_PARALLAX
    const len = Math.hypot(offX, offZ)
    if (len > LANDMARK_PARALLAX_CAP) {
      offX *= LANDMARK_PARALLAX_CAP / len
      offZ *= LANDMARK_PARALLAX_CAP / len
    }
    g.position.set(snapController.pos.x + offX, 0, snapController.pos.z + offZ)

    // Grow-in as the whiteout decays (one-shot ease, kept under rm).
    const grow = smoothstep(0, 1, Math.min(1, Math.max(0, (t - st.swapAt - 0.15) / 0.95)))
    c.scale.setScalar(Math.max(1e-4, st.coreScale * (0.9 + 0.1 * grow)))

    // Slow motion — frozen under rm and governor pressure.
    const frozen = visuals.rm || governor.level >= 3
    if (!frozen) {
      c.rotation.y += spec.spinRate * dt
      if (spec.orbit) st.orbitSpin += spec.orbit.rate * dt
    }
    o.visible = !!spec.orbit && governor.level < 3
    if (o.visible) o.rotation.y = st.orbitSpin

    // Music-driven glow through the spec's pulse signal (flattened under rm).
    let pulse: number
    if (visuals.rm) {
      pulse = 0.65
    } else {
      switch (spec.pulse) {
        case 'breath':
          pulse = 0.6 + 0.4 * Math.max(0, visuals.breath)
          break
        case 'bar':
          pulse = 0.5 + 0.5 * visuals.barPulse
          break
        case 'bass':
          pulse = 0.5 + 0.6 * visuals.fogGlow
          break
        case 'onset':
          pulse = 0.5 + 0.5 * Math.min(1, visuals.runeGlow)
          break
        case 'shatter':
          pulse = 0.45 + 0.55 * Math.min(1, visuals.w3 + visuals.impactPulse)
          break
      }
    }
    const glow = visuals.landmarkGlow * (0.75 + 0.25 * grow)
    const veinSrc =
      spec.veinSource === 'primary'
        ? palette.primary
        : spec.veinSource === 'rune'
          ? palette.rune
          : palette.secondary
    veinScratch.set(veinSrc).multiplyScalar(spec.veinGainBase * glow * pulse)
    coreVein.copy(veinScratch)
    orbitVein.copy(veinScratch)
    bodyColor.set(palette.islandBase).multiplyScalar(0.6 + 0.5 * glow)
    coreMaterial.color.copy(bodyColor)
    orbitMaterial.color.copy(bodyColor)
  })

  return (
    <group ref={group}>
      <mesh ref={core} geometry={coreGeos[0]} material={coreMaterial} frustumCulled={false} />
      <mesh
        ref={orbit}
        geometry={orbitGeos[0] ?? coreGeos[0]}
        material={orbitMaterial}
        frustumCulled={false}
        visible={false}
      />
    </group>
  )
}
