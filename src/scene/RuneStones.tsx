import { useFrame, useLoader } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  Color,
  DodecahedronGeometry,
  DynamicDrawUsage,
  Matrix4,
  Object3D,
  OctahedronGeometry,
  TextureLoader,
  Vector3,
  type BufferAttribute,
  type BufferGeometry,
  type Group,
  type InstancedMesh,
  type Mesh,
  type MeshBasicMaterial,
} from 'three'
import { audioFrame } from '../audio/reactiveBus'
import { runState } from '../game/runState'
import { governor } from './perfGovernor'
import { runePlaneGeometry } from './runeAtlas'
import { snapController } from './snapController'
import { visuals } from './visualTuning'
import type { Palette } from '../theme/palettes'

const STONE_COUNT = 3
const MOTE_POOL = 14 // max shiftCost across all depths
const UP = new Vector3(0, 1, 0)
/** Angular ellipse the stones ride, biased below the view axis and outside
 * the protected centerClear cone (~21 deg): center -0.52 rad, radii 0.52/0.16. */
const RING_CX = 0.52
const RING_CY = -0.52
const RING_RY = 0.16
const STONE_DIST = 2.0
const MOTE_ELEV = -0.63
const MOTE_SPAN = 1.22 // ~70 deg azimuth arc

const dummy = new Object3D()
const hiddenMatrix = new Matrix4().makeScale(1e-4, 1e-4, 1e-4)
const tmp = new Color()

/** Carved rune stone chunk (same jitter trick as the bound stones). */
function makeStoneGeometry(): BufferGeometry {
  const geo = new DodecahedronGeometry(0.13, 0)
  const pos = geo.attributes.position as BufferAttribute
  const v = new Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const d = 1 + 0.2 * Math.sin(v.x * 19.3 + v.y * 23.7 + v.z * 15.1)
    pos.setXYZ(i, v.x * d, v.y * d, v.z * d)
  }
  return geo
}

/**
 * The diegetic EQ + Realm Shift display: three carved stones orbit the camera
 * (bass / mids / highs — glyph planes glowing with their band), and an arc of
 * small motes below them ignites with the shift charge (Mandala ignition
 * language). Gate-open celebration rides visuals.gateOpenPulse — gold flare +
 * radial bloom, replacing the old "GATE OPEN" HUD text.
 *
 * Deliberately NO viewBlend gate (unlike PlayerAvatar): the stones are the
 * player's readout in BOTH view modes. Positions ease toward their targets so
 * snaps/FOV kicks make them surge — the swim is embraced, they read as
 * floating companions, not screen furniture. Mounts after <PlayerRig/>.
 */
export function RuneStones({ palette }: { palette: Palette }) {
  const stoneGroups = useRef<(Group | null)[]>([])
  const glyphMats = useRef<(MeshBasicMaterial | null)[]>([])
  const rocks = useRef<(Mesh | null)[]>([])
  const glyphs = useRef<(Mesh | null)[]>([])
  const motesMesh = useRef<InstancedMesh>(null)
  const eased = useRef(
    Array.from({ length: STONE_COUNT }, () => ({ p: new Vector3(), init: false })),
  )
  const flashAge = useRef(new Float32Array(MOTE_POOL).fill(99))
  const litLevel = useRef(new Float32Array(MOTE_POOL))
  const prevCharge = useRef(0)
  const frameParity = useRef(0)

  const runesTex = useLoader(TextureLoader, '/assets/runes.png')
  const rockGeo = useMemo(makeStoneGeometry, [])
  // stride-4 glyphs so the three stones read as distinct sigils
  const glyphGeos = useMemo(
    () => Array.from({ length: STONE_COUNT }, (_, i) => runePlaneGeometry(i * 4, 0.16)),
    [],
  )
  const moteGeo = useMemo(() => new OctahedronGeometry(0.028, 0), [])

  const bandTints = useMemo(
    () => [
      new Color(palette.primary),
      new Color(palette.secondary),
      new Color(palette.particle),
    ],
    [palette],
  )
  const rockTint = useMemo(() => new Color(palette.islandBase).multiplyScalar(0.6), [palette])
  const moteLit = useMemo(() => new Color(palette.rune), [palette])
  const moteDim = useMemo(() => new Color(palette.secondary).multiplyScalar(0.08), [palette])
  const gold = useMemo(() => new Color(palette.hudAccent), [palette])
  const scratch = useMemo(
    () => ({ right: new Vector3(), upv: new Vector3(), dir: new Vector3(), target: new Vector3() }),
    [],
  )

  useFrame(({ camera, clock }, dt) => {
    const sc = snapController
    const s = scratch
    const rm = visuals.rm
    const gov = governor.level
    const t = clock.elapsedTime
    frameParity.current ^= 1
    const writeColors = gov < 3 || frameParity.current === 0

    // camera basis from the controller (current-frame; mounts after PlayerRig)
    s.right.crossVectors(sc.forward, UP)
    if (s.right.lengthSq() < 1e-6) s.right.set(1, 0, 0)
    s.right.normalize()
    s.upv.crossVectors(s.right, sc.forward)

    const orbitT = rm ? 0.06 : 0.15
    const bands = [audioFrame.bass, audioFrame.mids, audioFrame.highs]
    const onsets = [
      audioFrame.onsetStrength,
      audioFrame.midOnsetStrength,
      audioFrame.highOnsetStrength,
    ]
    const auraGain = 1 + 0.7 * visuals.auraGlow

    for (let i = 0; i < STONE_COUNT; i++) {
      const grp = stoneGroups.current[i]
      const rock = rocks.current[i]
      const glyph = glyphs.current[i]
      const gMat = glyphMats.current[i]
      if (!grp || !rock || !glyph || !gMat) continue

      const a = (gov >= 4 ? 0 : t * orbitT) + (i * Math.PI * 2) / STONE_COUNT
      const ox = RING_CX * Math.cos(a)
      const oy = RING_CY + RING_RY * Math.sin(a)
      s.dir.copy(sc.forward).addScaledVector(s.right, ox).addScaledVector(s.upv, oy).normalize()
      s.target.copy(sc.camPos).addScaledVector(s.dir, STONE_DIST)

      const e = eased.current[i]
      if (!e.init) {
        e.init = true
        e.p.copy(s.target)
      } else {
        e.p.lerp(s.target, 1 - Math.exp(-dt / 0.12))
      }
      grp.position.copy(e.p)

      // rock tumbles slowly; the glyph plane billboards to the camera
      rock.rotation.x += dt * 0.3
      rock.rotation.y += dt * (0.2 + i * 0.07)
      glyph.quaternion.copy(camera.quaternion)

      // per-band onset pulse (steady glow only under rm / at L4)
      const pulse = rm || gov >= 4 ? 0 : 0.35 * Math.min(1, onsets[i])
      grp.scale.setScalar(1 + pulse)

      if (writeColors) {
        gMat.color
          .copy(bandTints[i])
          .multiplyScalar((0.35 + 1.4 * bands[i]) * auraGain * (1 + 1.5 * visuals.gateOpenPulse))
      }
    }

    // ---- shift-charge motes ----
    const motes = motesMesh.current
    if (!motes) return
    const cost = Math.min(MOTE_POOL, runState.shiftCost)
    const charge = Math.min(cost, runState.shiftCharge)
    if (charge > prevCharge.current) {
      for (let k = prevCharge.current; k < charge; k++) flashAge.current[k] = 0
    } else if (charge < prevCharge.current) {
      flashAge.current.fill(99)
      litLevel.current.fill(0)
    }
    prevCharge.current = charge
    const pulse = visuals.gateOpenPulse
    const dist = STONE_DIST + 0.15 * pulse // radial bloom on gate open

    for (let k = 0; k < MOTE_POOL; k++) {
      if (k >= cost) {
        motes.setMatrixAt(k, hiddenMatrix)
        continue
      }
      const az = (cost > 1 ? k / (cost - 1) - 0.5 : 0) * MOTE_SPAN
      s.dir
        .copy(sc.forward)
        .addScaledVector(s.right, az)
        .addScaledVector(s.upv, MOTE_ELEV)
        .normalize()
      dummy.position.copy(sc.camPos).addScaledVector(s.dir, dist)
      dummy.quaternion.copy(camera.quaternion)
      flashAge.current[k] += dt
      const flash = rm || gov >= 4 ? 0 : Math.exp(-5 * flashAge.current[k])
      // ignition eases in under rm instead of flashing
      const targetLit = k < charge ? 1 : 0
      litLevel.current[k] += (targetLit - litLevel.current[k]) * (1 - Math.exp(-dt / 0.15))
      const lit = litLevel.current[k]
      dummy.scale.setScalar(1 + 0.6 * flash + 0.5 * pulse)
      dummy.updateMatrix()
      motes.setMatrixAt(k, dummy.matrix)
      if (writeColors) {
        tmp
          .copy(moteDim)
          .lerp(moteLit, lit)
          .multiplyScalar(1 + lit * (0.6 + 1.6 * flash))
        if (pulse > 0.01) tmp.lerp(gold, 0.6 * pulse).multiplyScalar(1 + 2 * pulse)
        motes.setColorAt(k, tmp)
      }
    }
    motes.instanceMatrix.needsUpdate = true
    if (writeColors && motes.instanceColor) motes.instanceColor.needsUpdate = true
  })

  return (
    <>
      {Array.from({ length: STONE_COUNT }, (_, i) => (
        <group
          key={i}
          ref={el => {
            stoneGroups.current[i] = el
          }}
        >
          <mesh
            geometry={rockGeo}
            frustumCulled={false}
            ref={el => {
              rocks.current[i] = el
            }}
          >
            <meshBasicMaterial color={rockTint} toneMapped={false} />
          </mesh>
          <mesh
            geometry={glyphGeos[i]}
            frustumCulled={false}
            ref={el => {
              glyphs.current[i] = el
            }}
          >
            <meshBasicMaterial
              ref={el => {
                glyphMats.current[i] = el
              }}
              map={runesTex}
              color={bandTints[i]}
              blending={AdditiveBlending}
              transparent
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
      <instancedMesh
        ref={el => {
          motesMesh.current = el
          if (el) {
            el.instanceMatrix.setUsage(DynamicDrawUsage)
            for (let k = 0; k < MOTE_POOL; k++) el.setMatrixAt(k, hiddenMatrix)
          }
        }}
        args={[moteGeo, undefined, MOTE_POOL]}
        frustumCulled={false}
      >
        <meshBasicMaterial color="#ffffff" toneMapped={false} transparent depthWrite={false} />
      </instancedMesh>
    </>
  )
}
