import { useFrame, useLoader } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Matrix4,
  Object3D,
  PlaneGeometry,
  TextureLoader,
  Vector3,
  type Group,
  type InstancedMesh,
} from 'three'
import { governor } from './perfGovernor'
import { snapController } from './snapController'
import { forcing, visuals } from './visualTuning'
import type { Palette } from '../theme/palettes'

/**
 * Shooting stars during PEAK/SHATTER: stretched streak sprites gliding along
 * great-circle arcs just inside the nebula shell (r 330-370). Spawned on bar
 * wraps (probability = visuals.cometRate), on drop impacts (two at once), or
 * by the J debug key. One instanced draw call, pool of 5.
 */
const POOL = 5
const R_MIN = 330
const R_MAX = 370

interface CometSlot {
  active: boolean
  age: number
  life: number
  theta0: number
  omega: number
  radius: number
  u: Vector3
  v: Vector3
}

const dummy = new Object3D()
const tmpColor = new Color()
const basis = new Matrix4()
const px = new Vector3()
const tx = new Vector3()
const nx = new Vector3()
const yx = new Vector3()

/** Random great-circle basis whose visible arc segment stays above y ~ -10. */
function rollPath(slot: CometSlot): void {
  for (let attempt = 0; attempt < 8; attempt++) {
    slot.u
      .set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1)
      .normalize()
    slot.v
      .set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1)
      .cross(slot.u)
    if (slot.v.lengthSq() < 1e-4) continue
    slot.v.normalize()
    slot.theta0 = Math.random() * Math.PI * 2
    const span = slot.omega * slot.life
    let ok = true
    for (let k = 0; k <= 4; k++) {
      const th = slot.theta0 + span * (k / 4)
      const y = (Math.cos(th) * slot.u.y + Math.sin(th) * slot.v.y) * slot.radius
      if (y < -10 || y > 300) {
        ok = false
        break
      }
    }
    if (ok) return
  }
  // last resort: horizontal-ish circle high in the sky
  slot.u.set(1, 0.15, 0).normalize()
  slot.v.set(0, 0.25, 1).normalize()
  slot.theta0 = Math.random() * Math.PI * 2
}

export function Comets({ palette }: { palette: Palette }) {
  const mesh = useRef<InstancedMesh>(null)
  const group = useRef<Group>(null)
  const cometTex = useLoader(TextureLoader, '/assets/comet.png')
  const geometry = useMemo(() => new PlaneGeometry(1, 1), [])
  useEffect(() => () => geometry.dispose(), [geometry])

  const slots = useMemo<CometSlot[]>(
    () =>
      Array.from({ length: POOL }, () => ({
        active: false,
        age: 0,
        life: 5,
        theta0: 0,
        omega: 0.25,
        radius: 350,
        u: new Vector3(1, 0, 0),
        v: new Vector3(0, 0, 1),
      })),
    [],
  )
  const trackers = useRef({
    lastWrap: visuals.barWrapCount,
    lastNova: visuals.novaCount,
    rollAcc: 0,
  })
  const tint = useMemo(() => new Color(palette.particle).lerp(new Color('#ffffff'), 0.5), [palette])

  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    for (let i = 0; i < POOL; i++) {
      dummy.position.set(0, -999, 0)
      dummy.scale.setScalar(1e-4)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
      m.setColorAt(i, tmpColor.setScalar(0))
    }
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [])

  useFrame((_, frameDt) => {
    const m = mesh.current
    if (!m) return
    // arcs ride with the player — the sky show is the same everywhere
    if (group.current) {
      group.current.position.set(snapController.pos.x, 0, snapController.pos.z)
    }
    const dt = Math.min(0.1, frameDt)
    const tr = trackers.current
    const poolLimit = governor.level >= 3 ? 0 : governor.level === 2 ? 3 : POOL
    const maxLive = visuals.w3 > 0.5 ? 3 : 2

    let live = 0
    for (const s of slots) if (s.active) live++

    const spawn = (n: number) => {
      for (let k = 0; k < n; k++) {
        if (live >= Math.min(maxLive, poolLimit)) return
        let idx = -1
        for (let j = 0; j < poolLimit; j++) {
          if (!slots[j].active) {
            idx = j
            break
          }
        }
        if (idx < 0) return
        const s = slots[idx]
        s.active = true
        s.age = 0
        s.life = 4.5 + Math.random() * 1.5
        s.omega = (0.22 + Math.random() * 0.08) * (Math.random() < 0.5 ? -1 : 1)
        s.radius = R_MIN + Math.random() * (R_MAX - R_MIN)
        rollPath(s)
        live++
      }
    }

    // triggers: bar wrap (probability), impact (pair), fallback roll, debug key
    const inLoud = visuals.w2 + visuals.w3 > 0.5
    if (visuals.barWrapCount !== tr.lastWrap) {
      tr.lastWrap = visuals.barWrapCount
      if (inLoud && Math.random() < visuals.cometRate) spawn(1)
    }
    if (visuals.barSync <= 0.01) {
      // no usable downbeats (low grid OR bar confidence): timer-roll fallback
      tr.rollAcc += dt
      if (tr.rollAcc >= 1.8) {
        tr.rollAcc = 0
        if (inLoud && Math.random() < visuals.cometRate) spawn(1)
      }
    }
    if (visuals.novaCount !== tr.lastNova) {
      tr.lastNova = visuals.novaCount
      spawn(2)
    }
    if (forcing.cometNow) {
      forcing.cometNow = false
      spawn(1)
    }

    for (let i = 0; i < POOL; i++) {
      const s = slots[i]
      if (!s.active) continue
      s.age += dt
      if (s.age >= s.life || i >= poolLimit) {
        s.active = false
        dummy.position.set(0, -999, 0)
        dummy.scale.setScalar(1e-4)
        dummy.rotation.set(0, 0, 0)
        dummy.updateMatrix()
        m.setMatrixAt(i, dummy.matrix)
        m.setColorAt(i, tmpColor.setScalar(0))
        continue
      }
      const th = s.theta0 + s.omega * s.age * visuals.cometSpeedMult
      const c = Math.cos(th)
      const sn = Math.sin(th)
      px.set(
        (c * s.u.x + sn * s.v.x) * s.radius,
        (c * s.u.y + sn * s.v.y) * s.radius,
        (c * s.u.z + sn * s.v.z) * s.radius,
      )
      // tangent (motion direction), radial-in, and their normal form the basis;
      // local -x carries the streak head, so it leads the motion
      tx.set(-sn * s.u.x + c * s.v.x, -sn * s.u.y + c * s.v.y, -sn * s.u.z + c * s.v.z)
      if (s.omega < 0) tx.negate()
      tx.negate() // head (low-u side of the texture) points along motion
      nx.copy(px).multiplyScalar(-1 / s.radius)
      yx.crossVectors(nx, tx)
      basis.makeBasis(tx, yx, nx)
      dummy.position.copy(px)
      dummy.rotation.setFromRotationMatrix(basis)
      dummy.scale.set(34, 3, 1)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
      const f = s.age / s.life
      const fade =
        Math.min(1, f / 0.15) * (1 - Math.max(0, (f - 0.85) / 0.15)) * (0.6 + 0.4 * visuals.vi)
      m.setColorAt(i, tmpColor.copy(tint).multiplyScalar(fade * 1.5))
    }
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  })

  return (
    <group ref={group}>
      <instancedMesh ref={mesh} args={[geometry, undefined, POOL]} frustumCulled={false}>
        <meshBasicMaterial
          map={cometTex}
          transparent
          blending={AdditiveBlending}
          depthWrite={false}
          side={DoubleSide}
          fog={false}
          toneMapped={false}
        />
      </instancedMesh>
    </group>
  )
}
