import { useFrame, useLoader } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  LatheGeometry,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  ShaderMaterial,
  TextureLoader,
  TorusGeometry,
  Vector2,
  Vector3,
  type InstancedMesh,
  type Mesh,
  type Sprite,
  type SpriteMaterial,
} from 'three'
import { ENEMY, WARDEN_ARCHETYPES, WK } from '../game/enemyArchetypes'
import { enemyState, WP } from '../game/enemyState'
import { worldState } from '../game/worldState'
import {
  sfxWardenDeath,
  sfxWardenDetonate,
  sfxWardenExposed,
  sfxWardenStagger,
  sfxWardenTell,
} from '../audio/sfx'
import { soupToGeometry } from './AvatarWings'
import {
  buildEyeGem,
  buildHuskShell,
  buildLimbSpike,
  buildVeilShred,
  freshHorrorPose,
  WARDEN_EYE_CAP,
  WARDEN_HUSK_CAP,
  WARDEN_LIMB_CAP,
  WARDEN_SHRED_CAP,
  WARDEN_VISUALS,
  wardenPose,
  windupCurve,
  type WardenPoseIn,
} from './horrorGeom'
import {
  bodyUniformsOf,
  eyeUniformsOf,
  horrorBodyFrag,
  horrorBodyVert,
  horrorEyeFrag,
  horrorEyeVert,
  makeHorrorBodyUniforms,
  makeHorrorEyeUniforms,
} from './horrorShader'
import { gemProfile } from './wingGeom'
import { BURST } from './burstVocab'
import { snapController } from './snapController'
import { triggerCombatImpact, visuals } from './visualTuning'
import type { Palette } from '../theme/palettes'

const hiddenMatrix = new Matrix4().makeScale(1e-4, 1e-4, 1e-4)
const dummy = new Object3D()
const mRoot = new Matrix4()
const mSeg: Matrix4[] = Array.from({ length: WARDEN_HUSK_CAP }, () => new Matrix4())
const mPart = new Matrix4()
const pose = freshHorrorPose()
const poseIn: WardenPoseIn = {
  state: 2,
  stateT: 0,
  stateU: 0,
  t: 0,
  speed: 0,
  barPulse: 0,
  seed: 0.5,
  telegraphT: 0,
  weakOpen: 0,
  hpFrac: 1,
}
const LASH_PTS = 24
const tP = new Vector3()
const tT = new Vector3()
const tS = new Vector3()
const tC = new Vector3()

/** The lash ribbon: additive camera-facing strip with a hot spine and soft
 * edges — the Line it replaces was locked to 1px on every ANGLE backend. */
const lashVert = /* glsl */ `
  attribute float aEdge;
  varying float vEdge;
  varying vec3 vCol;
  void main() {
    vEdge = aEdge;
    vCol = color;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const lashFrag = /* glsl */ `
  varying float vEdge;
  varying vec3 vCol;
  void main() {
    float core = 1.0 - abs(vEdge);
    gl_FragColor = vec4(vCol * (0.22 + 1.35 * core * core), 1.0);
  }
`

function makeParts(soup: ReturnType<typeof buildHuskShell>, count: number): BufferGeometry {
  const geo = soupToGeometry(soup, true)
  const data = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    data[i * 4] = 0
    data[i * 4 + 1] = i
    data[i * 4 + 2] = (i * 0.618) % 1
    data[i * 4 + 3] = 0
  }
  geo.setAttribute('aData', new InstancedBufferAttribute(data, 4))
  const state = new InstancedBufferAttribute(new Float32Array(count * 4), 4)
  state.setUsage(DynamicDrawUsage)
  geo.setAttribute('aState', state)
  return geo
}

/**
 * The gate warden: one realm-keyed boss rig built from the same four unit
 * parts as the swarm at ~5.6x scale, plus a crown ring, the stolen relic-heart
 * weak point (a gem lathe rhyming with the player's chest stone), its halo,
 * the lash ribbon, and the slam telegraph cage. Every telegraph is gameplay
 * information: windup ignites shrouds/eyes and pre-glows the lash path, SLAM
 * shows its true damage ring with a closing countdown cage, EXPOSED hinges
 * the carapace open around the burning core, the kill rite flings the plates
 * and walks the crown to the gate — the relic visibly unlocks the door.
 */
export function WardenRig({ palette }: { palette: Palette }) {
  const huskRef = useRef<InstancedMesh>(null)
  const limbRef = useRef<InstancedMesh>(null)
  const shredRef = useRef<InstancedMesh>(null)
  const eyeRef = useRef<InstancedMesh>(null)
  const crownRef = useRef<Mesh>(null)
  const coreRef = useRef<Mesh>(null)
  const haloRef = useRef<Sprite>(null)
  const haloMat = useRef<SpriteMaterial>(null)
  const lashRef = useRef<Mesh>(null)
  const ringsRef = useRef<InstancedMesh>(null)
  const softTex = useLoader(TextureLoader, '/assets/particle_soft.png')

  const husk = useMemo(() => makeParts(buildHuskShell(), WARDEN_HUSK_CAP), [])
  const limb = useMemo(() => makeParts(buildLimbSpike(), WARDEN_LIMB_CAP), [])
  const shred = useMemo(() => makeParts(buildVeilShred(), WARDEN_SHRED_CAP), [])
  const eye = useMemo(() => makeParts(buildEyeGem(), WARDEN_EYE_CAP), [])
  const crownGeo = useMemo(() => new TorusGeometry(1, 0.05, 8, 64), [])
  const ringGeo = useMemo(() => new TorusGeometry(1, 0.045, 6, 48), [])
  const coreGeo = useMemo(() => {
    const pts = gemProfile().map(([r, y]) => new Vector2(r * 0.5, y * 0.5))
    const geo = new LatheGeometry(pts, 8).toNonIndexed()
    geo.computeVertexNormals()
    return geo
  }, [])

  const bodyMat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: horrorBodyVert,
        fragmentShader: horrorBodyFrag,
        vertexColors: true,
        uniforms: makeHorrorBodyUniforms() as never,
      }),
    [],
  )
  const eyeMat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: horrorEyeVert,
        fragmentShader: horrorEyeFrag,
        uniforms: makeHorrorEyeUniforms() as never,
      }),
    [],
  )
  const crownMat = useMemo(
    () => new MeshBasicMaterial({ color: new Color('#ffffff'), toneMapped: false }),
    [],
  )
  const coreMat = useMemo(
    () => new MeshBasicMaterial({ color: new Color('#ffffff'), toneMapped: false }),
    [],
  )
  const ringMat = useMemo(
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

  const lash = useMemo(() => {
    const verts = LASH_PTS * 2
    const edge = new Float32Array(verts)
    for (let i = 0; i < LASH_PTS; i++) {
      edge[i * 2] = -1
      edge[i * 2 + 1] = 1
    }
    const idx: number[] = []
    for (let i = 0; i < LASH_PTS - 1; i++) {
      const a = i * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    const geo = new BufferGeometry()
    const posAttr = new Float32BufferAttribute(new Float32Array(verts * 3), 3)
    posAttr.setUsage(DynamicDrawUsage)
    const colAttr = new Float32BufferAttribute(new Float32Array(verts * 3), 3)
    colAttr.setUsage(DynamicDrawUsage)
    geo.setIndex(idx)
    geo.setAttribute('position', posAttr)
    geo.setAttribute('color', colAttr)
    geo.setAttribute('aEdge', new Float32BufferAttribute(edge, 1))
    // NB: Float32BufferAttribute COPIES its input — write through the
    // attribute's own storage or fills silently never reach the GPU
    const positions = posAttr.array as Float32Array
    const colors = colAttr.array as Float32Array
    const mat = new ShaderMaterial({
      vertexShader: lashVert,
      fragmentShader: lashFrag,
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    })
    return { geo, mat, positions, colors, posAttr, colAttr }
  }, [])

  useEffect(() => {
    return () => {
      husk.dispose()
      limb.dispose()
      shred.dispose()
      eye.dispose()
      crownGeo.dispose()
      ringGeo.dispose()
      coreGeo.dispose()
      bodyMat.dispose()
      eyeMat.dispose()
      crownMat.dispose()
      coreMat.dispose()
      ringMat.dispose()
      lash.geo.dispose()
      lash.mat.dispose()
    }
  }, [husk, limb, shred, eye, crownGeo, ringGeo, coreGeo, bodyMat, eyeMat, crownMat, coreMat, ringMat, lash])

  const accentHdr = useMemo(() => new Color(), [])
  const coreHdr = useMemo(() => new Color(), [])
  const tmp = useMemo(() => new Color(), [])
  useEffect(() => {
    const bu = bodyUniformsOf(bodyMat)
    bu.uBody.value.set(palette.horrorBody)
    bu.uVein.value.set(palette.wardenAccent).multiplyScalar(1.3)
    bu.uRim.value.set(palette.fog).lerp(new Color(palette.primary), 0.35).multiplyScalar(1.0)
    accentHdr.set(palette.wardenAccent).lerp(new Color('#ffffff'), 0.3).multiplyScalar(2.2)
    coreHdr.set(palette.wardenCore).multiplyScalar(3.4)
  }, [palette, bodyMat, accentHdr, coreHdr])

  const track = useRef({
    serial: -1,
    prevPhase: WP.DORMANT as number,
    matAmt: 0,
    // the crown walks from the dying body to the gate over the death rite
    crownLerp: 0,
    // slam attack visual state
    slamShockFired: false,
    shockT: 999,
    shockX: 0,
    shockY: 0,
    shockZ: 0,
    shockR: 10,
  })

  /** Fill the lash ribbon along an A->B arc (sim-owned during the strike, a
   * locally computed aim line during the windup pre-glow — the renderer never
   * writes sim state). k drives the traveling brightness wave; widthMul /
   * brightMul separate the pre-glow from the live strike. Camera-facing via
   * per-point cross(tangent, toCamera). */
  function fillLash(
    ax: number,
    ay: number,
    az: number,
    bEndX: number,
    bEndY: number,
    bEndZ: number,
    camX: number,
    camY: number,
    camZ: number,
    k: number,
    widthMul: number,
    brightMul: number,
  ): void {
    const bx = bEndX - ax
    const by = bEndY - ay
    const bz = bEndZ - az
    for (let i = 0; i < LASH_PTS; i++) {
      const u = i / (LASH_PTS - 1)
      tP.set(ax + bx * u, ay + by * u + Math.sin(u * Math.PI) * 1.5, az + bz * u)
      // analytic tangent of the sagging arc
      tT.set(bx, by + Math.cos(u * Math.PI) * Math.PI * 1.5, bz).normalize()
      tC.set(camX - tP.x, camY - tP.y, camZ - tP.z)
      tS.crossVectors(tT, tC)
      const sl = tS.lengthSq()
      if (sl < 1e-8) tS.set(0, 1, 0)
      else tS.multiplyScalar(1 / Math.sqrt(sl))
      const wave = Math.max(0, 1 - Math.abs(u - k) * 3)
      const width = (0.55 - 0.38 * u) * widthMul * (1 + 1.8 * wave)
      const b = (0.4 + 2.6 * wave * wave) * (1 - 0.3 * u) * brightMul
      const o = i * 6
      lash.positions[o] = tP.x - tS.x * width
      lash.positions[o + 1] = tP.y - tS.y * width
      lash.positions[o + 2] = tP.z - tS.z * width
      lash.positions[o + 3] = tP.x + tS.x * width
      lash.positions[o + 4] = tP.y + tS.y * width
      lash.positions[o + 5] = tP.z + tS.z * width
      const r = accentHdr.r * b
      const g = accentHdr.g * b
      const bl = accentHdr.b * b
      lash.colors[o] = r
      lash.colors[o + 1] = g
      lash.colors[o + 2] = bl
      lash.colors[o + 3] = r
      lash.colors[o + 4] = g
      lash.colors[o + 5] = bl
    }
    lash.posAttr.needsUpdate = true
    lash.colAttr.needsUpdate = true
  }

  useFrame(({ clock, camera }, rawDt) => {
    const hm = huskRef.current
    const lm = limbRef.current
    const sm = shredRef.current
    const em = eyeRef.current
    const crown = crownRef.current
    const core = coreRef.current
    const halo = haloRef.current
    const lm2 = lashRef.current
    const rings = ringsRef.current
    if (!hm || !lm || !sm || !em || !crown || !core || !halo || !lm2 || !rings) return
    const dt = Math.min(rawDt, 0.1)
    const t = clock.elapsedTime
    const w = enemyState.warden
    const tr = track.current
    const live = w.active && w.phase !== WP.DORMANT
    const table = WARDEN_ARCHETYPES[w.archetype]

    if (w.serial !== tr.serial) {
      tr.serial = w.serial
      tr.matAmt = 0
      tr.crownLerp = 0
      tr.shockT = 999
    }

    // ---- phase-transition FX (counter/phase diffs, never callbacks) ----
    if (w.phase !== tr.prevPhase) {
      if (w.phase === WP.EMERGE) {
        // ground breach at the gate's feet
        triggerCombatImpact(0.5, w.x, w.homeY - table.hover, w.z)
        snapController.pendingBursts.push({ x: w.x, y: w.homeY - table.hover + 0.5, z: w.z, count: 100, style: BURST.WARDEN })
      } else if (w.phase === WP.WINDUP) {
        sfxWardenTell()
        tr.slamShockFired = false
      } else if (w.phase === WP.ATTACK) {
        const atk = table.attacks[w.attackIdx % table.attacks.length]
        if (atk.kind === WK.SUMMON) {
          // the void tears — summoned husks burn in around the body
          triggerCombatImpact(0.35, w.x, w.y, w.z)
          snapController.pendingBursts.push({ x: w.x, y: w.y, z: w.z, count: 90, style: BURST.WARDEN })
        }
      } else if (w.phase === WP.EXPOSED) {
        // the carapace hinges open with a shudder — the opportunity RINGS
        sfxWardenExposed()
        triggerCombatImpact(0.3, w.x, w.y, w.z)
        snapController.pendingBursts.push({ x: w.weakX, y: w.weakY, z: w.weakZ, count: 50, style: BURST.WARDEN })
      } else if (w.phase === WP.STAGGER) sfxWardenStagger()
      else if (w.phase === WP.DYING) {
        // the biggest kill in the game finally has a voice
        sfxWardenDeath()
        triggerCombatImpact(0.7, w.x, w.y, w.z)
        snapController.pendingBursts.push({ x: w.x, y: w.y, z: w.z, count: 120, style: BURST.WARDEN })
      } else if (w.phase === WP.DEAD && tr.prevPhase === WP.DYING) {
        // the final detonation: the relic detonates free of the corpse
        sfxWardenDetonate()
        triggerCombatImpact(1.2, w.x, w.y, w.z)
        snapController.pendingBursts.push({ x: w.x, y: w.y, z: w.z, count: 220, style: BURST.WARDEN })
      }
      tr.prevPhase = w.phase
    }

    const showRig = live && w.phase !== WP.DEAD
    hm.visible = showRig
    lm.visible = showRig
    sm.visible = showRig
    em.visible = showRig
    crown.visible = live && (showRig || tr.crownLerp < 1.2)
    core.visible = showRig && (w.weakOpen || w.phase === WP.DYING)
    halo.visible = core.visible
    lm2.visible = false
    rings.visible = false
    if (!live) return

    const visual = WARDEN_VISUALS[w.archetype % WARDEN_VISUALS.length]
    const dyingU = w.phase === WP.DYING ? Math.min(1, w.phaseT / ENEMY.WARDEN_DEATH_DUR) : 0
    const matTarget = w.phase === WP.DYING ? 0 : 1
    const matRate = w.phase === WP.DYING ? dt / 1.6 : dt / (ENEMY.WARDEN_EMERGE_DUR * 0.7)
    tr.matAmt += Math.sign(matTarget - tr.matAmt) * Math.min(matRate, Math.abs(matTarget - tr.matAmt))
    const hpFrac = Math.max(0, w.hp / Math.max(1, w.maxHp))
    const rage = Math.max(0, (0.35 - hpFrac) / 0.35)

    if (showRig) {
      // ---- pose ----
      poseIn.state = w.phase === WP.DYING ? 7 : w.phase === WP.STAGGER ? 6 : 2
      poseIn.stateT = w.phaseT
      poseIn.stateU = dyingU
      poseIn.t = t
      poseIn.speed = 0
      poseIn.barPulse = visuals.barPulse
      poseIn.telegraphT = w.telegraphT
      poseIn.weakOpen = w.weakOpen ? 1 : 0
      poseIn.hpFrac = hpFrac
      wardenPose(pose, poseIn, visual)

      // face the player
      const sc = snapController
      const yaw = Math.atan2(-(sc.pos.x - w.x), -(sc.pos.z - w.z)) + Math.PI
      dummy.position.set(w.x, w.y + pose.bobY * visual.scale, w.z)
      dummy.rotation.set(pose.pitch, yaw + pose.yawJitter, pose.roll, 'YXZ')
      dummy.scale.setScalar(visual.scale)
      dummy.updateMatrix()
      mRoot.copy(dummy.matrix)

      const huskState = husk.getAttribute('aState') as InstancedBufferAttribute
      const limbState = limb.getAttribute('aState') as InstancedBufferAttribute
      const shredState = shred.getAttribute('aState') as InstancedBufferAttribute
      const eyeState = eye.getAttribute('aState') as InstancedBufferAttribute

      let huskIdx = -1
      let limbIdx = -1
      let shredIdx = -1
      let eyeIdx = -1
      let huskOrdinal = -1
      for (const part of visual.parts) {
        if (part.part === 0) huskOrdinal++
        const parentM = part.parent < 0 ? mRoot : mSeg[part.parent]
        let parentLen = 1
        if (part.parent >= 0) {
          let seen = -1
          for (const q of visual.parts) {
            if (q.part === 0) {
              seen++
              if (seen === part.parent) {
                parentLen = q.len
                break
              }
            }
          }
        }
        const m = part.mirror === 0 ? 1 : part.mirror
        let splay = part.splay * m
        let pitch = part.pitch
        if (part.part === 1) {
          splay *= pose.limbSplayMul
          pitch += 0.3 * pose.gaitLift * Math.sin(part.phaseOff * Math.PI * 2)
        } else if (part.part === 2) {
          pitch -= pose.shredFlare * 0.5
        } else if (part.part === 0 && part.parent >= 0) {
          // EXPOSED hinges the plate rings open, rank-staggered
          const hinge = pose.limbSplayMul - 1
          pitch += pose.segCurl * 0.3 + hinge * 0.5 * (0.6 + 0.4 * Math.sin(part.phaseOff * 6.28))
        }
        dummy.position.set(0, part.t * parentLen, part.zOff)
        dummy.rotation.set(pitch, part.yawO, splay, 'ZXY')
        dummy.scale.setScalar(1)
        dummy.updateMatrix()
        mPart.copy(parentM).multiply(dummy.matrix)
        if (part.part === 0) mSeg[Math.min(huskOrdinal, WARDEN_HUSK_CAP - 1)].copy(mPart)

        dummy.position.set(0, pose.fling * 1.4 * (0.3 + ((part.phaseOff * 7919) % 1)), 0)
        dummy.rotation.set(0, 0, 0)
        dummy.scale.set(
          Math.max(1e-4, part.wid),
          Math.max(1e-4, part.len),
          Math.max(1e-4, part.wid),
        )
        dummy.updateMatrix()
        mPart.multiply(dummy.matrix)

        if (part.part === 0) {
          huskIdx++
          hm.setMatrixAt(huskIdx, mPart)
          huskState.setXYZW(huskIdx, tr.matAmt, w.hitFlash, pose.eyeHeat * 0.8, pose.tremble)
        } else if (part.part === 1) {
          limbIdx++
          lm.setMatrixAt(limbIdx, mPart)
          limbState.setXYZW(limbIdx, tr.matAmt, w.hitFlash, pose.eyeHeat * 0.8, pose.tremble)
        } else if (part.part === 2) {
          shredIdx++
          sm.setMatrixAt(shredIdx, mPart)
          shredState.setXYZW(shredIdx, tr.matAmt, w.hitFlash, pose.eyeHeat, pose.tremble)
        } else {
          eyeIdx++
          em.setMatrixAt(eyeIdx, mPart)
          eyeState.setXYZW(eyeIdx, tr.matAmt, w.hitFlash, pose.eyeHeat, pose.tremble)
        }
      }
      for (let i = huskIdx + 1; i < WARDEN_HUSK_CAP; i++) hm.setMatrixAt(i, hiddenMatrix)
      for (let i = limbIdx + 1; i < WARDEN_LIMB_CAP; i++) lm.setMatrixAt(i, hiddenMatrix)
      for (let i = shredIdx + 1; i < WARDEN_SHRED_CAP; i++) sm.setMatrixAt(i, hiddenMatrix)
      for (let i = eyeIdx + 1; i < WARDEN_EYE_CAP; i++) em.setMatrixAt(i, hiddenMatrix)
      hm.instanceMatrix.needsUpdate = true
      lm.instanceMatrix.needsUpdate = true
      sm.instanceMatrix.needsUpdate = true
      em.instanceMatrix.needsUpdate = true
      huskState.needsUpdate = true
      limbState.needsUpdate = true
      shredState.needsUpdate = true
      eyeState.needsUpdate = true

      // eye color: accent ramping WHITE through the telegraph
      const tele = windupCurve(w.telegraphT)
      const eu = eyeUniformsOf(eyeMat)
      eu.uEye.value.copy(tmp.copy(accentHdr)).lerp(coreHdr, 0.3).multiplyScalar(1 + 1.2 * tele)
      if (tele > 0.01) {
        eu.uEye.value.lerp(tmp.set('#ffffff').multiplyScalar(3.6), tele * 0.7)
      }
      eu.uEyeGain.value = 1
      eu.uTime.value = t

      // weak-point core + halo, breathing with the song while it burns
      if (core.visible) {
        const openK = w.weakOpen ? 1 : Math.max(0, 1 - dyingU * 1.5)
        core.position.set(w.weakX, w.weakY, w.weakZ)
        core.rotation.y += dt * (1.5 + 3 * visuals.beatPulse)
        core.scale.setScalar(Math.max(0.05, (0.3 + 0.7 * openK) * (1 + 0.2 * visuals.beatPulse)))
        coreMat.color.copy(coreHdr).multiplyScalar(0.6 + 0.6 * openK + 0.5 * visuals.beatPulse)
        halo.position.set(w.weakX, w.weakY, w.weakZ)
        halo.scale.setScalar((2.2 * openK + 0.5) * (1 + 0.18 * visuals.beatPulse))
        if (haloMat.current) haloMat.current.opacity = 0.5 * openK * (0.8 + 0.4 * visuals.beatPulse)
      }
    }

    // ---- crown ring: orbits the body; the death rite walks it to the gate ----
    const gate = worldState.gate
    if (w.phase === WP.DYING || (w.phase === WP.DEAD && tr.crownLerp < 1.2)) {
      tr.crownLerp = Math.min(1.2, tr.crownLerp + dt / 1.4)
    }
    const ck = Math.min(1, tr.crownLerp)
    const cx = w.x + (gate.x - w.x) * ck
    const cy = w.y + (gate.y - w.y) * ck
    const cz = w.z + (gate.z - w.z) * ck
    crown.position.set(cx, cy, cz)
    crown.rotation.x = Math.PI / 2 + 0.25 * Math.sin(t * 0.6)
    crown.rotation.z = t * (0.4 + 1.5 * ck)
    crown.scale.setScalar(
      (table.bodyR * 1.25 * (1 - 0.5 * ck) + 1.2 * ck) * Math.max(0.05, tr.matAmt + ck * 0.6),
    )
    crownMat.color
      .copy(accentHdr)
      .multiplyScalar((0.7 + 0.5 * visuals.barPulse) * (1 + 1.5 * ck) * Math.max(0.15, tr.matAmt + ck))
    if (tr.crownLerp >= 1.2) crown.visible = false

    // ---- attack theater: lash ribbon + slam telegraph cage + shockwave ----
    const atk = table.attacks[w.attackIdx % table.attacks.length]
    const sc = snapController
    if (showRig && w.phase === WP.WINDUP) {
      if (atk.kind === WK.LASH) {
        // pre-glow along the CURRENT aim — the sim freezes this same line at
        // commit, so what glows is what strikes
        const dx = sc.pos.x - w.x
        const dy = sc.pos.y - w.y
        const dz = sc.pos.z - w.z
        const inv = 30 / (Math.hypot(dx, dy, dz) || 1)
        lm2.visible = true
        fillLash(
          w.x, w.y, w.z,
          w.x + dx * inv, w.y + dy * inv, w.z + dz * inv,
          camera.position.x, camera.position.y, camera.position.z,
          w.telegraphT, 0.4, 0.3 + 0.4 * w.telegraphT,
        )
      } else if (atk.kind === WK.SLAM) {
        // danger zone at its TRUE radius, tracking you until the commit —
        // the accelerating blink is the countdown
        rings.visible = true
        const pulse = 0.35 + 0.65 * Math.abs(Math.sin(t * (4 + 12 * w.telegraphT)))
        ringMat.color.copy(accentHdr).multiplyScalar(pulse * (0.5 + 0.8 * w.telegraphT))
        setRing(rings, 0, sc.pos.x, sc.pos.y, sc.pos.z, atk.param, 0)
        const cage = atk.param * (1 - 0.75 * w.telegraphT)
        setRing(rings, 1, sc.pos.x, sc.pos.y, sc.pos.z, cage, 1)
        setRing(rings, 2, sc.pos.x, sc.pos.y, sc.pos.z, cage, 2)
        rings.instanceMatrix.needsUpdate = true
      }
    } else if (showRig && w.phase === WP.ATTACK) {
      if (atk.kind === WK.LASH) {
        lm2.visible = true
        const k = Math.min(1, w.phaseT / Math.max(0.05, atk.active))
        fillLash(
          w.lashAx, w.lashAy, w.lashAz,
          w.lashBx, w.lashBy, w.lashBz,
          camera.position.x, camera.position.y, camera.position.z,
          k, 1, 1,
        )
      } else if (atk.kind === WK.SLAM) {
        const k = Math.min(1, w.phaseT / Math.max(0.05, atk.active))
        if (k < 1) {
          // locked on the frozen point; the cage slams shut
          rings.visible = true
          const pulse = 0.5 + 0.5 * Math.abs(Math.sin(t * 22))
          ringMat.color.copy(accentHdr).lerp(tmp.set('#ffffff'), k * 0.6).multiplyScalar(pulse * 1.4)
          setRing(rings, 0, w.slamX, w.slamY, w.slamZ, atk.param, 0)
          setRing(rings, 1, w.slamX, w.slamY, w.slamZ, atk.param * (1 - k) + 0.4, 1)
          setRing(rings, 2, w.slamX, w.slamY, w.slamZ, atk.param * (1 - k) + 0.4, 2)
          rings.instanceMatrix.needsUpdate = true
        } else if (!tr.slamShockFired) {
          tr.slamShockFired = true
          tr.shockT = 0
          tr.shockX = w.slamX
          tr.shockY = w.slamY
          tr.shockZ = w.slamZ
          tr.shockR = atk.param
          triggerCombatImpact(0.55, w.slamX, w.slamY, w.slamZ)
          snapController.pendingBursts.push({ x: w.slamX, y: w.slamY, z: w.slamZ, count: 70, style: BURST.WARDEN })
        }
      }
    }
    // expanding slam shockwave (outlives the ATTACK phase by design)
    if (tr.shockT < 0.45) {
      tr.shockT += dt
      const sk = Math.min(1, tr.shockT / 0.45)
      rings.visible = true
      const fade = (1 - sk) * (1 - sk)
      ringMat.color.copy(tmp.set('#ffffff')).lerp(accentHdr, sk).multiplyScalar(3 * fade + 0.05)
      const r = tr.shockR * (1 + 0.9 * sk)
      setRing(rings, 0, tr.shockX, tr.shockY, tr.shockZ, r, 0)
      setRing(rings, 1, tr.shockX, tr.shockY, tr.shockZ, r * 0.92, 1)
      setRing(rings, 2, tr.shockX, tr.shockY, tr.shockZ, r * 0.85, 2)
      rings.instanceMatrix.needsUpdate = true
    }

    const bu = bodyUniformsOf(bodyMat)
    bu.uTime.value = t
    // wounded past the last third, the veins never cool again
    bu.uVeinGain.value = 0.7 + 0.6 * visuals.beatPulse + 1.2 * windupCurve(w.telegraphT) + 0.8 * rage
    // the loom-breath of something too large to hide
    bu.uBreath.value = visuals.rm
      ? 0.01
      : 0.025 * (0.5 + 0.5 * Math.sin(t * 0.9)) + 0.02 * visuals.barPulse
  })

  return (
    <>
      <instancedMesh
        ref={el => {
          huskRef.current = el
          if (el) el.instanceMatrix.setUsage(DynamicDrawUsage)
        }}
        args={[husk, bodyMat, WARDEN_HUSK_CAP]}
        frustumCulled={false}
        visible={false}
      />
      <instancedMesh
        ref={el => {
          limbRef.current = el
          if (el) el.instanceMatrix.setUsage(DynamicDrawUsage)
        }}
        args={[limb, bodyMat, WARDEN_LIMB_CAP]}
        frustumCulled={false}
        visible={false}
      />
      <instancedMesh
        ref={el => {
          shredRef.current = el
          if (el) el.instanceMatrix.setUsage(DynamicDrawUsage)
        }}
        args={[shred, bodyMat, WARDEN_SHRED_CAP]}
        frustumCulled={false}
        visible={false}
      />
      <instancedMesh
        ref={el => {
          eyeRef.current = el
          if (el) el.instanceMatrix.setUsage(DynamicDrawUsage)
        }}
        args={[eye, eyeMat, WARDEN_EYE_CAP]}
        frustumCulled={false}
        visible={false}
      />
      <mesh ref={crownRef} geometry={crownGeo} material={crownMat} visible={false} frustumCulled={false} />
      <mesh ref={coreRef} geometry={coreGeo} material={coreMat} visible={false} frustumCulled={false} />
      <sprite ref={haloRef} visible={false} frustumCulled={false}>
        <spriteMaterial
          ref={haloMat}
          map={softTex}
          color={'#ffffff'}
          blending={AdditiveBlending}
          transparent
          opacity={0.4}
          depthWrite={false}
          toneMapped={false}
        />
      </sprite>
      <mesh ref={lashRef} geometry={lash.geo} material={lash.mat} visible={false} frustumCulled={false} />
      <instancedMesh
        ref={el => {
          ringsRef.current = el
          if (el) {
            el.instanceMatrix.setUsage(DynamicDrawUsage)
            for (let i = 0; i < 3; i++) el.setMatrixAt(i, hiddenMatrix)
          }
        }}
        args={[ringGeo, ringMat, 3]}
        frustumCulled={false}
        visible={false}
      />
    </>
  )
}

/** Stamp one telegraph/shock ring instance: 0 flat, 1/2 tilted cross. */
function setRing(
  mesh: InstancedMesh,
  slot: number,
  x: number,
  y: number,
  z: number,
  radius: number,
  orient: 0 | 1 | 2,
): void {
  dummy.position.set(x, y, z)
  if (orient === 0) dummy.rotation.set(Math.PI / 2, 0, 0)
  else if (orient === 1) dummy.rotation.set(Math.PI / 2 + 0.7, 0.5, 0)
  else dummy.rotation.set(Math.PI / 2 - 0.7, -0.5, 0)
  dummy.scale.setScalar(Math.max(0.01, radius))
  dummy.updateMatrix()
  mesh.setMatrixAt(slot, dummy.matrix)
}
