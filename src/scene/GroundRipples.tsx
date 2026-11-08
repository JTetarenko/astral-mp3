import { useFrame, useLoader } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  TextureLoader,
  type InstancedMesh,
} from 'three'
import { audioFrame } from '../audio/reactiveBus'
import { WORLD, worldState } from '../game/worldState'
import { variantTop } from '../game/islandVariants'
import { islandY } from './Islands'
import { governor } from './perfGovernor'
import { visuals } from './visualTuning'
import type { Palette } from '../theme/palettes'

/**
 * Kick-drum ground rings: strong bass onsets during PEAK/SHATTER spawn an
 * expanding glow ring flat on a large island's top. One instanced draw call,
 * 8 slots; pool shrinks with the perf governor. Ripples store (slot, serial)
 * and die instantly if their island streams out mid-ring.
 */
const SLOTS = 8
const RIPPLE_DUR = 0.7
/** The baked annulus peaks at r=0.72 of the sheet half-extent — the quad is
 * oversized so the visible ring lands at radius 1, keeping the old torus
 * scale math (and the ripple sweep) unchanged. */
const RING_TEX_R = 0.72

const dummy = new Object3D()
const tmpColor = new Color()

export function GroundRipples({ palette }: { palette: Palette }) {
  const mesh = useRef<InstancedMesh>(null)
  const ringTex = useLoader(TextureLoader, '/assets/ring_soft.png')
  const lastSlotVersion = useRef(-1)
  const eligible = useMemo<number[]>(() => [], [])
  const slots = useMemo(
    () => ({
      island: new Int32Array(SLOTS).fill(-1),
      serial: new Int32Array(SLOTS),
      age: new Float32Array(SLOTS),
      cursor: 0,
      lastSpawn: -999,
    }),
    [],
  )
  const geometry = useMemo(() => {
    // textured quad replaces the 384-tri torus: soft organic annulus + wake
    const side = 2 / RING_TEX_R
    const g = new PlaneGeometry(side, side)
    g.rotateX(-Math.PI / 2) // lie flat in XZ
    return g
  }, [])
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        map: ringTex,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        side: DoubleSide,
      }),
    [ringTex],
  )
  useEffect(() => {
    material.color.set(palette.primary).multiplyScalar(1.6)
  }, [palette, material])
  useEffect(() => {
    return () => {
      geometry.dispose()
      material.dispose()
    }
  }, [geometry, material])

  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    for (let i = 0; i < SLOTS; i++) {
      dummy.position.set(0, -999, 0)
      dummy.scale.setScalar(1e-4)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
      m.setColorAt(i, tmpColor.setScalar(0))
    }
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [])

  useFrame(({ clock }, frameDt) => {
    const m = mesh.current
    if (!m) return
    if (lastSlotVersion.current !== worldState.slotVersion) {
      lastSlotVersion.current = worldState.slotVersion
      eligible.length = 0
      const ws = worldState.slots
      for (let i = 0; i < WORLD.TOTAL_SLOTS; i++) {
        if (ws[i].used && ws[i].scale >= 3) eligible.push(i)
      }
    }
    if (eligible.length === 0) return
    const t = clock.elapsedTime
    const dt = Math.min(0.1, frameDt)
    const poolLimit = governor.level >= 3 ? 0 : governor.level === 2 ? 4 : SLOTS

    // kick threshold relaxes as the immersion dial climbs — at HARD/EXTREME
    // the realm answers every solid kick with a shockwave ring
    const slamThresh = 0.9 - 0.3 * Math.max(0, visuals.vi - 0.8) / 0.2
    if (
      poolLimit > 0 &&
      audioFrame.onset &&
      audioFrame.onsetStrength >= slamThresh &&
      visuals.onsetRippleGain > 0.01 &&
      visuals.w2 + visuals.w3 > 0.6 &&
      t - slots.lastSpawn >= 0.25
    ) {
      slots.lastSpawn = t
      slots.cursor = (slots.cursor + 1) % poolLimit
      const slotIdx = eligible[Math.floor(Math.random() * eligible.length)]
      slots.island[slots.cursor] = slotIdx
      slots.serial[slots.cursor] = worldState.slots[slotIdx].serial
      slots.age[slots.cursor] = 0
    }

    let any = false
    for (let s = 0; s < SLOTS; s++) {
      const idx = slots.island[s]
      if (idx < 0) continue
      any = true
      slots.age[s] += dt
      const spec = worldState.slots[idx]
      const gone = !spec.used || spec.serial !== slots.serial[s]
      if (slots.age[s] >= RIPPLE_DUR || gone) {
        slots.island[s] = -1
        dummy.position.set(0, -999, 0)
        dummy.scale.setScalar(1e-4)
        dummy.updateMatrix()
        m.setMatrixAt(s, dummy.matrix)
        m.setColorAt(s, tmpColor.setScalar(0))
        continue
      }
      const k = slots.age[s] / RIPPLE_DUR
      const scale = 0.5 + k * (spec.scale * 2.8 - 0.5)
      // +0.3: the coplanar sheet needs clearance the torus tube used to give
      const y =
        islandY(spec, t, audioFrame.bass, visuals.liftGain) +
        spec.scale * 0.82 * variantTop(spec.variant) +
        0.3
      dummy.position.set(spec.x, y, spec.z)
      dummy.scale.set(scale, 1, scale)
      dummy.updateMatrix()
      m.setMatrixAt(s, dummy.matrix)
      const b = (1 - k) * (1 - k) * visuals.onsetRippleGain * (0.55 + 0.9 * visuals.bassSlam)
      m.setColorAt(s, tmpColor.setScalar(b))
    }
    if (any) {
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
  })

  return (
    <instancedMesh
      ref={el => {
        mesh.current = el
        if (el) el.instanceMatrix.setUsage(DynamicDrawUsage)
      }}
      args={[geometry, material, SLOTS]}
      frustumCulled={false}
    />
  )
}
