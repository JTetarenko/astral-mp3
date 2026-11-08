import { useFrame, useLoader } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  TextureLoader,
  type Group,
  type Mesh,
} from 'three'
import { hashInts, mulberry32, range } from '../game/seededRandom'
import { worldState } from '../game/worldState'
import { soupToGeometry } from './AvatarWings'
import { snapController } from './snapController'
import { governor } from './perfGovernor'
import { buildSpireCluster } from './spireGeom'
import { applySpireVein } from './spireShader'
import { visuals } from './visualTuning'
import type { Palette } from '../theme/palettes'

/**
 * The realm beyond the play space, made endless: two cloud-sea planes that
 * follow the player (texture offset compensated so the sea reads world-fixed)
 * and a streamed far-grid of dark spire silhouettes — deterministic per
 * (trackSeed, depth, farCell), giving real parallax and an unreachable
 * horizon in every direction.
 */
const SPIRE_POOL = 48
const FAR_CELL = 160
const FAR_RADIUS = 420
const CLOUD_Y_A = -60
const CLOUD_Y_B = -72

/** Plane with a radial vertex-color falloff so the additive sheet fades to
 * nothing at the rim instead of fighting the fog-free sky behind it. */
function makeCloudGeometry(size: number): PlaneGeometry {
  const geo = new PlaneGeometry(size, size, 24, 24)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position
  const colors = new Float32Array(pos.count * 3)
  const half = size / 2
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const r = Math.sqrt(x * x + z * z) / half
    const t = Math.max(0, Math.min(1, (1 - r) / 0.45))
    const v = t * t * (3 - 2 * t)
    colors[i * 3] = v
    colors[i * 3 + 1] = v
    colors[i * 3 + 2] = v
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3))
  return geo
}

const dummy = new Object3D()
const hiddenMatrix = new Matrix4().makeScale(1e-4, 1e-4, 1e-4)

export function FarRealm({ palette }: { palette: Palette }) {
  const cloudTex = useLoader(TextureLoader, '/assets/clouds.png')
  const clouds = useRef<Group>(null)
  const matA = useRef<MeshBasicMaterial>(null)
  const matB = useRef<MeshBasicMaterial>(null)
  const meshB = useRef<Mesh>(null)
  const spires = useRef<InstancedMesh>(null)
  const scrollA = useRef(0)
  const scrollB = useRef(0)
  const farState = useRef({ cellX: Number.NaN, cellZ: Number.NaN, epoch: -1, gov: -1 })

  const [texA, texB] = useMemo(() => {
    const a = cloudTex.clone()
    a.wrapS = a.wrapT = RepeatWrapping
    a.repeat.set(3, 3)
    const b = cloudTex.clone()
    b.wrapS = b.wrapT = RepeatWrapping
    b.repeat.set(4, 4)
    return [a, b]
  }, [cloudTex])

  const geoA = useMemo(() => makeCloudGeometry(700), [])
  const geoB = useMemo(() => makeCloudGeometry(950), [])
  // faceted monolith cluster (spireGeom): base y=0, unit height — the same
  // instancing convention as the old nudged cone, ~96 tris shared by all 48
  const spireGeo = useMemo(() => soupToGeometry(buildSpireCluster(20260501), true), [])
  // stable Color ref the vein shader closes over — mutated per frame, so
  // palette swaps stay color-writes-only (no program rebuild)
  const veinColor = useMemo(() => new Color(0, 0, 0), [])
  const spireMaterial = useMemo(() => {
    const m = new MeshBasicMaterial({ fog: false, toneMapped: false, vertexColors: true })
    applySpireVein(m, veinColor)
    return m
  }, [veinColor])
  useEffect(() => {
    return () => {
      geoA.dispose()
      geoB.dispose()
      spireGeo.dispose()
      spireMaterial.dispose()
      texA.dispose()
      texB.dispose()
    }
  }, [geoA, geoB, spireGeo, spireMaterial, texA, texB])

  const cloudTint = useMemo(
    () => new Color(palette.secondary).lerp(new Color(palette.primary), 0.3),
    [palette],
  )
  const spireBase = useMemo(() => new Color(palette.islandBase), [palette])
  const veinBase = useMemo(
    () => new Color(palette.rune).lerp(new Color('#ffffff'), 0.2),
    [palette],
  )
  const tmp = useMemo(() => new Color(), [])

  /** Restream the far-grid spires around the player's far-cell. */
  const restreamSpires = (px: number, pz: number, radius: number) => {
    const m = spires.current
    if (!m) return
    const mods = worldState.modsGen
    const cellX = Math.floor(px / FAR_CELL)
    const cellZ = Math.floor(pz / FAR_CELL)
    const ring = Math.ceil(radius / FAR_CELL)
    let slot = 0
    for (let cx = cellX - ring; cx <= cellX + ring && slot < SPIRE_POOL; cx++) {
      for (let cz = cellZ - ring; cz <= cellZ + ring && slot < SPIRE_POOL; cz++) {
        const wx = (cx + 0.5) * FAR_CELL
        const wz = (cz + 0.5) * FAR_CELL
        const d = Math.hypot(wx - px, wz - pz)
        if (d > radius) continue
        // Spires stay outside the playfield so they never crowd the islands.
        if (d < 130) continue
        const rng = mulberry32(
          (hashInts(worldState.trackSeed, worldState.depth, cx, cz) ^ 0x5f1e5) >>> 0,
        )
        const count = Math.min(3, Math.floor(rng() * 3 * mods.spireDensity))
        for (let k = 0; k < count && slot < SPIRE_POOL; k++) {
          // shattered-monolith silhouettes: taller, narrower, tilted. New rng
          // draws are appended after the legacy ones within each spire's
          // block, so the per-cell stream stays deterministic.
          const x = cx * FAR_CELL + range(rng, 12, FAR_CELL - 12)
          const z = cz * FAR_CELL + range(rng, 12, FAR_CELL - 12)
          const h = range(rng, 40, 110) * mods.spireHeightMult
          const w = h * range(rng, 0.07, 0.13)
          const rotY = range(rng, 0, Math.PI * 2)
          const tiltX = range(rng, -0.1, 0.1)
          const tiltZ = range(rng, -0.12, 0.12)
          dummy.position.set(x, -75, z)
          dummy.scale.set(w, h, w)
          dummy.rotation.set(tiltX, rotY, tiltZ)
          dummy.updateMatrix()
          m.setMatrixAt(slot, dummy.matrix)
          slot++
        }
      }
    }
    for (; slot < SPIRE_POOL; slot++) m.setMatrixAt(slot, hiddenMatrix)
    m.instanceMatrix.needsUpdate = true
  }

  useFrame((_, dt) => {
    const px = snapController.pos.x
    const pz = snapController.pos.z

    // Cloud sea follows the player; texture offsets compensate the ride so the
    // pattern reads world-fixed, with the slow ambient scroll on top.
    const scroll = dt * (0.004 + 0.01 * visuals.eI)
    scrollA.current += scroll
    scrollB.current -= scroll * 0.7
    if (clouds.current) clouds.current.position.set(px, 0, pz)
    texA.offset.set(scrollA.current + (px / 700) * 3, -(pz / 700) * 3)
    texB.offset.set(scrollB.current + (px / 950) * 4, -(pz / 950) * 4)
    if (matA.current) {
      matA.current.color.copy(tmp.copy(cloudTint).multiplyScalar(visuals.cloudGlow))
    }
    if (matB.current) {
      matB.current.color.copy(tmp.copy(cloudTint).multiplyScalar(visuals.cloudGlow * 0.7))
    }
    if (meshB.current) meshB.current.visible = governor.level < 2

    // Far-grid spires: restream on far-cell crossing / realm swap / governor step.
    const fs = farState.current
    const cellX = Math.floor(px / FAR_CELL)
    const cellZ = Math.floor(pz / FAR_CELL)
    const gov = governor.level >= 2 ? 1 : 0
    if (cellX !== fs.cellX || cellZ !== fs.cellZ || fs.epoch !== worldState.epoch || fs.gov !== gov) {
      fs.cellX = cellX
      fs.cellZ = cellZ
      fs.epoch = worldState.epoch
      fs.gov = gov
      restreamSpires(px, pz, gov ? 300 : FAR_RADIUS)
    }
    // body stays the near-black silhouette; the vein columns ride spireGlow
    // into HDR only at high tiers (crossing bloom is the PEAK payoff)
    spireMaterial.color.copy(tmp.copy(spireBase).multiplyScalar(visuals.spireGlow))
    veinColor.copy(veinBase).multiplyScalar(0.5 + 1.4 * visuals.spireGlow)
  })

  return (
    <>
      <group ref={clouds}>
        <mesh geometry={geoA} position={[0, CLOUD_Y_A, 0]}>
          <meshBasicMaterial
            ref={matA}
            map={texA}
            vertexColors
            transparent
            blending={AdditiveBlending}
            depthWrite={false}
            fog={false}
            toneMapped={false}
          />
        </mesh>
        <mesh ref={meshB} geometry={geoB} position={[0, CLOUD_Y_B, 0]}>
          <meshBasicMaterial
            ref={matB}
            map={texB}
            vertexColors
            transparent
            blending={AdditiveBlending}
            depthWrite={false}
            fog={false}
            toneMapped={false}
          />
        </mesh>
      </group>
      <instancedMesh
        ref={spires}
        args={[spireGeo, spireMaterial, SPIRE_POOL]}
        frustumCulled={false}
      />
    </>
  )
}
