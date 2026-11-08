import { useFrame } from '@react-three/fiber'
import { audioFrame } from '../audio/reactiveBus'
import {
  sfxBoltHit,
  sfxChargedImpact,
  sfxEnemyKill,
  sfxGnawTick,
  sfxLatch,
  sfxRite,
  sfxWardenHitPlayer,
} from '../audio/sfx'
import { stereoPanFor } from '../game/direction'
import {
  enemyState,
  releaseAllLatched,
  updateEnemies,
  WP,
  type EnemyDirectorInput,
} from '../game/enemyState'
import { CHARGED_HIT_DMG } from '../game/combat'
import { feel, HIT_RING_CAP, HK } from '../game/feelSignals'
import { HITSTOP, triggerHitStop, worldDt } from '../game/gameTime'
import { getItem } from '../game/items'
import { difficultyFromVisuals } from '../game/immersion'
import { tickPlayerRegen } from '../game/playerHealth'
import { pushFeedback, RITE_DURATION, runState } from '../game/runState'
import { useGameStore } from '../game/state'
import { BURST } from './burstVocab'
import { snapController } from './snapController'
import { combatSignals, triggerBanishNova, triggerCombatImpact, visuals } from './visualTuning'

/** Reused every frame — the input snapshot allocates once. */
const input: EnemyDirectorInput = {
  px: 0,
  py: 0,
  pz: 0,
  pvx: 0,
  pvy: 0,
  pvz: 0,
  fx: 0,
  fz: -1,
  tier: 0,
  tierFrom: 0,
  tierBlend: 1,
  beatPulse: 0,
  dropCount: 0,
  playerUntargetable: false,
  enemySpeedMult: 1,
  stats: runState.stats,
}

let lastPlayerHit = 0
let lastKills = 0
let lastLatches = 0
/** Feel-ring cursor for bolt/nova kill hit-stops (diffed, never callbacks). */
let lastHitSerial = 0

/**
 * The WorldStreamer twin for the horror layer: runs the enemy sim at priority
 * -80 (after world streaming, before the scene poses), feeds visualTuning's
 * combatSignals, ticks consumable auras, and delivers warden knockback into
 * the snap controller. Pure orchestration — all rules live in enemyState.
 */
export function EnemyDirector() {
  useFrame(({ clock }, rawDt) => {
    const { screen, started, paused } = useGameStore.getState()
    if (screen !== 'play' || !started || paused) return
    // WORLD dt: the whole sim (and its aura/regen clocks) freezes through a
    // hit-stop — that IS the crunch. Absolute t stays real.
    const dt = worldDt(rawDt)
    const t = clock.elapsedTime
    const sc = snapController

    // consumable aura timers burn down here (the sim reads their effects)
    const fx = runState.activeEffects
    if (fx.stasisT > 0) fx.stasisT = Math.max(0, fx.stasisT - dt)
    if (fx.veilT > 0) fx.veilT = Math.max(0, fx.veilT - dt)
    if (fx.frenzyT > 0) fx.frenzyT = Math.max(0, fx.frenzyT - dt)
    // delayed passive regen (opposes the gnaws, shares their clock)
    tickPlayerRegen(dt, t)

    // ---- consume a queued rite (keys 1/2 — the intent-flag pattern) ----
    const slot = sc.consumableQueued
    if (slot >= 0) {
      sc.consumableQueued = -1
      const id = runState.loadout[slot]
      const item = id ? getItem(id) : null
      if (!item?.effect || !id) {
        // empty slot — silence, the HUD socket already reads hollow
      } else if (runState.loadoutCharges[slot] < 1) {
        pushFeedback('RITE SPENT', item.name, 'warn')
      } else if (item.effect === 'autoRevive') {
        // passive: burns itself only at the moment of the fall
        pushFeedback('THE ASH SLEEPS', 'IT WAKES WHEN YOU FALL', 'warn')
      } else {
        let used = true
        switch (item.effect) {
          case 'purgeLatches': {
            const released = releaseAllLatched(t, true)
            triggerBanishNova(0.7)
            sc.pendingBursts.push({ x: sc.pos.x, y: sc.pos.y, z: sc.pos.z, count: 80, style: BURST.STRIKE })
            pushFeedback(item.name, released > 0 ? 'THE GRIP BREAKS' : 'NOTHING HELD YOU', 'complete')
            break
          }
          case 'stasisAura':
            fx.stasisT = RITE_DURATION.stasisAura
            pushFeedback(item.name, 'THE DEEP SLOWS TO READ IT', 'complete')
            break
          case 'veil':
            fx.veilT = RITE_DURATION.veil
            pushFeedback(item.name, 'BECOME WEATHER', 'complete')
            break
          case 'frenzy':
            fx.frenzyT = RITE_DURATION.frenzy
            pushFeedback(item.name, 'BOTTLED HUNGER, UNCORKED', 'complete')
            break
          case 'overcharge':
            runState.shiftCharge += runState.shiftCost * 0.5
            pushFeedback(item.name, 'THE GATE LEANS CLOSER', 'complete')
            break
          default:
            used = false
        }
        if (used) {
          runState.loadoutCharges[slot]--
          runState.consumablesUsed[slot]++
          sfxRite(item.effect)
        }
      }
    }

    input.px = sc.pos.x
    input.py = sc.pos.y
    input.pz = sc.pos.z
    input.pvx = sc.vel.x
    input.pvy = sc.vel.y
    input.pvz = sc.vel.z
    const fl = Math.hypot(sc.forward.x, sc.forward.z) || 1
    input.fx = sc.forward.x / fl
    input.fz = sc.forward.z / fl
    input.tier = audioFrame.tier
    input.tierFrom = audioFrame.tierFrom
    input.tierBlend = audioFrame.tierBlend
    input.beatPulse = visuals.beatPulse
    input.dropCount = audioFrame.dropCommitCount
    // any non-flying phase (streak/pull/shift/downed) or an active veil rite
    input.playerUntargetable =
      (sc.phase !== 'idle' && sc.phase !== 'recover') || fx.veilT > 0
    input.enemySpeedMult = fx.stasisT > 0 ? 0.35 : 1
    // VISUALS doubles as the difficulty dial: HARD/EXTREME realms push back.
    input.difficultyMult = difficultyFromVisuals(visuals.vi)
    input.stats = runState.stats

    updateEnemies(dt, t, input)

    // ---- warden knockback lands on the player (sim never touches scene) ----
    const es = enemyState
    if (es.playerKnockX !== 0 || es.playerKnockY !== 0 || es.playerKnockZ !== 0) {
      sc.vel.x += es.playerKnockX
      sc.vel.y += es.playerKnockY
      sc.vel.z += es.playerKnockZ
      es.playerKnockX = es.playerKnockY = es.playerKnockZ = 0
    }
    if (es.playerHitCount !== lastPlayerHit) {
      lastPlayerHit = es.playerHitCount
      sc.addTrauma(0.7)
      sc.fxPulse = Math.max(sc.fxPulse, 0.9)
      triggerCombatImpact(0.6, sc.pos.x, sc.pos.y, sc.pos.z)
      // the blow lands audibly, panned from the warden's true bearing
      sfxWardenHitPlayer(stereoPanFor(es.warden.x - sc.pos.x, es.warden.z - sc.pos.z, sc.yaw))
    }
    // counter-diffed combat audio (kills may come from bolts, not just strikes)
    const c = runState.combat
    if (c.kills !== lastKills) {
      if (c.kills > lastKills) sfxEnemyKill()
      lastKills = c.kills
    }
    if (c.latchesSuffered !== lastLatches) {
      if (c.latchesSuffered > lastLatches) sfxLatch()
      lastLatches = c.latchesSuffered
    }
    // bolt/nova KILLS earn their own micro-freeze (strike kills already fire
    // theirs at arrival), and every bolt CONNECT gets a panned tick + sparks —
    // the stream finally reads as a weapon. Ring-diffed; backlog clamped to
    // the ring size, serial-guarded against slot overwrite.
    if (feel.hitSerial !== lastHitSerial) {
      const from = Math.max(lastHitSerial, feel.hitSerial - HIT_RING_CAP)
      for (let s2 = from + 1; s2 <= feel.hitSerial; s2++) {
        const e = feel.hitRing[s2 % HIT_RING_CAP]
        if (e.serial !== s2) continue
        // a charged-cast connect crosses the shared damage threshold and earns
        // the heavier tier: longer freeze, ember burst, deeper panned thud
        const charged = e.kind === HK.BOLT && e.amount >= CHARGED_HIT_DMG
        if (e.kill === 1 && (e.kind === HK.BOLT || e.kind === HK.NOVA)) {
          triggerHitStop(charged ? HITSTOP.chargedKill : HITSTOP.boltKill)
        } else if (charged) {
          triggerHitStop(HITSTOP.chargedHit)
        }
        if (e.kind === HK.BOLT) {
          if (charged) {
            sfxChargedImpact(stereoPanFor(e.x - sc.pos.x, e.z - sc.pos.z, sc.yaw))
            sc.pendingBursts.push({ x: e.x, y: e.y, z: e.z, count: 30, style: BURST.CHARGED_IMPACT })
            triggerCombatImpact(0.7, e.x, e.y, e.z)
            if (e.kill === 1) {
              sc.pendingBursts.push({ x: e.x, y: e.y, z: e.z, count: 26, style: BURST.KILL })
            }
          } else if (e.kill === 1) {
            sc.pendingBursts.push({ x: e.x, y: e.y, z: e.z, count: 26, style: BURST.KILL })
          } else {
            sfxBoltHit(stereoPanFor(e.x - sc.pos.x, e.z - sc.pos.z, sc.yaw))
            sc.pendingBursts.push({ x: e.x, y: e.y, z: e.z, count: 14, style: BURST.BOLT_HIT })
          }
        } else if (e.kind === HK.LATCH_GNAW) {
          // each rider's bite ticks discretely over the gnaw bed
          sfxGnawTick()
        }
      }
      lastHitSerial = feel.hitSerial
    }

    // ---- feed the centralized visual layer ----
    const w = es.warden
    combatSignals.latchedCount = es.latchedCount
    combatSignals.maxLatch = runState.stats.maxLatch
    combatSignals.hpFrac = runState.hp / Math.max(1, runState.stats.maxHp)
    combatSignals.downed = sc.phase === 'downed'
    combatSignals.wardenAlive = w.active && w.phase !== WP.DEAD && w.phase !== WP.DORMANT
    if (combatSignals.wardenAlive) {
      const dx = w.x - sc.pos.x
      const dy = w.y - sc.pos.y
      const dz = w.z - sc.pos.z
      combatSignals.wardenDist = Math.sqrt(dx * dx + dy * dy + dz * dz)
      combatSignals.wardenTelegraph = w.telegraphT
    } else {
      combatSignals.wardenDist = 999
      combatSignals.wardenTelegraph = 0
    }
  }, -80)
  return null
}
