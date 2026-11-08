import { useFrame, useLoader } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  MeshBasicMaterial,
  Object3D,
  TextureLoader,
  type Group,
  type InstancedMesh,
} from 'three'
import { audioFrame } from '../audio/reactiveBus'
import { worldState } from '../game/worldState'
import { snapController } from './snapController'
import { smoothstep, T, visuals } from './visualTuning'
import type { Palette } from '../theme/palettes'

const SHAFTS = 8 // central beam + nested inner + 6 tilted ring shafts

const dummy = new Object3D()
const tmpColor = new Color()

/** Fake-volumetric light shafts rising from the REALM GATE — the beacon that
 * reads across the endless realm once the shift charge completes. World-space
 * cones (not billboards) so parallax stays honest when flying past; the
 * camera-inside-the-central-beam wash is faded out by distance-to-axis. */
export function GodrayShafts({ palette }: { palette: Palette }) {
  const group = useRef<Group>(null)
  const mesh = useRef<InstancedMesh>(null)
  const beamTex = useLoader(TextureLoader, '/assets/beam.png')

  const geometry = useMemo(() => {
    const geo = new CylinderGeometry(0.5, 2.6, 1, 14, 1, true)
    geo.translate(0, 0.5, 0) // base at origin; instance Y-scale = shaft length
    return geo
  }, [])
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        map: beamTex,
        color: new Color(palette.secondary).multiplyScalar(1.6),
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        fog: false,
        toneMapped: false,
      }),
    [beamTex, palette],
  )

  useEffect(() => {
    return () => {
      geometry.dispose()
      material.dispose()
    }
  }, [geometry, material])

  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    // 0: central up-beam, 1: nested inner core
    dummy.rotation.set(0, 0, 0)
    dummy.position.set(0, 0, 0)
    dummy.scale.set(2.2, 55, 2.2)
    dummy.updateMatrix()
    m.setMatrixAt(0, dummy.matrix)
    dummy.scale.set(1.1, 55, 1.1)
    dummy.updateMatrix()
    m.setMatrixAt(1, dummy.matrix)
    // 2..7: ring shafts tilted 38 degrees outward at 60-degree steps
    for (let k = 0; k < 6; k++) {
      dummy.rotation.order = 'YXZ'
      dummy.rotation.set((38 * Math.PI) / 180, (k * Math.PI) / 3, 0)
      dummy.position.set(0, 0, 0)
      dummy.scale.set(1, 32, 1)
      dummy.updateMatrix()
      m.setMatrixAt(k + 2, dummy.matrix)
    }
    m.instanceMatrix.needsUpdate = true
    for (let i = 0; i < SHAFTS; i++) m.setColorAt(i, tmpColor.setScalar(0))
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [])

  const prevCharge = useRef(0)

  useFrame((_, dt) => {
    const m = mesh.current
    const g = group.current
    if (!m || !g) return
    const worldGate = worldState.gate
    // Beacon floor: an open gate always glows at least faintly, PEAK amplifies.
    const gate = worldGate.active
      ? Math.max(visuals.godrayGate, 0.35) * worldGate.openT
      : 0
    m.visible = gate > 0.01
    if (!m.visible) return
    g.position.set(worldGate.x, worldGate.y, worldGate.z)
    g.rotation.y += dt * 0.03 * T(0.5, 0.8, 1, 1.4)
    // pre-drop focus: shafts narrow and intensify as the charge builds
    const charge = visuals.dropCharge
    if (charge > 0.001 || prevCharge.current > 0.001) {
      const k = 1 - 0.3 * charge
      dummy.rotation.set(0, 0, 0)
      dummy.position.set(0, 0, 0)
      dummy.scale.set(2.2 * k, 55, 2.2 * k)
      dummy.updateMatrix()
      m.setMatrixAt(0, dummy.matrix)
      dummy.scale.set(1.1 * k, 55, 1.1 * k)
      dummy.updateMatrix()
      m.setMatrixAt(1, dummy.matrix)
      for (let j = 0; j < 6; j++) {
        dummy.rotation.order = 'YXZ'
        dummy.rotation.set(((38 - 10 * charge) * Math.PI) / 180, (j * Math.PI) / 3, 0)
        dummy.scale.set(k, 32, k)
        dummy.updateMatrix()
        m.setMatrixAt(j + 2, dummy.matrix)
      }
      m.instanceMatrix.needsUpdate = true
    }
    prevCharge.current = charge
    // gate-open beacon: the shafts IGNITE skyward on the open pulse (and
    // re-fire when the gate relocates — openedAt refresh re-arms the pulse),
    // so a player looking away still catches the column in the corner of
    // the eye when they turn
    const beacon = visuals.gateOpenPulse
    g.scale.y = 1 + 0.6 * beacon
    const base =
      gate *
      (0.35 + 0.65 * audioFrame.mids * visuals.midsReact) *
      (1 + 0.35 * Math.min(1.5, audioFrame.onsetStrength * visuals.onsetReact)) *
      (1 + 0.8 * charge) *
      (1 + 0.25 * visuals.beatPulse) *
      (1 + 2.2 * beacon)
    // fade the central beams when the camera flies into them
    const distToAxis = Math.hypot(
      snapController.pos.x - worldGate.x,
      snapController.pos.z - worldGate.z,
    )
    const centralFade = smoothstep(1.5, 4.0, distToAxis)
    for (let i = 0; i < SHAFTS; i++) {
      const b = i <= 1 ? base * centralFade * (i === 1 ? 1.5 : 1) : base * 0.8
      m.setColorAt(i, tmpColor.setScalar(b * 0.18))
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  })

  return (
    <group ref={group}>
      <instancedMesh ref={mesh} args={[geometry, material, SHAFTS]} frustumCulled={false} visible={false} />
    </group>
  )
}
