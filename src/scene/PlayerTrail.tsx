import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Mesh,
  OctahedronGeometry,
  AdditiveBlending,
} from 'three'
import { audioFrame } from '../audio/reactiveBus'
import { fillRibbonColors, fillRibbonPositions, ribbonEdges, ribbonIndices } from './ribbonGeom'
import { makeRibbonMaterial } from './ribbonMaterial'
import { snapController } from './snapController'
import { T, visuals } from './visualTuning'
import type { Palette } from '../theme/palettes'

const N = 96
const SAMPLE_INTERVAL = 0.03

/**
 * The PRD-signature geometric light trail, upgraded from a 1px Line to a
 * camera-facing tapered ribbon (hot spine, soft edges — the WardenRig lash
 * technique via ribbonGeom). Fades over exactly one beat; width follows the
 * same age envelope as brightness, fattened by speed/sprint and the chain
 * aura. Plus the astral streak ghost that flies ahead during the snap.
 */
export function PlayerTrail({ palette }: { palette: Palette }) {
  const streakRef = useRef<Mesh>(null)
  const lastSample = useRef(0)
  const head = useRef(0)

  const trailColor = useMemo(() => new Color(palette.trail), [palette])

  const { mesh, positions, colors, ring, times, pts, rgb, widths, posAttr, colAttr } = useMemo(() => {
    const ring = new Float32Array(N * 3)
    const times = new Float32Array(N)
    const p = snapController.pos
    for (let i = 0; i < N; i++) {
      ring[i * 3] = p.x
      ring[i * 3 + 1] = p.y - 0.4
      ring[i * 3 + 2] = p.z
      times[i] = -999
    }
    const geo = new BufferGeometry()
    const posAttr = new Float32BufferAttribute(new Float32Array(N * 6), 3)
    const colAttr = new Float32BufferAttribute(new Float32Array(N * 6), 3)
    // NB: Float32BufferAttribute COPIES its input array — alias the
    // attribute's own storage or per-frame writes never reach the GPU
    const positions = posAttr.array as Float32Array
    const colors = colAttr.array as Float32Array
    geo.setAttribute('position', posAttr)
    geo.setAttribute('color', colAttr)
    geo.setAttribute('aEdge', new Float32BufferAttribute(ribbonEdges(N), 1))
    geo.setIndex(Array.from(ribbonIndices(N)))
    const mesh = new Mesh(geo, makeRibbonMaterial())
    mesh.frustumCulled = false
    // ordered-centerline scratch (oldest -> newest) + per-point color/width
    const pts = new Float32Array(N * 3)
    const rgb = new Float32Array(N * 3)
    const widths = new Float32Array(N)
    return { mesh, positions, colors, ring, times, pts, rgb, widths, posAttr, colAttr }
  }, [])

  const streakGeo = useMemo(() => new OctahedronGeometry(0.5, 0), [])
  const streakColor = useMemo(() => new Color(palette.trail).multiplyScalar(3), [palette])
  const strikeWhite = useMemo(() => new Color('#ffffff').multiplyScalar(4), [])

  useFrame(({ clock, camera }) => {
    const t = clock.elapsedTime
    const pos = snapController.pos

    if (t - lastSample.current >= SAMPLE_INTERVAL) {
      lastSample.current = t
      const h = head.current
      ring[h * 3] = pos.x
      ring[h * 3 + 1] = pos.y - 0.4
      ring[h * 3 + 2] = pos.z
      times[h] = t
      head.current = (h + 1) % N
    }

    // the score multiplier IS the aura: higher chains burn longer, brighter
    let trailBeats = T(0.8, 1.0, 1.5, 2.5) * (1 + 0.8 * visuals.auraGlow)
    if (visuals.rm) trailBeats = Math.min(trailBeats, 1.2)
    const beatDur = (60 / Math.max(60, audioFrame.bpm || 120)) * trailBeats
    const brightGain = 1.5 * T(1.0, 1.15, 1.3, 1.6) * (1 + 0.9 * visuals.auraGlow)
    const speed = snapController.vel.length()
    const speedGate = Math.min(1, speed / 5)
    // half-width: newest widest, tapering with the same envelope as the fade;
    // speed/sprint fatten the comet, the chain aura fattens it further
    const baseW =
      visuals.trailWidthGain * (0.05 + 0.11 * visuals.auraGlow) * (0.7 + 0.3 * Math.min(1, speed / 8))
    for (let k = 0; k < N; k++) {
      const idx = (head.current + k) % N // oldest -> newest
      pts[k * 3] = ring[idx * 3]
      pts[k * 3 + 1] = ring[idx * 3 + 1]
      pts[k * 3 + 2] = ring[idx * 3 + 2]
      const age = t - times[idx]
      const env = Math.max(0, 1 - age / beatDur) * speedGate
      const fade = env * brightGain
      rgb[k * 3] = trailColor.r * fade
      rgb[k * 3 + 1] = trailColor.g * fade
      rgb[k * 3 + 2] = trailColor.b * fade
      widths[k] = baseW * env
    }
    fillRibbonPositions(positions, pts, N, widths, camera.position.x, camera.position.y, camera.position.z)
    fillRibbonColors(colors, rgb, N)
    posAttr.needsUpdate = true
    colAttr.needsUpdate = true

    // Astral streak ghost (a strike swells it into a white-hot lance)
    const streak = streakRef.current
    if (streak) {
      const active = snapController.phase === 'streak'
      streak.visible = active
      if (active) {
        const heat = snapController.strikeHeat
        streak.position.copy(snapController.streakPos)
        streak.lookAt(snapController.snapPoint)
        streak.scale.set(0.45 + 0.15 * heat, 0.45 + 0.15 * heat, 2.6 + 0.8 * heat)
        const m = streak.material as import('three').MeshBasicMaterial
        m.color.copy(streakColor).lerp(strikeWhite, Math.min(1, heat))
      }
    }
  })

  return (
    <>
      <primitive object={mesh} />
      <mesh ref={streakRef} geometry={streakGeo} visible={false}>
        <meshBasicMaterial
          color={streakColor}
          wireframe
          transparent
          opacity={0.9}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </>
  )
}
