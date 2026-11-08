import { useFrame, useLoader } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  PlaneGeometry,
  RepeatWrapping,
  TextureLoader,
  type BufferAttribute,
  type Group,
  type Mesh,
} from 'three'
import { audioFrame } from '../audio/reactiveBus'
import { snapController } from './snapController'
import { T, visuals } from './visualTuning'
import type { Palette } from '../theme/palettes'

interface RibbonDef {
  radius: number
  spanDeg: number
  height: number
  y0: number
  theta0: number
  sag: number
  mixToward: number // 0 secondary .. 1 primary
  scroll: number
  flip: boolean
}

const RIBBONS: RibbonDef[] = [
  { radius: 140, spanDeg: 140, height: 26, y0: 45, theta0: 0.4, sag: 5, mixToward: 0, scroll: 1, flip: false },
  { radius: 165, spanDeg: 110, height: 34, y0: 60, theta0: 2.6, sag: 7, mixToward: 0.35, scroll: -0.8, flip: true },
  { radius: 120, spanDeg: 170, height: 22, y0: 38, theta0: 4.4, sag: 4, mixToward: 0.7, scroll: 0.6, flip: false },
]

/** PlaneGeometry remapped onto a cylindrical arc curtain. */
function ribbonGeometry(def: RibbonDef): PlaneGeometry {
  const geo = new PlaneGeometry(1, 1, 96, 6)
  const pos = geo.attributes.position as BufferAttribute
  const span = (def.spanDeg * Math.PI) / 180
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) + 0.5
    const v = pos.getY(i) + 0.5
    const theta = def.theta0 + u * span
    pos.setXYZ(
      i,
      Math.cos(theta) * def.radius,
      def.y0 + v * def.height + Math.sin(u * Math.PI) * def.sag,
      Math.sin(theta) * def.radius,
    )
  }
  geo.computeVertexNormals()
  return geo
}

/** Aurora curtains that ignite at PEAK and surge with the bass at SHATTER.
 * The curtain ring follows the player's XZ so it crowns every horizon. */
export function AuroraRibbons({ palette }: { palette: Palette }) {
  const meshes = useRef<(Mesh | null)[]>([null, null, null])
  const group = useRef<Group>(null)
  const auroraTex = useLoader(TextureLoader, '/assets/aurora.png')

  const geometries = useMemo(() => RIBBONS.map(ribbonGeometry), [])
  const materials = useMemo(
    () =>
      RIBBONS.map(def => {
        const tex = auroraTex.clone()
        tex.wrapS = RepeatWrapping
        tex.wrapT = RepeatWrapping
        if (def.flip) tex.repeat.y = -1
        tex.needsUpdate = true
        return new MeshBasicMaterial({
          map: tex,
          color: '#000000',
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
          side: DoubleSide,
          fog: false,
          toneMapped: false,
        })
      }),
    [auroraTex],
  )
  const colorA = useMemo(() => new Color(palette.secondary), [palette])
  const colorB = useMemo(() => new Color(palette.primary), [palette])
  const tmp = useMemo(() => new Color(), [])

  useEffect(() => {
    return () => {
      geometries.forEach(g => g.dispose())
      materials.forEach(mt => {
        mt.map?.dispose()
        mt.dispose()
      })
    }
  }, [geometries, materials])

  useFrame((_, dt) => {
    if (group.current) {
      group.current.position.set(snapController.pos.x, 0, snapController.pos.z)
    }
    // the drop impact flash forces the curtains open even mid-RISING
    const gate = Math.max(visuals.auroraGate, 0.7 * visuals.impactPulse)
    const brightness =
      T(0, 0.4, 1.6, 2.2) *
      (0.55 + 0.45 * audioFrame.mids * visuals.midsReact) *
      (1 + 0.5 * audioFrame.bass * visuals.w3) *
      (1 + 0.5 * visuals.dropCharge) *
      (1 + 1.5 * visuals.impactPulse) *
      (1 + 0.3 * audioFrame.midOnsetStrength * visuals.glintGain) *
      gate
    for (let i = 0; i < RIBBONS.length; i++) {
      const mesh = meshes.current[i]
      const mat = materials[i]
      if (!mesh) continue
      mesh.visible = gate > 0.01
      if (!mesh.visible) continue
      mat.map!.offset.x -=
        dt * (0.008 + 0.02 * visuals.eI) * (1 + 1.5 * visuals.dropCharge) * RIBBONS[i].scroll
      mat.color.copy(tmp.copy(colorA).lerp(colorB, RIBBONS[i].mixToward)).multiplyScalar(brightness)
    }
  })

  return (
    <group ref={group}>
      {RIBBONS.map((_, i) => (
        <mesh
          key={i}
          ref={el => {
            meshes.current[i] = el
          }}
          geometry={geometries[i]}
          material={materials[i]}
          visible={false}
          frustumCulled={false}
        />
      ))}
    </group>
  )
}
