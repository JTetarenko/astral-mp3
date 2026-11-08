import { useFrame, useLoader } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  PointsMaterial,
  Quaternion,
  Sprite,
  SpriteMaterial,
  TextureLoader,
  Vector2,
  Vector3,
  type BufferAttribute,
  type InstancedMesh,
  type Points,
  type PointLight,
} from 'three'
import { audioFrame } from '../audio/reactiveBus'
import { CP } from '../game/castState'
import { feel } from '../game/feelSignals'
import {
  assemblyStagger,
  bowStringPoints,
  buildArrow,
  buildBowRiser,
  buildBowSegment,
  idleFloatPose,
  limbCurl,
  limbTipPos,
  LIMB_LENS,
  LIMB_WIDTHS,
  SEG_COUNT,
  volleyFanAngles,
  type IdleFloatPose,
} from './bowGeom'
import { bowUniformsOf, makeBowMaterial } from './bowShader'
import { bowFrame } from './bowFrame'
import { BURST } from './burstVocab'
import { soupToGeometry } from './AvatarWings'
import { gemProfile } from './wingGeom'
import { governor } from './perfGovernor'
import { fillRibbonPositions, ribbonEdges, ribbonIndices } from './ribbonGeom'
import { makeRibbonMaterial } from './ribbonMaterial'
import { runePlaneGeometry } from './runeAtlas'
import { snapController } from './snapController'
import { combatSignals, smoothstep, T, visuals } from './visualTuning'
import type { Palette } from '../theme/palettes'

const SEG_INSTANCES = SEG_COUNT * 2
const STRING_N = 24
const ORBITALS = 8
const ASSEMBLY = 24
const SPARKLES = 16
const SPARKS = ORBITALS + ASSEMBLY + SPARKLES

// module-scoped scratch — zero allocation per frame
const dummy = new Object3D()
const eulerHost = new Object3D()
const mChain = new Matrix4()
const mStep = new Matrix4()
const mOut = new Matrix4()
const qAim = new Quaternion()
const vTmp = new Vector3()
const vNock = new Vector3()
const vAnchor = new Vector3()
const vRight = new Vector3()
const vUp = new Vector3()
const vFwd = new Vector3()
const glintWorld = new Vector3()
const curls = new Float32Array(SEG_COUNT)
const tipPos = { y: 0, z: 0 }
const stringLocal = new Float32Array(STRING_N * 3)
const stringWorld = new Float32Array(STRING_N * 3)
const stringWidths = new Float32Array(STRING_N)
const fanAngles = new Float32Array(3)
const idlePose: IdleFloatPose = { y: 0, yaw: 0, roll: 0, gap: 0 }
const colTmp = new Color()
const hiddenMatrix = new Matrix4().makeScale(1e-4, 1e-4, 1e-4)

/** Per-segment bow-rank (heat-crawl / stagger ordering): riser 0 -> prongs 1. */
const SEG_RANK: number[] = []
for (let i = 0; i < SEG_COUNT; i++) SEG_RANK.push(0.25 + 0.75 * (i / (SEG_COUNT - 1)))

/**
 * The Astral Crystal Bow: a levitating segmented crystal recurve the wraith
 * draws telekinetically (it has no hands — the weapon floats). Materializes
 * from shards when combat calls (dithered assembly, riser-first), idles
 * beside the avatar breathing with the music, snaps to the aim on windup,
 * flexes its segmented limbs as the energy string pulls back to the nocked
 * arrow, splits the arrow into a three-fan on overdraw, and recoils with a
 * decaying string vibration on every loose. Combo heat crawls up the limbs
 * (visuals.bowHeat), an armed Resonance Storm ignites the glyphs gold, and
 * the rig blends from a body-side mount in third person to a lower-right
 * camera anchor in first person. Mounted after PlayerAvatar (avatarFrame
 * fresh) and before AstralBolts (bowFrame read same-frame).
 */
export function AstralBow({ palette }: { palette: Palette }) {
  const rootRef = useRef<Group>(null)
  const segRef = useRef<InstancedMesh>(null)
  const riserRef = useRef<InstancedMesh>(null)
  const arrowRef = useRef<InstancedMesh>(null)
  const stringRef = useRef<Mesh>(null)
  const sparksRef = useRef<Points>(null)
  const lightRef = useRef<PointLight>(null)
  const softTex = useLoader(TextureLoader, '/assets/particle_soft.png')
  const runesTex = useLoader(TextureLoader, '/assets/runes.png')
  const ringTex = useLoader(TextureLoader, '/assets/ring_soft.png')
  const streakTex = useLoader(TextureLoader, '/assets/corona_streaks.png')
  const beamTex = useLoader(TextureLoader, '/assets/beam.png')

  // ---- geometries ----
  const segGeo = useMemo(() => {
    const geo = soupToGeometry(buildBowSegment(), true)
    const data = new Float32Array(SEG_INSTANCES * 4)
    for (let s = 0; s < 2; s++) {
      for (let i = 0; i < SEG_COUNT; i++) {
        const o = (s * SEG_COUNT + i) * 4
        data[o] = SEG_RANK[i]
        data[o + 1] = s === 0 ? 1 : -1
        data[o + 2] = (i * 0.618 + s * 0.37) % 1
        data[o + 3] = SEG_RANK[i] * 0.5
      }
    }
    geo.setAttribute('aData', new InstancedBufferAttribute(data, 4))
    return geo
  }, [])
  const riserGeo = useMemo(() => {
    const geo = soupToGeometry(buildBowRiser(), true)
    // rank 0, stagger 0: the riser crystallizes first
    geo.setAttribute('aData', new InstancedBufferAttribute(new Float32Array([0, 0, 0.41, 0]), 4))
    return geo
  }, [])
  const arrowGeo = useMemo(() => {
    const geo = soupToGeometry(buildArrow(), true)
    const data = new Float32Array(3 * 4)
    for (let i = 0; i < 3; i++) {
      data[i * 4] = 0.5
      data[i * 4 + 1] = i === 0 ? 0 : i === 1 ? -1 : 1
      data[i * 4 + 2] = (i * 0.618 + 0.11) % 1
      data[i * 4 + 3] = 0
    }
    geo.setAttribute('aData', new InstancedBufferAttribute(data, 4))
    return geo
  }, [])
  const gemGeo = useMemo(() => {
    // the relic gem-lathe recipe at bow scale, two-tone facet bands baked
    const pts = gemProfile().map(([r, y]) => new Vector2(r * 0.07, y * 0.07))
    const g = new LatheGeometry(pts, 6).toNonIndexed()
    const pos = g.attributes.position
    const cols = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i)
      const v = y > 0.017 ? 1.5 : y > -0.023 ? 1.0 : 0.55
      cols[i * 3] = cols[i * 3 + 1] = cols[i * 3 + 2] = v
    }
    g.setAttribute('color', new Float32BufferAttribute(cols, 3))
    return g
  }, [])
  const glyphGeo = useMemo(() => {
    // four hovering rune inlays merged into one additive draw (collar idiom):
    // two flanking the riser, two floating in the outer limb gaps
    const posOut: number[] = []
    const uvOut: number[] = []
    const place = [
      { glyph: 3, size: 0.13, x: -0.16, y: 0.02, z: 0.01 },
      { glyph: 7, size: 0.13, x: 0.16, y: -0.02, z: 0.01 },
      { glyph: 1, size: 0.11, x: 0.02, y: 0.63, z: 0.08 },
      { glyph: 10, size: 0.11, x: -0.02, y: -0.63, z: 0.08 },
    ]
    const m = new Matrix4()
    for (const pl of place) {
      const g = runePlaneGeometry(pl.glyph, pl.size).toNonIndexed()
      m.makeTranslation(pl.x, pl.y, pl.z)
      g.applyMatrix4(m)
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
  }, [])
  const stringGeo = useMemo(() => {
    const geo = new BufferGeometry()
    const pos = new Float32BufferAttribute(new Float32Array(STRING_N * 2 * 3), 3)
    const col = new Float32BufferAttribute(new Float32Array(STRING_N * 2 * 3), 3)
    pos.setUsage(DynamicDrawUsage)
    col.setUsage(DynamicDrawUsage)
    geo.setAttribute('position', pos)
    geo.setAttribute('color', col)
    geo.setAttribute('aEdge', new Float32BufferAttribute(ribbonEdges(STRING_N), 1))
    geo.setIndex(Array.from(ribbonIndices(STRING_N)))
    return geo
  }, [])
  const sparkGeo = useMemo(() => {
    const geo = new BufferGeometry()
    const pos = new Float32BufferAttribute(new Float32Array(SPARKS * 3), 3)
    const col = new Float32BufferAttribute(new Float32Array(SPARKS * 3), 3)
    pos.setUsage(DynamicDrawUsage)
    col.setUsage(DynamicDrawUsage)
    geo.setAttribute('position', pos)
    geo.setAttribute('color', col)
    return geo
  }, [])

  // ---- materials ----
  const bowMat = useMemo(() => makeBowMaterial(), [])
  const arrowMat = useMemo(() => makeBowMaterial(), [])
  const gemMat = useMemo(() => new MeshBasicMaterial({ vertexColors: true, toneMapped: false }), [])
  const glyphMat = useMemo(
    () =>
      new MeshBasicMaterial({
        map: runesTex,
        transparent: true,
        opacity: 0.3,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: DoubleSide,
      }),
    [runesTex],
  )
  const stringMat = useMemo(() => makeRibbonMaterial(), [])
  const sparkMat = useMemo(
    () =>
      new PointsMaterial({
        size: 0.05,
        map: softTex,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexColors: true,
        sizeAttenuation: true,
        toneMapped: false,
      }),
    [softTex],
  )
  const halo = useMemo(() => {
    // the baked radial is OPAQUE (radial in RGB, alpha 255) — reusing it as
    // the alphaMap squares the falloff so the quad edge can never read
    const s = new Sprite(
      new SpriteMaterial({
        map: softTex,
        alphaMap: softTex,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        opacity: 0.9,
      }),
    )
    s.visible = false
    return s
  }, [softTex])
  const streak = useMemo(() => {
    const s = new Sprite(
      new SpriteMaterial({
        map: streakTex,
        alphaMap: streakTex,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        opacity: 0,
      }),
    )
    s.visible = false
    return s
  }, [streakTex])
  const shockRing = useMemo(() => {
    const m = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({
        map: ringTex,
        alphaMap: ringTex,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: DoubleSide,
        opacity: 0,
      }),
    )
    m.visible = false
    m.frustumCulled = false
    return m
  }, [ringTex])
  const stormBeam = useMemo(() => {
    const m = new Mesh(
      new PlaneGeometry(1.6, 30),
      new MeshBasicMaterial({
        map: beamTex,
        alphaMap: beamTex,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: DoubleSide,
        opacity: 0,
      }),
    )
    m.visible = false
    m.frustumCulled = false
    return m
  }, [beamTex])

  useEffect(() => {
    return () => {
      segGeo.dispose()
      riserGeo.dispose()
      arrowGeo.dispose()
      gemGeo.dispose()
      glyphGeo.dispose()
      stringGeo.dispose()
      sparkGeo.dispose()
      bowMat.dispose()
      arrowMat.dispose()
      gemMat.dispose()
      glyphMat.dispose()
      stringMat.dispose()
      sparkMat.dispose()
      halo.material.dispose()
      streak.material.dispose()
      shockRing.geometry.dispose()
      ;(shockRing.material as MeshBasicMaterial).dispose()
      stormBeam.geometry.dispose()
      ;(stormBeam.material as MeshBasicMaterial).dispose()
    }
  }, [segGeo, riserGeo, arrowGeo, gemGeo, glyphGeo, stringGeo, sparkGeo, bowMat, arrowMat, gemMat, glyphMat, stringMat, sparkMat, halo, streak, shockRing, stormBeam])

  // alias the dynamic attribute arrays once — Float32BufferAttribute COPIES
  // its input (the BoltTrails gotcha), so per-frame writes go through these
  const S = useMemo(() => {
    const posAttr = stringGeo.attributes.position as BufferAttribute
    const colAttr = stringGeo.attributes.color as BufferAttribute
    const sparkPosAttr = sparkGeo.attributes.position as BufferAttribute
    const sparkColAttr = sparkGeo.attributes.color as BufferAttribute
    return {
      posAttr,
      colAttr,
      sparkPosAttr,
      sparkColAttr,
      pos: posAttr.array as Float32Array,
      col: colAttr.array as Float32Array,
      sparkPos: sparkPosAttr.array as Float32Array,
      sparkCol: sparkColAttr.array as Float32Array,
    }
  }, [stringGeo, sparkGeo])

  // ---- palette: color writes only ----
  const stringHdr = useMemo(() => new Color(), [])
  const gemGold = useMemo(() => new Color('#ffd24a').multiplyScalar(2.6), [])
  const gemWhite = useMemo(() => new Color('#ffffff').multiplyScalar(4), [])
  const emberHdr = useMemo(() => new Color(), [])
  const runeHdr = useMemo(() => new Color(), [])
  useEffect(() => {
    for (const mat of [bowMat, arrowMat]) {
      const u = bowUniformsOf(mat)
      u.uIce.value.set('#ffffff').lerp(new Color(palette.secondary), 0.12)
      u.uDeep.value.set(palette.secondary).lerp(new Color('#ffffff'), 0.3).multiplyScalar(0.62)
      u.uEmber.value.set(palette.primary).lerp(new Color('#ffffff'), 0.35).multiplyScalar(2.4)
    }
    stringHdr.set(palette.trail).lerp(new Color('#ffffff'), 0.35)
    emberHdr.set(palette.primary).lerp(new Color('#ffffff'), 0.4).multiplyScalar(2.6)
    runeHdr.set(palette.rune).lerp(new Color('#ffffff'), 0.2).multiplyScalar(2.2)
    glyphMat.color.copy(runeHdr)
    ;(shockRing.material as MeshBasicMaterial).color
      .set(palette.trail)
      .lerp(new Color('#ffffff'), 0.5)
      .multiplyScalar(2.5)
    ;(stormBeam.material as MeshBasicMaterial).color
      .set(palette.primary)
      .lerp(new Color('#ffffff'), 0.6)
      .multiplyScalar(2.8)
    // modest gain — the gaussian's tails clip into a visible quad past ~1.6
    halo.material.color.set(palette.trail).lerp(new Color('#ffffff'), 0.5).multiplyScalar(1.5)
    streak.material.color.set(palette.trail).lerp(new Color('#ffffff'), 0.6).multiplyScalar(2.2)
  }, [palette, bowMat, arrowMat, glyphMat, shockRing, stormBeam, halo, streak, stringHdr, emberHdr, runeHdr])

  const st = useRef({
    born: -1,
    /** 0..1 materialize level + its target. */
    mat: 0,
    matTarget: 0,
    idleSince: 99,
    dissolveArmedAt: -1,
    /** feel diff cursors. */
    lastLoose: 0,
    lastStorm: 0,
    lastPhase: CP.IDLE as number,
    /** string vibration. */
    vibAmp: 0,
    vibPhase: 0,
    /** release recoil + flash envelopes. */
    recoil: 0,
    flash: 0,
    /** shockwave ring / storm beam clocks (>= 1 = idle). */
    ringT: 9,
    ringPower: 0,
    beamT: 9,
    /** slewed draw for the micro-flex lag. */
    flexLag: 0,
    orbitPhase: 0,
    /** hash sphere directions for the assembly shard shell. */
    shardDir: (() => {
      const d = new Float32Array(ASSEMBLY * 3)
      for (let i = 0; i < ASSEMBLY; i++) {
        const a = i * 2.399963
        const y = 1 - (2 * (i + 0.5)) / ASSEMBLY
        const r = Math.sqrt(Math.max(0, 1 - y * y))
        d[i * 3] = Math.cos(a) * r
        d[i * 3 + 1] = y
        d[i * 3 + 2] = Math.sin(a) * r
      }
      return d
    })(),
  })

  useFrame(({ clock, camera }, rawDt) => {
    const root = rootRef.current
    const seg = segRef.current
    const riser = riserRef.current
    const arrows = arrowRef.current
    const stringMesh = stringRef.current
    const sparks = sparksRef.current
    const light = lightRef.current
    if (!root || !seg || !riser || !arrows || !stringMesh || !sparks) return
    const dt = Math.min(rawDt, 0.1)
    const t = clock.elapsedTime
    const sc = snapController
    const cs = sc.cast
    const v = visuals
    const rm = v.rm
    const s = st.current
    const k = (tau: number) => 1 - Math.exp(-dt / tau)
    if (s.born < 0) {
      s.born = t
      s.lastLoose = feel.castLooseCount
      s.lastStorm = feel.castStormCount
    }
    const blend = smoothstep(0.25, 0.45, sc.viewBlend)

    // ---- manifest machine ----
    const phase = sc.phase
    const combatActive =
      cs.phase !== CP.IDLE ||
      sc.tricks.castRelease > 0.2 ||
      combatSignals.castComboTier > 0 ||
      combatSignals.stormArmed
    if (phase === 'shift' || phase === 'downed') {
      s.matTarget = 0
      s.idleSince = 99
      s.dissolveArmedAt = -1
    } else if (combatActive) {
      if (s.matTarget < 1 && s.mat < 0.05) {
        // shard convergence burst the moment the summon begins
        computeAnchor(camera, blend)
        sc.pendingBursts.push({
          x: vAnchor.x,
          y: vAnchor.y,
          z: vAnchor.z,
          count: 26,
          style: BURST.BOW_ASSEMBLE,
        })
      }
      s.matTarget = 1
      s.idleSince = 0
      s.dissolveArmedAt = -1
    } else {
      s.idleSince += dt
      if (s.matTarget > 0 && s.idleSince > 4.5) {
        // wait up to 0.8s for a bar wrap so the vanish lands on the downbeat
        if (s.dissolveArmedAt < 0) s.dissolveArmedAt = t
        if (v.barSync <= 0.5 || v.barPulse > 0.55 || t - s.dissolveArmedAt > 0.8) {
          s.matTarget = 0
          s.dissolveArmedAt = -1
          sc.pendingBursts.push({
            x: root.position.x,
            y: root.position.y,
            z: root.position.z,
            count: 10,
            style: BURST.BOW_ASSEMBLE,
          })
        }
      }
    }
    const matTau = s.matTarget > s.mat ? 0.09 : phase === 'shift' || phase === 'downed' ? 0.07 : 0.14
    s.mat += (s.matTarget - s.mat) * k(matTau)
    if (s.mat < 0.02 && s.matTarget === 0) {
      root.visible = false
      arrows.visible = false
      stringMesh.visible = false
      sparks.visible = false
      halo.visible = false
      streak.visible = false
      if (light) light.visible = false
      bowFrame.manifest = 0
      stepWorldFx(dt, camera)
      return
    }
    root.visible = true
    stringMesh.visible = true
    sparks.visible = true

    // ---- pose signals ----
    const draw = sc.tricks.castCharge
    const windup = sc.tricks.castWindup
    const od = sc.tricks.overdraw
    const fullPulse = sc.tricks.fullPulse
    const casting = cs.phase !== CP.IDLE

    // ---- release edges ----
    if (feel.castLooseCount !== s.lastLoose) {
      s.lastLoose = feel.castLooseCount
      const power = cs.power
      const kind = feel.lastLooseKind
      s.vibAmp = (0.05 + 0.1 * power) * (rm ? 0.6 : 1)
      s.vibPhase = 0
      s.recoil = 0.12 * (0.5 + 0.5 * power) * (rm ? 0.6 : 1)
      s.flash = Math.max(s.flash, Math.min(rm ? 1.8 : 3, 1.6 + 1.4 * power))
      bowFrame.lastLooseAt = t
      if (kind >= 1) {
        s.ringT = 0
        s.ringPower = kind >= 2 ? 1.15 : 0.55 + 0.6 * power
      }
    }
    if (feel.castStormCount !== s.lastStorm) {
      s.lastStorm = feel.castStormCount
      if (!rm) s.beamT = 0
      vTmp.set(
        sc.pos.x + sc.forward.x * 1.2,
        sc.pos.y + sc.forward.y * 1.2 + 0.15,
        sc.pos.z + sc.forward.z * 1.2,
      )
      sc.pendingBursts.push({ x: vTmp.x, y: vTmp.y, z: vTmp.z, count: 40, style: BURST.STORM })
    }
    if (cs.phase === CP.WINDUP && s.lastPhase === CP.IDLE) s.flash = Math.max(s.flash, 0.4)
    s.lastPhase = cs.phase
    s.vibAmp *= Math.exp(-9 * dt)
    if (s.vibAmp < 1e-4) s.vibAmp = 0
    s.vibPhase += 55 * dt
    s.recoil *= Math.exp(-8 * dt)
    s.flash *= Math.exp(-7 * dt)
    if (s.flash < 1e-3) s.flash = 0

    // ---- root anchor: TP body mount <-> FP camera mount, aim-true ----
    idleFloatPose(idlePose, t, v.beatPulse, v.barPulse)
    const idleK = 1 - Math.max(draw, windup)
    computeAnchor(camera, blend)
    vAnchor.y += idlePose.y * idleK * blend
    // recoil lunges the whole bow back along the aim
    vAnchor.addScaledVector(sc.forward, -s.recoil * 2.2)
    root.position.lerp(vAnchor, blend < 0.02 ? 1 : k(0.05))
    const cant = 0.55 + (0.35 - 0.55) * blend - 0.25 * draw + idlePose.roll * idleK
    const aimYaw = casting || blend < 0.5 ? sc.yaw : sc.yaw + idlePose.yaw * idleK
    eulerHost.rotation.set(sc.pitch - s.recoil * 0.4, aimYaw, cant, 'YXZ')
    qAim.setFromEuler(eulerHost.rotation)
    root.quaternion.slerp(qAim, casting ? k(0.04) : k(0.16))
    const scale = (0.55 + 0.45 * blend) * (0.24 + 0.76 * s.mat)
    root.scale.setScalar(scale)
    root.updateMatrixWorld()

    // ---- limb FK -> segment instances ----
    limbCurl(curls, draw, od)
    const gap = idlePose.gap * idleK
    for (let side = 0; side < 2; side++) {
      if (side === 0) {
        mChain.makeTranslation(0, 0.18, 0)
      } else {
        mChain.makeRotationZ(Math.PI)
        mChain.setPosition(0, -0.18, 0)
      }
      for (let i = 0; i < SEG_COUNT; i++) {
        mStep.makeRotationX(curls[i])
        mChain.multiply(mStep)
        mOut.copy(mChain)
        mStep.makeScale(LIMB_WIDTHS[i], LIMB_LENS[i] * 0.92, LIMB_WIDTHS[i] * 0.72)
        mOut.multiply(mStep)
        seg.setMatrixAt(side * SEG_COUNT + i, mOut)
        mStep.makeTranslation(0, LIMB_LENS[i] + gap, 0)
        mChain.multiply(mStep)
      }
    }
    seg.instanceMatrix.needsUpdate = true

    // ---- string (world space, camera-facing ribbon) ----
    limbTipPos(tipPos, curls)
    bowStringPoints(
      stringLocal,
      STRING_N,
      tipPos.y,
      tipPos.z,
      -tipPos.y,
      tipPos.z,
      draw,
      od,
      s.vibAmp,
      s.vibPhase,
    )
    for (let i = 0; i < STRING_N; i++) {
      vTmp
        .set(stringLocal[i * 3], stringLocal[i * 3 + 1], stringLocal[i * 3 + 2])
        .applyMatrix4(root.matrixWorld)
      stringWorld[i * 3] = vTmp.x
      stringWorld[i * 3 + 1] = vTmp.y
      stringWorld[i * 3 + 2] = vTmp.z
    }
    const stringGate = smoothstep(0.55, 0.9, s.mat)
    const wGain = (1 + 1.2 * draw) * scale * stringGate * (governor.level >= 4 ? 0.7 : 1)
    const colGain = (2 + 1.5 * (draw + fullPulse)) * stringGate
    for (let i = 0; i < STRING_N; i++) {
      const u = i / (STRING_N - 1)
      const arc = Math.sin(Math.PI * u)
      stringWidths[i] = (0.006 + 0.007 * arc) * wGain
      const g = colGain * (0.5 + 0.5 * arc) * (1 + 0.6 * v.beatPulse * arc)
      const o = i * 6
      const cr = stringHdr.r * g
      const cg = stringHdr.g * g
      const cb = stringHdr.b * g
      S.col[o] = cr
      S.col[o + 1] = cg
      S.col[o + 2] = cb
      S.col[o + 3] = cr
      S.col[o + 4] = cg
      S.col[o + 5] = cb
    }
    fillRibbonPositions(
      S.pos,
      stringWorld,
      STRING_N,
      stringWidths,
      camera.position.x,
      camera.position.y,
      camera.position.z,
    )
    S.posAttr.needsUpdate = true
    S.colAttr.needsUpdate = true

    // ---- nock + arrows (world-space instances, each on its flight ray) ----
    vNock.set(0, 0, tipPos.z + 0.34 * draw + 0.08 * od).applyMatrix4(root.matrixWorld)
    const arrowGate =
      cs.phase === CP.CHARGE ? Math.min(1, draw / 0.15) : cs.phase === CP.WINDUP ? windup * 0.5 : 0
    const au = bowUniformsOf(arrowMat)
    au.uMat.value = arrowGate
    au.uTime.value = t
    au.uHeat.value = v.bowHeat
    au.uHue.value = v.hue * 0.6 + t * 0.06
    au.uFlash.value = s.flash * 0.5
    arrows.visible = arrowGate > 0.02
    if (arrows.visible) {
      volleyFanAngles(fanAngles, od)
      vRight.set(Math.cos(sc.yaw), 0, -Math.sin(sc.yaw))
      for (let i = 0; i < 3; i++) {
        const fanK = i === 0 ? 1 : smoothstep(0.05, 0.45, od)
        if (fanK < 0.02) {
          arrows.setMatrixAt(i, hiddenMatrix)
          continue
        }
        const fan = fanAngles[i]
        // converge each arrow onto its own flight ray toward the far muzzle
        vTmp
          .set(
            sc.pos.x + sc.forward.x * 2.6,
            sc.pos.y + sc.forward.y * 2.6 + 0.15,
            sc.pos.z + sc.forward.z * 2.6,
          )
          .addScaledVector(vRight, Math.tan(fan) * 2.6)
        dummy.position.copy(vNock)
        if (i > 0) dummy.position.addScaledVector(vRight, fan * 0.35)
        dummy.lookAt(vTmp)
        dummy.rotateX(Math.PI / 2)
        const as = scale * (0.85 + 0.1 * fullPulse) * (i === 0 ? 1 : 0.9 * fanK)
        dummy.scale.set(as, as, as)
        dummy.updateMatrix()
        arrows.setMatrixAt(i, dummy.matrix)
      }
      arrows.instanceMatrix.needsUpdate = true
    }

    // ---- bow shader state ----
    const bu = bowUniformsOf(bowMat)
    bu.uTime.value = t
    bu.uMat.value = s.mat
    bu.uHeat.value = Math.min(1, v.bowHeat + 0.15 * draw)
    bu.uHue.value = v.hue * 0.6 + t * 0.06
    bu.uFlash.value = s.flash
    bu.uTremble.value = 0.02 * od * (rm ? 0.3 : 1)
    bu.uBreath.value = 0.006 * v.barPulse * idleK
    s.flexLag += (draw - s.flexLag) * k(0.06)
    bu.uFlex.value = Math.max(-0.3, Math.min(0.3, (draw - s.flexLag) * 0.8))
    bu.uIrid.value = 0.26 + 0.2 * v.tripLevel + 0.18 * v.bowHeat
    const af = audioFrame
    bu.uGlow.value =
      (0.9 + 0.5 * af.bass * v.bassReact + 0.5 * v.beatPulse + 0.3 * v.barPulse) *
      T(0.8, 1.0, 1.2, 1.45) *
      (0.55 + 0.45 * v.vi)
    bu.uSparkle.value =
      (0.35 + 1.5 * af.highs * v.highsReact) * (0.5 + 0.5 * v.vi) * (1 + 1.5 * draw + 2 * fullPulse)
    glintWorld
      .set(Math.sin(t * 0.33), 0.4 + 0.25 * Math.sin(t * 0.21), Math.cos(t * 0.27))
      .normalize()
      .transformDirection(camera.matrixWorldInverse)
    bu.uGlintDir.value.copy(glintWorld)
    au.uGlintDir.value.copy(glintWorld)
    au.uGlow.value = bu.uGlow.value
    au.uSparkle.value = bu.uSparkle.value

    // ---- gem + glyphs: storm-armed ignition ----
    const storm = v.stormGlow
    colTmp.copy(gemGold).lerp(gemWhite, 0.5 * storm)
    gemMat.color.copy(colTmp).multiplyScalar((1 + 0.35 * v.beatPulse + 0.5 * storm) * s.mat)
    glyphMat.opacity =
      governor.level >= 4
        ? 0
        : Math.min(1, (0.22 + 0.5 * v.bowHeat + 0.55 * storm + 0.2 * draw) * s.mat)
    glyphMat.color.copy(runeHdr).lerp(gemGold, 0.7 * storm)

    // ---- halo + lens streak at the nock ----
    const haloS = (0.08 + 0.34 * draw + 0.28 * fullPulse + 0.16 * storm) * scale
    halo.visible = casting || storm > 0.05
    if (halo.visible) {
      halo.position.copy(vNock)
      halo.scale.setScalar(haloS)
      halo.material.opacity = 0.35 + 0.25 * draw
    }
    const streakK = 0.5 * fullPulse + 0.35 * od + 0.3 * storm * (0.5 + 0.5 * Math.sin(t * 2.1))
    streak.visible = streakK > 0.03 && !rm
    if (streak.visible) {
      streak.position.copy(vNock)
      streak.scale.set(4.4 * streakK * scale, 1.1 * streakK * scale, 1)
      streak.material.rotation = t * 0.3
      streak.material.opacity = Math.min(0.85, streakK)
    }

    // ---- draw light (nock glow; governor-gated) ----
    if (light) {
      const li = (2.2 * draw + 1.3 * s.flash + 2 * fullPulse) * scale
      light.visible = governor.level < 3 && li > 0.06
      if (light.visible) {
        light.position.copy(vNock)
        light.intensity = li
        light.color.copy(stringHdr)
      }
    }

    // ---- sparks: orbitals / assembly shards / string sparkles ----
    s.orbitPhase += (0.8 + 1.6 * v.bowHeat) * dt
    const sparksLive = governor.level < 3
    for (let i = 0; i < ORBITALS; i++) {
      const o = i * 3
      if (!sparksLive) {
        S.sparkCol[o] = S.sparkCol[o + 1] = S.sparkCol[o + 2] = 0
        continue
      }
      const a = s.orbitPhase + (i / ORBITALS) * Math.PI * 2
      vTmp
        .set(Math.cos(a) * 0.42, Math.sin(a * 2 + i) * 0.28, Math.sin(a) * 0.21)
        .applyMatrix4(root.matrixWorld)
      S.sparkPos[o] = vTmp.x
      S.sparkPos[o + 1] = vTmp.y
      S.sparkPos[o + 2] = vTmp.z
      const g = (0.5 + 0.5 * Math.sin(a * 3 + i * 1.7)) * (0.4 + 1.6 * v.bowHeat) * s.mat
      S.sparkCol[o] = runeHdr.r * g
      S.sparkCol[o + 1] = runeHdr.g * g
      S.sparkCol[o + 2] = runeHdr.b * g
    }
    const assembling = s.mat > 0.02 && s.mat < 0.96
    for (let i = 0; i < ASSEMBLY; i++) {
      const o = (ORBITALS + i) * 3
      if (!assembling || !sparksLive) {
        S.sparkCol[o] = S.sparkCol[o + 1] = S.sparkCol[o + 2] = 0
        continue
      }
      const rank = i / ASSEMBLY
      const part = assemblyStagger(s.mat, rank)
      const r = 1.35 * (1 - part) + 0.06
      const d = s.shardDir
      vTmp.set(d[i * 3] * r, d[i * 3 + 1] * (r + 0.4), d[i * 3 + 2] * r).applyMatrix4(root.matrixWorld)
      S.sparkPos[o] = vTmp.x
      S.sparkPos[o + 1] = vTmp.y
      S.sparkPos[o + 2] = vTmp.z
      const g = (1 - part) * 2.2
      S.sparkCol[o] = emberHdr.r * g
      S.sparkCol[o + 1] = emberHdr.g * g
      S.sparkCol[o + 2] = emberHdr.b * g
    }
    const sparkleGain = v.beatPulse * stringGate
    for (let i = 0; i < SPARKLES; i++) {
      const o = (ORBITALS + ASSEMBLY + i) * 3
      if (sparkleGain < 0.08 || !sparksLive) {
        S.sparkCol[o] = S.sparkCol[o + 1] = S.sparkCol[o + 2] = 0
        continue
      }
      const idx = Math.min(STRING_N - 1, 1 + i * Math.floor(STRING_N / SPARKLES) + (i % 2))
      S.sparkPos[o] = stringWorld[idx * 3]
      S.sparkPos[o + 1] = stringWorld[idx * 3 + 1]
      S.sparkPos[o + 2] = stringWorld[idx * 3 + 2]
      const g = sparkleGain * (0.6 + 0.4 * Math.sin(t * 9 + i * 2.3))
      S.sparkCol[o] = stringHdr.r * 2.4 * g
      S.sparkCol[o + 1] = stringHdr.g * 2.4 * g
      S.sparkCol[o + 2] = stringHdr.b * 2.4 * g
    }
    S.sparkPosAttr.needsUpdate = true
    S.sparkColAttr.needsUpdate = true

    stepWorldFx(dt, camera)

    // ---- publish (AstralBolts/BoltTrails read same-frame) ----
    bowFrame.manifest = s.mat
    bowFrame.arrowTipX = vNock.x + sc.forward.x * 0.96 * scale
    bowFrame.arrowTipY = vNock.y + sc.forward.y * 0.96 * scale
    bowFrame.arrowTipZ = vNock.z + sc.forward.z * 0.96 * scale
  })

  /** TP body-side mount <-> FP camera lower-right anchor into vAnchor. */
  function computeAnchor(
    camera: { matrixWorld: Matrix4; position: Vector3 },
    blend: number,
  ): void {
    const sc = snapController
    const yaw = sc.yaw
    const ox = 0.42
    const oy = 0.52
    const oz = -0.35
    const tx = sc.pos.x + Math.cos(yaw) * ox - Math.sin(yaw) * oz
    const ty = sc.pos.y + oy
    const tz = sc.pos.z - Math.sin(yaw) * ox - Math.cos(yaw) * oz
    vRight.setFromMatrixColumn(camera.matrixWorld, 0)
    vUp.setFromMatrixColumn(camera.matrixWorld, 1)
    vFwd.setFromMatrixColumn(camera.matrixWorld, 2).multiplyScalar(-1)
    vAnchor
      .copy(camera.position)
      .addScaledVector(vRight, 0.35)
      .addScaledVector(vUp, -0.22)
      .addScaledVector(vFwd, 0.55)
    vAnchor.x += (tx - vAnchor.x) * blend
    vAnchor.y += (ty - vAnchor.y) * blend
    vAnchor.z += (tz - vAnchor.z) * blend
  }

  /** Release shockwave ring + storm sky-beam (world-space one-shots). */
  function stepWorldFx(dt: number, camera: { position: Vector3 }): void {
    const s = st.current
    const sc = snapController
    if (s.ringT < 1) {
      s.ringT = Math.min(1, s.ringT + dt / 0.25)
      const e = 1 - (1 - s.ringT) * (1 - s.ringT)
      shockRing.visible = true
      shockRing.position.set(
        sc.pos.x + sc.forward.x * 1.4,
        sc.pos.y + sc.forward.y * 1.4 + 0.15,
        sc.pos.z + sc.forward.z * 1.4,
      )
      vTmp.copy(shockRing.position).add(sc.forward)
      shockRing.lookAt(vTmp)
      const sr = 0.3 + 3.6 * e * s.ringPower
      shockRing.scale.set(sr, sr, sr)
      ;(shockRing.material as MeshBasicMaterial).opacity = (1 - s.ringT) * 0.85
    } else if (shockRing.visible) {
      shockRing.visible = false
    }
    if (s.beamT < 1) {
      s.beamT = Math.min(1, s.beamT + dt / 0.3)
      stormBeam.visible = true
      stormBeam.position.set(
        sc.pos.x + sc.forward.x * 1.4,
        sc.pos.y + sc.forward.y * 1.4 + 12,
        sc.pos.z + sc.forward.z * 1.4,
      )
      stormBeam.rotation.set(
        0,
        Math.atan2(
          camera.position.x - stormBeam.position.x,
          camera.position.z - stormBeam.position.z,
        ),
        0,
      )
      ;(stormBeam.material as MeshBasicMaterial).opacity = (1 - s.beamT) * 0.75
    } else if (stormBeam.visible) {
      stormBeam.visible = false
    }
  }

  return (
    <>
      <group ref={rootRef} visible={false}>
        <instancedMesh
          ref={el => {
            segRef.current = el
            if (el) el.instanceMatrix.setUsage(DynamicDrawUsage)
          }}
          args={[segGeo, bowMat, SEG_INSTANCES]}
          frustumCulled={false}
        />
        <instancedMesh
          ref={el => {
            riserRef.current = el
            if (el) {
              el.instanceMatrix.setUsage(DynamicDrawUsage)
              dummy.position.set(0, 0, 0)
              dummy.rotation.set(0, 0, 0)
              dummy.scale.setScalar(1)
              dummy.updateMatrix()
              el.setMatrixAt(0, dummy.matrix)
            }
          }}
          args={[riserGeo, bowMat, 1]}
          frustumCulled={false}
        />
        <mesh geometry={gemGeo} material={gemMat} position={[0, 0, -0.09]} frustumCulled={false} />
        <mesh geometry={glyphGeo} material={glyphMat} frustumCulled={false} />
      </group>
      <pointLight ref={lightRef} distance={10} decay={2} visible={false} />
      <instancedMesh
        ref={el => {
          arrowRef.current = el
          if (el) {
            el.instanceMatrix.setUsage(DynamicDrawUsage)
            for (let i = 0; i < 3; i++) el.setMatrixAt(i, hiddenMatrix)
          }
        }}
        args={[arrowGeo, arrowMat, 3]}
        visible={false}
        frustumCulled={false}
      />
      <mesh ref={stringRef} geometry={stringGeo} material={stringMat} frustumCulled={false} visible={false} />
      <points ref={sparksRef} geometry={sparkGeo} material={sparkMat} frustumCulled={false} visible={false} />
      <primitive object={halo} />
      <primitive object={streak} />
      <primitive object={shockRing} />
      <primitive object={stormBeam} />
    </>
  )
}
