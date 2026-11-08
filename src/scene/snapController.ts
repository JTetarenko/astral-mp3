import { Vector3 } from 'three'
import type { PerspectiveCamera } from 'three'
import { audioFrame } from '../audio/reactiveBus'
import {
  sfxBanish,
  sfxCastLoose,
  sfxCastStorm,
  sfxCastVolley,
  sfxCastWindup,
  sfxChime,
  sfxComboBreak,
  sfxComboTier,
  sfxDrawCancel,
  sfxDrawFull,
  sfxDrawUpdate,
  sfxComplete,
  sfxDenied,
  sfxDowned,
  sfxEnemyHit,
  sfxGradeConfirm,
  sfxHpRefill,
  sfxImpact,
  sfxLock,
  sfxOverdrawSplit,
  sfxSnapLaunch,
  sfxSprintStart,
  sfxStormArmed,
  sfxWhiff,
} from '../audio/sfx'
import {
  AIM,
  AIM_HYST,
  ENEMY_AIM,
  GATE_AIM,
  pickEnemyTarget,
  pickGate,
  pickPoolTarget,
  WARDEN_AIM,
  type AimConfig,
} from '../game/aim'
import { isOnBeat } from '../game/beatWindow'
import {
  castDamage,
  castGravity,
  castHitR,
  castHomeTurn,
  castLife,
  castPierce,
  castSpeed,
  COMBAT,
  snapStrikeDamage,
} from '../game/combat'
import { CP, makeCastState, recoverDuration, resetCast, stepCast } from '../game/castState'
import {
  castComboDamageMult,
  castComboOnHit,
  castComboOnLoose,
  comboTier,
  makeCastCombo,
  resetCastCombo,
  tickCastCombo,
  tryConsumeStorm,
} from '../game/castCombo'
import {
  applySnapStrike,
  applyWardenWeakHit,
  banishNova,
  collectStormTargets,
  enemyState,
  fireBolt,
  isDownedTriggered,
  latchLoad,
  releaseAllLatched,
  STRIKE_KILL,
  STRIKE_MISS,
  tearOffOneLatch,
  wardenBlocksGate,
  weakPointTarget,
} from '../game/enemyState'
import { feel, HIT_RING_CAP, HK } from '../game/feelSignals'
import { gameTime, HITSTOP, triggerHitStop } from '../game/gameTime'
import {
  clearBuffer,
  makePressBuffer,
  press,
  tickBuffer,
  tryConsume,
} from '../game/inputBuffer'
import { getItem } from '../game/items'
import { healPlayer, PLAYER_HP, reviveFloor } from '../game/playerHealth'
import { applySnap, decayedMultiplier, SCORING } from '../game/scoring'
import { pushFeedback, runState } from '../game/runState'
import { hashInts } from '../game/seededRandom'
import { getRealmForDepth, shiftBonus, shiftCostForDepth } from '../game/realms'
import { BOOM, boomClearT } from '../game/cameraBoom'
import { LAYOUT } from '../game/layout'
import { BURST } from './burstVocab'
import {
  collectPoint,
  openGate,
  performRealmSwap,
  worldState,
} from '../game/worldState'
import {
  combatSignals,
  fxSignals,
  triggerBanishNova,
  triggerCombatImpact,
  triggerShiftBurst,
  visuals,
} from './visualTuning'

export type SnapPhase = 'idle' | 'streak' | 'pull' | 'recover' | 'shift' | 'downed'
export type ViewMode = 'third' | 'first'

const STREAK_DUR = 0.11
const PULL_DUR = 0.32
const RECOVER_DUR = 0.25
/** Realm shift: whiteout peak (world swap) and total lockout. */
const SHIFT_SWAP_T = 0.45
const SHIFT_DUR = 1.25
/** The dragged-from-the-sky fall before the run ends. */
const DOWNED_DUR = 2.4
const BASE_FOV = 75
const FOV_KICK = 17
const MOUSE_RAD_PER_PX = 0.0022
const ACCEL = 30
const MAX_SPEED = 12

/** Camera-feel tuning: trauma shake, roll spring, boom punch, FOV taus. */
const CAM = {
  /** trauma 0..1 drains at this rate; amplitude = trauma^2 * shakeMax. */
  traumaDecay: 2.2,
  shakeMax: 0.035,
  /** Damped roll spring (zeta ~0.68: one visible overshoot, no wobble tail). */
  rollK: 90,
  rollDamp: 13,
  rollStrike: 0.9,
  rollWarden: 1.4,
  rollBolt: 0.18,
  /** Boom lunge fraction on a kill (of BOOM.back). */
  boomPunchK: 0.22,
  /** FOV spring: rise stays instant-feeling; the snappier fall IS the punch. */
  fovRiseTau: 0.045,
  fovFallTau: 0.11,
} as const
/** Aim-target sentinel for the realm gate (point slots are 0..15). */
export const TARGET_GATE = 100
/** Enemy sentinels: enemy i -> TARGET_ENEMY_BASE + i (i < SWARM_CAP 24). */
export const TARGET_ENEMY_BASE = 200
/** The warden's open weak point. */
export const TARGET_WARDEN = 300
/** Gate must be at least this materialized before it can be snapped. */
const GATE_MIN_OPEN = 0.35

export interface Shockwave {
  x: number
  y: number
  z: number
  t0: number
  strength: number
  active: boolean
}

export interface Burst {
  x: number
  y: number
  z: number
  count: number
  /** BURST style id (burstVocab); undefined = GENERIC. */
  style?: number
}

/** Accelerate-then-arrive "pulled" easing for the body tween. */
function pullEase(k: number): number {
  const split = 0.6
  const mid = 0.55
  if (k < split) {
    const u = k / split
    return mid * u * u
  }
  const u = (k - split) / (1 - split)
  return mid + (1 - mid) * (1 - Math.pow(1 - u, 3))
}

/**
 * All mutable player/snap state lives here, outside React. PlayerRig feeds it
 * input events and calls update() from useFrame; everything else reads fields.
 */
class SnapController {
  pos = new Vector3(0, 4, 40)
  vel = new Vector3()
  yaw = 0
  pitch = 0.08
  forward = new Vector3(0, 0, -1)

  phase: SnapPhase = 'idle'
  phaseT = 0
  /** Currently aimed (assisted) target: point index, TARGET_GATE, or -1. */
  target = -1
  targetAngle = 0
  targetDist = 0
  /** 0..1 aim-assist quality of the current target this frame (0 when
   * target === -1). The aim thread reads it for brightness/tautness. */
  targetScore = 0

  snapTargetIdx = -1
  snapFrom = new Vector3()
  snapTo = new Vector3()
  snapPoint = new Vector3()
  approachDir = new Vector3(0, 0, -1)
  streakPos = new Vector3()
  private snapAimError = 0
  private snapDist = 0
  private snapOnBeat = false
  private swapDone = false
  /** Committed snap-strike victim (serial-guarded — voidmaws can blink away). */
  private strikeIdx = -1
  private strikeSerial = 0
  /** 1 while the streak ghost is a white-hot strike lance; exp(-4t) decay. */
  strikeHeat = 0

  // ---- combat intents (set by PlayerRig, consumed in update) ----
  /** RMB held raw: sustains the draw (the press edge rides castPressBuf). */
  castHeld = false
  /** 0/1 pressed: fire that consumable rite slot (EnemyDirector consumes). */
  consumableQueued = -1
  /** The cast/charge machine (pure; stepped with REAL dt — see castState.ts). */
  cast = makeCastState()
  private castPressBuf = makePressBuffer()
  /** Alternating cast-recoil roll direction. */
  private boltSide = 1
  /** The bow-combo ladder (pure; hits ring-diffed from feelSignals). */
  castCombo = makeCastCombo()
  /** Ring cursor for the combo hit feed (feel.hitSerial diff). */
  private lastComboHitSerial = 0
  /** Last seen combo tier — cue fires on the rise only. */
  private lastComboTier = 0
  /** Storm-armed edge memory (streak and tier paths share one register). */
  private stormWasArmed = false
  /** Shard-target scratch for the storm fan. */
  private stormTargets = new Int16Array(8)

  fov = BASE_FOV
  /** 0..1 camera trauma; amplitude = trauma^2 (Schell's law: shakes read as
   * energy, and energy squared reads as impact). addTrauma to feed. */
  private trauma = 0
  /** Damped-spring camera roll (rad) + velocity; impulses via punchCam. */
  private camRoll = 0
  private rollVel = 0
  /** 0..1 boom lunge toward the action; exp(-8t) decay. */
  private boomPunch = 0
  /** Post-FX impulse pulse 0..1, decays exp(-6t). Read by Effects. */
  fxPulse = 0
  shockwave: Shockwave = { x: 0, y: 0, z: 0, t0: 0, strength: 0, active: false }
  pendingBursts: Burst[] = []

  /** Flight-life signals the avatar layer consumes each frame. */
  tricks = {
    /** 1 on a dive released into level flight; exp(-3t) decay. */
    swoopPulse: 0,
    /** 1 on a hard acceleration burst; exp(-3.5t) decay. */
    snapBoost: 0,
    /** 0..1 sustained hard-turn blend; carveDir = turn sign. */
    carve: 0,
    carveDir: 1,
    /** 0..1 eagle-soar blend: sustained forward flight tips the avatar prone
     * and flattens the wings into a swept glide plane. */
    soar: 0,
    /** Slewed climb angle of the velocity (rad; negative = diving). */
    climb: 0,
    /** 0..1 sprint blend (double-tap W and hold): faster flight, falcon-swept
     * wings, wider FOV. */
    sprint: 0,
    /** Idle flourish: -1 none, 0 wing stretch, 1 ruffle, 2 halo bloom. */
    flourish: -1,
    flourishT: 0,
    flourishDur: 1,
    flourishCount: 0,
    idleT: 0,
    /** 0..1 cast anticipation ramp (wings tense, orb forms). */
    castWindup: 0,
    /** 0..1 draw power mirror while charging (bow-tension pose). */
    castCharge: 0,
    /** 1 on loose; exp(-6t) decay (wing snap-forward). */
    castRelease: 0,
    /** 1 when the draw tops out; exp(-8t) decay (orb pop). */
    fullPulse: 0,
    /** 0..1 held past full draw — the volley split ramp mirror. */
    overdraw: 0,
    /** 1 when the nocked arrow splits into the fan; exp(-8t) decay. */
    volleyPulse: 0,
    /** 1 on a storm release; exp(-5t) decay (the sky opens). */
    stormRelease: 0,
  }

  /** Sprint intent from the rig (double-tap W, held); tricks.sprint slews. */
  sprintHeld = false

  private lastSwoopAt = -999
  private lastBoostAt = -999
  private diveArmed = false
  private prevSpeed = 0
  private prevYawTrick = 0
  private yawRateSlew = 0
  private nextFlourishAt = 5

  // ---- third-person camera ----
  /** Desired mode (settings-synced); viewBlend eases toward it. */
  viewMode: ViewMode = 'third'
  /** 0 = first person (exact legacy camera), 1 = full boom. */
  viewBlend = 1
  /** Rendered camera position — the aim origin; avatar/HUD read it too. */
  camPos = new Vector3(0, 4, 40)
  /** Player->camera distance after occlusion (avatar hide + aim minDist). */
  camDist = 0
  private camAnchor = new Vector3(0, 4, 40)
  private boomT = 1
  private aimCfg: AimConfig = { ...AIM }
  private gateCfg: AimConfig = { ...GATE_AIM }
  private enemyCfg: AimConfig = { ...ENEMY_AIM }
  private wardenCfg: AimConfig = { ...WARDEN_AIM }

  keys = new Set<string>()
  pointerLocked = false
  canvasEl: HTMLCanvasElement | null = null
  sensitivity = 1
  /** state.ts wires this to the store so React learns about depth changes. */
  onDepthChange: ((depth: number) => void) | null = null
  /** state.ts wires this to endRun('downed') — fired once per fall. */
  onDowned: (() => void) | null = null
  private downedFired = false

  /** Sticky press intents: a click mid-pull chains on the first legal frame
   * instead of vanishing (the old booleans dropped it). REAL-dt ticked. */
  private snapBuf = makePressBuffer()
  private novaBuf = makePressBuffer()
  private clockT = 0
  private lastLockedTarget = -1
  private lastLockSfxAt = -999
  /** One SEALED toast per warden (serial-keyed). */
  private deniedGateToastSerial = -1

  reset(): void {
    this.pos.set(LAYOUT.spawn.x, LAYOUT.spawn.y, LAYOUT.spawn.z)
    this.vel.set(0, 0, 0)
    this.yaw = 0
    this.pitch = 0.08
    this.phase = 'idle'
    this.phaseT = 0
    this.target = -1
    this.targetScore = 0
    this.snapTargetIdx = -1
    this.fov = BASE_FOV
    this.trauma = 0
    this.camRoll = 0
    this.rollVel = 0
    this.boomPunch = 0
    this.fxPulse = 0
    this.shockwave.active = false
    this.pendingBursts.length = 0
    clearBuffer(this.snapBuf)
    clearBuffer(this.novaBuf)
    this.swapDone = false
    this.lastLockedTarget = -1
    this.lastLockSfxAt = -999
    this.deniedGateToastSerial = -1
    this.strikeIdx = -1
    this.strikeHeat = 0
    this.castHeld = false
    resetCast(this.cast)
    clearBuffer(this.castPressBuf)
    resetCastCombo(this.castCombo)
    // arm the hit cursor against the CURRENT serial — feel counters are
    // monotonic across runs, so stale events must not feed a fresh combo
    this.lastComboHitSerial = feel.hitSerial
    this.lastComboTier = 0
    this.stormWasArmed = false
    this.consumableQueued = -1
    this.downedFired = false
    this.tricks.swoopPulse = 0
    this.tricks.snapBoost = 0
    this.tricks.carve = 0
    this.tricks.soar = 0
    this.tricks.climb = 0
    this.tricks.sprint = 0
    this.tricks.flourish = -1
    this.tricks.idleT = 0
    this.tricks.castWindup = 0
    this.tricks.castCharge = 0
    this.tricks.castRelease = 0
    this.tricks.fullPulse = 0
    this.tricks.overdraw = 0
    this.tricks.volleyPulse = 0
    this.tricks.stormRelease = 0
    this.sprintHeld = false
    this.lastSwoopAt = -999
    this.lastBoostAt = -999
    this.diveArmed = false
    this.prevSpeed = 0
    this.prevYawTrick = 0
    this.yawRateSlew = 0
    this.nextFlourishAt = 5
    this.keys.clear()
    this.viewBlend = this.viewMode === 'third' ? 1 : 0
    this.camAnchor.copy(this.pos)
    this.camPos.copy(this.pos)
    this.boomT = 1
    this.camDist = 0
  }

  onMouseMove(dx: number, dy: number): void {
    const k = MOUSE_RAD_PER_PX * this.sensitivity
    this.yaw -= dx * k
    this.pitch = Math.max(-1.48, Math.min(1.48, this.pitch - dy * k))
  }

  queueSnap(): void {
    press(this.snapBuf)
  }

  queueNova(): void {
    press(this.novaBuf)
  }

  /** RMB press edge — sticky, so a click mid-pull begins the windup the frame
   * you land (the LMB chain-feel doctrine). */
  queueCast(): void {
    press(this.castPressBuf)
  }

  /** Feed the camera-trauma pool (impacts, knocks, the fall). */
  addTrauma(x: number): void {
    this.trauma = Math.min(1, this.trauma + x)
  }

  /** One camera punch: boom lunge + roll impulse + trauma. FOV rides the
   * separate triggerCombatImpact/impactFov path. */
  private punchCam(boomK: number, rollImpulse: number, traumaAdd: number): void {
    this.boomPunch = Math.min(1, Math.max(this.boomPunch, boomK))
    this.rollVel += rollImpulse
    this.addTrauma(traumaAdd)
  }

  /** Roll direction of a pass: lean WITH the travel across the screen. */
  private strikeRollSign(): number {
    const rx = Math.cos(this.yaw)
    const rz = -Math.sin(this.yaw)
    const s = this.approachDir.x * rx + this.approachDir.z * rz
    return s >= 0 ? 1 : -1
  }


  update(dt: number, t: number, camera: PerspectiveCamera): void {
    this.clockT = t
    // The hit-stop split: world motion (phase tweens, movement, the fall)
    // integrates with dtW and freezes through a stop; the camera, springs,
    // decays and input buffers stay on REAL dt — the live camera over the
    // frozen world IS the punch.
    const dtW = dt * gameTime.worldScale
    this.fxPulse *= Math.exp(-6 * dt)
    tickBuffer(this.snapBuf, dt)
    tickBuffer(this.novaBuf, dt)
    tickBuffer(this.castPressBuf, dt)
    if (this.shockwave.active && t - this.shockwave.t0 > 1.5) this.shockwave.active = false

    const cp = Math.cos(this.pitch)
    this.forward.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp)

    // Multiplier decay is continuous — mutate the field, keep the pure math in scoring.ts
    const ss = runState.scoreState
    ss.multiplier = decayedMultiplier(ss.multiplier, audioFrame.time - ss.lastSnapTime, dt)

    let aimFresh = false
    switch (this.phase) {
      case 'idle':
      case 'recover':
        // the fail check: too many riders — or a bled-out blood pool — and
        // the sky lets go of you, unless a phoenix ash burns itself instead
        if (isDownedTriggered(runState.stats.maxLatch) || runState.hp <= 0) {
          if (this.tryPhoenixAsh(t)) break
          this.beginDowned(runState.hp <= 0 && !isDownedTriggered(runState.stats.maxLatch))
          break
        }
        if (this.phase === 'recover') {
          this.phaseT += dtW
          if (this.phaseT >= RECOVER_DUR) this.phase = 'idle'
        }
        this.integrateMovement(dtW)
        this.updateAim()
        aimFresh = true
        break
      case 'streak': {
        this.phaseT += dtW
        const k = Math.min(1, this.phaseT / STREAK_DUR)
        const e = 1 - Math.pow(1 - k, 4)
        this.streakPos.lerpVectors(this.snapFrom, this.snapPoint, e)
        if (k >= 1) {
          this.phase = 'pull'
          this.phaseT = 0
        }
        break
      }
      case 'pull': {
        this.phaseT += dtW
        const k = Math.min(1, this.phaseT / PULL_DUR)
        this.pos.lerpVectors(this.snapFrom, this.snapTo, pullEase(k))
        if (k >= 1) {
          if (this.snapTargetIdx === TARGET_GATE) this.beginShift()
          else if (this.snapTargetIdx >= TARGET_ENEMY_BASE) this.arriveStrike(t)
          else this.arrive()
        }
        break
      }
      case 'shift': {
        this.phaseT += dtW
        if (!this.swapDone && this.phaseT >= SHIFT_SWAP_T) this.performSwap(t)
        if (this.phaseT >= SHIFT_DUR) {
          this.phase = 'recover'
          this.phaseT = 0
        }
        break
      }
      case 'downed': {
        // real gravity for the first time in the game: no hover spring, no
        // vertical band — the world simply lets go. Latched horrors ride the
        // fall (the renderer keeps them attached). Music keeps playing until
        // endRun stops it — the track outliving you IS the fail-state feel.
        this.phaseT += dtW
        this.vel.y -= 22 * dtW
        const dragH = Math.exp(-1.5 * dtW)
        this.vel.x *= dragH
        this.vel.z *= dragH
        this.yaw += 0.4 * dtW // slow forced tumble
        this.pitch += (-0.5 - this.pitch) * (1 - Math.exp(-dtW / 0.5))
        this.pos.addScaledVector(this.vel, dtW)
        if ((this.phaseT >= DOWNED_DUR || this.pos.y < -80) && !this.downedFired) {
          this.downedFired = true
          this.onDowned?.()
        }
        break
      }
    }

    // ---- buffered intents, consumed on the first legal frame. The snap
    // consume additionally waits for a frame with FRESH aim: on the very
    // arrival frame target is stale (-1), and whiffing there would punish a
    // perfectly aimed chain click. ----
    const canAct = this.phase === 'idle' || this.phase === 'recover'
    if (aimFresh && tryConsume(this.snapBuf)) {
      if (this.target >= 0) {
        this.startSnap()
      } else {
        // an honest whiff: the sky answers a swing at nothing
        feel.whiffCount++
        sfxWhiff()
        this.addTrauma(0.12)
      }
    }
    if (canAct && tryConsume(this.novaBuf)) {
      if (runState.shiftCharge >= COMBAT.nova.cost) {
        runState.shiftCharge -= COMBAT.nova.cost
        banishNova(this.pos.x, this.pos.y, this.pos.z, t, runState.stats)
        triggerBanishNova(1)
        this.shockwave.x = this.pos.x
        this.shockwave.y = this.pos.y
        this.shockwave.z = this.pos.z
        this.shockwave.t0 = t
        this.shockwave.strength = 1.2
        this.shockwave.active = true
        this.pendingBursts.push({ x: this.pos.x, y: this.pos.y, z: this.pos.z, count: 120, style: BURST.STRIKE })
        this.fxPulse = 1
        this.addTrauma(0.5)
        sfxBanish()
      } else {
        feel.deniedNovaCount++
        sfxDenied()
        pushFeedback('NOT ENOUGH CHARGE', 'SNAP RESONANCE TO CHARGE', 'warn')
      }
    }
    // ---- the bow-combo ladder: decay clock (audio time — hit-stop immune,
    // the multiplier-decay precedent) + the hit feed. EnemyDirector at -80
    // pushed this frame's bolt hits before this priority-0 tick, so the ring
    // diff is zero-latency. Own cursor beside EnemyDirector's and the HUD's. ----
    if (tickCastCombo(this.castCombo, audioFrame.time)) {
      feel.castComboBreakCount++
      sfxComboBreak()
    }
    {
      const from = Math.max(this.lastComboHitSerial, feel.hitSerial - HIT_RING_CAP)
      for (let s = from + 1; s <= feel.hitSerial; s++) {
        const e = feel.hitRing[s % HIT_RING_CAP]
        if (e.serial !== s) continue
        // every bolt victim counts — a lined-up pierce is the peak bow play
        if (e.kind === HK.BOLT) castComboOnHit(this.castCombo, audioFrame.time)
      }
      this.lastComboHitSerial = feel.hitSerial
    }
    const comboTierNow = comboTier(this.castCombo.comboCount)
    if (comboTierNow > this.lastComboTier) {
      feel.lastComboTier = comboTierNow
      feel.castComboTierCount++
      sfxComboTier(comboTierNow)
    }
    this.lastComboTier = comboTierNow

    // ---- the cast machine: tap = quick bolt (windup then loose), hold =
    // bowstring draw. Holding NEVER autofires — one loose per press. Stepped
    // with REAL dt so a draw keeps ramping through hit-stop. ----
    const cs = this.cast
    const prevCastPhase = cs.phase
    const startEdge = cs.phase === CP.IDLE && canAct && tryConsume(this.castPressBuf)
    const loose = stepCast(
      cs,
      startEdge,
      this.castHeld,
      canAct,
      dt,
      runState.stats.castSpeedMult,
      runState.stats.drawSpeedMult,
    )
    if (startEdge) sfxCastWindup()
    if (cs.phase === CP.CHARGE && cs.power >= 1 && !cs.fullFired) {
      // full-draw cue, once per draw
      cs.fullFired = true
      this.tricks.fullPulse = 1
      this.pendingBursts.push({
        x: this.pos.x + this.forward.x * 1.2,
        y: this.pos.y + this.forward.y * 1.2 + 0.15,
        z: this.pos.z + this.forward.z * 1.2,
        count: 10,
        style: BURST.MUZZLE,
      })
      sfxDrawFull()
    }
    if (cs.phase === CP.CHARGE && cs.over >= 1 && !cs.overFired) {
      // overdraw split cue, once per draw: the nocked arrow fans into three
      cs.overFired = true
      this.tricks.volleyPulse = 1
      this.pendingBursts.push({
        x: this.pos.x + this.forward.x * 1.2,
        y: this.pos.y + this.forward.y * 1.2 + 0.15,
        z: this.pos.z + this.forward.z * 1.2,
        count: 8,
        style: BURST.MUZZLE,
      })
      sfxOverdrawSplit()
    }
    if (prevCastPhase === CP.CHARGE && cs.phase === CP.IDLE && !loose) {
      // snap/shift/downed tore the draw away: honest fizzle, no penalty
      this.pendingBursts.push({
        x: this.pos.x + this.forward.x * 1.2,
        y: this.pos.y + this.forward.y * 1.2 + 0.15,
        z: this.pos.z + this.forward.z * 1.2,
        count: 4,
        style: BURST.MUZZLE,
      })
      sfxDrawCancel()
    }
    if (loose) {
      const p = loose.power
      const onBeat = isOnBeat(
        audioFrame.gridPhase,
        audioFrame.gridSpanSec,
        audioFrame.gridConfidence,
        audioFrame.timeSinceOnset,
      )
      const frenzy = runState.activeEffects.frenzyT > 0 ? 1.5 : 1
      // shot-type classification. The volley BANKS an armed storm — only a
      // full-draw non-volley release spends it (the player chooses).
      const isVolley = loose.over >= 1
      const isStorm = !isVolley && p >= 0.999 && tryConsumeStorm(this.castCombo)
      const kind = isStorm ? 3 : isVolley ? 2 : p < 0.05 ? 0 : 1
      const dmgBase =
        castDamage(p, runState.stats.boltDamageMult) *
        frenzy *
        (onBeat ? COMBAT.cast.onBeatMult : 1) *
        castComboDamageMult(comboTierNow)
      let homeIdx = -1
      let homeSerial = 0
      if (this.target >= TARGET_ENEMY_BASE && this.target < TARGET_WARDEN) {
        homeIdx = this.target - TARGET_ENEMY_BASE
        homeSerial = enemyState.pool.serial[homeIdx]
      }
      const mx = this.pos.x + this.forward.x * 1.2
      const my = this.pos.y + this.forward.y * 1.2 + 0.15
      const mz = this.pos.z + this.forward.z * 1.2
      const fx = this.forward.x
      const fy = this.forward.y
      const fz = this.forward.z
      const cfg = COMBAT.cast
      let firedCount = 0
      if (isVolley) {
        // flat 3-bolt fan about forward; center FIRST so a starved pool
        // keeps the aimed bolt. fireBolt normalizes direction.
        const rx = Math.cos(this.yaw)
        const rz = -Math.sin(this.yaw)
        const tanS = Math.tan(cfg.volleySpreadRad)
        for (const k of [0, -1, 1]) {
          const ok = fireBolt(
            mx,
            my,
            mz,
            fx + rx * tanS * k,
            fy,
            fz + rz * tanS * k,
            dmgBase * cfg.volleyDamageK,
            -1,
            0,
            t,
            {
              power: 1,
              speed: castSpeed(1) * (1 + cfg.volleySpeedVar * k),
              radius: castHitR(1),
              pierce: castPierce(1, runState.stats.pierceBonus),
              grav: castGravity(1),
              homeTurn: 0,
              lobUp: 0,
              life: cfg.volleyLife,
              crit: onBeat,
            },
          )
          if (ok) firedCount++
        }
      } else if (isStorm) {
        // five shards up-and-over, center-out; each homes on its own horror
        const rx = Math.cos(this.yaw)
        const rz = -Math.sin(this.yaw)
        const upTan = Math.tan(cfg.stormUpPitch)
        const nT = collectStormTargets(
          this.stormTargets,
          this.pos.x,
          this.pos.y,
          this.pos.z,
          cfg.stormCount,
        )
        let ti = 0
        for (const k of [0, -1, 1, -2, 2]) {
          const tanS = Math.tan(cfg.stormFanRad * k)
          let hIdx = -1
          let hSerial = 0
          if (ti === 0 && homeIdx >= 0) {
            // the aimed horror takes the first shard
            hIdx = homeIdx
            hSerial = homeSerial
          } else if (nT > 0) {
            hIdx = this.stormTargets[ti % nT]
            hSerial = enemyState.pool.serial[hIdx]
          }
          ti++
          const ok = fireBolt(
            mx,
            my,
            mz,
            fx + rx * tanS,
            fy + upTan,
            fz + rz * tanS,
            dmgBase * cfg.stormDamageK,
            hIdx,
            hSerial,
            t,
            {
              power: 1,
              speed: cfg.fullSpeed * cfg.stormSpeedK,
              radius: castHitR(1),
              pierce: cfg.stormPierce,
              grav: cfg.stormGravity,
              homeTurn: cfg.stormHomeTurn,
              lobUp: 0,
              life: cfg.stormLife,
              crit: onBeat,
            },
          )
          if (ok) firedCount++
        }
      } else {
        const fired = fireBolt(mx, my, mz, fx, fy, fz, dmgBase, homeIdx, homeSerial, t, {
          power: p,
          speed: castSpeed(p),
          radius: castHitR(p),
          pierce: castPierce(p, runState.stats.pierceBonus),
          grav: castGravity(p),
          homeTurn: castHomeTurn(p),
          // the wizard lob fades out by half-draw: a charged shot flies true
          lobUp: p < 0.5 ? COMBAT.bolt.lobUp * (1 - 2 * p) : 0,
          life: castLife(p),
          crit: onBeat,
        })
        if (fired) firedCount = 1
      }
      if (firedCount > 0) {
        castComboOnLoose(this.castCombo, onBeat)
        feel.lastLooseKind = kind
        feel.castLooseCount++
        if (onBeat) feel.castLooseBeatCount++
        if (kind === 2) feel.castVolleyCount++
        if (kind === 3) feel.castStormCount++
        this.tricks.castRelease = 1
        this.boltSide = -this.boltSide
        if (kind === 0) {
          // quick loose: the release IS the shot
          this.tricks.snapBoost = Math.max(this.tricks.snapBoost, 0.5)
          this.punchCam(0.18, 0.22 * this.boltSide, 0.1)
          this.pendingBursts.push({ x: mx, y: my, z: mz, count: 8, style: BURST.MUZZLE })
          this.pendingBursts.push({ x: mx, y: my, z: mz, count: 6, style: BURST.CAST })
          sfxCastLoose(p, onBeat, comboTierNow)
        } else if (kind === 1) {
          // charged loose: bow recoil — boom lunge + FOV/CA lift, NO hit-stop
          // (a freeze at fire time reads as input lag)
          this.tricks.snapBoost = Math.max(this.tricks.snapBoost, 0.5 + 0.4 * p)
          this.punchCam(0.35 + 0.55 * p, (0.25 + 0.45 * p) * this.boltSide, 0.12 + 0.28 * p)
          triggerCombatImpact(0.3 + 0.5 * p, mx, my, mz)
          this.pendingBursts.push({
            x: mx,
            y: my,
            z: mz,
            count: 10 + Math.round(22 * p),
            style: BURST.CAST,
          })
          sfxCastLoose(p, onBeat, comboTierNow)
        } else if (kind === 2) {
          // volley: three heavy releases in one breath
          this.tricks.snapBoost = Math.max(this.tricks.snapBoost, 1)
          this.punchCam(1.0, 0.5 * this.boltSide, 0.5)
          triggerCombatImpact(0.9, mx, my, mz)
          this.pendingBursts.push({ x: mx, y: my, z: mz, count: 36, style: BURST.CAST })
          this.pendingBursts.push({ x: mx, y: my, z: mz, count: 12, style: BURST.MUZZLE })
          sfxCastVolley(onBeat, comboTierNow)
        } else {
          // storm: the sky opens. Still NO hit-stop at fire time.
          this.tricks.snapBoost = Math.max(this.tricks.snapBoost, 1)
          this.tricks.stormRelease = 1
          this.punchCam(0.8, 0.3 * this.boltSide, 0.45)
          triggerCombatImpact(1.1, mx, my, mz)
          this.fxPulse = Math.max(this.fxPulse, 0.8)
          this.pendingBursts.push({ x: mx, y: my, z: mz, count: 48, style: BURST.CAST })
          this.pendingBursts.push({ x: mx, y: my, z: mz, count: 20, style: BURST.MUZZLE })
          sfxCastStorm(onBeat)
        }
      }
    }
    // storm arming edge (streak or tier path) — one register per arming
    if (this.castCombo.stormArmed && !this.stormWasArmed) {
      feel.stormArmedCount++
      sfxStormArmed()
    }
    this.stormWasArmed = this.castCombo.stormArmed
    // the rising bow-creak loop tracks the draw; gain 0 tears it silent.
    // Overdraw strains the creak past the full-draw register.
    sfxDrawUpdate(
      cs.phase === CP.CHARGE ? cs.power : 0,
      cs.phase === CP.CHARGE ? cs.over : 0,
    )
    this.strikeHeat *= Math.exp(-4 * dt)
    if (this.strikeHeat < 1e-3) this.strikeHeat = 0
    // boltCharge = cast readiness (1 = ready to cast); every legacy boltGlow
    // consumer (HUD tick, muzzle ember) keeps its meaning
    combatSignals.boltCharge =
      cs.phase === CP.IDLE
        ? 1
        : cs.phase === CP.RECOVER
          ? Math.min(1, cs.t / recoverDuration(cs.power, runState.stats.castSpeedMult))
          : 0
    combatSignals.castCharge = cs.phase === CP.CHARGE ? cs.power : 0
    combatSignals.castPhase = cs.phase
    combatSignals.castOver = cs.phase === CP.CHARGE ? cs.over : 0
    combatSignals.castComboCount = this.castCombo.comboCount
    combatSignals.castComboTier = comboTierNow
    combatSignals.stormArmed = this.castCombo.stormArmed
    // anticipation/tension mirrors for the avatar layer
    this.tricks.castWindup =
      cs.phase === CP.WINDUP
        ? Math.min(1, cs.t / (COMBAT.cast.windup / Math.max(0.01, runState.stats.castSpeedMult)))
        : 0
    this.tricks.castCharge = cs.phase === CP.CHARGE ? cs.power : 0
    this.tricks.overdraw = cs.phase === CP.CHARGE ? cs.over : 0
    this.tricks.castRelease *= Math.exp(-6 * dt)
    if (this.tricks.castRelease < 1e-3) this.tricks.castRelease = 0
    this.tricks.fullPulse *= Math.exp(-8 * dt)
    if (this.tricks.fullPulse < 1e-3) this.tricks.fullPulse = 0
    this.tricks.volleyPulse *= Math.exp(-8 * dt)
    if (this.tricks.volleyPulse < 1e-3) this.tricks.volleyPulse = 0
    this.tricks.stormRelease *= Math.exp(-5 * dt)
    if (this.tricks.stormRelease < 1e-3) this.tricks.stormRelease = 0

    this.updateTricks(dt, t)
    this.writeCamera(dt, t, camera)
  }

  /** Flight envelopes + idle-flourish scheduling (visual layer signals —
   * only sprint feeds back into movement, via integrateMovement's caps). */
  private updateTricks(dt: number, t: number): void {
    const tk = this.tricks

    // sprint: double-tap-W intent, honored only while actually flying forward
    const sprintT =
      this.sprintHeld && (this.phase === 'idle' || this.phase === 'recover') ? 1 : 0
    if (sprintT > 0.5 && tk.sprint <= 0.1) sfxSprintStart() // engage exhale on the rising edge
    tk.sprint += (sprintT - tk.sprint) * (1 - Math.exp(-dt / (sprintT > tk.sprint ? 0.25 : 0.4)))

    // swoop flare: a committed dive, released back into level flight
    const vy = this.vel.y
    if (vy < -7.5) this.diveArmed = true
    else if (this.diveArmed && vy > -1.2) {
      this.diveArmed = false
      if (t - this.lastSwoopAt > 1.5) {
        this.lastSwoopAt = t
        tk.swoopPulse = 1
      }
    }
    tk.swoopPulse *= Math.exp(-3 * dt)
    if (tk.swoopPulse < 1e-3) tk.swoopPulse = 0

    // wing snap on a hard acceleration burst
    const speed = Math.hypot(this.vel.x, this.vel.y, this.vel.z)
    if (
      speed - this.prevSpeed > 13 * dt &&
      speed > 6 &&
      t - this.lastBoostAt > 0.8 &&
      this.phase === 'idle'
    ) {
      this.lastBoostAt = t
      tk.snapBoost = 1
    }
    this.prevSpeed = speed
    tk.snapBoost *= Math.exp(-3.5 * dt)
    if (tk.snapBoost < 1e-3) tk.snapBoost = 0

    // carve: sustained hard turning at speed banks the wings asymmetrically
    let yawDelta = (this.yaw - this.prevYawTrick) % (Math.PI * 2)
    if (yawDelta > Math.PI) yawDelta -= Math.PI * 2
    if (yawDelta < -Math.PI) yawDelta += Math.PI * 2
    this.prevYawTrick = this.yaw
    const yawRate = yawDelta / Math.max(1e-3, dt)
    this.yawRateSlew += (yawRate - this.yawRateSlew) * (1 - Math.exp(-dt / 0.18))
    const carveT = speed > 4 ? Math.min(1, Math.abs(this.yawRateSlew) / 2.2) : 0
    tk.carve += (carveT - tk.carve) * (1 - Math.exp(-dt / 0.25))
    if (Math.abs(this.yawRateSlew) > 0.2) tk.carveDir = Math.sign(this.yawRateSlew)

    // eagle soar: only FORWARD airspeed tips the avatar prone — strafing and
    // backpedaling stay upright, and snap phases pose themselves
    const fwdSpd =
      this.vel.x * this.forward.x + this.vel.y * this.forward.y + this.vel.z * this.forward.z
    const soarGate = this.phase === 'idle' || this.phase === 'recover'
    const soarLin = soarGate ? Math.min(1, Math.max(0, (fwdSpd - 3.5) / 6.5)) : 0
    const soarT = soarLin * soarLin * (3 - 2 * soarLin)
    tk.soar += (soarT - tk.soar) * (1 - Math.exp(-dt / (soarT > tk.soar ? 0.45 : 0.3)))
    const hSpd = Math.hypot(this.vel.x, this.vel.z)
    const climbT = Math.max(-1.1, Math.min(1.1, Math.atan2(this.vel.y, Math.max(1, hSpd))))
    tk.climb += (climbT - tk.climb) * (1 - Math.exp(-dt / 0.3))

    // idle flourishes: hover long enough and the seraph starts to preen
    const idle = this.phase === 'idle' && speed < 0.8
    if (idle) {
      tk.idleT += dt
      if (tk.flourish < 0 && tk.idleT >= this.nextFlourishAt) {
        tk.flourishCount++
        tk.flourish = hashInts(worldState.trackSeed, tk.flourishCount, 0xf10, 0) % 3
        tk.flourishDur = tk.flourish === 0 ? 1.7 : tk.flourish === 1 ? 0.9 : 1.4
        tk.flourishT = 0
      }
    } else {
      tk.idleT = 0
      if (speed > 1.5) tk.flourish = -1
    }
    if (tk.flourish >= 0) {
      tk.flourishT += dt
      if (tk.flourishT >= tk.flourishDur) {
        tk.flourish = -1
        this.nextFlourishAt =
          tk.idleT + 5 + (hashInts(worldState.trackSeed, tk.flourishCount, 0x51, 0) % 400) / 100
      }
    }
  }

  /** Debug hook: force the full shift sequence without snapping the gate. */
  forceShift(): void {
    if (this.phase === 'shift') return
    this.snapTargetIdx = TARGET_GATE
    this.beginShift()
  }

  private updateAim(): void {
    // camPos/camDist are last frame's (writeCamera runs after) — centimeters
    // of error at 60fps. In third person the aim origin is the camera so the
    // cone always matches the center reticle; minDist is inflated so nothing
    // between the camera and the body is targetable.
    const o = this.camPos
    this.aimCfg.minDist = AIM.minDist + this.camDist
    this.gateCfg.minDist = GATE_AIM.minDist + this.camDist
    this.enemyCfg.minDist = ENEMY_AIM.minDist + this.camDist
    this.wardenCfg.minDist = WARDEN_AIM.minDist + this.camDist
    const f = this.forward
    const r = pickPoolTarget(worldState.points, o.x, o.y, o.z, f.x, f.y, f.z, this.aimCfg)
    let target = r.index
    let angle = r.angle
    let dist = r.dist
    let score = r.score
    // Continuous hysteresis: whichever candidate is ALREADY held gets a
    // sticky bonus, so near-parity rivals can't flicker the lock per frame.
    if (r.index >= 0 && this.target === r.index) score *= AIM_HYST.stickyMult
    // Horrors outrank points at near-parity: combat beats collection under
    // the reticle, but a clearly better point still wins.
    const e = pickEnemyTarget(enemyState.pool, o.x, o.y, o.z, f.x, f.y, f.z, this.enemyCfg)
    let eScore = e.score
    if (e.index >= 0 && this.target === TARGET_ENEMY_BASE + e.index) eScore *= AIM_HYST.stickyMult
    if (e.index >= 0 && eScore * 1.15 >= score) {
      target = TARGET_ENEMY_BASE + e.index
      angle = e.angle
      dist = e.dist
      score = eScore
    }
    // The warden's OPEN weak point outranks the swarm — the fight-defining hit.
    weakPointTarget(weakScratch)
    if (weakScratch.open) {
      const w = pickGate(
        weakScratch.x,
        weakScratch.y,
        weakScratch.z,
        o.x,
        o.y,
        o.z,
        f.x,
        f.y,
        f.z,
        this.wardenCfg,
      )
      if (w.score > 0) {
        target = TARGET_WARDEN
        angle = w.angle
        dist = w.dist
        score = w.score
      }
    }
    // The gate outranks everything whenever it's in the (wider) cone —
    // unless its warden still lives (the gate is sealed). A sealed gate under
    // the reticle is no longer SILENT: the denied signal drives the SEALED
    // reticle state, with one toast per warden at the moment of intent.
    const gate = worldState.gate
    const gateReady = gate.active && gate.openT >= GATE_MIN_OPEN
    let denied = false
    if (gateReady && !wardenBlocksGate()) {
      const g = pickGate(gate.x, gate.y, gate.z, o.x, o.y, o.z, f.x, f.y, f.z, this.gateCfg)
      if (g.score > 0) {
        target = TARGET_GATE
        angle = g.angle
        dist = g.dist
        score = g.score
      }
    } else if (gateReady) {
      const g = pickGate(gate.x, gate.y, gate.z, o.x, o.y, o.z, f.x, f.y, f.z, this.gateCfg)
      if (g.score > 0) {
        denied = true
        if (this.deniedGateToastSerial !== enemyState.warden.serial) {
          this.deniedGateToastSerial = enemyState.warden.serial
          pushFeedback('THE GATE IS SEALED', 'FELL THE WARDEN', 'warn')
          sfxDenied()
        }
      }
    }
    feel.deniedGateAim = denied
    this.target = target
    this.targetAngle = angle
    this.targetDist = dist
    this.targetScore = target === -1 ? 0 : Math.min(1, score)
    if (
      target >= 0 &&
      target !== this.lastLockedTarget &&
      this.clockT - this.lastLockSfxAt > AIM_HYST.lockSfxCooldown
    ) {
      sfxLock()
      this.lastLockSfxAt = this.clockT
    }
    this.lastLockedTarget = target
  }

  private startSnap(): void {
    const idx = this.target
    if (idx === TARGET_GATE) {
      const g = worldState.gate
      if (!g.active) return
      this.snapPoint.set(g.x, g.y, g.z)
    } else if (idx === TARGET_WARDEN) {
      weakPointTarget(weakScratch)
      if (!weakScratch.open) return
      this.snapPoint.set(weakScratch.x, weakScratch.y, weakScratch.z)
    } else if (idx >= TARGET_ENEMY_BASE) {
      const e = idx - TARGET_ENEMY_BASE
      const pool = enemyState.pool
      this.snapPoint.set(pool.x[e], pool.y[e], pool.z[e])
      this.strikeIdx = e
      this.strikeSerial = pool.serial[e]
    } else {
      const p = worldState.points
      if (!p.active[idx]) return
      this.snapPoint.set(p.x[idx], p.y[idx], p.z[idx])
    }
    this.snapTargetIdx = idx
    this.snapFrom.copy(this.pos)
    this.approachDir.copy(this.snapPoint).sub(this.snapFrom).normalize()
    if (idx >= TARGET_ENEMY_BASE) {
      // strikes pass THROUGH the victim — momentum is the weapon
      const through = idx === TARGET_WARDEN ? COMBAT.strike.passThrough + 1 : COMBAT.strike.passThrough
      this.snapTo.copy(this.snapPoint).addScaledVector(this.approachDir, through)
      this.strikeHeat = 1
    } else {
      this.snapTo.copy(this.snapPoint).addScaledVector(this.approachDir, -2.5)
      this.snapTo.y += 1.2
    }
    this.streakPos.copy(this.pos)
    this.snapAimError = this.targetAngle
    // Scoring distance is from the BODY, not the camera — otherwise third
    // person would earn ~8 extra points per snap from the boom length.
    this.snapDist = this.pos.distanceTo(this.snapPoint)
    // Symmetric beat window: the offline grid credits anticipation (early
    // clicks), the onset path stays as the gridless fallback.
    this.snapOnBeat = isOnBeat(
      audioFrame.gridPhase,
      audioFrame.gridSpanSec,
      audioFrame.gridConfidence,
      audioFrame.timeSinceOnset,
    )
    this.target = -1
    this.targetScore = 0
    this.phase = 'streak'
    this.phaseT = 0
    sfxSnapLaunch()
  }

  private arrive(): void {
    const idx = this.snapTargetIdx
    const t = this.clockT
    collectPoint(idx, t)
    runState.collected++
    const chargeBefore = runState.shiftCharge
    runState.shiftCharge++
    runState.snaps++
    runState.lastActivation = { x: this.snapPoint.x, y: this.snapPoint.y, z: this.snapPoint.z, at: t }
    // the collect that arms the gate gets its own moment (HUD flash + charms)
    if (chargeBefore < runState.shiftCost && runState.shiftCharge >= runState.shiftCost) {
      feel.chargeFullCount++
    }

    const outcome = applySnap(
      runState.scoreState,
      { aimErrorRad: this.snapAimError, distance: this.snapDist, onBeat: this.snapOnBeat },
      audioFrame.time,
    )
    runState.scoreState = outcome.state
    if (outcome.tier === 'perfect') {
      runState.perfects++
      // flow play sustains: a perfect snap knits ~one gnaw tick of blood back
      healPlayer(PLAYER_HP.perfectHeal)
    } else if (outcome.tier === 'good') runState.goods++
    if (this.snapOnBeat) runState.onBeats++

    const title =
      outcome.tier === 'perfect' ? 'PERFECT' : outcome.tier === 'good' ? 'GOOD' : 'SNAP'
    pushFeedback(
      this.snapOnBeat ? `${title} · ON BEAT` : title,
      `+${outcome.gained}`,
      this.snapOnBeat ? 'beat' : outcome.tier,
    )
    if (outcome.tier === 'perfect' || outcome.tier === 'good') {
      sfxGradeConfirm(outcome.tier)
    }

    this.shockwave.x = this.snapPoint.x
    this.shockwave.y = this.snapPoint.y
    this.shockwave.z = this.snapPoint.z
    this.shockwave.t0 = t
    this.shockwave.strength = (0.6 + 0.4 * Math.min(2, audioFrame.onsetStrength)) * (this.snapOnBeat ? 1.5 : 1)
    this.shockwave.active = true
    this.pendingBursts.push({ x: this.snapPoint.x, y: this.snapPoint.y, z: this.snapPoint.z, count: 150, style: BURST.SOUL })
    this.fxPulse = 1
    this.addTrauma(0.5)
    this.vel.copy(this.approachDir).multiplyScalar(6)
    sfxImpact(this.snapOnBeat)
    sfxChime()

    // Charge complete -> the realm gate materializes ahead.
    if (runState.shiftCharge >= runState.shiftCost && !worldState.gate.active) {
      openGate(this.pos.x, this.pos.y, this.pos.z, this.forward.x, this.forward.z, t)
      const next = getRealmForDepth(worldState.depth + 1)
      pushFeedback('REALM GATE MATERIALIZED', next.realm.label, 'complete')
      sfxComplete()
    } else if (
      chargeBefore < runState.shiftCost &&
      runState.shiftCharge >= runState.shiftCost &&
      worldState.gate.active
    ) {
      // re-armed after a warden drained it below cost — previously silent
      pushFeedback('CHARGE RESTORED', 'SNAP THE GATE', 'complete')
      sfxComplete()
    }

    this.phase = 'recover'
    this.phaseT = 0
  }

  /** A loaded phoenix ash burns instead of the player falling. */
  private tryPhoenixAsh(t: number): boolean {
    for (let slot = 0; slot < 2; slot++) {
      const id = runState.loadout[slot]
      if (!id || runState.loadoutCharges[slot] < 1) continue
      if (getItem(id)?.effect !== 'autoRevive') continue
      runState.loadoutCharges[slot]--
      runState.consumablesUsed[slot]++
      releaseAllLatched(t, true)
      // the ash reknits flesh too: never revive below half the pool
      runState.hp = Math.max(runState.hp, reviveFloor())
      runState.activeEffects.veilT = Math.max(runState.activeEffects.veilT, 2)
      triggerBanishNova(1.2)
      this.pendingBursts.push({ x: this.pos.x, y: this.pos.y, z: this.pos.z, count: 200, style: BURST.STRIKE })
      this.fxPulse = 1
      this.addTrauma(0.55)
      pushFeedback('PHOENIX ASH', 'ONE MORE VERSE', 'complete')
      sfxChime()
      return true
    }
    return false
  }

  /** The sky lets go: latch overload drags you down, or the blood runs out. */
  private beginDowned(bled = false): void {
    this.phase = 'downed'
    this.phaseT = 0
    this.downedFired = false
    clearBuffer(this.snapBuf)
    clearBuffer(this.novaBuf)
    clearBuffer(this.castPressBuf)
    this.castHeld = false
    resetCast(this.cast)
    this.sprintHeld = false
    this.keys.clear()
    this.target = -1
    this.targetScore = 0
    this.fxPulse = 1
    this.addTrauma(1)
    if (bled) pushFeedback('YOUR LIGHT GIVES OUT', 'THE DEEP DRINKS THE LAST OF IT', 'downed')
    else pushFeedback('DRAGGED FROM THE SKY', 'THE SWARM TAKES YOU', 'downed')
    sfxDowned()
  }

  /** Snap-strike arrival: pass through the horror, tear the hit through it.
   * A kill is DIFFERENT from a chip hit now — freeze, lunge, lean, flash. */
  private arriveStrike(t: number): void {
    const isWarden = this.snapTargetIdx === TARGET_WARDEN
    const frenzy = runState.activeEffects.frenzyT > 0 ? 1.5 : 1
    const crit = this.snapOnBeat || this.snapAimError <= SCORING.perfectRad
    const dmg = snapStrikeDamage(
      this.snapAimError,
      SCORING.perfectRad,
      SCORING.goodRad,
      this.snapOnBeat,
      runState.stats.snapDamageMult * frenzy,
    )
    let hitCode: 0 | 1 | 2 = STRIKE_MISS
    if (isWarden) {
      weakPointTarget(weakScratch)
      if (weakScratch.open) {
        const precision =
          this.snapAimError <= SCORING.perfectRad ? 1.4 : this.snapAimError <= SCORING.goodRad ? 1.2 : 1
        const killed = applyWardenWeakHit(
          COMBAT.wardenWeakHit * runState.stats.snapDamageMult * frenzy * precision * (this.snapOnBeat ? 1.15 : 1),
          t,
          crit,
        )
        hitCode = killed ? STRIKE_KILL : 1
      }
    } else {
      hitCode = applySnapStrike(
        this.strikeIdx,
        this.strikeSerial,
        this.snapPoint.x,
        this.snapPoint.y,
        this.snapPoint.z,
        dmg,
        t,
        crit,
      )
    }
    this.strikeIdx = -1
    if (hitCode !== STRIKE_MISS) {
      // connected strikes feed the SAME chain as collecting — combat pays
      const outcome = applySnap(
        runState.scoreState,
        {
          aimErrorRad: this.snapAimError,
          distance: this.snapDist,
          onBeat: this.snapOnBeat,
          kind: 'strike',
        },
        audioFrame.time,
      )
      runState.scoreState = outcome.state
      if (this.snapOnBeat) runState.onBeats++
      // grade confirm mirrors the point-snap arrival (toastRules suppresses
      // these kinds from toasts — the HUD grade pop is the consumer)
      pushFeedback(
        this.snapOnBeat
          ? 'STRIKE · ON BEAT'
          : outcome.tier === 'perfect'
            ? 'PERFECT'
            : outcome.tier === 'good'
              ? 'GOOD'
              : 'STRIKE',
        `+${outcome.gained}`,
        this.snapOnBeat ? 'beat' : outcome.tier,
      )
      if (outcome.tier === 'perfect' || outcome.tier === 'good') {
        sfxGradeConfirm(outcome.tier)
      }
      // the g-force of the pass rips your oldest rider off
      tearOffOneLatch(t)
      this.shockwave.x = this.snapPoint.x
      this.shockwave.y = this.snapPoint.y
      this.shockwave.z = this.snapPoint.z
      this.shockwave.t0 = t
      this.shockwave.strength = 1.1 * (this.snapOnBeat ? 1.4 : 1)
      this.shockwave.active = true
      this.pendingBursts.push({
        x: this.snapPoint.x,
        y: this.snapPoint.y,
        z: this.snapPoint.z,
        count: isWarden ? 160 : 90,
        style: BURST.STRIKE,
      })
      this.fxPulse = 0.8
      const sign = this.strikeRollSign()
      if (isWarden) {
        // the fight-defining hit: the longest freeze in the game
        triggerHitStop(HITSTOP.wardenWeak)
        triggerCombatImpact(1.1, this.snapPoint.x, this.snapPoint.y, this.snapPoint.z)
        this.punchCam(1.2, CAM.rollWarden * sign, 0.85)
      } else if (hitCode === STRIKE_KILL) {
        triggerHitStop(HITSTOP.strikeKill)
        triggerCombatImpact(0.95, this.snapPoint.x, this.snapPoint.y, this.snapPoint.z)
        this.punchCam(1.0, CAM.rollStrike * sign, 0.75)
      } else {
        triggerHitStop(HITSTOP.strikeHit)
        triggerCombatImpact(0.35, this.snapPoint.x, this.snapPoint.y, this.snapPoint.z)
        this.punchCam(0.45, CAM.rollStrike * 0.6 * sign, 0.45)
      }
      // hot exit: faster than a point arrival, no hover pause — chain it
      this.vel.copy(this.approachDir).multiplyScalar(COMBAT.strike.exitSpeed)
      sfxEnemyHit()
      sfxImpact(this.snapOnBeat)
    } else {
      // the victim slipped the blow — failure is audible and visible now
      feel.whiffCount++
      sfxWhiff()
      this.addTrauma(0.12)
      pushFeedback('STRIKE LOST', 'IT SLIPPED THE BLOW', 'warn')
      this.vel.copy(this.approachDir).multiplyScalar(8)
    }
    this.phase = 'recover'
    this.phaseT = 0
  }

  /** Gate arrival: score the descent, fire the whiteout, lock input. */
  private beginShift(): void {
    const hot = visuals.w2 + visuals.w3 > 0.5
    const bonus = shiftBonus(worldState.depth, hot)
    runState.scoreState.score += bonus
    pushFeedback(hot ? 'REALM SHIFT · IN THE SURGE' : 'REALM SHIFT', `+${bonus}`, 'descent')
    triggerShiftBurst(1)
    sfxImpact(true)
    sfxChime()
    this.vel.set(0, 0, 0)
    this.addTrauma(0.55)
    this.fxPulse = 1
    this.swapDone = false
    this.phase = 'shift'
    this.phaseT = 0
  }

  /** The whiteout peak: regenerate the world one realm deeper, rebase origin. */
  private performSwap(t: number): void {
    this.swapDone = true
    performRealmSwap(t)
    // Origin rebase — yaw/pitch preserved so the hands stay continuous.
    this.pos.set(LAYOUT.spawn.x, LAYOUT.spawn.y, LAYOUT.spawn.z)
    this.vel.set(0, 0, 0)
    this.camAnchor.copy(this.pos)
    this.boomT = 1
    this.target = -1
    this.snapTargetIdx = -1
    runState.depth = worldState.depth
    runState.shiftCharge = 0
    runState.shiftCost = shiftCostForDepth(worldState.depth)
    runState.shiftsDone++
    // a new realm is a chapter reset: the blood pool refills with the charge —
    // the refill chime lands 0.4s later, just out of the whiteout
    runState.hp = runState.stats.maxHp
    sfxHpRefill(0.4)
    fxSignals.echoClear++ // flush afterimages of the dead realm
    visuals.skyFlash = visuals.rm ? 0.5 : 1 // the reveal starts from white
    const at = getRealmForDepth(worldState.depth)
    pushFeedback(`DEPTH ${worldState.depth + 1}`, at.realm.label, 'realm')
    if (worldState.depth + 1 > runState.bestDepthPrev && runState.bestDepthPrev > 0) {
      pushFeedback('NEW DEEPEST', `DEPTH ${worldState.depth + 1}`, 'descent')
    }
    sfxComplete()
    this.onDepthChange?.(worldState.depth)
  }

  private integrateMovement(dt: number): void {
    const keys = this.keys
    const fwdAmt = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0)
    const rightAmt = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0)
    const s = Math.sin(this.yaw)
    const c = Math.cos(this.yaw)
    let wx = -s * fwdAmt + c * rightAmt
    let wz = -c * fwdAmt - s * rightAmt
    const wl = Math.hypot(wx, wz)
    if (wl > 1) {
      wx /= wl
      wz /= wl
    }
    // latched horrors are dead weight: acceleration, sprint and the speed
    // ceiling all sag with the load — the readable death spiral
    const load = Math.min(1, latchLoad(runState.stats.maxLatch))
    // sprint: nearly double the airspeed while the intent holds
    const sprintK = this.tricks.sprint * (1 - load)
    // the archer plant: drawing the bow digs the heels in (x0.6 at full draw)
    const drawK = this.cast.phase === CP.CHARGE ? this.cast.power : 0
    const drawSlow = 1 - COMBAT.cast.moveSlowAtFull * drawK
    const accel =
      ACCEL * (1 + 0.7 * sprintK) * (1 - 0.45 * load) * runState.stats.moveMult * drawSlow
    this.vel.x += wx * accel * dt
    this.vel.z += wz * accel * dt

    // Low-gravity hover: realm-tuned sink, Space thrust, Shift dive
    let vy = worldState.modsCur.sinkRate
    if (keys.has('Space')) vy += 10
    if (keys.has('ShiftLeft') || keys.has('ShiftRight')) vy -= 8
    vy -= 6 * load // the riders drag you down

    this.vel.y += vy * dt

    // Soft hover spring above the nearest live island top
    let bestTop = -Infinity
    const slots = worldState.slots
    for (let i = 0; i < slots.length; i++) {
      const isl = slots[i]
      if (!isl.used) continue
      const dx = this.pos.x - isl.x
      const dz = this.pos.z - isl.z
      const rad = isl.scale * 1.2
      if (dx * dx + dz * dz > rad * rad) continue
      const top = isl.y + isl.scale * 0.9
      if (top < this.pos.y + 0.5 && top > bestTop) bestTop = top
    }
    if (bestTop > -Infinity) {
      const gap = this.pos.y - bestTop
      if (gap < 4) this.vel.y += (-20 * (gap - 2.2) - 8 * this.vel.y) * dt
    }

    // Drag — a sprinting raptor is streamlined, so the sprint also thins the
    // air: terminal speed ≈ accel/drag rises to ~2.3x cruise
    const dragH = Math.exp(-3.5 * (1 - 0.25 * sprintK) * dt)
    this.vel.x *= dragH
    this.vel.z *= dragH
    this.vel.y *= Math.exp(-2 * dt)

    // Clamp (sprint raises the ceiling smoothly; easing sprint off lets the
    // drag bleed the excess rather than snapping)
    const maxSp = MAX_SPEED * (1 + 0.95 * sprintK) * (1 - 0.4 * load) * drawSlow
    const hs = Math.hypot(this.vel.x, this.vel.z)
    if (hs > maxSp) {
      const f = maxSp / hs
      this.vel.x *= f
      this.vel.z *= f
    }
    this.vel.y = Math.max(-10, Math.min(10, this.vel.y))

    // The world is endless in XZ now — only the vertical band is sprung.
    if (this.pos.y < -35) this.vel.y += (-35 - this.pos.y) * 2 * dt
    if (this.pos.y > 55) this.vel.y -= (this.pos.y - 55) * 2 * dt

    this.pos.addScaledVector(this.vel, dt)
  }

  private writeCamera(dt: number, t: number, camera: PerspectiveCamera): void {
    // --- V-toggle blend; b == 0 reproduces the legacy first-person camera.
    // Downed forces third person: you watch your own body fall.
    const want = this.phase === 'downed' ? 1 : this.viewMode === 'third' ? 1 : 0
    this.viewBlend += (want - this.viewBlend) * (1 - Math.exp(-dt / BOOM.blendTau))
    if (Math.abs(this.viewBlend - want) < 0.001) this.viewBlend = want
    const b = this.viewBlend

    // --- positional anchor lag (rotation stays 1:1 with the mouse). Longer
    // tau during pull: the body is yanked and the camera whips after it.
    const tau =
      this.phase === 'pull' ? BOOM.tauPull : this.phase === 'streak' ? BOOM.tauStreak : BOOM.tauIdle
    this.camAnchor.lerp(this.pos, 1 - Math.exp(-dt / tau))
    const ex = this.pos.x + (this.camAnchor.x - this.pos.x) * b
    const ey = this.pos.y + (this.camAnchor.y - this.pos.y) * b
    const ez = this.pos.z + (this.camAnchor.z - this.pos.z) * b

    // --- boom target: pivot lift + shoulder offset, back along -forward.
    // boomPunch lunges the camera toward a kill (never past the occlusion
    // clamp below — it only ever SHORTENS the boom).
    this.boomPunch *= Math.exp(-8 * dt)
    if (this.boomPunch < 1e-3) this.boomPunch = 0
    const rx = Math.cos(this.yaw)
    const rz = -Math.sin(this.yaw)
    const px = ex + rx * BOOM.side * b
    const py = ey + BOOM.up * b
    const pz = ez + rz * BOOM.side * b
    const back = BOOM.back * b * (1 - CAM.boomPunchK * this.boomPunch)
    const wx = px - this.forward.x * back
    const wy = py - this.forward.y * back
    const wz = pz - this.forward.z * back

    // --- cheap island occlusion: shorten fast, relax slow
    const clear = b > 0.001 ? boomClearT(ex, ey, ez, wx, wy, wz, worldState.slots) : 1
    const kT =
      clear < this.boomT
        ? 1 - Math.exp(-dt / BOOM.occludeInTau)
        : 1 - Math.exp(-dt / BOOM.occludeOutTau)
    this.boomT += (clear - this.boomT) * kT
    let cx = ex + (wx - ex) * this.boomT
    let cy = ey + (wy - ey) * this.boomT
    let cz = ez + (wz - ez) * this.boomT
    const ddx = cx - this.pos.x
    const ddy = cy - this.pos.y
    const ddz = cz - this.pos.z
    this.camDist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz)

    // --- bass sway (both modes, unchanged from the original camera)
    const sway = audioFrame.bass * 0.05
    cx += Math.sin(t * 1.3) * sway
    cy += Math.sin(t * 2.1) * sway
    cz += Math.cos(t * 1.7) * sway
    // --- bass slam: heavy kicks land in the body too. vi-gated so SERENE
    // stays glassy; rm keeps the camera perfectly still.
    if (audioFrame.onset && !visuals.rm && visuals.vi >= 0.5) {
      this.trauma = Math.min(1, this.trauma + audioFrame.onsetStrength * 0.14 * visuals.vi)
    }
    camera.position.set(cx, cy, cz)
    this.camPos.set(cx, cy, cz)

    // --- trauma shake: amplitude = trauma^2 (energy reads as impact), four
    // incommensurate sines so it never loops visibly, monotone decay — every
    // event feeds ONE pool instead of fighting over a timer.
    this.trauma = Math.max(0, this.trauma - CAM.traumaDecay * dt)
    let rxr = this.pitch
    let ryr = this.yaw
    if (this.trauma > 0) {
      const a = this.trauma * this.trauma * CAM.shakeMax * (visuals.rm ? 0.5 : 1)
      rxr += (Math.sin(t * 50.3) * 0.6 + Math.sin(t * 33.7 + 2.1) * 0.4) * a
      ryr += (Math.sin(t * 47.1 + 1.7) * 0.6 + Math.sin(t * 61.7 + 0.6) * 0.4) * a
    }
    // --- camera roll: a damped spring the strikes lean on (the z slot was
    // hardcoded 0 since the barrel-roll purge — combat reclaims it gently)
    this.rollVel += (-CAM.rollK * this.camRoll - CAM.rollDamp * this.rollVel) * dt
    this.camRoll += this.rollVel * dt
    if (Math.abs(this.camRoll) < 1e-5 && Math.abs(this.rollVel) < 1e-4) {
      this.camRoll = 0
      this.rollVel = 0
    }
    camera.rotation.order = 'YXZ'
    camera.rotation.set(rxr, ryr, this.camRoll)

    // world breathing joins the idle FOV *target* — 10x smaller than the snap
    // kick, so the kick always wins instantly through the same spring.
    // Structural terms ride the same spring: dropFovPull narrows during the
    // pre-drop inhale, impactFov kicks wide on the drop (both pre-capped in
    // visualTuning, so the controller stays dumb).
    const targetFov =
      this.phase === 'pull' || this.phase === 'shift'
        ? BASE_FOV + (this.phase === 'shift' ? FOV_KICK * (1 - Math.min(1, this.phaseT / SHIFT_DUR)) : FOV_KICK)
        : this.phase === 'streak'
          ? BASE_FOV - 3
          : this.phase === 'downed'
            ? BASE_FOV - 8
            : BASE_FOV +
              visuals.fovBreathAmp * visuals.breath -
              visuals.dropFovPull +
              visuals.impactFov +
              this.tricks.soar * 3 +
              this.tricks.sprint * 4 -
              visuals.latchDread * 3 -
              visuals.castCharge * 2.5 // the draw pinch: sighting down the shot
    const tau2 = targetFov > this.fov ? CAM.fovRiseTau : CAM.fovFallTau
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt / tau2))
    if (Math.abs(camera.fov - this.fov) > 0.01) {
      camera.fov = this.fov
      camera.updateProjectionMatrix()
    }
  }
}

/** Shared scratch for the warden weak-point aim reads (zero-alloc). */
const weakScratch = { x: 0, y: 0, z: 0, open: false }

export const snapController = new SnapController()

/** Pointer lock with raw (unaccelerated) input where supported. */
export function requestLock(el: HTMLElement | null): void {
  if (!el || document.pointerLockElement === el) return
  try {
    const req = el.requestPointerLock as (options?: {
      unadjustedMovement?: boolean
    }) => Promise<void> | undefined
    const p = req.call(el, { unadjustedMovement: true })
    p?.catch?.(() => {
      try {
        el.requestPointerLock()
      } catch {
        // pointer lock unavailable — pause overlay lets the user retry
      }
    })
  } catch {
    try {
      el.requestPointerLock()
    } catch {
      // ignore
    }
  }
}
