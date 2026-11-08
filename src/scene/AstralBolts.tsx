import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  type InstancedMesh,
} from 'three'
import { ENEMY } from '../game/enemyArchetypes'
import { enemyState } from '../game/enemyState'
import { bowFrame } from './bowFrame'
import { BURST } from './burstVocab'
import { governor } from './perfGovernor'
import { snapController } from './snapController'
import { visuals } from './visualTuning'
import type { Palette } from '../theme/palettes'

const CAP = ENEMY.BOLT_CAP
/** Extra instance slot: the muzzle ember riding ahead of the hand — the
 * boltGlow readiness cue (cooldown cadence made visible, zero extra draws). */
const MUZZLE_SLOT = CAP
const hiddenMatrix = new Matrix4().makeScale(1e-4, 1e-4, 1e-4)
const dummy = new Object3D()

/**
 * The RMB astral bolts: one InstancedMesh of stretched additive octahedra in
 * the streak-ghost language. EchoPass smears the HDR movers into free tracers
 * whenever the echo is live (bolts stretch longer at governor L4 where the
 * echo is off). Impact feedback comes from the feel ring (EnemyDirector) —
 * this component only adds a fizzle where a bolt dies.
 */
export function AstralBolts({ palette }: { palette: Palette }) {
  const meshRef = useRef<InstancedMesh>(null)
  const geo = useMemo(() => new OctahedronGeometry(0.5, 0), [])
  const mat = useMemo(
    () =>
      new MeshBasicMaterial({
        color: new Color('#ffffff'),
        transparent: true,
        opacity: 0.95,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  )
  useEffect(() => {
    return () => {
      geo.dispose()
      mat.dispose()
    }
  }, [geo, mat])
  // cached tint pair: base trail-white, and the frenzy-hot shift the x1.5
  // damage rite earns (lerped per-frame between these — zero alloc)
  const tint = useMemo(() => {
    const base = new Color(palette.trail).lerp(new Color('#ffffff'), 0.35).multiplyScalar(3)
    const hot = new Color('#ff4a30').lerp(new Color('#ffffff'), 0.25).multiplyScalar(3.4)
    return { base, hot }
  }, [palette])
  useEffect(() => {
    mat.color.copy(tint.base)
  }, [tint, mat])

  const track = useRef({
    serial: new Uint32Array(CAP),
    x: new Float32Array(CAP),
    y: new Float32Array(CAP),
    z: new Float32Array(CAP),
    wasActive: new Uint8Array(CAP),
  })

  useFrame(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const b = enemyState.bolts
    const tr = track.current
    // frenzy heats the whole stream toward white-red while the rite runs
    const frenzy = visuals.frenzyAura
    mat.color.copy(tint.base)
    if (frenzy > 0.01) mat.color.lerp(tint.hot, 0.6 * frenzy)
    // echo off at L4 — longer solids keep the tracer read without it
    const stretch = governor.level >= 4 ? 2.6 : 1.9
    for (let i = 0; i < CAP; i++) {
      if (!b.active[i]) {
        if (tr.wasActive[i]) {
          // fizzle where the bolt died — real impacts spark from the feel
          // ring in EnemyDirector (the old lifetime inference dropped hits
          // landing in the last 50ms of bolt life)
          snapController.pendingBursts.push({ x: tr.x[i], y: tr.y[i], z: tr.z[i], count: 4, style: BURST.MUZZLE })
          tr.wasActive[i] = 0
          mesh.setMatrixAt(i, hiddenMatrix)
        }
        continue
      }
      tr.wasActive[i] = 1
      tr.serial[i] = b.serial[i]
      tr.x[i] = b.x[i]
      tr.y[i] = b.y[i]
      tr.z[i] = b.z[i]
      dummy.position.set(b.x[i], b.y[i], b.z[i])
      // align the long axis to the velocity
      dummy.lookAt(b.x[i] + b.vx[i], b.y[i] + b.vy[i], b.z[i] + b.vz[i])
      // a charged shot is a heavy comet: girth and length grow with power
      const pw = b.power[i]
      const xy = 0.28 + 0.3 * pw
      dummy.scale.set(xy, xy, stretch * (1 + 0.35 * pw))
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    // muzzle ember: the readiness cue only. The crystal bow's nocked arrow
    // absorbed the draw-orb role — the ember fades out as the bow manifests
    // and remains the sole cast-ready pulse while the weapon is dissolved.
    const sc = snapController
    const glow = visuals.boltGlow
    const casting = sc.cast.phase !== 0 // CP.IDLE
    const s =
      (0.06 + 0.5 * glow * glow) * (casting ? 1 : 0.35) * (1 - 0.85 * bowFrame.manifest)
    if (s > 0.02) {
      dummy.position.set(
        sc.pos.x + sc.forward.x * 1.2,
        sc.pos.y + sc.forward.y * 1.2 + 0.15,
        sc.pos.z + sc.forward.z * 1.2,
      )
      dummy.lookAt(dummy.position.x + sc.forward.x, dummy.position.y + sc.forward.y, dummy.position.z + sc.forward.z)
      dummy.scale.set(s, s, s * 1.6)
      dummy.updateMatrix()
      mesh.setMatrixAt(MUZZLE_SLOT, dummy.matrix)
    } else {
      mesh.setMatrixAt(MUZZLE_SLOT, hiddenMatrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={el => {
        meshRef.current = el
        if (el) {
          el.instanceMatrix.setUsage(DynamicDrawUsage)
          for (let i = 0; i <= CAP; i++) el.setMatrixAt(i, hiddenMatrix)
        }
      }}
      args={[geo, mat, CAP + 1]}
      frustumCulled={false}
    />
  )
}
