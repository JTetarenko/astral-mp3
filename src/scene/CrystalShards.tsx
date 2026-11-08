import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  Quaternion,
  Vector3,
  type BufferAttribute,
  type InstancedMesh,
} from 'three'
import { audioFrame } from '../audio/reactiveBus'
import { mulberry32, range } from '../game/seededRandom'
import { WORLD, worldState } from '../game/worldState'
import { snapController } from './snapController'
import { variantRadialX, variantRadialY } from '../game/islandVariants'
import { islandGrowScale, islandY } from './Islands'
import { smoothstep, T, visuals } from './visualTuning'
import type { Palette } from '../theme/palettes'

const POOL = WORLD.SHARD_POOL
const MAX_PER_ISLAND = WORLD.SHARDS_MAX_PER_ISLAND
/** Only islands this near the player grow crystals (fog hides the rest). */
const SHARD_IN_R = 110
const SHARD_OUT_R = 126
/** Floats per shard: ox,oy,oz, qx,qy,qz,qw, baseScale, threshold. */
const STRIDE = 9

/** Base-at-origin stretched octahedron: scale-in needs no repositioning.
 * Vertex colors: dark body + HDR tip in ONE basic material — the tips bloom,
 * the bodies stay silhouettes, no lights involved. */
function makeShardGeometry(): OctahedronGeometry {
  const geo = new OctahedronGeometry(1, 0)
  geo.scale(0.22, 0.9, 0.22)
  geo.translate(0, 0.9, 0)
  const pos = geo.attributes.position as BufferAttribute
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const v = pos.getY(i) > 1.6 ? 3.2 : 0.08
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = v
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return geo
}

const dummy = new Object3D()
const up = new Vector3(0, 1, 0)
const whiteShard = new Color('#ffffff')
const glintColor = new Color()
const hiddenMatrix = new Matrix4().makeScale(1e-4, 1e-4, 1e-4)
const scratchDir = new Vector3()
const scratchQuat = new Quaternion()
const scratchTilt = new Quaternion()
const scratchAxis = new Vector3()
const GLINT_SLOTS = 6
const GLINT_DUR = 0.6

interface ShardBinds {
  /** Shard -> island slot (-1 free) + the serial it bound against. */
  parent: Int32Array
  parentSerial: Int32Array
  data: Float32Array
  free: Int32Array
  freeTop: number
  /** Island -> its shard indices. */
  shardsOf: Int32Array
  shardCount: Uint8Array
  /** Island serial last processed + sharded flag. */
  lastSerial: Int32Array
  sharded: Uint8Array
  lastEpoch: number
}

function makeBinds(): ShardBinds {
  const free = new Int32Array(POOL)
  for (let i = 0; i < POOL; i++) free[i] = POOL - 1 - i
  return {
    parent: new Int32Array(POOL).fill(-1),
    parentSerial: new Int32Array(POOL),
    data: new Float32Array(POOL * STRIDE),
    free,
    freeTop: POOL,
    shardsOf: new Int32Array(WORLD.TOTAL_SLOTS * MAX_PER_ISLAND).fill(-1),
    shardCount: new Uint8Array(WORLD.TOTAL_SLOTS),
    lastSerial: new Int32Array(WORLD.TOTAL_SLOTS).fill(-1),
    sharded: new Uint8Array(WORLD.TOTAL_SLOTS),
    lastEpoch: -1,
  }
}

function freeIslandShards(b: ShardBinds, isl: number): void {
  const n = b.shardCount[isl]
  for (let k = 0; k < n; k++) {
    const s = b.shardsOf[isl * MAX_PER_ISLAND + k]
    if (s >= 0) {
      b.parent[s] = -1
      b.free[b.freeTop++] = s
    }
    b.shardsOf[isl * MAX_PER_ISLAND + k] = -1
  }
  b.shardCount[isl] = 0
  b.sharded[isl] = 0
}

/** Derive an island's crystals from its deterministic id (chunk-stable). */
function allocIslandShards(b: ShardBinds, isl: number): void {
  const slot = worldState.slots[isl]
  const rng = mulberry32((slot.id ^ 0xc0ffee) >>> 0)
  const want = Math.min(
    MAX_PER_ISLAND,
    Math.max(2, Math.round(slot.scale * worldState.modsGen.shardDensity * 0.7)),
  )
  let placed = 0
  for (let k = 0; k < want; k++) {
    if (b.freeTop <= 0) break // pool dry — distant islands just stay bare
    const s = b.free[--b.freeTop]
    const theta = range(rng, 0, Math.PI * 2)
    const phi = range(rng, 0.15, 1.15) // upper hemisphere
    scratchDir.set(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta))
    scratchQuat.setFromUnitVectors(up, scratchDir)
    scratchAxis.set(range(rng, -1, 1), 0, range(rng, -1, 1)).normalize()
    scratchTilt.setFromAxisAngle(scratchAxis, range(rng, -0.44, 0.44))
    scratchQuat.multiply(scratchTilt)
    // per-axis radial factors hug the variant silhouette (monoliths are
    // narrow and tall); same rng draw count keeps chunk determinism
    const r = slot.scale * 0.8
    const o = s * STRIDE
    b.data[o] = scratchDir.x * r * variantRadialX(slot.variant)
    b.data[o + 1] = scratchDir.y * r * variantRadialY(slot.variant)
    b.data[o + 2] = scratchDir.z * r * variantRadialX(slot.variant)
    b.data[o + 3] = scratchQuat.x
    b.data[o + 4] = scratchQuat.y
    b.data[o + 5] = scratchQuat.z
    b.data[o + 6] = scratchQuat.w
    b.data[o + 7] = slot.scale * range(rng, 0.17, 0.55)
    b.data[o + 8] = rng() * 0.85
    b.parent[s] = isl
    b.parentSerial[s] = slot.serial
    b.shardsOf[isl * MAX_PER_ISLAND + placed] = s
    placed++
  }
  b.shardCount[isl] = placed
  b.sharded[isl] = 1
}

/** Resonance crystals that grow out of nearby islands as the song climbs. */
export function CrystalShards({ palette }: { palette: Palette }) {
  const mesh = useRef<InstancedMesh>(null)
  const binds = useMemo(makeBinds, [])

  const geometry = useMemo(makeShardGeometry, [])
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        vertexColors: true,
        toneMapped: false,
      }),
    [],
  )
  useEffect(() => {
    material.color.set(palette.primary)
  }, [palette, material])

  // snare-glint slots: {shard index, age}; -1 = free
  const glints = useMemo(
    () => ({
      idx: new Int32Array(GLINT_SLOTS).fill(-1),
      age: new Float32Array(GLINT_SLOTS),
      lastSpawn: -999,
    }),
    [],
  )

  useEffect(() => {
    return () => {
      geometry.dispose()
      material.dispose()
    }
  }, [geometry, material])

  // instanceColor must exist before the first glint write, all-white
  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    for (let j = 0; j < POOL; j++) m.setColorAt(j, whiteShard)
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [])

  useFrame(({ clock }, frameDt) => {
    const m = mesh.current
    if (!m) return
    const b = binds
    const slots = worldState.slots
    const px = snapController.pos.x
    const pz = snapController.pos.z

    // Epoch guard: a realm swap invalidates every binding at once.
    if (b.lastEpoch !== worldState.epoch) {
      b.lastEpoch = worldState.epoch
      for (let i = 0; i < WORLD.TOTAL_SLOTS; i++) {
        if (b.sharded[i]) freeIslandShards(b, i)
        b.lastSerial[i] = -1
      }
      glints.idx.fill(-1)
    }

    // Bind maintenance: serial diffs + radius membership (with hysteresis).
    for (let i = 0; i < WORLD.TOTAL_SLOTS; i++) {
      const slot = slots[i]
      if (b.lastSerial[i] !== slot.serial) {
        if (b.sharded[i]) freeIslandShards(b, i)
        b.lastSerial[i] = slot.serial
      }
      if (!slot.used) continue
      const dx = slot.x - px
      const dz = slot.z - pz
      const dSq = dx * dx + dz * dz
      if (!b.sharded[i]) {
        if (dSq < SHARD_IN_R * SHARD_IN_R) allocIslandShards(b, i)
      } else if (dSq > SHARD_OUT_R * SHARD_OUT_R) {
        freeIslandShards(b, i)
      }
    }

    const growth = visuals.shardGrowth
    if (growth < 0.001) {
      m.count = 0
      return
    }
    m.count = POOL
    const gdt = Math.min(0.1, frameDt)
    const t = clock.elapsedTime
    const bass = audioFrame.bass
    const liftGain = visuals.liftGain
    const pulse = 1 + bass * 0.05 * T(0.5, 0.9, 1.3, 1.6)
    for (let j = 0; j < POOL; j++) {
      const isl = b.parent[j]
      if (isl < 0) {
        m.setMatrixAt(j, hiddenMatrix)
        continue
      }
      const slot = slots[isl]
      const o = j * STRIDE
      const grow = smoothstep(0, 1, Math.min(1, Math.max(0, (growth - b.data[o + 8]) / 0.15)))
      const scale =
        b.data[o + 7] * grow * (1 + bass * 0.1) * islandGrowScale(slot.bornAt, t)
      const iy = islandY(slot, t, bass, liftGain)
      dummy.position.set(
        slot.x + b.data[o] * pulse,
        iy + b.data[o + 1] * pulse,
        slot.z + b.data[o + 2] * pulse,
      )
      dummy.quaternion.set(b.data[o + 3], b.data[o + 4], b.data[o + 5], b.data[o + 6])
      if (visuals.w3 > 0.01) dummy.rotateX(Math.sin(t * 23 + j) * 0.04 * visuals.w3)
      // crystals stretch skyward as the trip approaches
      const sc = Math.max(1e-4, scale)
      dummy.scale.set(sc, sc * (1 + 0.5 * visuals.tripLevel), sc)
      dummy.updateMatrix()
      m.setMatrixAt(j, dummy.matrix)
    }
    m.instanceMatrix.needsUpdate = true

    // snare glints: white-hot flash on a few grown shards per mid onset
    let colorsDirty = false
    if (
      audioFrame.midOnset &&
      audioFrame.midOnsetStrength >= 0.5 &&
      visuals.glintGain > 0.01 &&
      t - glints.lastSpawn > 0.12
    ) {
      glints.lastSpawn = t
      const want = 1 + Math.floor(Math.random() * 3)
      for (let n = 0; n < want; n++) {
        // find a bound, grown shard (few tries, then give up)
        for (let tries = 0; tries < 6; tries++) {
          const j = Math.floor(Math.random() * POOL)
          if (b.parent[j] >= 0 && growth - b.data[j * STRIDE + 8] > 0.15) {
            const slot = (n + Math.floor(Math.random() * GLINT_SLOTS)) % GLINT_SLOTS
            glints.idx[slot] = j
            glints.age[slot] = 0
            break
          }
        }
      }
    }
    for (let s = 0; s < GLINT_SLOTS; s++) {
      const j = glints.idx[s]
      if (j < 0) continue
      if (b.parent[j] < 0) {
        // the shard was recycled mid-glint — drop it
        glints.idx[s] = -1
        m.setColorAt(j, whiteShard)
        colorsDirty = true
        continue
      }
      const env = Math.exp(-8 * glints.age[s]) * visuals.glintGain
      glints.age[s] += gdt
      if (glints.age[s] >= GLINT_DUR) {
        glints.idx[s] = -1
        m.setColorAt(j, whiteShard)
      } else {
        m.setColorAt(j, glintColor.setScalar(1 + 5 * env))
      }
      colorsDirty = true
    }
    if (colorsDirty && m.instanceColor) m.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={el => {
        mesh.current = el
        if (el) el.instanceMatrix.setUsage(DynamicDrawUsage)
      }}
      args={[geometry, material, POOL]}
      frustumCulled={false}
    />
  )
}
