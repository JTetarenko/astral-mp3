import { useFrame, useLoader } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  AdditiveBlending,
  AnimationMixer,
  BackSide,
  Box3,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  LatheGeometry,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  RepeatWrapping,
  SphereGeometry,
  TextureLoader,
  TorusGeometry,
  Vector2,
  Vector3,
  type BufferAttribute,
  type Group,
  type InstancedMesh,
  type Mesh,
  type Sprite,
  type SpriteMaterial,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { audioFrame } from '../audio/reactiveBus'
import { avatarFrame } from './avatarFrame'
import { AvatarWings, soupToGeometry } from './AvatarWings'
import { CharmShards } from './CharmShards'
import { runePlaneGeometry } from './runeAtlas'
import { snapController } from './snapController'
import { visuals } from './visualTuning'
import { buildCollarPlate, gemProfile } from './wingGeom'
import type { Palette } from '../theme/palettes'

const PULL_DUR = 0.32
/** Signature golds — realm palettes recolor the runes, never the relics. */
const GOLD_GEM = new Color('#ffd24a')
const GOLD_RING = new Color('#ffc857')
/** Rite-aura tints: stasis cools the halo glacial, frenzy heats gem + eyes. */
const STASIS_COOL = new Color('#9fd8ff')
const FRENZY_HOT = new Color('#ff4a30')
/** Rune column placement angles around the robe front (rad from -Z). */
const RUNE_COLS = [-0.52, 0, 0.52]
/** Drop a rigged/hooded character here to replace the procedural wraith. */
const PLAYER_MODEL_URL = '/assets/player.glb'

/**
 * Bakes key-light facet shading into a color attribute so the unlit / dimly
 * lit materials still read as carved surfaces. Non-indexed input: all three
 * verts of a face share a normal, so each flat facet gets one tone.
 */
function bakeFacetShading(geo: BufferGeometry, base: number, gain: number, pow = 1): void {
  const n = geo.attributes.normal as BufferAttribute
  const colors = new Float32Array(n.count * 3)
  const lx = 0.45
  const ly = 0.65
  const lz = 0.6
  for (let i = 0; i < n.count; i++) {
    const d = Math.max(0, n.getX(i) * lx + n.getY(i) * ly + n.getZ(i) * lz)
    const b = base + gain * Math.pow(d, pow)
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = b
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3))
}

/** Seam-safe chiseled-stone noise (pure trig of angle+height — the lathe's
 * duplicated seam verts get identical displacement). */
function stoneJag(a: number, y: number): number {
  return (
    0.045 * Math.sin(a * 5 + y * 6) +
    0.035 * Math.sin(a * 9 + 1.7 + y * 3.1) +
    0.025 * Math.sin(a * 3 - y * 9 + 0.6)
  )
}

/**
 * Hooded-cloak silhouette carved from stone: lathe profile from hood tip to
 * open hem, radially displaced by angular noise into chiseled facets, hem
 * torn into rags, flat-shaded with baked key-light tones — the reference's
 * rocky monolith robe instead of a smooth cone.
 */
function makeCloakGeometry(): BufferGeometry {
  const pts = [
    new Vector2(0.001, 0.95),
    new Vector2(0.12, 0.88),
    new Vector2(0.16, 0.82),
    new Vector2(0.3, 0.62),
    new Vector2(0.34, 0.55),
    new Vector2(0.31, 0.4),
    new Vector2(0.3, 0.25),
    new Vector2(0.33, 0.08),
    new Vector2(0.36, -0.05),
    new Vector2(0.42, -0.15),
    new Vector2(0.47, -0.32),
    new Vector2(0.52, -0.5),
    new Vector2(0.57, -0.68),
    new Vector2(0.62, -0.85),
  ]
  const lathe = new LatheGeometry(pts, 14)
  const pos = lathe.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const a = Math.atan2(z, x)
    // chisel fades out at the hood tip so the peak stays a clean point
    const k = y > 0.8 ? 0 : y > 0.5 ? (0.8 - y) / 0.3 : 1
    const jag = stoneJag(a, y) * k
    pos.setX(i, x * (1 + jag))
    pos.setZ(i, z * (1 + jag))
    if (y < -0.55) {
      const hk = Math.min(1, (-0.55 - y) / 0.3)
      const rag = 0.11 * Math.sin(a * 7 + 1.3) + 0.07 * Math.sin(a * 13 + 0.4)
      pos.setY(i, y + rag * hk)
    }
  }
  const geo = lathe.toNonIndexed()
  geo.computeVertexNormals()
  bakeFacetShading(geo, 0.38, 0.5)
  return geo
}

/** Slimmer inner robe beneath the cloak — same stone treatment, subdued. */
function makeRobeGeometry(): BufferGeometry {
  const pts = [
    new Vector2(0.001, 0.3),
    new Vector2(0.2, 0.2),
    new Vector2(0.24, -0.1),
    new Vector2(0.34, -0.55),
    new Vector2(0.4, -0.92),
  ]
  const lathe = new LatheGeometry(pts, 10)
  const pos = lathe.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const jag = stoneJag(Math.atan2(z, x), pos.getY(i)) * 0.6
    pos.setX(i, x * (1 + jag))
    pos.setZ(i, z * (1 + jag))
  }
  const geo = lathe.toNonIndexed()
  geo.computeVertexNormals()
  bakeFacetShading(geo, 0.32, 0.4)
  return geo
}

/**
 * Brilliant-cut chest gem with baked facet shading: a fixed key light dotted
 * against each flat face into the color attribute, so an unlit HDR material
 * still reads as a cut stone in the deliberately dim scene.
 */
function makeGemGeometry(): BufferGeometry {
  const pts = gemProfile().map(([r, y]) => new Vector2(r * 0.22, y * 0.22))
  const geo = new LatheGeometry(pts, 8).toNonIndexed()
  geo.computeVertexNormals()
  bakeFacetShading(geo, 0.5, 0.7, 1.2)
  return geo
}

const scratch = new Vector3()
const collarDummy = new Object3D()

/**
 * The astral body seen in third person. Prefers an HQ character dropped at
 * public/assets/player.glb (auto-scaled, idle clip auto-played); otherwise
 * renders the procedural crystal seraph: layered tattered cloak + inner robe,
 * rim aura shell, engraved pauldron collar, glyph columns down the robe, a
 * gold faceted chest gem inside its halo, a precessing rune orbit ring, the
 * gold ritual circle underfoot, orbiting shards — and the AvatarWings rig on
 * its own mount so the wings share attitude but never squash. During 'streak'
 * the body holds a reaching pose while the ghost flies out; during 'pull' it
 * stretches along the approach — the out-of-body premise.
 */
export function PlayerAvatar({ palette }: { palette: Palette }) {
  const root = useRef<Group>(null)
  const body = useRef<Group>(null)
  const wingMount = useRef<Group>(null)
  const core = useRef<Mesh>(null)
  const coreMat = useRef<MeshBasicMaterial>(null)
  const coreInner = useRef<Mesh>(null)
  const coreInnerMat = useRef<MeshBasicMaterial>(null)
  const eyeMatL = useRef<MeshBasicMaterial>(null)
  const eyeMatR = useRef<MeshBasicMaterial>(null)
  const eyeHaloMat = useRef<SpriteMaterial>(null)
  const glyphMat = useRef<MeshBasicMaterial>(null)
  const innerRing = useRef<Mesh>(null)
  const innerMat = useRef<MeshBasicMaterial>(null)
  const auraMat = useRef<MeshBasicMaterial>(null)
  const halo = useRef<Sprite>(null)
  const haloMat = useRef<SpriteMaterial>(null)
  const waistRing = useRef<Mesh>(null)
  const waistMat = useRef<MeshBasicMaterial>(null)
  const baseGrp = useRef<Group>(null)
  const baseMat = useRef<MeshBasicMaterial>(null)
  const runeBand = useRef<Mesh>(null)
  const bandMat = useRef<MeshBasicMaterial>(null)
  const colMats = useRef<(MeshBasicMaterial | null)[]>([])
  const collar = useRef<InstancedMesh>(null)
  const softTex = useLoader(TextureLoader, '/assets/particle_soft.png')
  const runesTex = useLoader(TextureLoader, '/assets/runes.png')

  // Cloned atlas views: one glyph ROW wrapped around the base band, one
  // glyph COLUMN per robe strip (offset.y scrolls the living inscription).
  const bandTex = useMemo(() => {
    const tx = runesTex.clone()
    tx.wrapS = RepeatWrapping
    tx.wrapT = RepeatWrapping
    tx.repeat.set(3, 1 / 3)
    tx.offset.set(0, 1 / 3)
    tx.needsUpdate = true
    return tx
  }, [runesTex])
  const colTexes = useMemo(
    () =>
      RUNE_COLS.map((_, i) => {
        const tx = runesTex.clone()
        tx.wrapS = RepeatWrapping
        tx.wrapT = RepeatWrapping
        tx.repeat.set(1 / 4, 1)
        tx.offset.set(i / 4, 0)
        tx.needsUpdate = true
        return tx
      }),
    [runesTex],
  )

  // Optional HQ model: loaded manually so a missing file falls back silently.
  const [hqModel, setHqModel] = useState<Group | null>(null)
  const mixer = useRef<AnimationMixer | null>(null)
  useEffect(() => {
    let disposed = false
    new GLTFLoader().load(
      PLAYER_MODEL_URL,
      gltf => {
        if (disposed) return
        const scene = gltf.scene
        const box = new Box3().setFromObject(scene)
        const size = new Vector3()
        box.getSize(size)
        const s = 1.9 / Math.max(size.y, 1e-3)
        scene.scale.setScalar(s)
        const center = new Vector3()
        box.getCenter(center)
        scene.position.set(-center.x * s, -center.y * s, -center.z * s)
        if (gltf.animations.length > 0) {
          mixer.current = new AnimationMixer(scene)
          mixer.current.clipAction(gltf.animations[0]).play()
        }
        setHqModel(scene)
      },
      undefined,
      () => {
        // no player.glb — the procedural wraith carries the run
      },
    )
    return () => {
      disposed = true
    }
  }, [])

  const cloakGeo = useMemo(makeCloakGeometry, [])
  const robeGeo = useMemo(makeRobeGeometry, [])
  const cavityGeo = useMemo(
    () => new SphereGeometry(0.17, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2),
    [],
  )
  const eyeGeo = useMemo(() => new OctahedronGeometry(0.035, 0), [])
  const gemGeo = useMemo(makeGemGeometry, [])
  const gemBackGeo = useMemo(() => new OctahedronGeometry(0.15, 0), [])
  const gemCoreGeo = useMemo(() => new OctahedronGeometry(0.075, 0), [])
  const waistGeo = useMemo(() => new TorusGeometry(0.46, 0.022, 6, 40), [])
  const baseTorusGeo = useMemo(() => new TorusGeometry(0.8, 0.028, 8, 48), [])
  const innerRingGeo = useMemo(() => new TorusGeometry(0.62, 0.014, 6, 40), [])
  const bandGeo = useMemo(() => new CylinderGeometry(0.8, 0.8, 0.16, 48, 1, true), [])
  const colGeo = useMemo(() => new PlaneGeometry(0.12, 0.66), [])
  const collarGeo = useMemo(() => soupToGeometry(buildCollarPlate(), true), [])
  const cloakMat = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#06070c',
        roughness: 0.88,
        metalness: 0.12,
        flatShading: true,
        vertexColors: true,
      }),
    [],
  )
  const robeMat = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#04050a',
        roughness: 0.95,
        metalness: 0,
        flatShading: true,
        vertexColors: true,
      }),
    [],
  )
  const collarMaterial = useMemo(
    () => new MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    [],
  )
  useEffect(() => {
    return () => {
      cloakGeo.dispose()
      robeGeo.dispose()
      cavityGeo.dispose()
      eyeGeo.dispose()
      gemGeo.dispose()
      gemBackGeo.dispose()
      gemCoreGeo.dispose()
      waistGeo.dispose()
      baseTorusGeo.dispose()
      innerRingGeo.dispose()
      bandGeo.dispose()
      colGeo.dispose()
      collarGeo.dispose()
      cloakMat.dispose()
      robeMat.dispose()
      collarMaterial.dispose()
      bandTex.dispose()
      for (const tx of colTexes) tx.dispose()
    }
  }, [cloakGeo, robeGeo, cavityGeo, eyeGeo, gemGeo, gemBackGeo, gemCoreGeo, waistGeo, baseTorusGeo, innerRingGeo, bandGeo, colGeo, collarGeo, cloakMat, robeMat, collarMaterial, bandTex, colTexes])

  const secondaryHdr = useMemo(() => new Color(palette.secondary).multiplyScalar(1.8), [palette])
  const runeHdr = useMemo(() => new Color(palette.rune).multiplyScalar(2.2), [palette])
  const tmp = useMemo(() => new Color(), [])

  // Realm palette swap: color writes only, no geometry/material rebuilds.
  // The gem + rings stay gold (signature relics); runes retint per realm.
  useEffect(() => {
    cloakMat.color.set('#06070c').lerp(new Color(palette.voidTop), 0.4)
    robeMat.color.set('#04050a').lerp(new Color(palette.voidBottom), 0.3)
    if (haloMat.current) haloMat.current.color.copy(GOLD_GEM)
    if (auraMat.current) auraMat.current.color.copy(tmp.copy(secondaryHdr).multiplyScalar(0.12))
    collarMaterial.color.set(palette.secondary).lerp(new Color('#cfe2f2'), 0.6)
  }, [palette, cloakMat, robeMat, collarMaterial, secondaryHdr, tmp])

  // Collar pauldrons: seven engraved plates ringing the hood plus two larger
  // shoulder guards anchoring the wing roots. Static — computed once, shared
  // by the instance matrices and the merged glyph engravings.
  const collarTransforms = useMemo(() => {
    const arr: Matrix4[] = []
    for (let i = 0; i < 7; i++) {
      const a = (i * Math.PI * 2) / 7 + 0.45
      const minor = i % 2 === 1
      collarDummy.position.set(Math.sin(a) * 0.3, 0.27, Math.cos(a) * 0.3)
      collarDummy.rotation.set(-0.5, a, 0, 'YXZ')
      collarDummy.scale.set(minor ? 0.12 : 0.16, minor ? 0.15 : 0.2, minor ? 0.12 : 0.16)
      collarDummy.updateMatrix()
      arr.push(collarDummy.matrix.clone())
    }
    for (const sx of [1, -1]) {
      collarDummy.position.set(sx * 0.3, 0.37, 0.02)
      collarDummy.rotation.set(-0.7, sx * (Math.PI / 2), 0, 'YXZ')
      collarDummy.scale.set(0.19, 0.22, 0.19)
      collarDummy.updateMatrix()
      arr.push(collarDummy.matrix.clone())
    }
    return arr
  }, [])
  useLayoutEffect(() => {
    const m = collar.current
    if (!m) return
    for (let i = 0; i < collarTransforms.length; i++) m.setMatrixAt(i, collarTransforms[i])
    m.instanceMatrix.needsUpdate = true
  }, [collarTransforms])

  // Every plate carries an engraved atlas rune — merged into one additive
  // draw call, positioned just off each plate face.
  const collarGlyphGeo = useMemo(() => {
    const posOut: number[] = []
    const uvOut: number[] = []
    const lift = new Matrix4().makeTranslation(0, -0.45, 0.2)
    for (let i = 0; i < collarTransforms.length; i++) {
      const g = runePlaneGeometry((i * 5 + 2) % 12, 0.5).toNonIndexed()
      g.applyMatrix4(lift)
      g.applyMatrix4(collarTransforms[i])
      const p = g.attributes.position as BufferAttribute
      const uv = g.attributes.uv as BufferAttribute
      for (let v = 0; v < p.count; v++) {
        posOut.push(p.getX(v), p.getY(v), p.getZ(v))
        uvOut.push(uv.getX(v), uv.getY(v))
      }
      g.dispose()
    }
    const merged = new BufferGeometry()
    merged.setAttribute('position', new Float32BufferAttribute(posOut, 3))
    merged.setAttribute('uv', new Float32BufferAttribute(uvOut, 2))
    return merged
  }, [collarTransforms])
  useEffect(() => () => collarGlyphGeo.dispose(), [collarGlyphGeo])

  // Smoothed animation state (exp taus), kept outside React.
  const anim = useRef({
    yaw: 0,
    lean: 0,
    tilt: 0,
    roll: 0,
    yawRate: 0,
    prevYaw: 0,
    beatLift: 0,
    eyeGlow: 1,
    reach: 0,
  })

  useFrame(({ clock }, rawDt) => {
    const g = root.current
    const b = body.current
    if (!g || !b) return
    const dt = Math.min(rawDt, 0.1)
    const t = clock.elapsedTime
    const sc = snapController
    const a = anim.current
    const rm = visuals.rm ? 0.6 : 1

    // Visibility: first person, or the occluded boom collapsing onto the body.
    const show = sc.viewBlend > 0.35 && sc.camDist > 1.4
    g.visible = show
    avatarFrame.visible = show
    if (!show) {
      // latched horrors still need an anchor in first person — raw controller
      avatarFrame.x = sc.pos.x
      avatarFrame.y = sc.pos.y - 0.4
      avatarFrame.z = sc.pos.z
      avatarFrame.yaw = sc.yaw
      avatarFrame.pitch = 0
      avatarFrame.roll = 0
      return
    }

    mixer.current?.update(dt)

    const k = (tau: number) => 1 - Math.exp(-dt / tau)

    // --- root: position + hover bob + facing (bob stills in an eagle soar)
    const soar = sc.tricks.soar
    a.beatLift += (visuals.beatPulse - a.beatLift) * k(0.1)
    const bob = (0.06 * Math.sin(1.7 * t) + 0.1 * a.beatLift) * rm * (1 - 0.8 * soar)
    g.position.set(sc.pos.x, sc.pos.y - 0.4 + bob, sc.pos.z)

    const phase = sc.phase
    if (phase === 'streak' || phase === 'pull') {
      // face the snap target while the astral form flies / the body is pulled
      scratch.copy(sc.snapPoint).sub(sc.pos)
      const targetYaw = Math.atan2(-scratch.x, -scratch.z)
      a.yaw += shortestArc(a.yaw, targetYaw) * k(0.05)
    } else {
      a.yaw += shortestArc(a.yaw, sc.yaw) * k(0.1)
    }
    g.rotation.set(0, a.yaw, 0)

    // --- body: lean/bank from velocity in yaw space
    const s = Math.sin(a.yaw)
    const c = Math.cos(a.yaw)
    const vxLocal = c * sc.vel.x - s * sc.vel.z
    const vzLocal = -s * sc.vel.x - c * sc.vel.z
    const yawRateRaw = shortestArc(a.prevYaw, sc.yaw) / Math.max(1e-3, dt)
    a.prevYaw = sc.yaw
    a.yawRate += (yawRateRaw - a.yawRate) * k(0.06)

    // vzLocal > 0 when moving forward; lean INTO motion = negative rotation.x
    let targetLean = clampAbs(-vzLocal * 0.028, 0.3) * rm
    // diving (vel.y < 0) noses down, climbing tips back
    let targetTilt = clampAbs(sc.vel.y * 0.035, 0.4) * rm
    // prone soar banks into the turn like a real eagle — steady and
    // coordinated, never past ~30°
    let targetRoll = clampAbs(
      (clampAbs(-vxLocal * 0.05, 0.35) + clampAbs(-a.yawRate * 0.09, 0.45)) *
        rm *
        (1 + 0.45 * soar),
      0.52,
    )

    // --- phase poses
    let reachTarget = 0
    let sy = 1
    let sxz = 1
    if (phase === 'streak') {
      reachTarget = 1
      targetLean = -0.35 * rm
    } else if (phase === 'pull') {
      const kk = Math.min(1, sc.phaseT / PULL_DUR)
      const stretch = Math.sin(Math.PI * kk)
      sy = 1 + 1.4 * stretch * rm
      sxz = 1 - 0.35 * stretch * rm
      targetLean = -0.5 * rm
    } else if (phase === 'recover') {
      const q = 0.18 * Math.exp(-9 * sc.phaseT) * rm
      sy = 1 - q
      sxz = 1 + 0.7 * q
    } else if (phase === 'shift') {
      // dissolving through the gate: spin up and pull inward
      const kk = Math.min(1, sc.phaseT / 0.45)
      sy = 1 + 0.8 * kk
      sxz = Math.max(0.15, 1 - 0.85 * kk)
      targetRoll += 4 * kk * dt
    } else if (phase === 'downed') {
      // dragged from the sky: head-down slump, everything gutters out
      const kk = Math.min(1, sc.phaseT / 1.2)
      targetLean = 0.55 * kk
      targetTilt = 0.2 * kk
      sy = 1 - 0.12 * kk
    }
    a.reach += (reachTarget - a.reach) * k(0.05)
    a.lean += (targetLean - a.lean) * k(0.12)
    a.tilt += (targetTilt - a.tilt) * k(0.12)
    a.roll += (targetRoll - a.roll) * k(0.12)

    // eagle soar: the whole body tips prone along the velocity vector; the
    // small hover lean/tilt fade out as the big pitch takes over
    const soarPitch =
      soar > 0.001
        ? Math.max(-1.35, soar * (-1.12 + 0.85 * Math.max(-1.1, sc.tricks.climb)))
        : 0
    const pitchTotal =
      a.lean * (1 - 0.55 * soar) + a.tilt * (1 - 0.7 * soar) - 0.45 * a.reach + soarPitch
    b.rotation.set(pitchTotal, 0, a.roll)
    b.scale.set(sxz, sy, sxz)
    // wings share the body's attitude but never its pull-stretch — crystal
    // doesn't go rubbery
    if (wingMount.current) {
      wingMount.current.rotation.set(pitchTotal, 0, a.roll)
    }

    // --- gem pulse (bass + beat), halo breath, aura swell
    const bass = audioFrame.bass
    if (core.current) {
      const cs = 1 + 0.25 * bass + 0.35 * a.beatLift
      core.current.scale.setScalar(cs * (1 + 0.6 * a.reach))
      core.current.rotation.y += dt * 0.7
    }
    // the inner fire tumbles against the stone's spin — living sparkle
    if (coreInner.current) {
      coreInner.current.rotation.y -= dt * 1.9
      coreInner.current.rotation.x += dt * 0.6
      coreInner.current.scale.setScalar(1 + 0.3 * bass + 0.25 * a.beatLift)
    }
    if (coreInnerMat.current) {
      coreInnerMat.current.color.copy(tmp.copy(GOLD_GEM)).multiplyScalar(3.2 + 1.6 * bass)
    }
    // the score multiplier feeds the aura: a chained player visibly burns —
    // and the downed fade drains the relics of their fire. Rite auras layer
    // on top: stasis cools/swells the halo, veil fades every glow toward
    // weather, frenzy sets the gem and eyes alight (the x1.5 damage READS).
    const aura = visuals.auraGlow
    const lifeDim = 1 - 0.75 * visuals.downedFade
    const stasis = visuals.stasisAura
    const veilDim = 1 - 0.5 * visuals.veilAura
    const frenzy = visuals.frenzyAura
    if (coreMat.current) {
      tmp.copy(GOLD_GEM)
      if (frenzy > 0.001) tmp.lerp(FRENZY_HOT, 0.45 * frenzy)
      coreMat.current.color
        .copy(tmp)
        .multiplyScalar(
          (2.2 + 1.2 * bass + 0.5 * a.beatLift) * (1 + 0.55 * aura) * (1 + 0.8 * frenzy) * lifeDim,
        )
    }
    if (haloMat.current) {
      haloMat.current.opacity =
        Math.min(1, 0.35 + 0.2 * bass + 0.25 * a.beatLift + 0.25 * aura + 0.3 * stasis) * veilDim
      tmp.copy(GOLD_GEM)
      if (stasis > 0.001) tmp.lerp(STASIS_COOL, 0.7 * stasis)
      haloMat.current.color.copy(tmp)
    }
    if (halo.current) halo.current.scale.setScalar((0.9 + 0.15 * bass) * (1 + 0.35 * stasis))
    if (auraMat.current) {
      auraMat.current.color
        .copy(tmp.copy(secondaryHdr))
        .multiplyScalar((0.1 + 0.08 * bass + 0.1 * a.beatLift + 0.08 * aura) * veilDim)
    }

    // --- eyes glow when a target is locked; a slow double-frequency flicker
    //     keeps them alive even at rest. Downed: they gutter out.
    const eyeTarget = phase === 'downed' ? 0.15 : sc.target >= 0 ? 2.5 : 1
    a.eyeGlow += (eyeTarget - a.eyeGlow) * k(0.08)
    const eyeLife = 0.84 + 0.12 * Math.sin(1.3 * t) + 0.05 * Math.sin(7.7 * t + 1)
    const eyeGain = a.eyeGlow * eyeLife * (1 + 0.8 * frenzy) * veilDim
    tmp.copy(runeHdr)
    if (frenzy > 0.001) tmp.lerp(FRENZY_HOT, 0.5 * frenzy)
    if (eyeMatL.current) {
      eyeMatL.current.color.copy(tmp).multiplyScalar(eyeGain)
    }
    if (eyeMatR.current) {
      eyeMatR.current.color.copy(tmp).multiplyScalar(eyeGain)
    }
    if (eyeHaloMat.current) {
      eyeHaloMat.current.opacity = (0.13 + 0.06 * eyeLife + 0.12 * (a.eyeGlow - 1)) * veilDim
    }

    // --- waist orbit ring: tilted, precessing, beat-swollen
    if (waistRing.current) {
      waistRing.current.rotation.set(
        Math.PI / 2 + 0.2 * Math.sin(t * 0.53),
        0,
        0.2 * Math.cos(t * 0.53),
      )
      waistRing.current.scale.setScalar(1 + 0.05 * a.beatLift + 0.03 * bass)
    }
    if (waistMat.current) {
      waistMat.current.color
        .copy(tmp.copy(runeHdr))
        .multiplyScalar(1.1 + 0.8 * a.beatLift + 0.35 * bass + 0.4 * aura)
    }

    // --- base ritual ring: gold circle + scrolling glyph band
    const speed = Math.hypot(sc.vel.x, sc.vel.z)
    if (baseGrp.current) {
      baseGrp.current.scale.setScalar(
        1 + 0.05 * bass + 0.22 * visuals.impactPulse + 0.15 * visuals.gateOpenPulse,
      )
      baseGrp.current.position.y = -1.06 + 0.04 * Math.sin(1.3 * t + 1)
    }
    if (baseMat.current) {
      baseMat.current.color
        .copy(tmp.copy(GOLD_RING))
        .multiplyScalar(
          (1.5 + 0.7 * bass + 0.06 * speed + 2.0 * visuals.impactPulse + 0.5 * aura) * lifeDim,
        )
    }
    if (runeBand.current) runeBand.current.rotation.y += dt * 0.22
    if (bandMat.current) {
      bandMat.current.color
        .copy(tmp.copy(GOLD_RING))
        .multiplyScalar(1.1 + 0.9 * a.beatLift + 1.6 * visuals.impactPulse)
    }
    if (innerRing.current) innerRing.current.rotation.z -= dt * 0.35
    if (innerMat.current) {
      innerMat.current.color
        .copy(tmp.copy(GOLD_RING))
        .multiplyScalar(0.9 + 0.5 * bass + 1.2 * visuals.impactPulse)
    }

    // --- living inscription: robe columns flicker with the mids, scroll
    //     downward, and burn brighter as a drop charges
    const midK = Math.min(1, audioFrame.midOnsetStrength)
    for (let i = 0; i < RUNE_COLS.length; i++) {
      const m = colMats.current[i]
      if (!m) continue
      m.opacity = Math.min(
        1,
        0.42 +
          0.2 * Math.sin(t * (1.1 + 0.31 * i) + i * 2.1) +
          0.45 * midK * visuals.midsReact +
          0.55 * visuals.dropCharge,
      )
      m.color.copy(tmp.copy(runeHdr)).multiplyScalar(0.55 + 0.5 * aura + 0.3 * visuals.w3)
      colTexes[i].offset.y = (t * (0.02 + 0.009 * i)) % 1
    }

    // --- publish the rendered attitude for the latch riders (HorrorSwarm
    //     mounts after us, so this is a same-frame read)
    avatarFrame.x = g.position.x
    avatarFrame.y = g.position.y
    avatarFrame.z = g.position.z
    avatarFrame.yaw = a.yaw
    avatarFrame.pitch = pitchTotal
    avatarFrame.roll = a.roll
  })

  return (
    <group ref={root} visible={false}>
      <group ref={body}>
        {hqModel ? (
          <primitive object={hqModel} />
        ) : (
          <>
            <mesh geometry={cloakGeo} material={cloakMat} />
            <mesh geometry={robeGeo} material={robeMat} />
            {/* faint rim aura: back-face shell makes the silhouette glow */}
            <mesh geometry={cloakGeo} scale={[1.06, 1.04, 1.06]}>
              <meshBasicMaterial
                ref={auraMat}
                color={secondaryHdr}
                side={BackSide}
                blending={AdditiveBlending}
                transparent
                opacity={0.9}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
            {/* concave void inside the hood — depth instead of a flat disc */}
            <mesh geometry={cavityGeo} position={[0, 0.42, 0.2]} rotation={[-Math.PI / 2, 0, 0]}>
              <meshBasicMaterial color="#000000" side={BackSide} />
            </mesh>
            {/* diamond-cut eyes with a soft shared glow in the cavity */}
            <mesh geometry={eyeGeo} position={[-0.06, 0.44, 0.22]} scale={[1, 1.45, 0.75]}>
              <meshBasicMaterial ref={eyeMatL} color={runeHdr} toneMapped={false} />
            </mesh>
            <mesh geometry={eyeGeo} position={[0.06, 0.44, 0.22]} scale={[1, 1.45, 0.75]}>
              <meshBasicMaterial ref={eyeMatR} color={runeHdr} toneMapped={false} />
            </mesh>
            <sprite position={[0, 0.44, 0.21]} scale={[0.26, 0.2, 1]}>
              <spriteMaterial
                ref={eyeHaloMat}
                map={softTex}
                color={runeHdr}
                blending={AdditiveBlending}
                transparent
                opacity={0.3}
                depthWrite={false}
                toneMapped={false}
              />
            </sprite>
            {/* engraved pauldron plates ringing the hood + shoulder guards */}
            <instancedMesh
              ref={collar}
              args={[collarGeo, collarMaterial, collarTransforms.length]}
            />
            <mesh geometry={collarGlyphGeo}>
              <meshBasicMaterial
                ref={glyphMat}
                map={runesTex}
                color={runeHdr}
                blending={AdditiveBlending}
                transparent
                opacity={0.85}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
            {/* living inscription: glyph columns down the robe front */}
            {RUNE_COLS.map((ang, i) => (
              <mesh
                key={`rc${i}`}
                geometry={colGeo}
                position={[Math.sin(ang) * 0.49, -0.33, -Math.cos(ang) * 0.49]}
                rotation={[0.3, Math.PI - ang, 0, 'YXZ']}
              >
                <meshBasicMaterial
                  ref={el => {
                    colMats.current[i] = el
                  }}
                  map={colTexes[i]}
                  color={runeHdr}
                  blending={AdditiveBlending}
                  transparent
                  opacity={0.5}
                  depthWrite={false}
                  toneMapped={false}
                />
              </mesh>
            ))}
          </>
        )}
        {/* the astral signature stays in both modes: gem, halo, rings, shards */}
        {/* dark pendant setting silhouettes the stone */}
        <mesh geometry={gemBackGeo} position={[0, 0.05, 0.26]} scale={[1.2, 1.45, 0.28]}>
          <meshBasicMaterial color="#0b0e14" />
        </mesh>
        <mesh ref={core} geometry={gemGeo} position={[0, 0.05, 0.32]}>
          <meshBasicMaterial
            ref={coreMat}
            vertexColors
            color={GOLD_GEM}
            transparent
            opacity={0.85}
            toneMapped={false}
          />
        </mesh>
        {/* inner fire: a counter-rotating core glimpsed through the facets */}
        <mesh ref={coreInner} geometry={gemCoreGeo} position={[0, 0.05, 0.32]}>
          <meshBasicMaterial ref={coreInnerMat} color={GOLD_GEM} toneMapped={false} />
        </mesh>
        <sprite ref={halo} position={[0, 0.04, 0.3]} scale={[0.9, 0.9, 1]}>
          <spriteMaterial
            ref={haloMat}
            map={softTex}
            color={GOLD_GEM}
            blending={AdditiveBlending}
            transparent
            opacity={0.4}
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
        <mesh
          ref={waistRing}
          geometry={waistGeo}
          position={[0, -0.06, 0]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <meshBasicMaterial ref={waistMat} color={runeHdr} toneMapped={false} />
        </mesh>
        {/* the ritual circle the wraith hovers inside */}
        <group ref={baseGrp} position={[0, -1.06, 0]}>
          <mesh geometry={baseTorusGeo} rotation={[Math.PI / 2, 0, 0]}>
            <meshBasicMaterial ref={baseMat} color={GOLD_RING} toneMapped={false} />
          </mesh>
          {/* thin counter-rotating inner circle — the double-ring sigil */}
          <mesh ref={innerRing} geometry={innerRingGeo} rotation={[Math.PI / 2, 0, 0]}>
            <meshBasicMaterial ref={innerMat} color={GOLD_RING} toneMapped={false} />
          </mesh>
          <mesh ref={runeBand} geometry={bandGeo} position={[0, 0.1, 0]}>
            <meshBasicMaterial
              ref={bandMat}
              map={bandTex}
              color={GOLD_RING}
              blending={AdditiveBlending}
              transparent
              opacity={0.9}
              side={DoubleSide}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        </group>
        {/* the gate-charge charms: the three resonance shards, now legible */}
        <CharmShards palette={palette} />
      </group>
      {/* crystalline seraph wings ride the body's attitude, not its stretch */}
      <group ref={wingMount}>
        <AvatarWings palette={palette} />
      </group>
    </group>
  )
}

function shortestArc(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

function clampAbs(v: number, m: number): number {
  return Math.max(-m, Math.min(m, v))
}
