import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  Color,
  DynamicDrawUsage,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  type InstancedMesh,
} from 'three'
import { audioFrame } from '../audio/reactiveBus'
import { hashInts } from '../game/seededRandom'
import { WORLD, worldState } from '../game/worldState'
import { soupToGeometry } from './AvatarWings'
import { islandY } from './Islands'
import { governor } from './perfGovernor'
import { snapController } from './snapController'
import { applySpireVein } from './spireShader'
import { buildTendril, TENDRIL_POOL } from './tendrilGeom'
import { visuals } from './visualTuning'
import type { Palette } from '../theme/palettes'

const dummy = new Object3D()
const hiddenMatrix = new Matrix4().makeScale(1e-4, 1e-4, 1e-4)

interface Binding {
  island: number
  serial: number
  offX: number
  offZ: number
  len: number
  width: number
  rotY: number
}

/**
 * Hanging stalactite tendrils under the large islands — the underside mass
 * that sells "rock torn out of a world" (the bare icosa bottoms read as
 * floating props). One InstancedMesh, TENDRIL_POOL slots; bindings rebuild on
 * worldState.slotVersion change (the GroundRipples eligible-rebuild idiom),
 * nearest-first to the player so the budget dresses where the eye is.
 * Matrices re-stamp per frame welded to islandY's bob (the CrystalShards
 * contract), parity-amortized at governor >= 2; visuals.tendrilCount (0 at
 * L4) caps the live set. Dim rune tips stay below the bloom threshold.
 */
export function IslandTendrils({ palette }: { palette: Palette }) {
  const mesh = useRef<InstancedMesh>(null)
  const lastSlotVersion = useRef(-1)
  const lastCount = useRef(-1)
  const parity = useRef(0)
  const bindings = useMemo<Binding[]>(() => [], [])

  const geometry = useMemo(() => soupToGeometry(buildTendril(0x7e4d), true), [])
  const veinColor = useMemo(() => new Color(0, 0, 0), [])
  const material = useMemo(() => {
    const m = new MeshBasicMaterial({ vertexColors: true, toneMapped: false })
    applySpireVein(m, veinColor)
    return m
  }, [veinColor])
  const bodyBase = useMemo(() => new Color(palette.islandBase).multiplyScalar(0.8), [palette])
  const veinBase = useMemo(() => new Color(palette.rune).multiplyScalar(0.9), [palette])

  useEffect(() => {
    return () => {
      geometry.dispose()
      material.dispose()
    }
  }, [geometry, material])

  useFrame(({ clock }) => {
    const m = mesh.current
    if (!m) return

    // rebind on world change: eligible islands nearest-first, 1-3 spikes each
    if (lastSlotVersion.current !== worldState.slotVersion) {
      lastSlotVersion.current = worldState.slotVersion
      bindings.length = 0
      const px = snapController.pos.x
      const pz = snapController.pos.z
      const order: { i: number; d: number }[] = []
      const ws = worldState.slots
      for (let i = 0; i < WORLD.TOTAL_SLOTS; i++) {
        const s = ws[i]
        if (s.used && s.scale >= 3.5) {
          order.push({ i, d: Math.hypot(s.x - px, s.z - pz) })
        }
      }
      order.sort((a, b) => a.d - b.d)
      for (const { i } of order) {
        if (bindings.length >= TENDRIL_POOL) break
        const s = ws[i]
        const n = 1 + (hashInts(s.serial, 0x7e4d, 0x11, i) % 3)
        for (let k = 0; k < n && bindings.length < TENDRIL_POOL; k++) {
          const h1 = hashInts(s.serial, k, 0x7e4d, 0x11)
          const h2 = hashInts(s.serial, k, 0x11, 0x7e4d)
          const a = ((h1 % 1024) / 1024) * Math.PI * 2
          const r = (0.12 + 0.33 * ((h2 % 1024) / 1024)) * s.scale
          bindings.push({
            island: i,
            serial: s.serial,
            offX: Math.cos(a) * r,
            offZ: Math.sin(a) * r,
            len: (0.5 + 0.6 * (((h1 >>> 10) % 1024) / 1024)) * s.scale,
            width: (0.06 + 0.04 * (((h2 >>> 10) % 1024) / 1024)) * s.scale,
            rotY: a * 1.7,
          })
        }
      }
      lastCount.current = -1 // force a full restamp
    }

    // half-rate matrix stamping under governor pressure (bob is slow)
    parity.current ^= 1
    if (governor.level >= 2 && parity.current === 1 && lastCount.current >= 0) return

    const live = Math.min(bindings.length, visuals.tendrilCount, TENDRIL_POOL)
    const t = clock.elapsedTime
    const bass = audioFrame.bass
    const lift = visuals.liftGain
    for (let s = 0; s < TENDRIL_POOL; s++) {
      if (s >= live) {
        if (lastCount.current !== live) m.setMatrixAt(s, hiddenMatrix)
        continue
      }
      const b = bindings[s]
      const spec = worldState.slots[b.island]
      if (!spec.used || spec.serial !== b.serial) {
        m.setMatrixAt(s, hiddenMatrix)
        continue
      }
      // root welded to the island's belly, riding its bob
      dummy.position.set(
        spec.x + b.offX,
        islandY(spec, t, bass, lift) - spec.scale * 0.55,
        spec.z + b.offZ,
      )
      dummy.scale.set(b.width, b.len, b.width)
      dummy.rotation.set(0, b.rotY, 0)
      dummy.updateMatrix()
      m.setMatrixAt(s, dummy.matrix)
    }
    lastCount.current = live
    m.instanceMatrix.needsUpdate = true

    material.color.copy(bodyBase)
    veinColor.copy(veinBase)
  })

  return (
    <instancedMesh
      ref={el => {
        mesh.current = el
        if (el) {
          el.instanceMatrix.setUsage(DynamicDrawUsage)
          for (let i = 0; i < TENDRIL_POOL; i++) el.setMatrixAt(i, hiddenMatrix)
        }
      }}
      args={[geometry, material, TENDRIL_POOL]}
      frustumCulled={false}
    />
  )
}
