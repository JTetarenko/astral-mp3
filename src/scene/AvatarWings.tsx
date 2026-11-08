import { useFrame, useLoader } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  PointsMaterial,
  ShaderMaterial,
  TextureLoader,
  Vector3,
  type BufferAttribute,
  type InstancedMesh,
  type Points,
} from 'three'
import { audioFrame } from '../audio/reactiveBus'
import { runState } from '../game/runState'
import { snapController } from './snapController'
import { smoothstep, T, visuals } from './visualTuning'
import {
  BONE_LENGTHS,
  buildFeatherBlade,
  buildStrutSlab,
  buildWingLayout,
  flapPose,
  flapWave,
  type FlapPose,
  type TriSoup,
} from './wingGeom'
import type { Palette } from '../theme/palettes'

const LAYOUT = buildWingLayout()
const FEATHERS = LAYOUT.length
const INSTANCES = FEATHERS * 2
const STRUTS = 6
const SPARKS = 64
/** Wing root offset from the avatar origin (shoulder blades). */
const ROOT_X = 0.26
const ROOT_Y = 0.44
const ROOT_Z = 0.12
/** Rest dihedral — the wings ride raised, seraph-style. */
const BASE_RAISE = 0.85
/** Realm-shift swap instant (mirrors snapController's SHIFT_SWAP_T). */
const SHIFT_SWAP_T = 0.45
const STRUT_WIDTHS = [0.075, 0.062, 0.05]

export function soupToGeometry(soup: TriSoup, withGlow: boolean): BufferGeometry {
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(soup.positions, 3))
  geo.setAttribute('aV', new Float32BufferAttribute(soup.along, 1))
  if (withGlow) {
    // grayscale glow scalar -> vec3 color attr (CrystalShards two-tone idiom)
    const colors = new Float32Array(soup.glow.length * 3)
    for (let i = 0; i < soup.glow.length; i++) {
      colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = soup.glow[i]
    }
    geo.setAttribute('color', new Float32BufferAttribute(colors, 3))
  }
  geo.computeVertexNormals()
  return geo
}

const featherVert = /* glsl */ `
  attribute float aV;
  attribute vec4 aData; // x ripple rank, y layer, z rand, w side
  uniform float uTime;
  uniform float uBend;
  uniform float uTremble;
  varying float vV;
  varying vec3 vN;
  varying vec3 vE;
  varying float vRand;
  void main() {
    vV = aV;
    vRand = aData.z;
    vec3 p = position;
    // stroke lag: blades flex through their thin axis, quadratic to the tip
    float k = aV * aV;
    p.z += uBend * (0.65 + 0.35 * sin(aData.x * 1.7 + aData.w)) * k;
    p.x += uTremble * sin(uTime * 37.0 + aData.x * 9.0 + aData.z * 20.0) * k;
    mat4 im = instanceMatrix;
    vec4 mv = modelViewMatrix * im * vec4(p, 1.0);
    vN = normalize(mat3(modelViewMatrix * im) * normal);
    vE = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`

const featherFrag = /* glsl */ `
  uniform vec3 uIce;
  uniform vec3 uDeep;
  uniform vec3 uGlintDir;
  uniform float uGlow;
  uniform float uSparkle;
  uniform float uFlash;
  uniform float uIrid;
  uniform float uHue;
  varying float vV;
  varying vec3 vN;
  varying vec3 vE;
  varying float vRand;
  void main() {
    vec3 N = normalize(vN);
    vec3 E = normalize(vE);
    float ndv = abs(dot(N, E));
    float fres = pow(1.0 - ndv, 2.2);
    // faceted prism: each flat facet picks a hue by its normal, drifting
    // slowly; abs() keeps mirrored wings on the same rainbow
    float h = dot(abs(N), vec3(0.6, 1.1, 0.8)) + vV * 2.6 + vRand * 3.1 + uHue;
    vec3 irid = 0.5 + 0.5 * cos(h + vec3(0.0, 2.094, 4.188));
    vec3 col = mix(uDeep, uIce, 0.3 + 0.7 * vV);
    col += irid * uIrid * (0.3 + 0.9 * fres);
    col += vec3(0.9) * fres;
    // rotating glint: facets aligned with the roving light flash HDR white
    float g = pow(max(dot(N, uGlintDir), 0.0), 30.0);
    col += vec3(3.4) * g * uSparkle;
    // stacking shadow where blades overlap at the root, hot tips
    float rootAo = 0.58 + 0.55 * smoothstep(0.0, 0.3, vV);
    col *= uGlow * rootAo * (0.85 + 0.35 * vV);
    // faint internal growth bands — crystal, not plastic
    col *= 1.0 + 0.07 * sin(vV * 34.0 + vRand * 19.0) * (1.0 - fres);
    col += vec3(uFlash);
    gl_FragColor = vec4(col, 1.0);
  }
`

const dummy = new Object3D()
const mSh = new Matrix4()
const mEl = new Matrix4()
const mHa = new Matrix4()
const mF = new Matrix4()
const glintWorld = new Vector3()
const pose: FlapPose = {
  shoulderLift: 0,
  shoulderSweep: 0,
  shoulderTwist: 0,
  elbowBend: 0,
  handBend: 0,
  elbowFold: 0,
  handFold: 0,
  splayMul: 1,
  featherPitch: 0,
}

/** Wrap to the nearest cycle: frac distance in [-0.5, 0.5]. */
function fracArc(d: number): number {
  return d - Math.round(d)
}

const clampAbs = (v: number, m: number) => Math.max(-m, Math.min(m, v))

interface WingAnim {
  born: number
  phaseF: number
  amp: number
  fold: number
  sweep: number
  raise: number
  spread: number
  power: number
  glide: number
  bend: number
  bank: number
  lastBar: number
  lastNova: number
  lastBanish: number
  prevPhase: string
  prevPhaseT: number
  /** Flap-glide bout state: seconds left in the bout / until the next one. */
  boutLeft: number
  nextBoutIn: number
  boutCount: number
  boutAmp: number
}

/**
 * The crystalline seraph wings: 30 prismatic blade feathers on a 3-joint
 * armature per side (one InstancedMesh), dark rune-lit struts, and a spiral
 * halo of spark motes overhead. The flap cycle entrains to the song's bar
 * grid (downstroke lands on the downbeat when the grid is trustworthy),
 * joints lag shoulder->elbow->hand->feathers for follow-through, and every
 * gameplay beat gets a pose: dive tuck on streak, trailing stretch on pull,
 * flare on recover, cocoon wrap through a realm shift, overhead tremble as a
 * drop charges, full-spread white flash when it lands.
 */
export function AvatarWings({ palette }: { palette: Palette }) {
  const feathers = useRef<InstancedMesh>(null)
  const struts = useRef<InstancedMesh>(null)
  const sparks = useRef<Points>(null)
  const softTex = useLoader(TextureLoader, '/assets/particle_soft.png')

  const featherGeo = useMemo(() => {
    const geo = soupToGeometry(buildFeatherBlade(), false)
    const data = new Float32Array(INSTANCES * 4)
    for (let s = 0; s < 2; s++) {
      const sx = s === 0 ? 1 : -1
      for (let i = 0; i < FEATHERS; i++) {
        const o = (s * FEATHERS + i) * 4
        data[o] = LAYOUT[i].ripple
        data[o + 1] = LAYOUT[i].layer
        data[o + 2] = ((i * 0.618 + s * 0.31) % 1)
        data[o + 3] = sx
      }
    }
    geo.setAttribute('aData', new InstancedBufferAttribute(data, 4))
    return geo
  }, [])
  const strutGeo = useMemo(() => soupToGeometry(buildStrutSlab(), true), [])

  const featherMat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: featherVert,
        fragmentShader: featherFrag,
        uniforms: {
          uTime: { value: 0 },
          uBend: { value: 0 },
          uTremble: { value: 0 },
          uIce: { value: new Color('#e8f4ff') },
          uDeep: { value: new Color('#5a7a9a') },
          uGlintDir: { value: new Vector3(0, 1, 0) },
          uGlow: { value: 1 },
          uSparkle: { value: 0.5 },
          uFlash: { value: 0 },
          uIrid: { value: 0.35 },
          uHue: { value: 0 },
        },
      }),
    [],
  )
  const strutMat = useMemo(
    () => new MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    [],
  )

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
  const sparkMat = useMemo(
    () =>
      new PointsMaterial({
        size: 0.055,
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

  useEffect(() => {
    return () => {
      featherGeo.dispose()
      strutGeo.dispose()
      sparkGeo.dispose()
      featherMat.dispose()
      strutMat.dispose()
      sparkMat.dispose()
    }
  }, [featherGeo, strutGeo, sparkGeo, featherMat, strutMat, sparkMat])

  // Realm palette swap: color writes only.
  const sparkHdr = useMemo(() => new Color(), [])
  useEffect(() => {
    const ice = featherMat.uniforms.uIce.value as Color
    const deep = featherMat.uniforms.uDeep.value as Color
    ice.set('#ffffff').lerp(new Color(palette.secondary), 0.12)
    deep.set(palette.secondary).lerp(new Color('#ffffff'), 0.3).multiplyScalar(0.62)
    strutMat.color.set(palette.rune).lerp(new Color('#dfeeff'), 0.5)
    sparkHdr.set(palette.rune).lerp(new Color('#ffffff'), 0.3).multiplyScalar(2.6)
  }, [palette, featherMat, strutMat, sparkHdr])

  const anim = useRef<WingAnim>({
    born: -1,
    phaseF: 0,
    amp: 0.5,
    fold: 0,
    sweep: 0.1,
    raise: 0,
    spread: 0,
    power: 0,
    glide: 0,
    bend: 0,
    bank: 0,
    lastBar: -1,
    lastNova: -1,
    lastBanish: 0,
    prevPhase: 'idle',
    prevPhaseT: 0,
    boutLeft: 0,
    nextBoutIn: 1.2,
    boutCount: 0,
    boutAmp: 0.035,
  })

  useFrame(({ clock, camera }, rawDt) => {
    const fm = feathers.current
    const sm = struts.current
    const pm = sparks.current
    if (!fm || !sm || !pm) return
    const sc = snapController
    // mirror the avatar's visibility gate — no work while first-person/occluded
    const show = sc.viewBlend > 0.35 && sc.camDist > 1.4
    fm.visible = show
    sm.visible = show
    pm.visible = show
    if (!show) return

    const dt = Math.min(rawDt, 0.1)
    const t = clock.elapsedTime
    const af = audioFrame
    const v = visuals
    const a = anim.current
    const rm = v.rm
    const k = (tau: number) => 1 - Math.exp(-dt / tau)
    if (a.born < 0) {
      a.born = t
      a.lastBar = v.barWrapCount
      a.lastNova = v.novaCount
    }

    // ---- context: speed glide, bank, gameplay phase poses ----
    const spd = Math.hypot(sc.vel.x, sc.vel.y, sc.vel.z)
    a.glide += (smoothstep(2.5, 10, spd) - a.glide) * k(0.35)
    const s = Math.sin(sc.yaw)
    const c = Math.cos(sc.yaw)
    const vxLocal = c * sc.vel.x - s * sc.vel.z
    a.bank += (clampAbs(-vxLocal * 0.035, 0.28) - a.bank) * k(0.2)

    // ---- trick signals (computed by the snap controller) ----
    const tk = sc.tricks
    const flourishEnv =
      tk.flourish >= 0 ? Math.sin(Math.PI * Math.min(1, tk.flourishT / tk.flourishDur)) : 0
    const stretchSideSel = tk.flourishCount % 2 === 0 ? 1 : -1
    const stretchEnv = tk.flourish === 0 ? flourishEnv : 0
    const ruffleEnv = tk.flourish === 1 ? flourishEnv : 0
    const bloomEnv = tk.flourish === 2 ? flourishEnv : 0

    const soar = tk.soar
    let foldT = 0
    // modest sweep: an eagle cruises wide-spanned, not delta-tucked — the
    // soar takes most of the glide's old sweep back out; a SPRINT earns the
    // falcon tuck
    let sweepT =
      0.1 + 0.5 * a.glide - 0.42 * soar * a.glide + 0.12 * soar + 0.3 * tk.sprint
    const phase = sc.phase
    if (phase === 'streak') {
      foldT = 1
      sweepT = 0.8
    } else if (phase === 'pull') {
      foldT = 0.8
      sweepT = 1.0
    } else if (phase === 'shift' && sc.phaseT < SHIFT_SWAP_T) {
      // cocoon: over-fold and wrap the wings forward around the body
      foldT = 1.2
      sweepT = -0.75
    } else if (phase === 'downed') {
      // the crumple: wings sag and fold as the swarm drags the seraph down
      foldT = 1.3
      sweepT = -0.1
    }
    if (phase !== a.prevPhase) {
      if (phase === 'recover') a.spread = Math.max(a.spread, 0.9)
      if (phase === 'downed') a.spread = 1 // one final defiant flare
      a.prevPhase = phase
    }
    // burst open exactly at the realm-swap whiteout peak
    if (phase === 'shift' && a.prevPhaseT < SHIFT_SWAP_T && sc.phaseT >= SHIFT_SWAP_T) {
      a.spread = 1
    }
    a.prevPhaseT = sc.phaseT

    a.fold += (foldT - a.fold) * k(foldT > a.fold ? 0.055 : 0.16)
    a.sweep += (sweepT - a.sweep) * k(0.25)
    const raiseT = 1.05 * v.dropCharge
    a.raise += (raiseT - a.raise) * k(raiseT > a.raise ? 0.4 : 0.25)

    // ---- musical impulses ----
    const barWrapped = v.barWrapCount !== a.lastBar
    if (barWrapped) {
      a.lastBar = v.barWrapCount
      // power flap on the downbeat — unless tucked, charging, or deep glide
      if (a.fold < 0.35 && a.raise < 0.5 && a.glide < 0.85) {
        a.power = Math.min(1.3, 0.7 + 0.6 * v.barPulse)
      }
    }
    a.power *= Math.exp(-2.8 * dt)
    if (v.novaCount !== a.lastNova) {
      a.lastNova = v.novaCount
      a.spread = 1
    }
    // a Banish Nova flares the wings the same way (counter diff, not novaCount
    // — the musical nova channel stays reserved for drops/shifts)
    if (runState.combat.novasFired !== a.lastBanish) {
      a.lastBanish = runState.combat.novasFired
      a.spread = 1
    }
    a.spread *= Math.exp(-2.4 * dt)
    // movement tricks feed the same channels: swoop -> flare, burst -> flap
    a.spread = Math.max(a.spread, 0.85 * tk.swoopPulse)
    a.power = Math.max(a.power, 1.1 * tk.snapBoost)
    // cast tension: the windup/draw freezes the stroke mid-breath and cocks
    // the shoulders back like a drawn bow; the loose snaps them forward via
    // snapBoost. At full draw the held tension quivers at ~8 Hz.
    const castT = Math.max(tk.castWindup, 0.5 * tk.castWindup + tk.castCharge)
    const castQuiver = tk.castCharge >= 0.98 && !rm ? 0.02 * Math.sin(t * 50) : 0
    a.spread = Math.max(a.spread, 0.5 * tk.castRelease)

    // ---- flap oscillator with bar entrainment ----
    const eI = v.eI
    const ampT =
      (0.48 + 0.32 * eI) *
      (1 - 0.78 * a.glide) *
      (1 - Math.min(1, a.fold)) *
      (1 - 0.7 * v.dropCharge) *
      (1 - 0.55 * Math.min(1, castT))
    a.amp += (ampT - a.amp) * k(0.4)

    // ---- eagle flap-glide bouts: at cruise the wings hold a near-still
    //      glide, broken by short runs of deep slow beats. Bouts prefer to
    //      launch on the downbeat while the grid is trustworthy; sprinting
    //      shortens the glides (a raptor powering forward). ----
    const soarK = smoothstep(0.55, 0.9, soar)
    let boutActive = false
    if (soarK > 0.01) {
      if (a.boutLeft > 0) {
        a.boutLeft -= dt
        boutActive = true
        if (a.boutLeft <= 0) {
          a.nextBoutIn =
            (2.6 + 1.7 * (0.5 + 0.5 * Math.sin(a.boutCount * 1.93 + 1.2))) *
            (1 - 0.4 * tk.sprint)
        }
      } else {
        a.nextBoutIn -= dt
        const due = a.nextBoutIn <= 0
        // wait up to a bar for the downbeat, then go regardless
        if (due && (v.barSync < 0.5 || barWrapped || a.nextBoutIn < -1.6)) {
          a.boutCount++
          a.boutLeft = 1.8 + 1.1 * (0.5 + 0.5 * Math.sin(a.boutCount * 2.71))
          boutActive = true
        }
      }
    } else {
      a.boutLeft = 0
      if (a.nextBoutIn > 1.2) a.nextBoutIn = 1.2
    }
    a.boutAmp += ((boutActive ? 0.95 : 0.035) - a.boutAmp) * k(0.18)

    // ruffle: rapid shallow shake-out flapping
    const ampBase = a.amp * (1 + 0.85 * a.power) * (rm ? 0.55 : 1) * (1 - 0.55 * ruffleEnv)
    const ampEff = ampBase * (1 - soarK) + a.boutAmp * soarK * (rm ? 0.55 : 1)
    let rate =
      (0.5 + 0.3 * eI + 0.45 * a.glide - 0.25 * v.dropCharge) * (1 + 2.2 * ruffleEnv)
    // bouts beat slow and deep, like the real bird
    rate = rate * (1 - soarK) + (0.55 + 0.15 * eI + 0.2 * tk.sprint) * soarK
    if (rm) rate *= 0.8
    a.phaseF += rate * dt
    if (v.barSync > 0.05 && af.bpm > 1) {
      // downstroke bottom (phase 0.42) lands on the downbeat; whole flaps/bar
      const barDur = (60 / af.bpm) * 4
      const n = Math.max(1, Math.min(4, Math.round(barDur * rate)))
      const locked = af.barPhase * n + 0.42
      a.phaseF += fracArc(locked - a.phaseF) * Math.min(1, 2.2 * dt * v.barSync)
    }
    const flapPhase = a.phaseF

    const downedFade = v.downedFade
    flapPose(pose, {
      phase: flapPhase,
      // the raised seraph V flattens into a horizontal glide plane at speed —
      // and sags below the shoulder line as the downed fade takes hold
      amp: ampEff * (1 - 0.9 * downedFade),
      raise:
        BASE_RAISE + a.raise - 0.72 * soar - 1.15 * downedFade +
        (0.25 + 0.1 * tk.castCharge) * Math.min(1, castT) + castQuiver,
      sweep: a.sweep + 0.3 * tk.castCharge,
      fold: a.fold,
      spread: a.spread,
    })
    if (soar > 0.001) {
      // eagle glide: arc flattens, wingtips curl up, blades bite the wind
      pose.elbowBend -= 0.06 * soar
      pose.handBend -= 0.16 * soar
      pose.featherPitch += 0.1 * soar
    }

    // ---- shader state ----
    const u = featherMat.uniforms
    u.uTime.value = t
    const strokeVel = ((flapWave(flapPhase + 0.02) - flapWave(flapPhase)) / 0.02) * rate
    const bendT = clampAbs(-strokeVel * ampEff * 0.035, 0.09) - 0.04 * a.spread
    a.bend += (bendT - a.bend) * k(0.06)
    u.uBend.value = a.bend
    u.uTremble.value =
      ((0.9 * v.dropInhale + 0.15 * v.w3) * 0.012 + 0.03 * ruffleEnv) * (rm ? 0.3 : 1)
    const vi = v.vi
    u.uGlow.value =
      (0.9 + 0.5 * af.bass * v.bassReact + 0.55 * v.beatPulse + 0.35 * v.barPulse + 1.1 * v.auraGlow) *
      T(0.8, 1.0, 1.2, 1.45) *
      (0.55 + 0.45 * vi) *
      (1 - 0.8 * downedFade)
    u.uSparkle.value =
      (0.35 + 1.5 * af.highs * v.highsReact + 0.6 * af.highOnsetStrength) *
      (0.5 + 0.5 * vi) *
      (1 + 1.2 * a.power + 1.5 * a.spread + 1.2 * tk.carve + 0.7 * soar)
    u.uFlash.value = Math.min(
      3,
      2.6 * (0.5 * v.impactPulse + 0.9 * v.shiftFlash) +
        1.2 * Math.max(0, a.spread - 0.5) +
        0.35 * tk.swoopPulse,
    )
    u.uIrid.value = 0.24 + 0.22 * v.tripLevel + 0.12 * v.w3 + 0.1 * v.dropCharge
    u.uHue.value = v.hue * 0.6 + t * 0.06
    glintWorld
      .set(Math.sin(t * 0.33), 0.4 + 0.25 * Math.sin(t * 0.21), Math.cos(t * 0.27))
      .normalize()
      .transformDirection(camera.matrixWorldInverse)
    ;(u.uGlintDir.value as Vector3).copy(glintWorld)

    // ---- per-feather ripple / shimmer amplitudes ----
    // wind flutter: airspeed vibrates the blades through a soar
    const rippleAmp =
      (0.045 + 0.11 * af.highs * v.highsReact + 0.05 * a.power + 0.035 * soar * Math.min(1, spd / 14)) *
      (1 + 4 * ruffleEnv) *
      (rm ? 0.5 : 1)
    const rippleFreq = (6 + 4 * eI) * (1 + 1.5 * ruffleEnv) + 3.5 * soar
    const shimmer = 0.03 * v.beatPulse

    const flapW = flapWave(flapPhase)

    // ---- compose both wings ----
    for (let side = 0; side < 2; side++) {
      const sx = side === 0 ? 1 : -1
      // carve: on a hard turn the outer wing extends, the inner wing folds
      const outerK = sx * tk.carveDir
      const carveLift = tk.carve * outerK * 0.18
      const carveFold = tk.carve * Math.max(0, -outerK) * 0.32
      // wing-stretch flourish: one wing extends fully, its flap stilled
      const stretch = stretchEnv * (sx === stretchSideSel ? 1 : 0)
      const liftSide =
        pose.shoulderLift - sx * a.bank * 0.5 + carveLift + stretch * (0.5 - ampEff * 0.5 * flapW)
      const elbowBendSide = pose.elbowBend * (1 - stretch)
      const handBendSide = pose.handBend * (1 - 0.8 * stretch)
      const splayMulSide = pose.splayMul + 0.5 * stretch
      const foldSide = carveFold

      dummy.position.set(sx * ROOT_X, ROOT_Y, ROOT_Z)
      dummy.rotation.set(0, 0, -sx * (Math.PI / 2), 'XYZ')
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      mSh.copy(dummy.matrix)
      dummy.position.set(0, 0, 0)
      dummy.rotation.set(pose.shoulderSweep, sx * pose.shoulderTwist, sx * liftSide, 'ZXY')
      dummy.updateMatrix()
      mSh.multiply(dummy.matrix)

      // in-plane arc bends about Z (side-flipped); tuck folds about X
      dummy.position.set(0, BONE_LENGTHS[0], 0)
      dummy.rotation.set(pose.elbowFold + foldSide, 0, -sx * elbowBendSide, 'ZXY')
      dummy.updateMatrix()
      mEl.copy(mSh).multiply(dummy.matrix)

      dummy.position.set(0, BONE_LENGTHS[1], 0)
      dummy.rotation.set(pose.handFold + foldSide * 1.2, 0, -sx * handBendSide, 'ZXY')
      dummy.updateMatrix()
      mHa.copy(mEl).multiply(dummy.matrix)

      // struts hug the bones
      for (let b = 0; b < 3; b++) {
        const mB = b === 0 ? mSh : b === 1 ? mEl : mHa
        const grow = smoothstep(0, 1, (t - a.born - 0.06 * b) / 0.4)
        dummy.position.set(0, 0, 0)
        dummy.rotation.set(0, 0, 0, 'XYZ')
        dummy.scale.set(
          STRUT_WIDTHS[b] * grow,
          BONE_LENGTHS[b] * Math.max(1e-4, grow),
          STRUT_WIDTHS[b] * grow,
        )
        dummy.updateMatrix()
        mF.copy(mB).multiply(dummy.matrix)
        sm.setMatrixAt(side * 3 + b, mF)
      }

      for (let i = 0; i < FEATHERS; i++) {
        const f = LAYOUT[i]
        const mB = f.bone === 0 ? mSh : f.bone === 1 ? mEl : mHa
        // flutter lives out-of-plane (X); the fan itself stays in-plane (Z)
        const flutter =
          rippleAmp * Math.sin(t * rippleFreq - f.ripple * 2.2 + side * 0.7) +
          shimmer * Math.sin(f.ripple * 2.7 + t * 2) +
          0.1 +
          0.3 * Math.min(1, a.fold)
        // soaring primaries spread like eagle fingertips (wider fan gaps)
        const fanMul = splayMulSide + (f.layer === 0 ? 0.3 * soar : 0)
        const rotZ = -sx * f.splay * fanMul
        const unfold = smoothstep(0, 1, (t - a.born - 0.1 - f.ripple * 0.2) / 0.55)
        dummy.position.set(0, f.t * BONE_LENGTHS[f.bone], f.zOff)
        dummy.rotation.set(flutter, sx * (f.pitch + pose.featherPitch), rotZ, 'ZXY')
        const sw = f.wid * unfold
        dummy.scale.set(
          Math.max(1e-4, sw),
          Math.max(1e-4, f.len * unfold * (1 + 0.06 * a.spread)),
          Math.max(1e-4, sw),
        )
        dummy.updateMatrix()
        mF.copy(mB).multiply(dummy.matrix)
        fm.setMatrixAt(side * FEATHERS + i, mF)
      }
    }
    fm.instanceMatrix.needsUpdate = true
    sm.instanceMatrix.needsUpdate = true

    // ---- spark spiral halo ----
    const posAttr = sparkGeo.attributes.position as BufferAttribute
    const colAttr = sparkGeo.attributes.color as BufferAttribute
    const spin = t * (0.55 + 0.35 * eI + 1.4 * bloomEnv) * (rm ? 0.6 : 1)
    const tighten = 1 - 0.45 * v.dropCharge
    const burst = (1 + 1.6 * a.spread) * (1 + 1.3 * bloomEnv)
    const highsK = Math.min(1, af.highs * v.highsReact)
    const sparkGain = (0.45 + 0.55 * vi) * (0.7 + 0.6 * eI) * (1 + 1.2 * bloomEnv)
    for (let i = 0; i < SPARKS; i++) {
      const uSp = i / SPARKS
      const arm = (i & 1) * Math.PI
      const ang = uSp * 6.8 + spin + arm
      const r = (0.07 + 0.4 * uSp) * tighten * burst
      posAttr.setXYZ(
        i,
        Math.cos(ang) * r,
        1.0 + 0.55 * uSp + 0.05 * Math.sin(t * 2.1 + i * 1.7),
        Math.sin(ang) * r * 0.8,
      )
      let tw = 0.5 + 0.5 * Math.sin(t * (5 + 2 * (i % 5)) + i * 2.31)
      tw *= tw
      const bright =
        (0.3 + 2.1 * tw * (0.4 + 0.6 * highsK)) * sparkGain * (1 + 2.5 * a.spread)
      colAttr.setXYZ(i, sparkHdr.r * bright, sparkHdr.g * bright, sparkHdr.b * bright)
    }
    posAttr.needsUpdate = true
    colAttr.needsUpdate = true
  })

  return (
    <>
      <instancedMesh
        ref={el => {
          feathers.current = el
          if (el) el.instanceMatrix.setUsage(DynamicDrawUsage)
        }}
        args={[featherGeo, featherMat, INSTANCES]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={el => {
          struts.current = el
          if (el) el.instanceMatrix.setUsage(DynamicDrawUsage)
        }}
        args={[strutGeo, strutMat, STRUTS]}
        frustumCulled={false}
      />
      <points ref={sparks} geometry={sparkGeo} material={sparkMat} frustumCulled={false} />
    </>
  )
}
