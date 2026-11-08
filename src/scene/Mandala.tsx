import { useFrame, useLoader } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  IcosahedronGeometry,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  TetrahedronGeometry,
  TextureLoader,
  TorusGeometry,
  type Group,
  type InstancedMesh,
  type LineBasicMaterial,
  type Mesh,
  type PointLight,
} from 'three'
import { audioFrame } from '../audio/reactiveBus'
import { sfxGateUnsealed } from '../audio/sfx'
import { wardenBlocksGate } from '../game/enemyState'
import { worldState } from '../game/worldState'
import { gateGlyph, gateStyleForDepth, runePlaneGeometry } from './runeAtlas'
import { BURST } from './burstVocab'
import { snapController } from './snapController'
import { runeRank, smoothstep, T, visuals } from './visualTuning'
import type { Palette } from '../theme/palettes'

const TETRA_COUNT = 24
const TETRA_RADIUS = 14
const RUNE_COUNT = 12
const RUNE_RADIUS = 16.5

function polygonGeometry(sides: number, radius: number): BufferGeometry {
  const positions: number[] = []
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + Math.PI / 2
    positions.push(Math.cos(a) * radius, Math.sin(a) * radius, 0)
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
  return geo
}

const dummy = new Object3D()
const tmpColor = new Color()

const RINGS = [
  { radius: 6, tube: 0.06, tilt: [Math.PI / 2, 0, 0] as const, speed: 0.15 },
  { radius: 9, tube: 0.06, tilt: [Math.PI / 2 - 0.35, 0, 0.2] as const, speed: -0.09 },
  { radius: 12, tube: 0.07, tilt: [Math.PI / 2 + 0.25, 0, -0.3] as const, speed: 0.05 },
]

/** Gate footprint relative to the old full-size mandala. */
const GATE_SCALE = 0.65

/**
 * The Realm Gate: the sacred-geometry mandala, repurposed. It materializes
 * ahead of the player when the shift charge completes (worldState.gate),
 * spins itself into existence over openT, and is snapped like a resonance
 * point to descend a realm. Counter-rotating HDR rings, inner polygons, a
 * glinting tetra ring, and a circle of baked rune glyphs chasing the mids.
 */
export function RealmGate({ palette }: { palette: Palette }) {
  const rootRef = useRef<Group>(null)
  const ringGroups = useRef<(Group | null)[]>([null, null, null])
  const ringMats = useRef<(MeshBasicMaterial | null)[]>([null, null, null])
  const lineMats = useRef<(LineBasicMaterial | null)[]>([null, null])
  const tetraMesh = useRef<InstancedMesh>(null)
  const light = useRef<PointLight>(null)

  const runesTex = useLoader(TextureLoader, '/assets/runes.png')
  const ringGeos = useMemo(() => RINGS.map(r => new TorusGeometry(r.radius, r.tube, 8, 96)), [])
  const triGeo = useMemo(() => polygonGeometry(3, 4), [])
  const hexGeo = useMemo(() => polygonGeometry(6, 5.2), [])
  const tetraGeo = useMemo(() => new TetrahedronGeometry(0.3), [])
  // trip morph ladder: the guardians shift form as the trip deepens
  const tripSolids = useMemo(
    () => [new TetrahedronGeometry(0.3), new OctahedronGeometry(0.32), new IcosahedronGeometry(0.34, 0)],
    [],
  )
  const runeGeos = useMemo(
    () => Array.from({ length: RUNE_COUNT }, (_, i) => runePlaneGeometry(i % 12, 1.7)),
    [],
  )
  const runeMats = useMemo(
    () =>
      Array.from(
        { length: RUNE_COUNT },
        () =>
          new MeshBasicMaterial({
            map: runesTex,
            color: '#ffffff',
            blending: AdditiveBlending,
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            toneMapped: false,
          }),
      ),
    [runesTex],
  )
  const primaryHdr = useMemo(() => new Color(palette.primary).multiplyScalar(2.5), [palette])
  const runeHdr = useMemo(() => new Color(palette.rune).multiplyScalar(2.2), [palette])

  useLayoutEffect(() => {
    const mesh = tetraMesh.current
    if (!mesh) return
    for (let i = 0; i < TETRA_COUNT; i++) {
      const a = (i / TETRA_COUNT) * Math.PI * 2
      dummy.position.set(Math.cos(a) * TETRA_RADIUS, 0, Math.sin(a) * TETRA_RADIUS)
      dummy.rotation.set(a, a * 2, 0)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, tmpColor.setScalar(0.3))
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [])

  const prevCharge = useRef(0)
  const solidIdx = useRef(0)
  const runeRefs = useRef<(Mesh | null)[]>(new Array(RUNE_COUNT).fill(null))
  const scrambleAt = useRef(0)
  const scrambled = useRef(false)
  const lastEpoch = useRef(-1)
  const gateStyle = useRef(gateStyleForDepth(0))

  // warden seal: a visible chain so the sealed gate reads as CAUSED, not
  // broken — it breathes with its jailer's attacks and shatters on the kill
  const sealGroup = useRef<Group>(null)
  const sealGeo = useMemo(() => new TorusGeometry(13, 0.14, 6, 64), [])
  const shackleGeo = useMemo(() => new TetrahedronGeometry(0.7, 0), [])
  const sealMatObj = useMemo(() => new MeshBasicMaterial({ toneMapped: false }), [])
  const sealHdr = useMemo(() => new Color(palette.horrorEye).multiplyScalar(2), [palette])
  const prevSealed = useRef(false)
  const sealFlashT = useRef(0)
  // seal beam: a crimson column readable at 200u — the close-range dimming
  // stays the message, this is the LANDMARK read that "dim" never gave
  const sealBeamRef = useRef<Mesh>(null)
  const sealBeamGeo = useMemo(() => {
    const g = new CylinderGeometry(0.35, 0.9, 60, 10, 1, true)
    g.translate(0, 25, 0)
    return g
  }, [])
  const sealBeamMat = useMemo(
    () =>
      new MeshBasicMaterial({
        toneMapped: false,
        transparent: true,
        opacity: 0.55,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        fog: false,
      }),
    [],
  )
  useLayoutEffect(() => {
    return () => {
      sealGeo.dispose()
      shackleGeo.dispose()
      sealMatObj.dispose()
      sealBeamGeo.dispose()
      sealBeamMat.dispose()
    }
  }, [sealGeo, shackleGeo, sealMatObj, sealBeamGeo, sealBeamMat])

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime
    const gate = worldState.gate
    const root = rootRef.current
    // Per-realm gate flavor swaps at the epoch guard — the gate is always
    // inactive during a swap, so the glyph-procession and ring-accent writes
    // never pop on screen. Runs BEFORE the gate-inactive early return.
    if (lastEpoch.current !== worldState.epoch) {
      lastEpoch.current = worldState.epoch
      const gs = gateStyleForDepth(worldState.depth)
      gateStyle.current = gs
      for (let i = 0; i < RUNE_COUNT; i++) {
        const m = runeRefs.current[i]
        if (m) m.geometry = runeGeos[gateGlyph(worldState.depth, i)]
      }
      for (let i = 0; i < RINGS.length; i++) {
        const g = ringGroups.current[i]
        if (g) {
          g.rotation.x = gs.tiltAdd[i]
          g.rotation.z = gs.tiltAdd[i] * 0.6
        }
      }
      scrambled.current = false
    }
    if (root) {
      root.visible = gate.active
      if (!gate.active) return
      root.position.set(gate.x, gate.y, gate.z)
      // Materialize: scale in over openT, spinning fast while still forming.
      const open = smoothstep(0, 1, gate.openT)
      root.scale.setScalar(
        GATE_SCALE * (0.05 + 0.95 * open) * (1 + 0.02 * visuals.breath * T(0, 0.5, 1, 1.4)),
      )
      root.rotation.y += dt * (0.1 + 2.2 * (1 - open))
    } else if (!gate.active) {
      return
    }
    const mids = audioFrame.mids * visuals.midsReact
    const bass = audioFrame.bass
    const charge = Math.max(visuals.dropCharge, 1 - gate.openT)
    const impact = visuals.impactPulse
    const trip = visuals.tripLevel
    // a warded gate is SEALED: the rings dim and drag until its jailer falls
    const sealed = wardenBlocksGate() ? 0.3 : 1
    const glowGain = T(0.35, 0.7, 1.0, 1.25) * sealed
    const spinGain = T(0.5, 1.0, 1.4, 2.0) * (1 + 1.2 * charge) * (sealed < 1 ? 0.25 : 1)

    // ---- the seal chain itself ----
    const sg = sealGroup.current
    if (sg) {
      const isSealed = sealed < 1
      if (prevSealed.current && !isSealed) {
        sfxGateUnsealed()
        // the jailer fell: the chain shatters in a white flash + burst
        sealFlashT.current = 0.35
        snapController.pendingBursts.push({ x: gate.x, y: gate.y, z: gate.z, count: 60, style: BURST.GATE })
      }
      prevSealed.current = isSealed
      if (sealFlashT.current > 0) sealFlashT.current = Math.max(0, sealFlashT.current - dt)
      const showSeal = isSealed || sealFlashT.current > 0
      sg.visible = showSeal
      // the distance beacon: steady under rm, breathing with the telegraph
      const beam = sealBeamRef.current
      if (beam) {
        beam.visible = isSealed
        if (isSealed) {
          const pulse = visuals.rm ? 1 : 0.85 + 0.3 * Math.sin(t * 2.1)
          sealBeamMat.color
            .copy(sealHdr)
            .multiplyScalar(0.7 * pulse * (1 + 0.9 * visuals.wardenTelegraph))
        }
      }
      if (showSeal) {
        sg.rotation.y -= dt * 0.25 // contra-rotation against the gate spin
        if (sealFlashT.current > 0 && !isSealed) {
          sealMatObj.color.set('#ffffff').multiplyScalar(8 * (sealFlashT.current / 0.35))
        } else {
          // the seal BREATHES when its warden winds up an attack
          sealMatObj.color
            .copy(sealHdr)
            .multiplyScalar((0.8 + 0.3 * Math.sin(t * 2.1)) * (1 + 0.9 * visuals.wardenTelegraph))
        }
      }
    }
    let chase = T(1.2, 2.0, 2.6, 4.0) * (1 + 2 * charge)
    if (visuals.rm) chase = Math.min(chase, 2.0)

    const ringBeat = 1 + 0.35 * visuals.beatPulse
    const gs = gateStyle.current
    for (let i = 0; i < RINGS.length; i++) {
      const g = ringGroups.current[i]
      if (g) {
        // realm spin accent; overdriven realms (|mult| > 1) gain a w3 flutter
        const over = Math.max(0, Math.abs(gs.spinMult[i]) - 1)
        const flutter = 1 + 0.5 * over * visuals.w3 * Math.sin(t * 6 + i * 2.1)
        g.rotation.y += RINGS[i].speed * gs.spinMult[i] * flutter * spinGain * dt
        if (i === 1) g.rotation.x = gs.tiltAdd[1] + Math.sin(t * 0.9) * 0.15 * visuals.w3
        if (i === 2) g.scale.setScalar(1 + bass * 0.12 + 0.25 * impact)
      }
      const m = ringMats.current[i]
      if (m) m.color.copy(primaryHdr).multiplyScalar(glowGain * (0.6 + mids * 2.4) * ringBeat)
    }
    const linePop = 1 + 0.06 * audioFrame.onsetStrength * visuals.onsetReact
    for (const lm of lineMats.current) {
      if (lm) lm.color.copy(primaryHdr).multiplyScalar(glowGain * (0.5 + mids * 2) * linePop)
    }

    const mesh = tetraMesh.current
    if (mesh) {
      // trip morph: tetra -> octa -> icosa as the trip deepens (and back)
      const want = trip > 0.75 ? 2 : trip > 0.4 ? 1 : 0
      if (want !== solidIdx.current) {
        solidIdx.current = want
        mesh.geometry = tripSolids[want]
      }
      // pre-drop contraction: the tetra ring squeezes inward as charge builds
      if (charge > 0.001 || prevCharge.current > 0.001) {
        const radius = TETRA_RADIUS * (1 - 0.25 * charge)
        for (let i = 0; i < TETRA_COUNT; i++) {
          const a = (i / TETRA_COUNT) * Math.PI * 2
          dummy.position.set(Math.cos(a) * radius, 0, Math.sin(a) * radius)
          dummy.rotation.set(a, a * 2, 0)
          dummy.scale.setScalar(1)
          dummy.updateMatrix()
          mesh.setMatrixAt(i, dummy.matrix)
        }
        mesh.instanceMatrix.needsUpdate = true
      }
      prevCharge.current = charge
      const base = T(0.06, 0.12, 0.15, 0.2)
      const amp = T(0.5, 0.9, 1.0, 1.3)
      for (let i = 0; i < TETRA_COUNT; i++) {
        const a = (i / TETRA_COUNT) * Math.PI * 2
        const intensity =
          (base + mids * (0.5 + 0.5 * Math.sin(a - t * chase)) * 1.8 * amp) * (1 + charge)
        mesh.setColorAt(i, tmpColor.setScalar(intensity))
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }

    // deep in the trip the glyphs rewrite themselves; they settle back to
    // their true forms on the way out
    if (trip > 0.5) {
      if (t > scrambleAt.current) {
        scrambleAt.current = t + 0.4 + Math.random() * 0.5
        scrambled.current = true
        const count = 1 + Math.floor(Math.random() * 3)
        for (let n = 0; n < count; n++) {
          const i = Math.floor(Math.random() * RUNE_COUNT)
          const m = runeRefs.current[i]
          if (m) m.geometry = runeGeos[Math.floor(Math.random() * RUNE_COUNT)]
        }
      }
    } else if (trip < 0.1 && scrambled.current) {
      scrambled.current = false
      // settle back to the REALM's procession, not the raw atlas order
      for (let i = 0; i < RUNE_COUNT; i++) {
        const m = runeRefs.current[i]
        if (m) m.geometry = runeGeos[gateGlyph(worldState.depth, i)]
      }
    }

    // rune-by-rune ignition: each glyph lights when the continuous ignition
    // level crosses its rank in the stride permutation. Impact flash-ignites
    // all of them; at PEAK the freshest grid beat flashes its rune.
    const beatRune =
      visuals.w2 > 0.6 && audioFrame.gridBeatIndex >= 0
        ? audioFrame.gridBeatIndex % RUNE_COUNT
        : -1
    for (let i = 0; i < RUNE_COUNT; i++) {
      const a = (i / RUNE_COUNT) * Math.PI * 2
      const lit = Math.max(impact, Math.max(0, Math.min(1, visuals.runeIgnition - runeRank(i))))
      const beatFlash = i === beatRune ? 0.6 * visuals.beatPulse : 0
      const brightness =
        (0.1 + lit * (0.18 + mids * (0.5 + 0.5 * Math.sin(a - t * chase)) * 1.6) + beatFlash) *
        (1 + 1.2 * impact)
      runeMats[i].color.copy(runeHdr).multiplyScalar(brightness)
    }

    if (light.current) {
      light.current.intensity = (2 + mids * 6) * T(0.5, 0.8, 1.0, 1.15) * (1 + 1.5 * charge)
    }
  })

  return (
    <group visible={false} ref={rootRef}>
      {RINGS.map((r, i) => (
        <group
          key={i}
          ref={el => {
            ringGroups.current[i] = el
          }}
        >
          <mesh geometry={ringGeos[i]} rotation={[r.tilt[0], r.tilt[1], r.tilt[2]]}>
            <meshBasicMaterial
              ref={el => {
                ringMats.current[i] = el
              }}
              color={primaryHdr}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
      <lineLoop geometry={triGeo} rotation={[Math.PI / 2, 0, 0]}>
        <lineBasicMaterial
          ref={el => {
            lineMats.current[0] = el
          }}
          color={primaryHdr}
          toneMapped={false}
        />
      </lineLoop>
      <lineLoop geometry={hexGeo} rotation={[Math.PI / 2, 0, 0]}>
        <lineBasicMaterial
          ref={el => {
            lineMats.current[1] = el
          }}
          color={primaryHdr}
          toneMapped={false}
        />
      </lineLoop>
      <instancedMesh ref={tetraMesh} args={[tetraGeo, undefined, TETRA_COUNT]}>
        <meshBasicMaterial color={runeHdr} toneMapped={false} />
      </instancedMesh>
      {runeGeos.map((geo, i) => {
        const a = (i / RUNE_COUNT) * Math.PI * 2
        return (
          <mesh
            key={i}
            ref={el => {
              runeRefs.current[i] = el
            }}
            geometry={geo}
            material={runeMats[i]}
            position={[Math.cos(a) * RUNE_RADIUS, 0.6, Math.sin(a) * RUNE_RADIUS]}
            rotation={[0, -a + Math.PI / 2, 0]}
          />
        )
      })}
      <group ref={sealGroup} visible={false} rotation={[0.61, 0, 0]}>
        <mesh geometry={sealGeo} material={sealMatObj} />
        {[0, 1, 2, 3].map(i => {
          const a = (i / 4) * Math.PI * 2 + 0.4
          return (
            <mesh
              key={i}
              geometry={shackleGeo}
              material={sealMatObj}
              position={[Math.cos(a) * 13, 0, Math.sin(a) * 13]}
              rotation={[a, a * 1.7, 0]}
            />
          )
        })}
      </group>
      <mesh ref={sealBeamRef} visible={false} geometry={sealBeamGeo} material={sealBeamMat} />
      <pointLight ref={light} color={palette.secondary} intensity={3} distance={90} decay={1.2} />
    </group>
  )
}
