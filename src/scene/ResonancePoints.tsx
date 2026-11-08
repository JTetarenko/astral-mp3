import { useFrame, useLoader } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import {
  Color,
  AdditiveBlending,
  DodecahedronGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Matrix4,
  Object3D,
  OctahedronGeometry,
  TextureLoader,
  TorusGeometry,
  Vector3,
  type BufferAttribute,
  type BufferGeometry,
  type Group,
  type InstancedMesh,
  type Mesh,
  type MeshBasicMaterial,
  type Sprite,
  type SpriteMaterial,
} from 'three'
import { audioFrame } from '../audio/reactiveBus'
import { runState } from '../game/runState'
import { mulberry32 } from '../game/seededRandom'
import { WORLD, worldState } from '../game/worldState'
import {
  crackPlanesForVariant,
  crackValue,
  CRYSTAL_VARIANTS,
  crystalVariantSeed,
  pickCrystalVariant,
} from './crystalGeom'
import { governor } from './perfGovernor'
import { ATLAS_COLS, ATLAS_ROWS, glyphUvOffset } from './runeAtlas'
import { snapController } from './snapController'
import { smoothstep, T, visuals } from './visualTuning'
import type { Palette } from '../theme/palettes'

const POOL = WORLD.POINT_POOL
const STONES_PER = 4
const FLASH_DUR = 0.4
const RING_DUR = 0.6

const tmp = new Color()
const dummy = new Object3D()
const hiddenMatrix = new Matrix4().makeScale(1e-4, 1e-4, 1e-4)
const scratchV = new Vector3()
const SLOT_INDICES = Array.from({ length: POOL }, (_, i) => i)

/** Elongated cracked-gem geometry: octahedron detail 1, position-keyed jitter
 * (welded), two-tone vertex colors from seeded crack planes — dark body,
 * HDR crack faces that bloom (the CrystalShards trick). */
function makeCrystalGeometry(variant: number): BufferGeometry {
  const geo = new OctahedronGeometry(1, 1)
  const rng = mulberry32((0xc0de + variant * 131) >>> 0)
  const k1 = new Vector3(
    3 + rng() * 4,
    3 + rng() * 4,
    3 + rng() * 4,
  )
  const planes = crackPlanesForVariant(variant)
  const pos = geo.attributes.position as BufferAttribute
  const v = new Vector3()
  const colors = new Float32Array(pos.count * 3)
  // chipped-ancient jitter, keyed on position so duplicated verts stay welded
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const d = 1 + 0.06 * Math.sin(v.dot(k1))
    pos.setXYZ(i, v.x * d * 0.55, v.y * d * 1.35, v.z * d * 0.55)
  }
  // per-face crack classification on the (normalized) face centroid
  for (let f = 0; f < pos.count; f += 3) {
    v.set(
      pos.getX(f) + pos.getX(f + 1) + pos.getX(f + 2),
      pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2),
      pos.getZ(f) + pos.getZ(f + 1) + pos.getZ(f + 2),
    ).normalize()
    const val = crackValue(v.x, v.y, v.z, planes)
    for (let k = 0; k < 3; k++) {
      colors[(f + k) * 3] = val
      colors[(f + k) * 3 + 1] = val
      colors[(f + k) * 3 + 2] = val
    }
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return geo
}

/** Carved bound-stone chunk (shared by all 64 instances). */
function makeStoneGeometry(): BufferGeometry {
  const geo = new DodecahedronGeometry(0.16, 0)
  const pos = geo.attributes.position as BufferAttribute
  const v = new Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const d = 1 + 0.18 * Math.sin(v.x * 21.7 + v.y * 17.3 + v.z * 25.1)
    pos.setXYZ(i, v.x * d, v.y * d, v.z * d)
  }
  return geo
}

/**
 * Diegetic resonance artifacts from the infinite pool: a levitating cracked
 * crystal bound by four orbiting stones. The crystal's cracks are HDR vertex
 * colors (bloom); targeting tightens the stone orbit and flares the cracks
 * with the live aim quality (snapController.targetScore) — the same signal
 * the aim thread reads. Collection bursts the stones outward. The group stays
 * EXACTLY at the pool coordinates — aim/spawn/collect logic is untouched.
 */
export function ResonancePoints({ palette }: { palette: Palette }) {
  const groups = useRef<(Group | null)[]>([])
  const crystalMats = useRef<(MeshBasicMaterial | null)[]>([])
  const crystals = useRef<(Mesh | null)[]>([])
  const sprites = useRef<(Sprite | null)[]>([])
  const spriteMats = useRef<(SpriteMaterial | null)[]>([])
  const stonesMesh = useRef<InstancedMesh>(null)
  const ringMesh = useRef<Mesh>(null)
  const ringMat = useRef<MeshBasicMaterial>(null)
  const lastSerial = useRef(new Uint32Array(POOL).fill(0xffffffff))
  const slotPhase = useRef(new Float32Array(POOL))
  const stoneAngle = useRef(new Float32Array(POOL))
  const targetBlend = useRef(new Float32Array(POOL))
  const frameParity = useRef(0)

  const runesTex = useLoader(TextureLoader, '/assets/runes.png')
  const glyphTextures = useMemo(
    () =>
      SLOT_INDICES.map(() => {
        const tex = runesTex.clone()
        tex.repeat.set(1 / ATLAS_COLS, 1 / ATLAS_ROWS)
        tex.needsUpdate = true
        return tex
      }),
    [runesTex],
  )

  const crystalGeos = useMemo(
    () => Array.from({ length: CRYSTAL_VARIANTS }, (_, v) => makeCrystalGeometry(v)),
    [],
  )
  const stoneGeo = useMemo(makeStoneGeometry, [])
  const ringGeo = useMemo(() => new TorusGeometry(1, 0.05, 6, 48), [])
  const primaryHdr = useMemo(() => new Color(palette.primary), [palette])
  const secondaryHdr = useMemo(() => new Color(palette.secondary), [palette])
  const runeHdr = useMemo(() => new Color(palette.rune).multiplyScalar(1.8), [palette])
  const white = useMemo(() => new Color('#ffffff'), [])

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime
    const pts = worldState.points
    const rm = visuals.rm
    const gov = governor.level
    const bass = audioFrame.bass
    const beatPulse = 1 + 0.08 * T(0.6, 1, 1.3, 1.5) * Math.sin(audioFrame.beatPhase * Math.PI * 2)
    const stones = stonesMesh.current
    if (!stones) return
    frameParity.current ^= 1
    const writeStones = gov < 3 || frameParity.current === 0

    for (let i = 0; i < POOL; i++) {
      const g = groups.current[i]
      const crystal = crystals.current[i]
      const crystalMat = crystalMats.current[i]
      const sprite = sprites.current[i]
      const spriteMat = spriteMats.current[i]
      if (!g || !crystal || !crystalMat) continue

      // Respawn: re-roll variant/phase/glyph and snap to the new position.
      if (lastSerial.current[i] !== pts.serial[i]) {
        lastSerial.current[i] = pts.serial[i]
        const seed = crystalVariantSeed(pts.serial[i], i)
        crystal.geometry = crystalGeos[pickCrystalVariant(seed)]
        const rng = mulberry32(seed)
        slotPhase.current[i] = rng() * Math.PI * 2
        crystal.rotation.y = rng() * Math.PI * 2
        stoneAngle.current[i] = rng() * Math.PI * 2
        targetBlend.current[i] = 0
        const uv = glyphUvOffset(pts.serial[i] * 5 + i)
        glyphTextures[i].offset.set(uv.x, uv.y)
      }

      const active = pts.active[i] === 1
      const flashAge = pts.flashAt[i] > 0 ? t - pts.flashAt[i] : Infinity

      if (!active && flashAge >= FLASH_DUR) {
        if (g.visible) g.visible = false
        if (writeStones) {
          for (let k = 0; k < STONES_PER; k++) stones.setMatrixAt(i * STONES_PER + k, hiddenMatrix)
        }
        continue
      }
      g.visible = true
      g.position.set(pts.x[i], pts.y[i], pts.z[i])

      const isTarget = snapController.target === i
      const tb = targetBlend.current[i]
      targetBlend.current[i] = Math.max(
        0,
        Math.min(1, tb + (isTarget ? 6 : -6) * dt),
      )
      const ph = slotPhase.current[i]

      // levitation: the CHILD bobs — the group stays on the aim point
      const bobAmp = rm ? 0.06 : 0.12
      crystal.position.y = bobAmp * Math.sin(t * 0.9 + ph)
      crystal.rotation.y += dt * 0.25 * (rm ? 0.5 : 1)

      // stone orbit: accumulate so bass modulates SPEED, not position jumps
      if (gov < 4) {
        stoneAngle.current[i] +=
          dt * (0.5 + 0.8 * bass) * (1 + 0.8 * tb) * (rm ? 0.6 : 1)
      }

      if (!active && flashAge < FLASH_DUR) {
        // collection flash: crystal whites out, stones burst outward
        const k = flashAge / FLASH_DUR
        crystalMat.color.copy(tmp.copy(white).lerp(primaryHdr, k)).multiplyScalar(4 * (1 - k) + 0.8)
        g.scale.setScalar(1.5 - k * 0.7)
        if (sprite && spriteMat) {
          sprite.visible = true
          sprite.scale.setScalar(1.4 + k * 1.6)
          spriteMat.opacity = 0.9 * (1 - k)
        }
        if (writeStones) {
          const burstR = 1.15 + k * 4
          for (let k2 = 0; k2 < STONES_PER; k2++) {
            const a = stoneAngle.current[i] + (k2 * Math.PI * 2) / STONES_PER
            scratchV.set(
              Math.cos(a) * burstR,
              Math.sin(a * 1.7 + ph) * 0.5 + k * 1.5,
              Math.sin(a) * burstR,
            )
            dummy.position.copy(g.position).add(scratchV)
            dummy.rotation.set(a, a * 1.3, 0)
            dummy.scale.setScalar(1 - k * 0.8)
            dummy.updateMatrix()
            stones.setMatrixAt(i * STONES_PER + k2, dummy.matrix)
            stones.setColorAt(i * STONES_PER + k2, tmp.copy(white).multiplyScalar(2.5 * (1 - k)))
          }
        }
      } else {
        // near-aim glow: anything within ~24 degrees of the view direction
        // brightens BEFORE lock — "these are the things" at a glance
        const sc = snapController
        scratchV.set(pts.x[i] - sc.camPos.x, pts.y[i] - sc.camPos.y, pts.z[i] - sc.camPos.z)
        const len = scratchV.length() || 1
        const viewDot =
          (scratchV.x * sc.forward.x + scratchV.y * sc.forward.y + scratchV.z * sc.forward.z) / len
        const nearAim = smoothstep(0.913, 0.99, viewDot)
        // idle / targeted crystal tint (vertex colors carry body-vs-crack)
        const flare = rm
          ? 1 + 0.3 * tb
          : 1 + 1.5 * snapController.targetScore * tb
        const base =
          (1.8 + 1.4 * tb + 0.5 * bass * visuals.bassReact) * flare * (1 + 0.6 * nearAim)
        crystalMat.color.copy(primaryHdr).multiplyScalar(base * (0.9 + 0.1 * beatPulse))
        g.scale.setScalar((1 + 0.18 * tb) * beatPulse)
        if (sprite && spriteMat) {
          sprite.visible = true
          sprite.scale.setScalar(1.4)
          sprite.position.y = 2.6 + Math.sin(t * 1.2 + i * 1.7) * 0.15
          spriteMat.opacity = 0.45 + 0.5 * tb + 0.25 * nearAim * (1 - tb)
          spriteMat.color.copy(runeHdr).multiplyScalar(1 + 0.5 * tb)
        }
        if (writeStones) {
          const radius = 1.15 - 0.3 * tb + 0.1 * Math.sin(t * 0.7 + ph)
          const bright = 0.12 + 0.78 * tb
          for (let k2 = 0; k2 < STONES_PER; k2++) {
            const a = stoneAngle.current[i] + (k2 * Math.PI * 2) / STONES_PER
            scratchV.set(
              Math.cos(a) * radius,
              0.35 * Math.sin(a * 2 + ph + k2) + (gov >= 4 ? 0 : 0.15 * Math.sin(t * 1.3 + k2 * 2.1)),
              Math.sin(a) * radius,
            )
            dummy.position.copy(g.position).add(scratchV)
            dummy.rotation.set(a * 0.7 + k2, a + t * 0.4, k2 * 1.9)
            dummy.scale.setScalar(1)
            dummy.updateMatrix()
            stones.setMatrixAt(i * STONES_PER + k2, dummy.matrix)
            stones.setColorAt(i * STONES_PER + k2, tmp.copy(secondaryHdr).multiplyScalar(bright))
          }
        }
      }
    }

    if (writeStones) {
      stones.instanceMatrix.needsUpdate = true
      if (stones.instanceColor) stones.instanceColor.needsUpdate = true
    }

    // Shared expanding activation ring
    const ring = ringMesh.current
    const rMat = ringMat.current
    const last = runState.lastActivation
    if (ring && rMat) {
      const age = last ? t - last.at : Infinity
      if (last && age < RING_DUR) {
        const k = age / RING_DUR
        ring.visible = true
        ring.position.set(last.x, last.y, last.z)
        ring.rotation.x = Math.PI / 2
        ring.scale.setScalar(1 + k * 14)
        rMat.opacity = 0.8 * (1 - k)
        rMat.color.copy(tmp.copy(secondaryHdr).lerp(white, k * 0.6))
      } else {
        ring.visible = false
      }
    }
  })

  return (
    <>
      {SLOT_INDICES.map(i => (
        <group
          key={i}
          visible={false}
          ref={el => {
            groups.current[i] = el
          }}
        >
          <mesh
            geometry={crystalGeos[0]}
            ref={el => {
              crystals.current[i] = el
            }}
          >
            <meshBasicMaterial
              ref={el => {
                crystalMats.current[i] = el
              }}
              color={primaryHdr}
              vertexColors
              toneMapped={false}
              fog={false}
            />
          </mesh>
          <sprite
            position={[0, 2.6, 0]}
            scale={[1.4, 1.4, 1]}
            ref={el => {
              sprites.current[i] = el
            }}
          >
            <spriteMaterial
              ref={el => {
                spriteMats.current[i] = el
              }}
              map={glyphTextures[i]}
              color={runeHdr}
              blending={AdditiveBlending}
              transparent
              opacity={0.45}
              depthWrite={false}
              toneMapped={false}
              fog={false}
            />
          </sprite>
        </group>
      ))}
      <instancedMesh
        ref={el => {
          stonesMesh.current = el
          if (el) {
            el.instanceMatrix.setUsage(DynamicDrawUsage)
            for (let k = 0; k < POOL * STONES_PER; k++) el.setMatrixAt(k, hiddenMatrix)
          }
        }}
        args={[stoneGeo, undefined, POOL * STONES_PER]}
        frustumCulled={false}
      >
        <meshBasicMaterial color="#ffffff" toneMapped={false} fog={false} />
      </instancedMesh>
      <mesh ref={ringMesh} geometry={ringGeo} visible={false}>
        <meshBasicMaterial
          ref={ringMat}
          color={palette.secondary}
          transparent
          opacity={0}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          fog={false}
        />
      </mesh>
    </>
  )
}
