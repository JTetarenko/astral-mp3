import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  Matrix4,
  Object3D,
  ShaderMaterial,
  type BufferGeometry,
  type InstancedMesh,
} from 'three'
import { ENEMY, LATCH_ANCHORS, SWARM_ARCHETYPES } from '../game/enemyArchetypes'
import { enemyState, ES } from '../game/enemyState'
import { worldState } from '../game/worldState'
import { governor } from './perfGovernor'
import { avatarFrame } from './avatarFrame'
import { sfxSwarmLeap, sfxSwarmWindup } from '../audio/sfx'
import { stereoPanFor } from '../game/direction'
import { BURST } from './burstVocab'
import { snapController } from './snapController'
import { soupToGeometry } from './AvatarWings'
import {
  buildEyeGem,
  buildHuskShell,
  buildLimbSpike,
  buildVeilShred,
  EYE_PER,
  freshHorrorPose,
  HORROR_VISUALS,
  horrorPose,
  HUSK_PER,
  LIMB_PER,
  SHRED_PER,
  type HorrorPoseIn,
  type HorrorVisual,
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
import { forcing, triggerCombatImpact, visuals } from './visualTuning'
import type { Palette } from '../theme/palettes'

const CAP = ENEMY.SWARM_CAP
const HUSKS = CAP * HUSK_PER
const LIMBS = CAP * LIMB_PER
const SHREDS = CAP * SHRED_PER
const EYES = CAP * EYE_PER

const hiddenMatrix = new Matrix4().makeScale(1e-4, 1e-4, 1e-4)
const TAU = Math.PI * 2
const dummy = new Object3D()
const mRoot = new Matrix4()
const mSeg: Matrix4[] = Array.from({ length: HUSK_PER }, () => new Matrix4())
const mPart = new Matrix4()
const pose = freshHorrorPose()
const poseIn: HorrorPoseIn = {
  state: ES.CIRCLE,
  stateT: 0,
  stateU: 0,
  t: 0,
  speed: 0,
  barPulse: 0,
  seed: 0,
}

interface PartMeshSetup {
  geo: BufferGeometry
  count: number
}

function makeInstanced(soup: ReturnType<typeof buildHuskShell>, count: number, perEnemy: number): PartMeshSetup {
  const geo = soupToGeometry(soup, true)
  const data = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    const enemy = Math.floor(i / perEnemy)
    const rank = i % perEnemy
    data[i * 4] = enemy
    data[i * 4 + 1] = rank
    data[i * 4 + 2] = (enemy * 0.618 + rank * 0.234) % 1
    data[i * 4 + 3] = 0
  }
  geo.setAttribute('aData', new InstancedBufferAttribute(data, 4))
  const state = new InstancedBufferAttribute(new Float32Array(count * 4), 4)
  state.setUsage(DynamicDrawUsage)
  geo.setAttribute('aState', state)
  return { geo, count }
}

/** Demo-mode synthetic states cycled per ring slot (headless verification). */
const DEMO_STATES = [ES.CIRCLE, ES.STALK, ES.WINDUP, ES.LEAP, ES.STAGGER, ES.DYING, ES.CIRCLE, ES.WINDUP]

/**
 * The horror swarm renderer: ALL live enemies of the current realm drawn as
 * four InstancedMeshes (husk/limb/shred/eye — 4 draw calls total). Geometry
 * is allocated once; a realm swap only re-poses and recolors (epoch diff).
 * Latched horrors compose onto the avatar's LATCH_ANCHORS via avatarFrame —
 * mounted after PlayerAvatar so the attach reads the current frame. Spawn-in,
 * death, the Pilgrim's teleport flicker and the Worm's burrow all ride one
 * dithered dissolve channel.
 */
export function HorrorSwarm({ palette }: { palette: Palette }) {
  const huskRef = useRef<InstancedMesh>(null)
  const limbRef = useRef<InstancedMesh>(null)
  const shredRef = useRef<InstancedMesh>(null)
  const eyeRef = useRef<InstancedMesh>(null)

  const husk = useMemo(() => makeInstanced(buildHuskShell(), HUSKS, HUSK_PER), [])
  const limb = useMemo(() => makeInstanced(buildLimbSpike(), LIMBS, LIMB_PER), [])
  const shred = useMemo(() => makeInstanced(buildVeilShred(), SHREDS, SHRED_PER), [])
  const eye = useMemo(() => makeInstanced(buildEyeGem(), EYES, EYE_PER), [])

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

  useEffect(() => {
    return () => {
      husk.geo.dispose()
      limb.geo.dispose()
      shred.geo.dispose()
      eye.geo.dispose()
      bodyMat.dispose()
      eyeMat.dispose()
    }
  }, [husk, limb, shred, eye, bodyMat, eyeMat])

  // Realm recolor: color writes only, never rebuilds. The rim wears the
  // realm's cold atmosphere (fog-toward-primary) so silhouettes separate
  // from THIS realm's sky, not a hardcoded one.
  useEffect(() => {
    const bu = bodyUniformsOf(bodyMat)
    bu.uBody.value.set(palette.horrorBody)
    bu.uVein.value.set(palette.horrorEye).multiplyScalar(0.9)
    bu.uRim.value.set(palette.fog).lerp(new Color(palette.primary), 0.35).multiplyScalar(0.95)
    eyeUniformsOf(eyeMat).uEye.value.set(palette.horrorEye)
  }, [palette, bodyMat, eyeMat])

  // Per-enemy render state (spawn ramps + serial/state diffs), plain arrays.
  const render = useRef({
    matAmt: new Float32Array(CAP),
    lastSerial: new Int32Array(CAP).fill(-1),
    lastState: new Uint8Array(CAP),
    wasLive: new Uint8Array(CAP),
    // render-side smoothing: the sim integrates on variable frame dt and
    // teleports outright on latch edges — the eye should only ever see
    // continuous motion, so the root chases the sim with a fast exp lag
    sx: new Float32Array(CAP),
    sy: new Float32Array(CAP),
    sz: new Float32Array(CAP),
    yaw: new Float32Array(CAP),
    yawInit: new Uint8Array(CAP),
    /** 0..1 world->anchor ease on latch attach. */
    attach: new Float32Array(CAP),
    frame: 0,
  })

  useFrame(({ clock }, rawDt) => {
    const hm = huskRef.current
    const lm = limbRef.current
    const sm = shredRef.current
    const em = eyeRef.current
    if (!hm || !lm || !sm || !em) return
    const dt = Math.min(rawDt, 0.1)
    const t = clock.elapsedTime
    const rs = render.current
    rs.frame++
    const gov = governor.level
    const showShreds = gov < 2
    const poseEveryFrame = gov < 3 || (rs.frame & 1) === 0
    const frozenGait = gov >= 4

    const p = enemyState.pool
    const demo = forcing.horrorDemo
    const demoActive = demo >= 0
    const visual: HorrorVisual = demoActive
      ? HORROR_VISUALS[demo % HORROR_VISUALS.length]
      : HORROR_VISUALS[worldState.depth % HORROR_VISUALS.length]
    const arch = SWARM_ARCHETYPES[demoActive ? demo % 6 : worldState.depth % 6]

    const huskState = husk.geo.getAttribute('aState') as InstancedBufferAttribute
    const limbState = limb.geo.getAttribute('aState') as InstancedBufferAttribute
    const shredState = shred.geo.getAttribute('aState') as InstancedBufferAttribute
    const eyeState = eye.geo.getAttribute('aState') as InstancedBufferAttribute

    for (let i = 0; i < CAP; i++) {
      // ---- source fields (live pool, or the demo ring) ----
      let state: number
      let stateT: number
      let seedFrac: number
      let ex = 0
      let ey = 0
      let ez = 0
      let vx = 0
      let vy = 0
      let vz = 0
      let latchSlot = -1
      let hitFlash = 0
      let serial = 0
      if (demoActive) {
        if (i >= 8) {
          if (rs.wasLive[i]) hideEnemy(i, hm, lm, sm, em)
          rs.wasLive[i] = 0
          continue
        }
        const ang = (i / 8) * Math.PI * 2
        const sc = snapController
        state = DEMO_STATES[i]
        stateT = (t + i * 0.7) % 2.2
        seedFrac = (i * 0.137) % 1
        ex = sc.pos.x + Math.cos(ang) * 10
        ey = sc.pos.y + Math.sin(i * 2.1) * 2
        ez = sc.pos.z + Math.sin(ang) * 10
        vx = -Math.sin(ang) * 3
        vz = Math.cos(ang) * 3
        serial = 1
      } else {
        state = p.state[i]
        if (state === ES.DORMANT) {
          if (rs.wasLive[i]) hideEnemy(i, hm, lm, sm, em)
          rs.wasLive[i] = 0
          rs.lastSerial[i] = -1
          continue
        }
        stateT = p.stateT[i]
        seedFrac = (p.seed[i] % 1024) / 1024
        ex = p.x[i]
        ey = p.y[i]
        ez = p.z[i]
        vx = p.vx[i]
        vy = p.vy[i]
        vz = p.vz[i]
        latchSlot = p.latchSlot[i]
        hitFlash = p.hitFlash[i]
        serial = p.serial[i]
      }
      const wasHidden = rs.wasLive[i] === 0
      let serialChanged = false
      // fresh spawn: restart the coalesce ramp (no transition events)
      if (serial !== rs.lastSerial[i]) {
        rs.lastSerial[i] = serial
        rs.matAmt[i] = 0
        rs.lastState[i] = state
        serialChanged = true
      } else if (!demoActive && state !== rs.lastState[i]) {
        // state-transition FX, diffed render-side so bolts/strikes/novas all
        // land the same juice without the sim knowing the scene exists
        if (state === ES.DYING) {
          // ember scatter + a screen kick as the body burns out of the world
          snapController.pendingBursts.push({ x: ex, y: ey + 0.6, z: ez, count: 20, style: BURST.KILL })
          triggerCombatImpact(0.3, ex, ey, ez)
        } else if (state === ES.WINDUP) {
          // THE must-react telegraph, finally audible — panned to the coil
          sfxSwarmWindup(stereoPanFor(ex - snapController.pos.x, ez - snapController.pos.z, snapController.yaw))
          snapController.pendingBursts.push({ x: ex, y: ey, z: ez, count: 8, style: BURST.GENERIC })
        } else if (state === ES.LEAP && rs.lastState[i] === ES.WINDUP) {
          // launch dust kick off the perch + the air rip
          sfxSwarmLeap(stereoPanFor(ex - snapController.pos.x, ez - snapController.pos.z, snapController.yaw))
          snapController.pendingBursts.push({ x: ex, y: ey - 0.4, z: ez, count: 10, style: BURST.GENERIC })
        }
        rs.lastState[i] = state
      }
      rs.wasLive[i] = 1
      // materialize ramp: in over 0.45s, out over the death hold; the sim's
      // DYING window doubles as the dissolve clock
      const matTarget = state === ES.DYING ? 0 : 1
      const matRate = state === ES.DYING ? dt / 0.5 : dt / 0.45
      rs.matAmt[i] += Math.sign(matTarget - rs.matAmt[i]) * Math.min(matRate, Math.abs(matTarget - rs.matAmt[i]))
      // the Worm submerges via the same channel while burrowed
      let mat = rs.matAmt[i]
      if (!demoActive && visual.id === 'collapse' && (state === ES.STALK || state === ES.CIRCLE)) {
        const cyc = fract((t + seedFrac * arch.styleB) / arch.styleB)
        if (cyc < arch.styleA) mat = Math.min(mat, 0.2)
      }
      if (!demoActive && visual.id === 'astral' && (state === ES.STALK || state === ES.CIRCLE)) {
        // teleport shimmer: brief dissolve dip on the blink cadence
        const phase = fract((t + seedFrac * arch.styleB * 7) / arch.styleB)
        if (phase < 0.12) mat = Math.min(mat, 0.45 + 3 * phase)
      }

      // ---- render-side smoothing ----
      // Snap on spawn/respawn so the dissolve-in never smears across the
      // world; otherwise chase the sim. Leaps track tighter so the latch
      // landing stays within the attach ease's reach.
      if (wasHidden || serialChanged) {
        rs.sx[i] = ex
        rs.sy[i] = ey
        rs.sz[i] = ez
        rs.yawInit[i] = 0
        rs.attach[i] = 0
      }
      const chase = state === ES.LEAP ? 30 : 16
      const ck = 1 - Math.exp(-chase * dt)
      rs.sx[i] += (ex - rs.sx[i]) * ck
      rs.sy[i] += (ey - rs.sy[i]) * ck
      rs.sz[i] += (ez - rs.sz[i]) * ck
      const latched = state === ES.LATCHED && latchSlot >= 0
      if (latched) rs.attach[i] = Math.min(1, rs.attach[i] + dt / 0.14)
      else rs.attach[i] = 0

      if (!poseEveryFrame) continue

      // ---- pose ----
      const speed = Math.hypot(vx, vy, vz)
      poseIn.state = state
      poseIn.stateT = stateT
      poseIn.stateU =
        state === ES.WINDUP
          ? Math.min(1, stateT / arch.windupDur)
          : state === ES.LEAP
            ? Math.min(1, stateT / Math.max(0.05, demoActive ? 0.5 : p.leapDur[i]))
            : state === ES.DYING
              ? Math.min(1, stateT / ENEMY.DEATH_HOLD)
              : 0
      // stop-motion wrongness: stalk/circle/retreat gaits run at a choppy
      // ~9fps like a silent-film apparition; windups/leaps stay smooth so
      // the telegraphs remain readable
      const choppy = state === ES.STALK || state === ES.CIRCLE || state === ES.RETREAT
      poseIn.t = frozenGait ? seedFrac * 10 : choppy ? Math.floor(t * 9 + seedFrac * 9) / 9 : t
      poseIn.speed = speed
      poseIn.barPulse = visuals.beatPulse
      poseIn.seed = seedFrac
      horrorPose(pose, poseIn, visual)

      // ---- root matrix ----
      if (latched) {
        const av = avatarFrame
        const a = LATCH_ANCHORS[latchSlot]
        // first person pushes anchors outward so riders claw the screen edge
        const push = snapController.viewBlend < 0.5 ? 1.6 : 1
        dummy.position.set(av.x, av.y, av.z)
        dummy.rotation.set(av.pitch, av.yaw, av.roll, 'YXZ')
        dummy.scale.setScalar(1)
        dummy.updateMatrix()
        mRoot.copy(dummy.matrix)
        dummy.position.set(a[0] * push, a[1] * push, a[2] * push)
        dummy.rotation.set(pose.pitch, a[3] + pose.yawJitter, pose.roll, 'YXZ')
        // riders read smaller so the bigger realm silhouettes don't swallow
        // the camera when they're on you
        dummy.scale.setScalar(visual.scale * 0.6 * (1 + pose.stretch))
        dummy.updateMatrix()
        mRoot.multiply(dummy.matrix)
        // ease the world->anchor snap so the attach never pops
        const ab = rs.attach[i]
        if (ab < 1) {
          const e = mRoot.elements
          e[12] = rs.sx[i] + (e[12] - rs.sx[i]) * ab
          e[13] = rs.sy[i] + (e[13] - rs.sy[i]) * ab
          e[14] = rs.sz[i] + (e[14] - rs.sz[i]) * ab
        }
      } else {
        // face travel when moving, else face the player — damped so facing
        // never snaps at leap launch/landing or the travel/player threshold
        let targetYaw: number
        if (speed > 1.2) targetYaw = Math.atan2(-vx, -vz) + Math.PI
        else {
          const sc = snapController
          targetYaw = Math.atan2(-(sc.pos.x - rs.sx[i]), -(sc.pos.z - rs.sz[i])) + Math.PI
        }
        if (rs.yawInit[i] === 0) {
          rs.yaw[i] = targetYaw
          rs.yawInit[i] = 1
        } else {
          let dy = (targetYaw - rs.yaw[i]) % TAU
          if (dy > Math.PI) dy -= TAU
          else if (dy < -Math.PI) dy += TAU
          rs.yaw[i] += dy * (1 - Math.exp(-10 * dt))
        }
        dummy.position.set(rs.sx[i], rs.sy[i] + pose.bobY * visual.scale, rs.sz[i])
        dummy.rotation.set(pose.pitch, rs.yaw[i] + pose.yawJitter, pose.roll, 'YXZ')
        dummy.scale.setScalar(visual.scale)
        dummy.updateMatrix()
        mRoot.copy(dummy.matrix)
      }

      // eyes ignite as they close in — the swarm watches you back
      const pdX = ex - snapController.pos.x
      const pdY = ey - snapController.pos.y
      const pdZ = ez - snapController.pos.z
      const proxFlare = Math.max(0, 1 - Math.hypot(pdX, pdY, pdZ) / 16) * 0.55

      // ---- FK through the part specs ----
      let huskIdx = -1
      let limbIdx = -1
      let shredIdx = -1
      let eyeIdx = -1
      for (const part of visual.parts) {
        const parentM = part.parent < 0 ? mRoot : mSeg[Math.min(part.parent, HUSK_PER - 1)]
        const parentLen = part.parent < 0 ? 0 : visual.parts[huskSpecIndex(visual, part.parent)].len
        const m = part.mirror === 0 ? 1 : part.mirror
        // local attach + orientation, modulated by the pose channels
        let splay = part.splay * m
        let pitch = part.pitch
        const gaitS = Math.sin(pose.gaitLift * 2 + part.phaseOff * Math.PI * 2)
        if (part.part === 1) {
          splay *= pose.limbSplayMul
          pitch += 0.35 * pose.gaitLift * Math.sin(part.phaseOff * Math.PI * 2 + poseIn.seed * 9)
        } else if (part.part === 2) {
          pitch -= pose.shredFlare * 0.55
          pitch += 0.06 * gaitS
        } else if (part.part === 0 && part.parent >= 0) {
          pitch += pose.segCurl * 0.4 + pose.segWave * Math.sin(poseIn.t * 3 + part.phaseOff * 6.28)
        }
        dummy.position.set(0, part.t * parentLen, part.zOff)
        dummy.rotation.set(pitch, part.yawO, splay, 'ZXY')
        dummy.scale.setScalar(1)
        dummy.updateMatrix()
        mPart.copy(parentM).multiply(dummy.matrix)

        if (part.part === 0) {
          huskIdx++
          mSeg[Math.min(huskIdx, HUSK_PER - 1)].copy(mPart)
        }

        // stamp geometry scale (+ death fling scatter along the part's axis)
        const stretchY = part.part === 0 && part.parent < 0 ? 1 + 0.6 * pose.stretch : 1
        dummy.position.set(0, pose.fling * 0.9 * (0.4 + poseIn.seed), 0)
        dummy.rotation.set(0, 0, 0)
        dummy.scale.set(
          Math.max(1e-4, part.wid),
          Math.max(1e-4, part.len * stretchY),
          Math.max(1e-4, part.wid),
        )
        dummy.updateMatrix()
        mPart.multiply(dummy.matrix)

        const heat = Math.min(1.6, (part.part === 3 ? pose.eyeHeat : pose.eyeHeat * 0.8) + proxFlare)
        if (part.part === 0) {
          const slot = i * HUSK_PER + huskIdx
          hm.setMatrixAt(slot, mPart)
          huskState.setXYZW(slot, mat, hitFlash, heat, pose.tremble)
        } else if (part.part === 1) {
          limbIdx++
          const slot = i * LIMB_PER + limbIdx
          lm.setMatrixAt(slot, mPart)
          limbState.setXYZW(slot, mat, hitFlash, heat, pose.tremble)
        } else if (part.part === 2) {
          shredIdx++
          const slot = i * SHRED_PER + shredIdx
          if (showShreds) {
            sm.setMatrixAt(slot, mPart)
            shredState.setXYZW(slot, mat, hitFlash, heat, pose.tremble)
          } else {
            sm.setMatrixAt(slot, hiddenMatrix)
          }
        } else {
          eyeIdx++
          const slot = i * EYE_PER + eyeIdx
          em.setMatrixAt(slot, mPart)
          eyeState.setXYZW(slot, mat, hitFlash, pose.eyeHeat, pose.tremble)
        }
      }
      // collapse the unused instance tail for this enemy
      for (let hI = huskIdx + 1; hI < HUSK_PER; hI++) hm.setMatrixAt(i * HUSK_PER + hI, hiddenMatrix)
      for (let lI = limbIdx + 1; lI < LIMB_PER; lI++) lm.setMatrixAt(i * LIMB_PER + lI, hiddenMatrix)
      for (let sI = shredIdx + 1; sI < SHRED_PER; sI++) sm.setMatrixAt(i * SHRED_PER + sI, hiddenMatrix)
      for (let eI = eyeIdx + 1; eI < EYE_PER; eI++) em.setMatrixAt(i * EYE_PER + eI, hiddenMatrix)
    }

    hm.instanceMatrix.needsUpdate = true
    lm.instanceMatrix.needsUpdate = true
    sm.instanceMatrix.needsUpdate = true
    em.instanceMatrix.needsUpdate = true
    huskState.needsUpdate = true
    limbState.needsUpdate = true
    shredState.needsUpdate = true
    eyeState.needsUpdate = true

    const bu = bodyUniformsOf(bodyMat)
    bu.uTime.value = t
    // veins smolder brighter as the song climbs toward SHATTER
    bu.uVeinGain.value = 0.8 + 0.5 * visuals.beatPulse + 0.45 * visuals.w3
    // the swarm breathes with the song — chests swell on the downbeat, and a
    // slow heave keeps them alive between bars
    bu.uBreath.value = visuals.rm ? 0 : 0.07 * visuals.barPulse + 0.025 * Math.sin(t * 0.9)
    const eu = eyeUniformsOf(eyeMat)
    eu.uTime.value = t
    eu.uEyeGain.value = visual.eyeHdr
  })

  return (
    <>
      <instancedMesh
        ref={el => {
          huskRef.current = el
          if (el) el.instanceMatrix.setUsage(DynamicDrawUsage)
        }}
        args={[husk.geo, bodyMat, HUSKS]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={el => {
          limbRef.current = el
          if (el) el.instanceMatrix.setUsage(DynamicDrawUsage)
        }}
        args={[limb.geo, bodyMat, LIMBS]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={el => {
          shredRef.current = el
          if (el) el.instanceMatrix.setUsage(DynamicDrawUsage)
        }}
        args={[shred.geo, bodyMat, SHREDS]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={el => {
          eyeRef.current = el
          if (el) el.instanceMatrix.setUsage(DynamicDrawUsage)
        }}
        args={[eye.geo, eyeMat, EYES]}
        frustumCulled={false}
      />
    </>
  )
}

function hideEnemy(
  i: number,
  hm: InstancedMesh,
  lm: InstancedMesh,
  sm: InstancedMesh,
  em: InstancedMesh,
): void {
  for (let k = 0; k < HUSK_PER; k++) hm.setMatrixAt(i * HUSK_PER + k, hiddenMatrix)
  for (let k = 0; k < LIMB_PER; k++) lm.setMatrixAt(i * LIMB_PER + k, hiddenMatrix)
  for (let k = 0; k < SHRED_PER; k++) sm.setMatrixAt(i * SHRED_PER + k, hiddenMatrix)
  for (let k = 0; k < EYE_PER; k++) em.setMatrixAt(i * EYE_PER + k, hiddenMatrix)
}

function fract(v: number): number {
  return v - Math.floor(v)
}

/** Index into visual.parts of the h-th husk (parents index the husk list). */
function huskSpecIndex(v: HorrorVisual, huskOrdinal: number): number {
  let seen = -1
  for (let i = 0; i < v.parts.length; i++) {
    if (v.parts[i].part === 0) {
      seen++
      if (seen === huskOrdinal) return i
    }
  }
  return 0
}
