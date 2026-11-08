import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  Color,
  Float32BufferAttribute,
  LatheGeometry,
  Vector2,
  type Mesh,
  type MeshBasicMaterial,
} from 'three'
import { audioFrame } from '../audio/reactiveBus'
import { runState } from '../game/runState'
import { worldState } from '../game/worldState'
import { snapController } from './snapController'
import { charmIgnition, gemProfile } from './wingGeom'
import type { Palette } from '../theme/palettes'

export const CHARM_COUNT = 3

/** Shift-swap instant (mirrors snapController's SHIFT_SWAP_T). */
const SHIFT_SWAP_T = 0.45

/**
 * The three resonance charms orbiting the wraith — the diegetic REALM GATE
 * charge meter, replacing the old unreadable "floating rocks". Each charm
 * ignites over one third of the shift charge; the charm that swallows a fresh
 * pickup pops white-hot for a beat. At full charge all three burn and spin
 * excited; once the gate materializes they stream out toward it like a
 * compass. During a snap streak they fan toward the target, and through a
 * realm shift they collapse into the body with the rest of the avatar.
 */
export function CharmShards({ palette }: { palette: Palette }) {
  const meshes = useRef<(Mesh | null)[]>([])
  const mats = useRef<(MeshBasicMaterial | null)[]>([])
  // mini resonance stones: the relic gem-lathe recipe at charm scale (the old
  // bare tetrahedra were the last primitive on the player). Two-tone facet
  // bands baked into vertex colors (the CrystalShards idiom) keep the cut-
  // stone read under the animated flat tint; EchoPass smears the HDR movers
  // into free orbit tracers, so no extra trail geometry is needed.
  const geo = useMemo(() => {
    const pts = gemProfile().map(([r, y]) => new Vector2(r * 0.12, y * 0.12))
    const g = new LatheGeometry(pts, 6).toNonIndexed()
    const pos = g.attributes.position
    const cols = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i)
      const v = y > 0.03 ? 1.5 : y > -0.04 ? 1.0 : 0.55
      cols[i * 3] = v
      cols[i * 3 + 1] = v
      cols[i * 3 + 2] = v
    }
    g.setAttribute('color', new Float32BufferAttribute(cols, 3))
    return g
  }, [])
  useEffect(() => () => geo.dispose(), [geo])

  const runeHdr = useMemo(() => new Color(palette.rune).multiplyScalar(2.2), [palette])
  const dim = useMemo(() => new Color(palette.secondary).multiplyScalar(0.28), [palette])
  const white = useMemo(() => new Color('#ffffff').multiplyScalar(4), [])
  const tmp = useMemo(() => new Color(), [])

  const st = useRef({
    lastCharge: -1,
    popT: [9, 9, 9],
    reach: 0,
    gateK: 0,
  })

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const t = clock.elapsedTime
    const sc = snapController
    const s = st.current
    const k = (tau: number) => 1 - Math.exp(-dt / tau)

    const charge = runState.shiftCharge
    const cost = Math.max(1, runState.shiftCost)
    // a fresh pickup pops the charm that swallowed it
    if (s.lastCharge < 0) s.lastCharge = charge
    if (charge > s.lastCharge) {
      if (s.lastCharge < cost && charge >= cost) {
        // CHARGE FULL: all three charms pop white at once — the gate is armed
        s.popT[0] = s.popT[1] = s.popT[2] = 0
      } else {
        s.popT[Math.min(2, Math.max(0, Math.floor(((charge - 0.5) / cost) * 3)))] = 0
      }
    }
    s.lastCharge = charge
    const frac = Math.min(1, charge / cost)

    // pose blends: streak/pull fan, gate compass, shift collapse
    const phase = sc.phase
    // the draw pulls the charms forward too — diegetic bow tension
    const reachT =
      phase === 'streak' || phase === 'pull' ? 1 : 0.6 * sc.tricks.castCharge
    s.reach += (reachT - s.reach) * k(0.08)
    const gate = worldState.gate
    const gateT = gate.active && phase !== 'shift' ? Math.min(1, gate.openT * 2) : 0
    s.gateK += (gateT - s.gateK) * k(0.25)
    const shiftK = phase === 'shift' ? Math.min(1, sc.phaseT / SHIFT_SWAP_T) : 0

    // gate direction in body-local space (this group lives inside the body)
    let gdx = 0
    let gdz = -1
    if (gate.active) {
      const cy = Math.cos(sc.yaw)
      const sy = Math.sin(sc.yaw)
      const wx = gate.x - sc.pos.x
      const wz = gate.z - sc.pos.z
      const lx = cy * wx - sy * wz
      const lz = sy * wx + cy * wz
      const len = Math.hypot(lx, lz) || 1
      gdx = lx / len
      gdz = lz / len
    }

    const highs = audioFrame.highs
    const bass = audioFrame.bass
    for (let i = 0; i < CHARM_COUNT; i++) {
      const m = meshes.current[i]
      const mat = mats.current[i]
      if (!m || !mat) continue
      const lit = charmIgnition(charge, cost, i)
      s.popT[i] = Math.min(9, s.popT[i] + dt)
      const pop = Math.exp(-5 * s.popT[i])

      // idle orbit, excited by charge; fans wide toward the snap target
      const ang = t * (0.8 + 2 * highs + 1.6 * frac) + (i * Math.PI * 2) / CHARM_COUNT
      const rad = 0.5 + 0.3 * s.reach
      let x = Math.cos(ang) * rad
      let y = 0.35 + 0.06 * Math.sin(2.3 * t + i * 2.1) + 0.25 * s.reach
      let z = Math.sin(ang) * rad - 0.3 * s.reach
      // compass: stream out toward the materialized gate, loosely clustered
      if (s.gateK > 0.001) {
        const spreadA = ((i - 1) * Math.PI) / 5 + 0.2 * Math.sin(t * 3 + i * 2.6)
        const ca = Math.cos(spreadA)
        const sa = Math.sin(spreadA)
        const gx = (gdx * ca - gdz * sa) * 0.62
        const gz = (gdx * sa + gdz * ca) * 0.62
        const gy = 0.42 + 0.05 * Math.sin(t * 4 + i * 1.9)
        x += (gx - x) * s.gateK
        y += (gy - y) * s.gateK
        z += (gz - z) * s.gateK
      }
      m.position.set(x, y - 0.35 * shiftK, z)
      m.rotation.set(ang, ang * 1.7 + t * 2 * frac, 0)
      const scale = (0.75 + 0.45 * lit + 0.55 * pop) * (1 - shiftK)
      m.scale.setScalar(Math.max(1e-3, scale))

      // dim ember -> realm-rune HDR as it fills; white pop on pickup;
      // full charge shimmers so "ready" is unmistakable
      tmp.copy(dim).lerp(runeHdr, lit)
      tmp.multiplyScalar(
        (0.9 + 0.5 * bass * lit) *
          (1 + (frac >= 1 ? 0.45 + 0.35 * Math.sin(t * 6 + i * 2.1) : 0) + 1.5 * s.gateK * lit),
      )
      if (pop > 0.02) tmp.lerp(white, Math.min(1, pop))
      mat.color.copy(tmp)
    }
  })

  return (
    <>
      {Array.from({ length: CHARM_COUNT }, (_, i) => (
        <mesh
          key={i}
          geometry={geo}
          ref={el => {
            meshes.current[i] = el
          }}
        >
          <meshBasicMaterial
            ref={el => {
              mats.current[i] = el
            }}
            color="#334455"
            vertexColors
            toneMapped={false}
          />
        </mesh>
      ))}
    </>
  )
}
