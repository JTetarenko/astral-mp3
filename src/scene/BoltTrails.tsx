import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BufferGeometry, Color, Float32BufferAttribute, Mesh, type PointLight } from 'three'
import { ENEMY } from '../game/enemyArchetypes'
import { enemyState } from '../game/enemyState'
import { bowFrame } from './bowFrame'
import { fillRibbonPositions, ribbonEdges, ribbonIndices } from './ribbonGeom'
import { makeRibbonMaterial } from './ribbonMaterial'
import { governor } from './perfGovernor'
import type { Palette } from '../theme/palettes'

const CAP = ENEMY.BOLT_CAP
/** Centerline points per bolt strip. */
const N = 16

/**
 * Per-bolt ribbon trails: every cast owns a real tracer instead of leaning on
 * the EchoPass afterimage (which the governor kills at L4). One merged
 * geometry, CAP disjoint strips, one draw call. Width and heat co-encode the
 * draw power — a quick bolt is a wisp, a full draw a burning lance. A single
 * point light rides the hottest charged bolt in flight.
 */
export function BoltTrails({ palette }: { palette: Palette }) {
  const meshRef = useRef<Mesh>(null)
  const lightRef = useRef<PointLight>(null)

  const S = useMemo(() => {
    const geo = new BufferGeometry()
    const posAttr = new Float32BufferAttribute(new Float32Array(CAP * N * 6), 3)
    const colAttr = new Float32BufferAttribute(new Float32Array(CAP * N * 6), 3)
    // NB: Float32BufferAttribute COPIES its input — alias the attribute's own
    // storage or per-frame writes never reach the GPU (the PlayerTrail gotcha)
    const positions = posAttr.array as Float32Array
    const colors = colAttr.array as Float32Array
    geo.setAttribute('position', posAttr)
    geo.setAttribute('color', colAttr)
    const edges = new Float32Array(CAP * N * 2)
    const idx: number[] = []
    for (let s = 0; s < CAP; s++) {
      edges.set(ribbonEdges(N), s * N * 2)
      const strip = ribbonIndices(N)
      const off = s * N * 2
      for (let i = 0; i < strip.length; i++) idx.push(strip[i] + off)
    }
    geo.setAttribute('aEdge', new Float32BufferAttribute(edges, 1))
    geo.setIndex(idx)
    const mat = makeRibbonMaterial()
    return {
      geo,
      mat,
      posAttr,
      colAttr,
      positions,
      colors,
      /** Per-slot centerline history, head at index 0. */
      pts: new Float32Array(CAP * N * 3),
      widths: new Float32Array(N),
      serial: new Uint32Array(CAP),
      live: new Uint8Array(CAP),
    }
  }, [])
  useEffect(() => {
    return () => {
      S.geo.dispose()
      S.mat.dispose()
    }
  }, [S])

  const trailColor = useMemo(() => new Color(palette.trail), [palette])
  const white = useMemo(() => new Color('#ffffff'), [])
  const tmp = useMemo(() => new Color(), [])

  useFrame(({ camera, clock }) => {
    const b = enemyState.bolts
    const { positions, colors, pts, widths } = S
    const cheap = governor.level >= 4
    let hotIdx = -1
    let hotPower = 0.5 // only charged bolts earn the light
    for (let i = 0; i < CAP; i++) {
      const base = i * N * 3
      if (!b.active[i] || cheap) {
        if (S.live[i]) {
          S.live[i] = 0
          // collapse the strip: zero-width quads vanish
          for (let k = 0; k < N; k++) widths[k] = 0
          fillRibbonPositions(
            positions.subarray(base * 2, base * 2 + N * 6),
            pts.subarray(base, base + N * 3),
            N,
            widths,
            camera.position.x,
            camera.position.y,
            camera.position.z,
          )
          S.posAttr.needsUpdate = true
        }
        continue
      }
      if (S.serial[i] !== b.serial[i] || !S.live[i]) {
        // a fresh bolt claims the slot: history collapses to the muzzle point
        // — or to the visible arrowhead when the bow just loosed, so the
        // tracer begins exactly where the nocked arrow was (continuity)
        S.serial[i] = b.serial[i]
        S.live[i] = 1
        const fromBow =
          bowFrame.manifest > 0.5 && clock.elapsedTime - bowFrame.lastLooseAt < 0.12
        const sx = fromBow ? bowFrame.arrowTipX : b.x[i]
        const sy = fromBow ? bowFrame.arrowTipY : b.y[i]
        const sz = fromBow ? bowFrame.arrowTipZ : b.z[i]
        for (let k = 0; k < N; k++) {
          pts[base + k * 3] = sx
          pts[base + k * 3 + 1] = sy
          pts[base + k * 3 + 2] = sz
        }
      } else {
        // shift history back one, head follows the bolt
        for (let k = N - 1; k > 0; k--) {
          pts[base + k * 3] = pts[base + (k - 1) * 3]
          pts[base + k * 3 + 1] = pts[base + (k - 1) * 3 + 1]
          pts[base + k * 3 + 2] = pts[base + (k - 1) * 3 + 2]
        }
        pts[base] = b.x[i]
        pts[base + 1] = b.y[i]
        pts[base + 2] = b.z[i]
      }
      const pw = b.power[i]
      const heat = Math.max(pw, b.crit[i])
      const w0 = 0.05 + 0.3 * pw
      tmp.copy(trailColor).lerp(white, 0.3 + 0.5 * heat)
      const gain = 2 + 1.5 * heat
      for (let k = 0; k < N; k++) {
        const fade = 1 - k / (N - 1)
        widths[k] = w0 * (0.25 + 0.75 * fade)
        const o = base * 2 + k * 6
        const cr = tmp.r * gain * fade
        const cg = tmp.g * gain * fade
        const cb = tmp.b * gain * fade
        colors[o] = cr
        colors[o + 1] = cg
        colors[o + 2] = cb
        colors[o + 3] = cr
        colors[o + 4] = cg
        colors[o + 5] = cb
      }
      fillRibbonPositions(
        positions.subarray(base * 2, base * 2 + N * 6),
        pts.subarray(base, base + N * 3),
        N,
        widths,
        camera.position.x,
        camera.position.y,
        camera.position.z,
      )
      S.posAttr.needsUpdate = true
      S.colAttr.needsUpdate = true
      if (pw >= hotPower) {
        hotPower = pw
        hotIdx = i
      }
    }
    // one light, riding the hottest charged bolt; off entirely under pressure
    const light = lightRef.current
    if (light) {
      if (hotIdx >= 0 && governor.level < 3) {
        light.visible = true
        light.position.set(b.x[hotIdx], b.y[hotIdx], b.z[hotIdx])
        light.intensity = 6 * hotPower
        light.color.copy(tmp.copy(trailColor).lerp(white, 0.5))
      } else {
        light.visible = false
      }
    }
  })

  return (
    <>
      <mesh ref={meshRef} geometry={S.geo} material={S.mat} frustumCulled={false} />
      <pointLight ref={lightRef} visible={false} distance={18} decay={2} />
    </>
  )
}
