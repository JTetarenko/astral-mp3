import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  TorusGeometry,
  type InstancedMesh,
} from 'three'
import { runState } from '../game/runState'
import { COMBAT } from '../game/combat'
import { snapController } from './snapController'
import { visuals } from './visualTuning'
import type { Palette } from '../theme/palettes'

const hiddenMatrix = new Matrix4().makeScale(1e-4, 1e-4, 1e-4)
const dummy = new Object3D()

/**
 * The Banish Nova ring: a crossed pair of expanding world-space tori riding
 * visuals.banishProgress (0 -> 1 over 0.55s), white-hot at ignition fading
 * to the realm's rune hue as it expands to the TRUE gameplay radius — a
 * screen-space ring would lie about what it cleansed.
 */
export function BanishNova({ palette }: { palette: Palette }) {
  const meshRef = useRef<InstancedMesh>(null)
  const geo = useMemo(() => new TorusGeometry(1, 0.045, 6, 40), [])
  const mat = useMemo(
    () =>
      new MeshBasicMaterial({
        color: new Color('#ffffff'),
        transparent: true,
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

  const runeHot = useMemo(() => new Color(palette.rune).multiplyScalar(2.4), [palette])
  const white = useMemo(() => new Color('#ffffff').multiplyScalar(3.2), [])
  const tmp = useMemo(() => new Color(), [])

  const origin = useRef({ x: 0, y: 0, z: 0, prevProgress: 1 })

  useFrame(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const prog = visuals.banishProgress
    const o = origin.current
    // a fresh trigger resets progress below the previous frame's value
    if (prog < o.prevProgress) {
      o.x = snapController.pos.x
      o.y = snapController.pos.y
      o.z = snapController.pos.z
    }
    o.prevProgress = prog
    const live = prog < 1 && visuals.banishStrength > 0.01
    mesh.visible = live
    if (!live) return
    const radius = COMBAT.nova.radius * runState.stats.novaRadiusMult * prog
    const fade = (1 - prog) * (1 - prog) * visuals.banishStrength
    tmp.copy(white).lerp(runeHot, Math.min(1, prog * 1.6)).multiplyScalar(Math.max(0.05, fade))
    mat.color.copy(tmp)
    // slot 0: horizontal cleansing ring; slot 1: tilted cross for 3D read
    dummy.position.set(o.x, o.y, o.z)
    dummy.rotation.set(Math.PI / 2, 0, 0)
    dummy.scale.setScalar(Math.max(0.01, radius))
    dummy.updateMatrix()
    mesh.setMatrixAt(0, dummy.matrix)
    dummy.rotation.set(Math.PI / 2 + 0.8, 0.6, 0)
    dummy.scale.setScalar(Math.max(0.01, radius * 0.85))
    dummy.updateMatrix()
    mesh.setMatrixAt(1, dummy.matrix)
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={el => {
        meshRef.current = el
        if (el) {
          el.instanceMatrix.setUsage(DynamicDrawUsage)
          el.setMatrixAt(0, hiddenMatrix)
          el.setMatrixAt(1, hiddenMatrix)
          el.visible = false
        }
      }}
      args={[geo, mat, 2]}
      frustumCulled={false}
    />
  )
}
