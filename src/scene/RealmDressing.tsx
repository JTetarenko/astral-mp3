import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  Color,
  DynamicDrawUsage,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type InstancedMesh,
} from 'three'
import { audioFrame } from '../audio/reactiveBus'
import { WORLD, worldState } from '../game/worldState'
import { variantRadialX, variantRadialY, variantTop } from '../game/islandVariants'
import { soupToGeometry } from './AvatarWings'
import {
  DRESSING_BUILDERS,
  DRESSING_POOL,
  DRESSING_VISUALS,
  placeDressing,
  type DressingPiece,
} from './dressingGeom'
import { islandGrowScale, islandY } from './Islands'
import { governor } from './perfGovernor'
import { snapController } from './snapController'
import { applySpireVein } from './spireShader'
import { visuals } from './visualTuning'
import type { Palette } from '../theme/palettes'

const dummy = new Object3D()
const hiddenMatrix = new Matrix4().makeScale(1e-4, 1e-4, 1e-4)
const qYaw = new Quaternion()
const qTilt = new Quaternion()
const tiltAxis = new Vector3()
const yAxis = new Vector3(0, 1, 0)

/** Fixed builder seeds — one geometry per realm, prebuilt and never rebuilt. */
const FAMILY_SEEDS = [0xa57a1, 0x0e551, 0xca7ed, 0x21707, 0xc077a, 0x1a7a5]

interface Binding {
  island: number
  serial: number
  piece: DressingPiece
}

/**
 * Per-realm island dressing: crystal halos / canopy fronds / buttress ribs /
 * menhir circles / orbiting crust plates / obsidian vents. ONE InstancedMesh
 * whose geometry POINTER swaps at the epoch guard (whiteout-masked; the
 * matrix pool lives on the mesh, so the swap costs nothing). Bindings rebuild
 * on slotVersion nearest-first (IslandTendrils idiom) but derive every piece
 * from the island's chunk-stable id (CrystalShards determinism contract).
 * visuals.dressingCount (tier x governor x realm mod, 0 at L4) caps the live
 * set; palette + realm swaps are color writes through the shared spire-vein
 * program.
 */
export function RealmDressing({ palette }: { palette: Palette }) {
  const mesh = useRef<InstancedMesh>(null)
  const lastEpoch = useRef(-1)
  const lastSlotVersion = useRef(-1)
  const lastCount = useRef(-1)
  const realmIdx = useRef(0)
  const parity = useRef(0)
  const bindings = useMemo<Binding[]>(() => [], [])
  const scratch = useMemo<DressingPiece[]>(() => [], [])

  const geometries = useMemo(
    () =>
      DRESSING_VISUALS.map((v, i) => soupToGeometry(DRESSING_BUILDERS[v.family](FAMILY_SEEDS[i]), true)),
    [],
  )
  const veinColor = useMemo(() => new Color(0, 0, 0), [])
  const material = useMemo(() => {
    const m = new MeshBasicMaterial({ vertexColors: true, toneMapped: false })
    applySpireVein(m, veinColor)
    return m
  }, [veinColor])
  const bodyBase = useMemo(() => new Color(palette.islandBase).multiplyScalar(0.85), [palette])
  const veinBase = useMemo(() => new Color(palette.rune), [palette])

  useEffect(() => {
    return () => {
      for (const g of geometries) g.dispose()
      material.dispose()
    }
  }, [geometries, material])

  useFrame(({ clock }) => {
    const m = mesh.current
    if (!m) return

    // Epoch guard FIRST: the realm swap changes the whole vocabulary at once
    // (under the whiteout), and slots were all recycled the same frame.
    if (lastEpoch.current !== worldState.epoch) {
      lastEpoch.current = worldState.epoch
      realmIdx.current = ((worldState.depth % 6) + 6) % 6
      m.geometry = geometries[realmIdx.current]
      bindings.length = 0
      lastSlotVersion.current = -1
    }
    const spec = DRESSING_VISUALS[realmIdx.current]

    // Rebind on world change: eligible islands nearest-first, deterministic
    // placement per island id — a re-streamed island regrows identically.
    if (lastSlotVersion.current !== worldState.slotVersion) {
      lastSlotVersion.current = worldState.slotVersion
      bindings.length = 0
      const px = snapController.pos.x
      const pz = snapController.pos.z
      const order: { i: number; d: number }[] = []
      const ws = worldState.slots
      for (let i = 0; i < WORLD.TOTAL_SLOTS; i++) {
        const s = ws[i]
        if (s.used && s.scale >= spec.minIslandScale) {
          order.push({ i, d: Math.hypot(s.x - px, s.z - pz) })
        }
      }
      order.sort((a, b) => a.d - b.d)
      const density = worldState.modsGen.dressingDensity
      for (const { i } of order) {
        if (bindings.length >= DRESSING_POOL) break
        const s = ws[i]
        const n = placeDressing(
          spec,
          s.id,
          s.scale,
          variantRadialX(s.variant),
          variantRadialY(s.variant),
          variantTop(s.variant),
          density,
          scratch,
        )
        for (let k = 0; k < n && bindings.length < DRESSING_POOL; k++) {
          bindings.push({ island: i, serial: s.serial, piece: { ...scratch[k] } })
        }
      }
      lastCount.current = -1 // force a full restamp
    }

    // half-rate matrix stamping under governor pressure (orbit drift is slow)
    parity.current ^= 1
    if (governor.level >= 2 && parity.current === 1 && lastCount.current >= 0) return

    const live = Math.min(bindings.length, visuals.dressingCount, DRESSING_POOL)
    const t = clock.elapsedTime
    const bass = audioFrame.bass
    const lift = visuals.liftGain
    const rm = visuals.rm
    const orbitYaw = rm ? 0 : spec.orbitRate * t
    const cw = Math.cos(orbitYaw)
    const sw = Math.sin(orbitYaw)
    const tripStretch = 1 + spec.tripStretch * visuals.tripLevel
    for (let s = 0; s < DRESSING_POOL; s++) {
      if (s >= live) {
        if (lastCount.current !== live) m.setMatrixAt(s, hiddenMatrix)
        continue
      }
      const b = bindings[s]
      const slot = worldState.slots[b.island]
      if (!slot.used || slot.serial !== b.serial) {
        m.setMatrixAt(s, hiddenMatrix)
        continue
      }
      const p = b.piece
      const ox = p.ox * cw - p.oz * sw
      const oz = p.ox * sw + p.oz * cw
      dummy.position.set(
        slot.x + ox,
        islandY(slot, t, bass, lift) + p.oy,
        slot.z + oz,
      )
      // yaw first (intrinsic), then the outward tilt in world space — matches
      // the builders' unit-up convention
      qYaw.setFromAxisAngle(yAxis, p.ry + orbitYaw)
      const dir = p.tiltDir + orbitYaw
      tiltAxis.set(Math.sin(dir), 0, -Math.cos(dir))
      qTilt.setFromAxisAngle(tiltAxis, p.tilt)
      dummy.quaternion.copy(qTilt).multiply(qYaw)
      const grow = islandGrowScale(slot.bornAt, t)
      dummy.scale.set(p.sx * grow, p.sy * grow * tripStretch, p.sx * grow)
      dummy.updateMatrix()
      m.setMatrixAt(s, dummy.matrix)
    }
    lastCount.current = live
    m.instanceMatrix.needsUpdate = true

    material.color.copy(bodyBase)
    veinColor
      .copy(veinBase)
      .multiplyScalar(spec.veinGain * (0.5 + 0.7 * visuals.runeGlow))
  })

  return (
    <instancedMesh
      ref={el => {
        mesh.current = el
        if (el) {
          el.instanceMatrix.setUsage(DynamicDrawUsage)
          for (let i = 0; i < DRESSING_POOL; i++) el.setMatrixAt(i, hiddenMatrix)
        }
      }}
      args={[geometries[0], material, DRESSING_POOL]}
      frustumCulled={false}
    />
  )
}
