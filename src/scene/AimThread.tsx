import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import {
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Mesh,
  Vector3,
} from 'three'
import { audioFrame } from '../audio/reactiveBus'
import { AIM, alignmentQuality, ENEMY_AIM, GATE_AIM, WARDEN_AIM } from '../game/aim'
import { enemyState, weakPointTarget } from '../game/enemyState'
import { SCORING } from '../game/scoring'
import { worldState } from '../game/worldState'
import { governor } from './perfGovernor'
import { fillRibbonPositions, ribbonEdges, ribbonIndices } from './ribbonGeom'
import { makeRibbonMaterial } from './ribbonMaterial'
import { snapController, TARGET_ENEMY_BASE, TARGET_GATE, TARGET_WARDEN } from './snapController'
import { slew, smoothstep, visuals } from './visualTuning'
import type { Palette } from '../theme/palettes'

const N = 40
const UP = new Vector3(0, 1, 0)
const weakEnd = { x: 0, y: 0, z: 0, open: false }

/**
 * The organic energy thread that replaces the crosshair-centric lock UX: one
 * additive camera-facing RIBBON from the player toward the aimed target
 * (upgraded off the 1px Line via ribbonGeom — width now co-encodes aim
 * quality beside brightness). Its noise CALMS, its color whitens and its body
 * FATTENS as the angular error approaches a perfect snap (thresholds shared
 * with scoring), so precision is read in-world, not off a HUD. During the
 * snap it becomes the taut white yank line. The last ~15% fades and thins to
 * nothing so the thread never covers the aim point inside the protected
 * center. MUST mount after <PlayerRig/> so camPos/forward/viewBlend are
 * current-frame.
 */
export function AimThread({ palette }: { palette: Palette }) {
  const grow = useRef(0)
  const frameParity = useRef(0)
  const noiseTime = useRef(0)
  const lastEnd = useRef(new Vector3())

  const { thread, positions, colors, posAttr, colAttr, pts, widths } = useMemo(() => {
    const geo = new BufferGeometry()
    const posAttr = new Float32BufferAttribute(new Float32Array(N * 6), 3)
    posAttr.setUsage(DynamicDrawUsage)
    const colAttr = new Float32BufferAttribute(new Float32Array(N * 6), 3)
    colAttr.setUsage(DynamicDrawUsage)
    // NB: Float32BufferAttribute COPIES its input array — alias the
    // attribute's own storage or per-frame writes never reach the GPU
    const positions = posAttr.array as Float32Array
    const colors = colAttr.array as Float32Array
    geo.setAttribute('position', posAttr)
    geo.setAttribute('color', colAttr)
    geo.setAttribute('aEdge', new Float32BufferAttribute(ribbonEdges(N), 1))
    geo.setIndex(Array.from(ribbonIndices(N)))
    const thread = new Mesh(geo, makeRibbonMaterial())
    thread.frustumCulled = false
    thread.visible = false
    const pts = new Float32Array(N * 3)
    const widths = new Float32Array(N)
    return { thread, positions, colors, posAttr, colAttr, pts, widths }
  }, [])

  const cLock = useMemo(() => new Color(palette.secondary).multiplyScalar(0.55), [palette])
  const cGood = useMemo(() => new Color(palette.primary).multiplyScalar(1.4), [palette])
  const cPerfect = useMemo(
    () => new Color(palette.primary).lerp(new Color('#ffffff'), 0.6).multiplyScalar(3.0),
    [palette],
  )
  const cGate = useMemo(() => new Color(palette.rune).multiplyScalar(1.5), [palette])
  const cHostile = useMemo(() => new Color(palette.horrorEye).multiplyScalar(1.6), [palette])
  const cHostileHot = useMemo(
    () => new Color(palette.horrorEye).lerp(new Color('#ffffff'), 0.55).multiplyScalar(3.0),
    [palette],
  )
  const cSnap = useMemo(() => new Color('#ffffff').multiplyScalar(3.2), [])
  const scratch = useMemo(
    () => ({
      origin: new Vector3(),
      end: new Vector3(),
      chord: new Vector3(),
      p1: new Vector3(),
      p2: new Vector3(),
      perp1: new Vector3(),
      perp2: new Vector3(),
      pt: new Vector3(),
      col: new Color(),
    }),
    [],
  )

  useFrame(({ camera }, dt) => {
    const sc = snapController
    const s = scratch
    const snapping = sc.phase === 'streak' || sc.phase === 'pull'
    const target = sc.target

    // ---- endpoint + quality ----
    // ORDER MATTERS: the sentinel branches must run BEFORE the `target >= 0`
    // points fallback — an enemy sentinel (200+) would index the 16-slot
    // point arrays into NaN endpoints.
    let hasTarget = false
    let q = 0
    let isGate = false
    let isHostile = false
    if (snapping) {
      hasTarget = true
      q = 1
      s.end.copy(sc.snapPoint)
      isHostile = sc.snapTargetIdx >= TARGET_ENEMY_BASE
    } else if (sc.phase === 'shift') {
      hasTarget = false
    } else if (target === TARGET_GATE) {
      const g = worldState.gate
      hasTarget = true
      isGate = true
      s.end.set(g.x, g.y, g.z)
      q = alignmentQuality(sc.targetAngle, GATE_AIM.coneHalfRad, SCORING.perfectRad, SCORING.goodRad).q
    } else if (target === TARGET_WARDEN) {
      weakPointTarget(weakEnd)
      hasTarget = weakEnd.open
      isHostile = true
      s.end.set(weakEnd.x, weakEnd.y, weakEnd.z)
      q = alignmentQuality(sc.targetAngle, WARDEN_AIM.coneHalfRad, SCORING.perfectRad, SCORING.goodRad).q
    } else if (target >= TARGET_ENEMY_BASE) {
      const e = target - TARGET_ENEMY_BASE
      const pool = enemyState.pool
      hasTarget = true
      isHostile = true
      s.end.set(pool.x[e], pool.y[e], pool.z[e])
      q = alignmentQuality(sc.targetAngle, ENEMY_AIM.coneHalfRad, SCORING.perfectRad, SCORING.goodRad).q
    } else if (target >= 0) {
      const p = worldState.points
      hasTarget = true
      s.end.set(p.x[target], p.y[target], p.z[target])
      q = alignmentQuality(sc.targetAngle, AIM.coneHalfRad, SCORING.perfectRad, SCORING.goodRad).q
    }
    if (hasTarget) lastEnd.current.copy(s.end)
    else s.end.copy(lastEnd.current) // retract along the last known thread

    // snappier attach (100ms) and retract (~85ms): the thread answers the eye
    grow.current =
      sc.phase === 'shift' ? 0 : slew(grow.current, hasTarget ? 1 : 0, 10, 12, dt)
    const g = grow.current
    thread.visible = g > 0.01
    if (!thread.visible) return

    // ---- origin: low-forward in first person, chest height in third ----
    const vb = sc.viewBlend
    s.origin
      .copy(sc.camPos)
      .addScaledVector(sc.forward, 1.1)
      .addScaledVector(UP, -0.5)
    s.origin.lerp(s.p1.copy(sc.pos).addScaledVector(UP, -0.05), vb)
    if (snapping) s.origin.copy(sc.pos) // the yank line runs from the body

    // ---- cubic bezier control points ----
    s.chord.copy(s.end).sub(s.origin)
    const len = Math.max(0.001, s.chord.length())
    s.chord.divideScalar(len)
    const droop = snapping ? 0 : 0.15 * Math.min(1, len / 20)
    s.p1
      .copy(s.origin)
      .addScaledVector(sc.forward, 0.3 * len)
      .addScaledVector(UP, -droop * len * 0.5)
    s.p2.copy(s.end).addScaledVector(s.chord, -0.25 * len).addScaledVector(UP, droop * len)

    // perpendicular frame for the organic noise
    s.perp1.crossVectors(s.chord, UP)
    if (s.perp1.lengthSq() < 1e-6) s.perp1.set(1, 0, 0)
    s.perp1.normalize()
    s.perp2.crossVectors(s.chord, s.perp1)

    // L4 freezes the writhe entirely; otherwise it calms as q -> 1
    if (governor.level < 4) noiseTime.current += dt
    const nt = noiseTime.current
    const noiseAmp = snapping
      ? 0
      : 0.35 * Math.sqrt(len) * Math.pow(1 - q, 1.5) * visuals.threadNoise

    // half-width: quality fattens the body; the taut yank line is a constant
    // cord; the tip thins to nothing inside the protected center
    const baseW = snapping
      ? visuals.threadWidthGain * 0.12
      : visuals.threadWidthGain * (0.03 + 0.09 * q)
    for (let j = 0; j < N; j++) {
      const u = (j / (N - 1)) * g
      const omu = 1 - u
      // cubic bezier
      s.pt.set(
        omu * omu * omu * s.origin.x +
          3 * omu * omu * u * s.p1.x +
          3 * omu * u * u * s.p2.x +
          u * u * u * s.end.x,
        omu * omu * omu * s.origin.y +
          3 * omu * omu * u * s.p1.y +
          3 * omu * u * u * s.p2.y +
          u * u * u * s.end.y,
        omu * omu * omu * s.origin.z +
          3 * omu * omu * u * s.p1.z +
          3 * omu * u * u * s.p2.z +
          u * u * u * s.end.z,
      )
      if (noiseAmp > 0.001) {
        const pinned = Math.sin(Math.PI * u) * noiseAmp
        const n1 = Math.sin(u * 7.3 + nt * 2.2) + 0.5 * Math.sin(u * 15.1 - nt * 3.4)
        const n2 = Math.sin(u * 9.7 - nt * 2.7) + 0.5 * Math.sin(u * 12.3 + nt * 3.1)
        s.pt.addScaledVector(s.perp1, n1 * pinned).addScaledVector(s.perp2, n2 * pinned)
      }
      pts[j * 3] = s.pt.x
      pts[j * 3 + 1] = s.pt.y
      pts[j * 3 + 2] = s.pt.z
      const uf = j / (N - 1)
      widths[j] = baseW * smoothstep(0, 0.08, uf) * (1 - smoothstep(0.85, 1, uf))
    }
    fillRibbonPositions(positions, pts, N, widths, camera.position.x, camera.position.y, camera.position.z)
    posAttr.needsUpdate = true

    // ---- colors (L3: every 2nd frame) ----
    frameParity.current ^= 1
    if (governor.level < 3 || frameParity.current === 0) {
      // continuous quality blend: dim lock -> primary -> white-hot perfect
      if (snapping) {
        s.col.copy(cSnap).multiplyScalar(sc.phase === 'pull' ? 1 - 0.6 * Math.min(1, sc.phaseT / 0.32) : 1)
        if (isHostile) s.col.lerp(cHostileHot, 0.35)
      } else if (isGate) {
        s.col.copy(cGate).multiplyScalar(0.8 + 1.2 * q)
      } else if (isHostile) {
        // the strike thread reads as a threat, never as a pickup
        s.col.copy(cHostile).lerp(cHostileHot, q)
      } else if (q < 0.5) {
        s.col.copy(cLock).lerp(cGood, q * 2)
      } else {
        s.col.copy(cGood).lerp(cPerfect, (q - 0.5) * 2)
      }
      const gain = visuals.threadGlow * (1 + 0.4 * visuals.auraGlow)
      const waveOn = audioFrame.gridConfidence > 0.5
      // perfect-band tip flare: the thread visibly BITES just before the aim
      // point when a perfect is armed (q hits 1 only inside perfectRad)
      const perfectArmed = !snapping && q >= 1 ? 0.8 + 0.6 * visuals.beatPulse : 0
      for (let j = 0; j < N; j++) {
        const u = j / (N - 1)
        // fade in off the origin, fade OUT over the last ~15% (centerClear)
        let env = smoothstep(0, 0.08, u) * (1 - smoothstep(0.85, 1, u))
        if (waveOn && !snapping) {
          const wave = 0.5 + 0.5 * Math.sin((u * 2 - audioFrame.gridPhase) * Math.PI * 2)
          env *= 0.8 + 0.2 * wave
        }
        if (perfectArmed > 0 && u > 0.7 && u < 0.85) {
          env *= 1 + perfectArmed * Math.sin(((u - 0.7) / 0.15) * Math.PI)
        }
        const b = env * gain
        const o = j * 6
        colors[o] = s.col.r * b
        colors[o + 1] = s.col.g * b
        colors[o + 2] = s.col.b * b
        colors[o + 3] = colors[o]
        colors[o + 4] = colors[o + 1]
        colors[o + 5] = colors[o + 2]
      }
      colAttr.needsUpdate = true
    }
  })

  return <primitive object={thread} />
}
