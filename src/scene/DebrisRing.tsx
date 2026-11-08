import { useFrame, useLoader } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  DynamicDrawUsage,
  MeshStandardMaterial,
  Object3D,
  RepeatWrapping,
  TextureLoader,
  Vector2,
  Vector3,
  type InstancedMesh,
} from 'three'
import { audioFrame } from '../audio/reactiveBus'
import { hashInts, mulberry32, range } from '../game/seededRandom'
import { WORLD, worldState } from '../game/worldState'
import { islandY, makeIslandGeometry } from './Islands'
import { snapController } from './snapController'
import { applyTripWarp } from './tripWarp'
import { dropWavePush, visuals } from './visualTuning'
import type { Palette } from '../theme/palettes'

const CHUNKS = 96

interface ChunkBind {
  /** Island slot index (-1 unbound) + serial guard. */
  parent: number
  parentSerial: number
  e1: Vector3
  e2: Vector3
  radius: number
  speed: number
  phase: number
  spinX: number
  spinY: number
  sx: number
  sy: number
  sz: number
  threshold: number
}

const dummy = new Object3D()
const scratchN = new Vector3()

const easeOutCubic = (k: number) => 1 - Math.pow(1 - k, 3)

function makeBinds(): ChunkBind[] {
  return Array.from({ length: CHUNKS }, () => ({
    parent: -1,
    parentSerial: 0,
    e1: new Vector3(1, 0, 0),
    e2: new Vector3(0, 0, 1),
    radius: 1,
    speed: 0.5,
    phase: 0,
    spinX: 1,
    spinY: 1,
    sx: 0.3,
    sy: 0.3,
    sz: 0.3,
    threshold: 0.5,
  }))
}

/** Derive chunk j's orbit from its parent island id — deterministic per island,
 * so a full rebind after streaming leaves unchanged parents visually identical. */
function bindChunk(b: ChunkBind, j: number, slotIdx: number): void {
  const slot = worldState.slots[slotIdx]
  const rng = mulberry32(hashInts(slot.id, j, 0xd3b815, 0))
  scratchN.set(range(rng, -0.65, 0.65), 1, range(rng, -0.65, 0.65)).normalize()
  b.e1.set(1, 0, 0).cross(scratchN)
  if (b.e1.lengthSq() < 1e-4) b.e1.set(0, 0, 1)
  b.e1.normalize()
  b.e2.copy(scratchN).cross(b.e1).normalize()
  const parentScale = slot.scale
  b.parent = slotIdx
  b.parentSerial = slot.serial
  b.radius = parentScale * range(rng, 1.7, 3.2)
  b.speed = range(rng, 0.35, 1.0) * (rng() < 0.5 ? -1 : 1)
  b.phase = range(rng, 0, Math.PI * 2)
  b.spinX = range(rng, 0.4, 1.6)
  b.spinY = range(rng, 0.4, 1.6)
  b.sx = (parentScale / 3) * range(rng, 0.2, 0.7)
  b.sy = (parentScale / 3) * range(rng, 0.2, 0.7)
  b.sz = (parentScale / 3) * range(rng, 0.2, 0.7)
  b.threshold = rng()
}

/** SHATTER: island fragments tear out and orbit their parents, then get
 * sucked back when the drop ends. Orbits are analytic (pure functions of t),
 * so tear-out/return is just the debrisAmount scalar. */
export function DebrisRing({ palette }: { palette: Palette }) {
  const mesh = useRef<InstancedMesh>(null)
  const rockNormal = useLoader(TextureLoader, '/assets/rock_normal.png')
  const binds = useMemo(makeBinds, [])
  const lastSlotVersion = useRef(-1)
  const eligible = useMemo<number[]>(() => [], [])

  const geometry = useMemo(() => makeIslandGeometry(4242, 1), [])
  const material = useMemo(() => {
    rockNormal.wrapS = rockNormal.wrapT = RepeatWrapping
    rockNormal.repeat.set(2, 2)
    return new MeshStandardMaterial({
      flatShading: true,
      roughness: 0.9,
      metalness: 0.05,
      vertexColors: true,
      normalMap: rockNormal,
      normalScale: new Vector2(0.7, 0.7),
    })
  }, [rockNormal])
  const warp = useMemo(() => applyTripWarp(material), [material])

  useEffect(() => {
    material.color.set(palette.islandBase)
  }, [palette, material])

  useEffect(() => {
    return () => {
      geometry.dispose()
      material.dispose()
    }
  }, [geometry, material])

  useFrame(({ clock }) => {
    const m = mesh.current
    if (!m) return

    // Rebind after any streaming change. Derivations are keyed on island ids,
    // so chunks whose parent survived re-derive identical orbits (no jumps).
    if (lastSlotVersion.current !== worldState.slotVersion) {
      lastSlotVersion.current = worldState.slotVersion
      eligible.length = 0
      const slots = worldState.slots
      for (let i = 0; i < WORLD.TOTAL_SLOTS; i++) {
        if (slots[i].used && slots[i].scale >= 3) eligible.push(i)
      }
      for (let j = 0; j < CHUNKS; j++) {
        if (eligible.length === 0) binds[j].parent = -1
        else bindChunk(binds[j], j, eligible[j % eligible.length])
      }
    }

    const amount = visuals.debrisAmount
    if (amount < 0.005 || eligible.length === 0) {
      m.count = 0
      m.visible = false
      return
    }
    m.visible = true
    m.count = CHUNKS
    const t = clock.elapsedTime
    const bass = audioFrame.bass
    const liftGain = visuals.liftGain
    const orbitBoost = 1 + 0.6 * bass
    const sw = snapController.shockwave
    const swAge = t - sw.t0
    const swLive = sw.active && swAge >= 0 && swAge < 1.2
    const swPulse = swLive ? Math.exp(-3 * swAge) * Math.sin(10 * swAge) * sw.strength * 1.5 : 0
    const dropWaveLive = visuals.dropWaveAge < 1.2 && visuals.dropWaveStrength > 0
    const waveCx = snapController.pos.x
    const waveCy = snapController.pos.y
    const waveCz = snapController.pos.z

    warp.uTripAmp.value = visuals.tripLevel * (visuals.rm ? 0.25 : 1)
    warp.uTripTime.value = t

    for (let j = 0; j < CHUNKS; j++) {
      const s = binds[j]
      const slot = s.parent >= 0 ? worldState.slots[s.parent] : null
      if (!slot || !slot.used || slot.serial !== s.parentSerial) {
        dummy.position.set(0, -999, 0)
        dummy.scale.setScalar(1e-4)
        dummy.rotation.set(0, 0, 0)
        dummy.updateMatrix()
        m.setMatrixAt(j, dummy.matrix)
        continue
      }
      const k = easeOutCubic(Math.min(1, Math.max(0, (amount - 0.6 * s.threshold) / 0.4)))
      const angle = s.phase + t * s.speed * orbitBoost
      const cx = slot.x
      const cy = islandY(slot, t, bass, liftGain)
      const cz = slot.z
      const r = s.radius * k
      let px = cx + (s.e1.x * Math.cos(angle) + s.e2.x * Math.sin(angle)) * r
      let py = cy + (s.e1.y * Math.cos(angle) + s.e2.y * Math.sin(angle)) * r
      let pz = cz + (s.e1.z * Math.cos(angle) + s.e2.z * Math.sin(angle)) * r
      if (swLive) {
        const dx = px - sw.x
        const dy = py - sw.y
        const dz = pz - sw.z
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-3
        const falloff = Math.max(0, 1 - dist / 40)
        if (falloff > 0) {
          const push = swPulse * falloff
          px += (dx / dist) * push
          py += (dy / dist) * push
          pz += (dz / dist) * push
        }
      }
      if (dropWaveLive) {
        const dx = px - waveCx
        const dy = py - waveCy
        const dz = pz - waveCz
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-3
        const push = dropWavePush(dist)
        if (push > 1e-4) {
          px += (dx / dist) * push
          py += (dy / dist) * push
          pz += (dz / dist) * push
        }
      }
      dummy.position.set(px, py, pz)
      dummy.rotation.set(t * s.spinX, t * s.spinY, 0)
      dummy.scale.set(
        Math.max(1e-4, s.sx * k),
        Math.max(1e-4, s.sy * k),
        Math.max(1e-4, s.sz * k),
      )
      dummy.updateMatrix()
      m.setMatrixAt(j, dummy.matrix)
    }
    m.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={el => {
        mesh.current = el
        if (el) el.instanceMatrix.setUsage(DynamicDrawUsage)
      }}
      args={[geometry, material, CHUNKS]}
      frustumCulled={false}
      visible={false}
    />
  )
}
