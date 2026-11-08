import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  LineBasicMaterial,
  type LineSegments,
} from 'three'
import { audioFrame } from '../audio/reactiveBus'
import { WORLD, worldState } from '../game/worldState'
import { variantTop } from '../game/islandVariants'
import { islandY } from './Islands'
import { governor } from './perfGovernor'
import { visuals } from './visualTuning'
import type { Palette } from '../theme/palettes'

/**
 * Energy tethers: quadratic-bezier arcs from the REALM GATE to the nearest
 * large islands — the gate visibly drinks the realm while it waits to be
 * snapped. visuals.tetherCount gates how many are alive; a brightness wave
 * travels along each one on the beat grid, and downbeats pluck the whole arc
 * upward. One LineSegments draw call; HDR crest colors fattened by bloom.
 */
const MAX_TETHERS = 10
const SEGS = 24

export function Tethers({ palette }: { palette: Palette }) {
  const lines = useRef<LineSegments>(null)
  const frameParity = useRef(0)
  const anchorState = useRef({
    slots: new Int32Array(MAX_TETHERS).fill(-1),
    serials: new Int32Array(MAX_TETHERS),
    openedAt: -1,
    slotVersion: -1,
  })

  const buffers = useMemo(() => {
    const verts = MAX_TETHERS * SEGS * 2
    return {
      positions: new Float32Array(verts * 3),
      colors: new Float32Array(verts * 3),
      // scratch: SEGS+1 sampled points per tether
      px: new Float32Array(SEGS + 1),
      py: new Float32Array(SEGS + 1),
      pz: new Float32Array(SEGS + 1),
      cr: new Float32Array(SEGS + 1),
      cg: new Float32Array(SEGS + 1),
      cb: new Float32Array(SEGS + 1),
    }
  }, [])

  const geometry = useMemo(() => {
    const geo = new BufferGeometry()
    const posAttr = new BufferAttribute(buffers.positions, 3)
    posAttr.setUsage(DynamicDrawUsage)
    const colAttr = new BufferAttribute(buffers.colors, 3)
    colAttr.setUsage(DynamicDrawUsage)
    geo.setAttribute('position', posAttr)
    geo.setAttribute('color', colAttr)
    return geo
  }, [buffers])
  const material = useMemo(
    () =>
      new LineBasicMaterial({
        vertexColors: true,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  )
  useEffect(() => {
    return () => {
      geometry.dispose()
      material.dispose()
    }
  }, [geometry, material])

  const colorA = useMemo(() => new Color(palette.secondary), [palette])
  const colorB = useMemo(() => new Color(palette.primary), [palette])

  useFrame(({ clock }) => {
    const m = lines.current
    if (!m) return
    const gate = worldState.gate
    const count = visuals.tetherCount
    // Tethers exist only while the gate does: minimum 3 arcs so a charged
    // gate always reads as feeding, more as the song intensifies.
    const liveCount = gate.active ? Math.max(3 * gate.openT, count) : 0
    m.visible = liveCount > 0.01
    if (!m.visible) return

    // Re-anchor on gate (re)spawn or when streaming changed the island set.
    const a = anchorState.current
    if (a.openedAt !== gate.openedAt || a.slotVersion !== worldState.slotVersion) {
      a.openedAt = gate.openedAt
      a.slotVersion = worldState.slotVersion
      const slots = worldState.slots
      // nearest eligible islands to the gate
      const scored: { i: number; d: number }[] = []
      for (let i = 0; i < WORLD.TOTAL_SLOTS; i++) {
        const s = slots[i]
        if (!s.used || s.scale < 3) continue
        scored.push({ i, d: Math.hypot(s.x - gate.x, s.y - gate.y, s.z - gate.z) })
      }
      scored.sort((p, q) => p.d - q.d)
      for (let k = 0; k < MAX_TETHERS; k++) {
        if (k < scored.length) {
          a.slots[k] = scored[k].i
          a.serials[k] = slots[scored[k].i].serial
        } else {
          a.slots[k] = -1
        }
      }
    }

    // L3: refresh colors every 2nd frame; L4: wave freezes (gate/growth only)
    frameParity.current ^= 1
    const updateColors = governor.level < 3 || frameParity.current === 0
    const waveLive = governor.level < 4
    const t = clock.elapsedTime
    const bass = audioFrame.bass
    const b = buffers
    const viGain = (0.6 + 0.4 * visuals.vi) * 1.8
    const waveS = !waveLive
      ? 0.5
      : audioFrame.gridConfidence > 0.5
        ? audioFrame.gridPhase
        : ((t * Math.max(60, audioFrame.bpm || 120)) / 60) % 1
    const pluck = 1.5 * visuals.tetherPluck
    const gx = gate.x
    const gy = gate.y
    const gz = gate.z

    for (let i = 0; i < MAX_TETHERS; i++) {
      const base = i * SEGS * 2 * 3
      const slotIdx = anchorState.current.slots[i]
      const spec = slotIdx >= 0 ? worldState.slots[slotIdx] : null
      const valid =
        spec && spec.used && spec.serial === anchorState.current.serials[i] ? spec : null
      const g = valid ? Math.max(0, Math.min(1, liveCount - i)) : 0
      if (g <= 0.001 || !valid) {
        // collapsed: park all verts at the gate, black
        for (let j = 0; j < SEGS * 2; j++) {
          b.positions[base + j * 3] = gx
          b.positions[base + j * 3 + 1] = gy
          b.positions[base + j * 3 + 2] = gz
          b.colors[base + j * 3] = 0
          b.colors[base + j * 3 + 1] = 0
          b.colors[base + j * 3 + 2] = 0
        }
        continue
      }
      const ex = valid.x
      const ey =
        islandY(valid, t, bass, visuals.liftGain) + valid.scale * 0.82 * variantTop(valid.variant)
      const ez = valid.z
      const dist = Math.hypot(ex - gx, ey - gy, ez - gz)
      const mx = (gx + ex) * 0.5
      const my = (gy + ey) * 0.5 + 6 + 0.15 * dist
      const mz = (gz + ez) * 0.5
      for (let j = 0; j <= SEGS; j++) {
        const u = (j / SEGS) * g // tether grows outward from the gate
        const a0 = (1 - u) * (1 - u)
        const a1 = 2 * (1 - u) * u
        const a2 = u * u
        b.px[j] = a0 * gx + a1 * mx + a2 * ex
        b.py[j] = a0 * gy + a1 * my + a2 * ey + Math.sin(u * Math.PI) * pluck
        b.pz[j] = a0 * gz + a1 * mz + a2 * ez
        if (updateColors) {
          const dw = Math.abs(u - waveS)
          const wave = Math.max(0, 1 - dw * 3)
          const glow = (0.35 + 0.65 * wave * wave) * viGain
          const mix = u
          b.cr[j] = (colorA.r + (colorB.r - colorA.r) * mix) * glow
          b.cg[j] = (colorA.g + (colorB.g - colorA.g) * mix) * glow
          b.cb[j] = (colorA.b + (colorB.b - colorA.b) * mix) * glow
        }
      }
      for (let j = 0; j < SEGS; j++) {
        const o = base + j * 6
        b.positions[o] = b.px[j]
        b.positions[o + 1] = b.py[j]
        b.positions[o + 2] = b.pz[j]
        b.positions[o + 3] = b.px[j + 1]
        b.positions[o + 4] = b.py[j + 1]
        b.positions[o + 5] = b.pz[j + 1]
        if (updateColors) {
          b.colors[o] = b.cr[j]
          b.colors[o + 1] = b.cg[j]
          b.colors[o + 2] = b.cb[j]
          b.colors[o + 3] = b.cr[j + 1]
          b.colors[o + 4] = b.cg[j + 1]
          b.colors[o + 5] = b.cb[j + 1]
        }
      }
    }
    ;(geometry.attributes.position as BufferAttribute).needsUpdate = true
    if (updateColors) (geometry.attributes.color as BufferAttribute).needsUpdate = true
  })

  return (
    <lineSegments
      ref={lines}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      visible={false}
    />
  )
}
