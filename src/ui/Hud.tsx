import { useEffect, useMemo, useRef } from 'react'
import { audioFrame } from '../audio/reactiveBus'
import { alignmentQuality } from '../game/aim'
import { CAST_COMBO } from '../game/castCombo'
import { describeEffect } from '../game/describe'
import { edgeClamp, screenAngleFor, type EdgeOut } from '../game/direction'
import { WARDEN_ARCHETYPES } from '../game/enemyArchetypes'
import { enemyState, ES, WP } from '../game/enemyState'
import { feel, HIT_RING_CAP, HK } from '../game/feelSignals'
import { getItem } from '../game/items'
import { getRealmForDepth } from '../game/realms'
import { RITE_DURATION, runState } from '../game/runState'
import { SCORING } from '../game/scoring'
import { worldState } from '../game/worldState'
import { hudProjection, makeScreenPoint, projectToScreen } from '../scene/hudProjection'
import { snapController } from '../scene/snapController'
import { combatSignals, visuals } from '../scene/visualTuning'
import { runeMaskStyle } from './fx/menuGlyphs'
import { makeBubbleLayer } from './hud/damageBubbles'
import { coneHalfFor, reticleKindFor, type ReticleKind } from './hud/reticleState'
import { makeToastState, updateToasts } from './hud/toastRules'

const RAD2DEG = 57.29578

/**
 * The combat-readability HUD. Still the house pattern — zero React state
 * after mount, one rAF mutating refs — but now with two lanes: a per-frame
 * lane for the reticle/hitmarkers/damage bubbles/threat markers (feel is
 * latency), and a 33ms-throttled lane for bars, toasts, the score cluster
 * and the objective strip (readability is cadence). The diegetic world
 * readouts all remain; this layer is the exact-numbers supplement the horror
 * combat earned. Live numbers for verification: window.__run/__enemies/__feel
 * (?debug).
 */
export function Hud() {
  // reticle cluster
  const retRef = useRef<HTMLDivElement>(null)
  const bracketsRef = useRef<HTMLDivElement>(null)
  const hitmarkRef = useRef<HTMLDivElement>(null)
  const retBoltFillRef = useRef<HTMLDivElement>(null)
  const retDrawRef = useRef<HTMLDivElement>(null)
  const gradePopRef = useRef<HTMLDivElement>(null)
  // bow combo widget (below the bolt tick)
  const comboRef = useRef<HTMLDivElement>(null)
  const comboNumRef = useRef<HTMLSpanElement>(null)
  const comboFuseRef = useRef<HTMLDivElement>(null)
  // hp bar
  const hpWrapRef = useRef<HTMLDivElement>(null)
  const hpFillRef = useRef<HTMLDivElement>(null)
  const hpGhostRef = useRef<HTMLDivElement>(null)
  const hpNumRef = useRef<HTMLSpanElement>(null)
  // boss bar
  const bossRef = useRef<HTMLDivElement>(null)
  const bossNameRef = useRef<HTMLDivElement>(null)
  const bossFillRef = useRef<HTMLDivElement>(null)
  const bossGhostRef = useRef<HTMLDivElement>(null)
  const bossTeleRef = useRef<HTMLDivElement>(null)
  const bossStateRef = useRef<HTMLDivElement>(null)
  const bossStrikeRef = useRef<HTMLDivElement>(null)
  const weakMarkRef = useRef<HTMLDivElement>(null)
  // toasts + objective strip + bubbles
  const toastRefs = useRef<(HTMLDivElement | null)[]>([])
  const objRef = useRef<HTMLDivElement>(null)
  const objLine1Ref = useRef<HTMLDivElement>(null)
  const objLine2Ref = useRef<HTMLSpanElement>(null)
  const objBarRef = useRef<HTMLDivElement>(null)
  const dmgLayerRef = useRef<HTMLDivElement>(null)
  // score cluster (top-right)
  const scoreWrapRef = useRef<HTMLDivElement>(null)
  const scoreNumRef = useRef<HTMLSpanElement>(null)
  const multChipRef = useRef<HTMLSpanElement>(null)
  const chainNumRef = useRef<HTMLSpanElement>(null)
  const decayFillRef = useRef<HTMLDivElement>(null)
  // directional threat layers
  const arcRefs = useRef<(HTMLDivElement | null)[]>([])
  const arrowRefs = useRef<(HTMLDivElement | null)[]>([])
  // legacy pair
  const riteRefs = useRef<(HTMLSpanElement | null)[]>([])
  const riteTimerRefs = useRef<(HTMLDivElement | null)[]>([])
  const latchRefs = useRef<(HTMLSpanElement | null)[]>([])
  const latchWrapRef = useRef<HTMLDivElement>(null)

  // fixed per run: snapshot once at mount
  const loadout = useMemo(
    () =>
      runState.loadout.map(id => {
        const item = id ? getItem(id) : null
        return item ? { glyph: item.glyph, name: item.name, effect: item.effect ?? null } : null
      }),
    [],
  )
  const maxLatch = useMemo(() => runState.stats.maxLatch, [])
  const anyRites = loadout.some(Boolean)

  useEffect(() => {
    const dmgRoot = dmgLayerRef.current
    if (!dmgRoot) return
    const bubbles = makeBubbleLayer(dmgRoot)
    const newestFeedback =
      runState.feedback.length > 0 ? runState.feedback[runState.feedback.length - 1].id : -1
    const toasts = makeToastState(newestFeedback)
    const weakPt = makeScreenPoint()
    const threatPt = makeScreenPoint()
    const edge: EdgeOut = { x: 0, y: 0, edge: false }
    /** Remaining seconds for a timed rite effect (0 for instants). */
    const remainingFor = (eff: string | null): number => {
      const a = runState.activeEffects
      return eff === 'stasisAura' ? a.stasisT : eff === 'veil' ? a.veilT : eff === 'frenzy' ? a.frenzyT : 0
    }
    const st = {
      last: 0,
      // reticle
      kind: 'none' as ReticleKind,
      band: 'lock' as string,
      bracketScale: -1,
      perfectFlashUntil: 0,
      boltShown: -1,
      boltReady: false,
      drawShown: -1,
      drawFull: false,
      lastCastLoose: feel.castLooseCount,
      lastCastLooseBeat: feel.castLooseBeatCount,
      looseFlashUntil: 0,
      sprintOn: false,
      // bow: overdraw ring, storm state, combo widget
      overShown: -1,
      overdrawOn: false,
      volleyArmed: false,
      stormOn: false,
      lastStormArmed: feel.stormArmedCount,
      stormFlashUntil: 0,
      comboShown: -1,
      comboTierShown: 0,
      comboAwake: false,
      comboFuseShown: -1,
      lastComboTierCount: feel.castComboTierCount,
      tierFlashUntil: 0,
      lastComboBreak: feel.castComboBreakCount,
      brokeFlashUntil: 0,
      // hitmarker + grade pop
      lastHitSerial: feel.hitSerial,
      hitmarkUntil: 0,
      gradeSeenId: newestFeedback,
      gradeUntil: 0,
      // directional damage arcs (2-slot pool)
      arcUntil: [0, 0],
      arcCursor: 0,
      // threat arrows shown flags (3 swarm + 1 warden)
      arrowOn: [false, false, false, false],
      // hp
      shownHp: -1,
      ghostHp: runState.hp,
      lastHp: runState.hp,
      lastDamageWallMs: -1e9,
      hpFlashUntil: 0,
      gnawFlashUntil: 0,
      healSweepUntil: -1e9,
      // boss
      bossSerial: -1,
      bossGhost: 1,
      bossShownName: '',
      bossState: '',
      bossVisible: false,
      bossExposed: false,
      bossDyingAtMs: -1e9,
      // objective
      objLine1: '',
      objLine2: '',
      objMode: '',
      lastChargeDrained: 0,
      drainFlashUntil: 0,
      lastGateOpenedAt: 0,
      sweepUntil: 0,
      chargeFullSeen: feel.chargeFullCount,
      chargeFlashUntil: 0,
      // score cluster
      scoreShown: 0,
      scoreText: '',
      multShown: 1,
      multText: '',
      multPulseUntil: 0,
      chainText: '',
      decayShown: -1,
      decayOn: false,
      scoreAwake: false,
      // latches
      heavyOn: false,
      prevMs: performance.now(),
    }

    let raf = 0
    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick)
      const sc = snapController
      const dtMs = Math.min(100, ts - st.prevMs)
      st.prevMs = ts

      // ================= 60 Hz lane: reticle / hitmarker / bubbles ==========
      const ret = retRef.current
      if (ret) {
        const inAction = sc.phase === 'shift' || sc.phase === 'downed'
        ret.classList.toggle('hidden', inAction)
        if (!inAction) {
          const kind = reticleKindFor(sc.target, feel.deniedGateAim)
          if (kind !== st.kind) {
            ret.classList.remove(`rk-${st.kind}`)
            ret.classList.add(`rk-${kind}`)
            st.kind = kind
          }
          const brackets = bracketsRef.current
          if (brackets) {
            if (kind === 'none' || kind === 'sealed') {
              if (st.bracketScale !== -1) {
                brackets.style.transform = 'scale(1.7)'
                brackets.style.opacity = kind === 'sealed' ? '0.55' : '0'
                st.bracketScale = -1
              }
            } else {
              const aq = alignmentQuality(
                sc.targetAngle,
                coneHalfFor(kind),
                SCORING.perfectRad,
                SCORING.goodRad,
              )
              // the draw tightens the brackets — sighting down the shot
              const scale = (1 + 0.55 * (1 - aq.q)) * (1 - 0.18 * visuals.castCharge)
              if (Math.abs(scale - st.bracketScale) > 0.008) {
                brackets.style.transform = `scale(${scale.toFixed(3)})`
                brackets.style.opacity = '1'
                st.bracketScale = scale
              }
              // one-shot gold pop the instant the perfect band arms
              if (aq.band === 'perfect' && st.band !== 'perfect') {
                ret.classList.add('ret-perfect')
                st.perfectFlashUntil = ts + 260
              }
              st.band = aq.band
            }
          }
          if (st.perfectFlashUntil > 0 && ts > st.perfectFlashUntil) {
            ret.classList.remove('ret-perfect')
            st.perfectFlashUntil = 0
          }
        }
        // bolt charge tick: the RMB cadence made visible under the crosshair
        const boltFill = retBoltFillRef.current
        if (boltFill) {
          const bg = visuals.boltGlow
          if (Math.abs(bg - st.boltShown) > 0.01) {
            boltFill.style.transform = `scaleX(${bg.toFixed(3)})`
            st.boltShown = bg
          }
          const ready = bg >= 0.999
          if (ready !== st.boltReady) {
            ret.classList.toggle('bolt-ready', ready)
            st.boltReady = ready
          }
        }
        // draw ring: conic fill around the brackets tracks the bow tension.
        // The smoothed fill reads visuals (rm-capped by design); the STATE
        // classes read combatSignals raw — under reduced motion the capped
        // visual could never reach the full/overdraw thresholds.
        const drawRing = retDrawRef.current
        if (drawRing) {
          const dc = visuals.castCharge
          if (Math.abs(dc - st.drawShown) > 0.01 || (dc <= 0.01 && st.drawShown !== 0)) {
            drawRing.style.setProperty('--draw', dc <= 0.01 ? '0' : dc.toFixed(3))
            st.drawShown = dc <= 0.01 ? 0 : dc
          }
          const full = combatSignals.castCharge >= 0.985
          if (full !== st.drawFull) {
            ret.classList.toggle('draw-full', full)
            st.drawFull = full
          }
          // overdraw: the ring shifts hue and grows the three volley notches
          const over = combatSignals.castOver
          const overdrawing = over > 0.01
          if (overdrawing !== st.overdrawOn) {
            ret.classList.toggle('overdrawing', overdrawing)
            st.overdrawOn = overdrawing
          }
          const overShown = overdrawing ? over : 0
          if (Math.abs(overShown - st.overShown) > 0.01 || (overShown === 0 && st.overShown !== 0)) {
            drawRing.style.setProperty('--over', overShown.toFixed(3))
            st.overShown = overShown
          }
          const volleyArmed = over >= 0.999
          if (volleyArmed !== st.volleyArmed) {
            ret.classList.toggle('volley-armed', volleyArmed)
            st.volleyArmed = volleyArmed
          }
        }
        // storm-armed: gold underglow while banked, one-shot flash on arming
        const stormOn = combatSignals.stormArmed
        if (stormOn !== st.stormOn) {
          ret.classList.toggle('storm-armed', stormOn)
          st.stormOn = stormOn
        }
        if (feel.stormArmedCount !== st.lastStormArmed) {
          st.lastStormArmed = feel.stormArmedCount
          ret.classList.remove('storm-arm-flash')
          void ret.offsetWidth
          ret.classList.add('storm-arm-flash')
          st.stormFlashUntil = ts + 420
        }
        if (st.stormFlashUntil > 0 && ts > st.stormFlashUntil) {
          ret.classList.remove('storm-arm-flash')
          st.stormFlashUntil = 0
        }
        // loose flash: white tick per cast, gold on the beat, triple tick on
        // a volley, the big gold-violet bloom on a storm
        if (feel.castLooseCount !== st.lastCastLoose) {
          const onBeat = feel.castLooseBeatCount !== st.lastCastLooseBeat
          st.lastCastLoose = feel.castLooseCount
          st.lastCastLooseBeat = feel.castLooseBeatCount
          ret.classList.remove('ret-loose', 'ret-loose-beat', 'ret-loose-volley', 'ret-loose-storm')
          void ret.offsetWidth // restart the CSS animation
          const lk = feel.lastLooseKind
          ret.classList.add(
            lk === 3
              ? 'ret-loose-storm'
              : lk === 2
                ? 'ret-loose-volley'
                : onBeat
                  ? 'ret-loose-beat'
                  : 'ret-loose',
          )
          st.looseFlashUntil = ts + (lk === 3 ? 340 : 260)
        }
        if (st.looseFlashUntil > 0 && ts > st.looseFlashUntil) {
          ret.classList.remove('ret-loose', 'ret-loose-beat', 'ret-loose-volley', 'ret-loose-storm')
          st.looseFlashUntil = 0
        }
        // bow combo widget: hit count + tier pips + decay fuse
        const comboWrap = comboRef.current
        if (comboWrap) {
          const count = combatSignals.castComboCount
          const tier = combatSignals.castComboTier
          const awake = count > 0
          if (awake !== st.comboAwake) {
            comboWrap.classList.toggle('combo-awake', awake)
            st.comboAwake = awake
          }
          if (count !== st.comboShown) {
            const numEl = comboNumRef.current
            if (numEl) numEl.textContent = String(count)
            st.comboShown = count
          }
          if (tier !== st.comboTierShown) {
            if (st.comboTierShown > 0) comboWrap.classList.remove(`ct-${st.comboTierShown}`)
            if (tier > 0) comboWrap.classList.add(`ct-${tier}`)
            st.comboTierShown = tier
          }
          if (feel.castComboTierCount !== st.lastComboTierCount) {
            st.lastComboTierCount = feel.castComboTierCount
            comboWrap.classList.remove('tier-flash')
            void comboWrap.offsetWidth
            comboWrap.classList.add('tier-flash')
            st.tierFlashUntil = ts + 420
          }
          if (st.tierFlashUntil > 0 && ts > st.tierFlashUntil) {
            comboWrap.classList.remove('tier-flash')
            st.tierFlashUntil = 0
          }
          if (feel.castComboBreakCount !== st.lastComboBreak) {
            st.lastComboBreak = feel.castComboBreakCount
            comboWrap.classList.remove('combo-broke')
            void comboWrap.offsetWidth
            comboWrap.classList.add('combo-broke')
            st.brokeFlashUntil = ts + 340
          }
          if (st.brokeFlashUntil > 0 && ts > st.brokeFlashUntil) {
            comboWrap.classList.remove('combo-broke')
            st.brokeFlashUntil = 0
          }
          const fuse = awake
            ? Math.max(
                0,
                Math.min(
                  1,
                  1 - (audioFrame.time - sc.castCombo.lastHitAt) / CAST_COMBO.windowSec,
                ),
              )
            : 0
          if (Math.abs(fuse - st.comboFuseShown) > 0.01) {
            const fuseEl = comboFuseRef.current
            if (fuseEl) fuseEl.style.transform = `scaleX(${fuse.toFixed(3)})`
            st.comboFuseShown = fuse
          }
        }
        // sprint widens the brackets (transition-only CSS — rm safe)
        const sprinting = sc.tricks.sprint > 0.5
        if (sprinting !== st.sprintOn) {
          ret.classList.toggle('ret-sprint', sprinting)
          st.sprintOn = sprinting
        }
      }
      // hitmarker + directional damage: dealt/taken ring diff
      if (feel.hitSerial !== st.lastHitSerial) {
        const from = Math.max(st.lastHitSerial, feel.hitSerial - HIT_RING_CAP)
        let flash = 0 // 1 hit, 2 crit, 3 kill, 4 warden kill
        for (let s = from + 1; s <= feel.hitSerial; s++) {
          const e = feel.hitRing[s % HIT_RING_CAP]
          if (e.serial !== s) continue
          if (e.kind === HK.PLAYER_TAKEN || e.kind === HK.LATCH_GNAW) {
            st.hpFlashUntil = ts + 150
            if (e.kind === HK.LATCH_GNAW) st.gnawFlashUntil = ts + 160
            else {
              // warden blow: red wedge rotated at the attacker's bearing
              // (kinds-4 event position IS the damage source)
              const a = st.arcCursor
              st.arcCursor = (a + 1) % 2
              const arc = arcRefs.current[a]
              if (arc) {
                const th = screenAngleFor(e.x - sc.pos.x, e.z - sc.pos.z, sc.yaw)
                arc.style.transform = `rotate(${(th * RAD2DEG).toFixed(1)}deg)`
                arc.classList.add('show')
                st.arcUntil[a] = ts + 650
              }
            }
            continue
          }
          flash = Math.max(
            flash,
            e.kill === 1 && e.targetId === 300 ? 4 : e.kill === 1 ? 3 : e.crit === 1 ? 2 : 1,
          )
        }
        st.lastHitSerial = feel.hitSerial
        const hm = hitmarkRef.current
        if (hm && flash > 0) {
          hm.className = `hitmark show${flash >= 4 ? ' kill warden' : flash === 3 ? ' kill' : flash === 2 ? ' crit' : ''}`
          st.hitmarkUntil = ts + (flash >= 4 ? 320 : flash === 3 ? 260 : 130)
        }
      }
      if (st.hitmarkUntil > 0 && ts > st.hitmarkUntil) {
        if (hitmarkRef.current) hitmarkRef.current.className = 'hitmark'
        st.hitmarkUntil = 0
      }
      for (let a = 0; a < 2; a++) {
        if (st.arcUntil[a] > 0 && ts > st.arcUntil[a]) {
          arcRefs.current[a]?.classList.remove('show')
          st.arcUntil[a] = 0
        }
      }
      // grade pop: PERFECT / GOOD / ON BEAT exactly at snap arrival
      const fb = runState.feedback
      if (fb.length > 0 && fb[fb.length - 1].id > st.gradeSeenId) {
        for (let i = 0; i < fb.length; i++) {
          const m = fb[i]
          if (m.id <= st.gradeSeenId) continue
          if (m.kind === 'perfect' || m.kind === 'good' || m.kind === 'beat') {
            const gp = gradePopRef.current
            if (gp) {
              gp.textContent = m.kind === 'beat' ? 'ON BEAT' : m.kind === 'perfect' ? 'PERFECT' : 'GOOD'
              gp.className = `grade-pop show g-${m.kind}`
              st.gradeUntil = ts + 420
            }
          }
        }
        st.gradeSeenId = fb[fb.length - 1].id
      }
      if (st.gradeUntil > 0 && ts > st.gradeUntil) {
        if (gradePopRef.current) gradePopRef.current.className = 'grade-pop'
        st.gradeUntil = 0
      }
      bubbles.update(ts)
      // warden weak-point marker: the one continuously projected element
      const w = enemyState.warden
      const wm = weakMarkRef.current
      if (wm) {
        const showWeak = w.active && w.weakOpen && w.phase !== WP.DEAD
        if (showWeak) {
          projectToScreen(hudProjection.m, w.weakX, w.weakY, w.weakZ, hudProjection.vw, hudProjection.vh, weakPt)
          if (weakPt.visible) {
            wm.style.transform = `translate3d(${Math.round(weakPt.x)}px, ${Math.round(weakPt.y)}px, 0)`
          }
          wm.classList.toggle('show', weakPt.visible)
        } else wm.classList.remove('show')
      }
      // off-screen threat chevrons: an unseen windup/leap must still read.
      // Swarm slots ride a bearing ring; the warden slot clamps its true
      // projection into the padded rect (falls back to the ring when behind).
      const pool = enemyState.pool
      const vw = hudProjection.vw
      const vh = hudProjection.vh
      const ringR = Math.min(vw, vh) * 0.42
      let ai = 0
      for (let i = 0; i < pool.state.length && ai < 3; i++) {
        const es2 = pool.state[i]
        if (es2 !== ES.WINDUP && es2 !== ES.LEAP) continue
        projectToScreen(hudProjection.m, pool.x[i], pool.y[i], pool.z[i], vw, vh, threatPt)
        if (threatPt.visible) continue // on-screen: the ignition crawl reads
        const el = arrowRefs.current[ai]
        if (el) {
          const th = screenAngleFor(pool.x[i] - sc.pos.x, pool.z[i] - sc.pos.z, sc.yaw)
          const ax = vw / 2 + Math.sin(th) * ringR
          const ay = vh / 2 - Math.cos(th) * ringR
          el.style.transform = `translate3d(${Math.round(ax)}px, ${Math.round(ay)}px, 0) rotate(${(th * RAD2DEG).toFixed(1)}deg)`
          el.className = `threat-arrow show${es2 === ES.LEAP ? ' t-leap' : ''}`
          st.arrowOn[ai] = true
        }
        ai++
      }
      for (; ai < 3; ai++) {
        if (st.arrowOn[ai]) {
          arrowRefs.current[ai]?.classList.remove('show')
          st.arrowOn[ai] = false
        }
      }
      let wardenArrow = false
      if (w.active && w.phase !== WP.DEAD && w.phase !== WP.DORMANT && w.telegraphT > 0.15) {
        projectToScreen(hudProjection.m, w.x, w.y, w.z, vw, vh, threatPt)
        if (!threatPt.visible) {
          const el = arrowRefs.current[3]
          if (el) {
            const th = screenAngleFor(w.x - sc.pos.x, w.z - sc.pos.z, sc.yaw)
            let ax: number
            let ay: number
            if (threatPt.depth > 0) {
              edgeClamp((threatPt.x / vw) * 2 - 1, 1 - (threatPt.y / vh) * 2, 0.14, edge)
              ax = (edge.x * 0.5 + 0.5) * vw
              ay = (1 - (edge.y * 0.5 + 0.5)) * vh
            } else {
              ax = vw / 2 + Math.sin(th) * ringR
              ay = vh / 2 - Math.cos(th) * ringR
            }
            el.style.transform = `translate3d(${Math.round(ax)}px, ${Math.round(ay)}px, 0) rotate(${(th * RAD2DEG).toFixed(1)}deg)`
            el.className = 'threat-arrow show t-warden'
            wardenArrow = true
            st.arrowOn[3] = true
          }
        }
      }
      if (!wardenArrow && st.arrowOn[3]) {
        arrowRefs.current[3]?.classList.remove('show')
        st.arrowOn[3] = false
      }

      // ================= 33ms lane: bars / toasts / strip ===================
      if (ts - st.last < 33) return
      st.last = ts

      // ---- player hp bar ----
      const hp = runState.hp
      const maxHp = Math.max(1, runState.stats.maxHp)
      if (hp < st.lastHp) st.lastDamageWallMs = ts
      else if (hp > st.lastHp + 10) st.healSweepUntil = ts + 700 // descent refill / big heal
      if (hp > st.ghostHp) st.ghostHp = hp // heals snap the ghost
      st.lastHp = hp
      if (ts - st.lastDamageWallMs > 350) {
        st.ghostHp += (hp - st.ghostHp) * (1 - Math.exp(-dtMs / 450))
        if (Math.abs(st.ghostHp - hp) < 0.2) st.ghostHp = hp
      }
      const hpWrap = hpWrapRef.current
      if (hpWrap) {
        hpWrap.classList.toggle('hidden', sc.phase === 'downed')
        const frac = hp / maxHp
        if (hpFillRef.current) hpFillRef.current.style.transform = `scaleX(${frac.toFixed(4)})`
        if (hpGhostRef.current)
          hpGhostRef.current.style.transform = `scaleX(${(st.ghostHp / maxHp).toFixed(4)})`
        const shown = Math.ceil(hp)
        if (shown !== st.shownHp && hpNumRef.current) {
          hpNumRef.current.textContent = String(shown)
          st.shownHp = shown
        }
        hpWrap.classList.toggle('hp-low', frac <= 0.35 && frac > 0.15)
        hpWrap.classList.toggle('hp-crit', frac <= 0.15)
        hpWrap.classList.toggle('hp-flash', st.hpFlashUntil > ts)
        hpWrap.classList.toggle('hp-heal', st.healSweepUntil > ts)
        // quiet until hurt: full pool fades the widget almost out — but a
        // heal sweep keeps it lit long enough to SEE the refill land
        hpWrap.classList.toggle(
          'hp-awake',
          frac < 0.999 || ts - st.lastDamageWallMs < 6000 || st.healSweepUntil > ts,
        )
      }

      // ---- rites: charges + live duration drain ----
      for (let slot = 0; slot < 2; slot++) {
        const el = riteRefs.current[slot]
        if (!el) continue
        const charges = runState.loadoutCharges[slot]
        el.textContent = String(charges)
        const sock = el.parentElement
        sock?.classList.toggle('spent', charges < 1)
        const info = loadout[slot]
        const dur = info?.effect ? (RITE_DURATION as Record<string, number>)[info.effect] : 0
        const timerEl = riteTimerRefs.current[slot]
        if (timerEl && dur) {
          const left = remainingFor(info!.effect)
          timerEl.style.transform = `scaleX(${Math.min(1, left / dur).toFixed(3)})`
          sock?.classList.toggle('rite-active', left > 0)
          sock?.classList.toggle('rite-expiring', left > 0 && left < 1.5)
        }
      }
      const latched = enemyState.latchedCount
      for (let i = 0; i < latchRefs.current.length; i++) {
        latchRefs.current[i]?.classList.toggle('lit', i < latched)
      }
      const lw = latchWrapRef.current
      if (lw) {
        if (latched > 0) lw.classList.add('awakened')
        lw.classList.toggle('doomed', latched >= maxLatch - 1 && latched > 0)
        lw.classList.toggle('gnaw-flash', st.gnawFlashUntil > ts)
        // half-loaded: name the sluggishness (riders cut accel + speed cap)
        const heavy = latched >= Math.max(1, Math.ceil(maxLatch / 2))
        if (heavy !== st.heavyOn) {
          lw.classList.toggle('heavy', heavy)
          st.heavyOn = heavy
        }
      }

      // ---- boss bar ----
      const boss = bossRef.current
      if (boss) {
        const table = WARDEN_ARCHETYPES[w.archetype % WARDEN_ARCHETYPES.length]
        const live = w.active && w.phase !== WP.DORMANT && w.phase !== WP.DEAD
        if (w.serial !== st.bossSerial) {
          st.bossSerial = w.serial
          st.bossGhost = 1
          st.bossDyingAtMs = -1e9
        }
        if (w.phase === WP.DYING && st.bossDyingAtMs < 0) st.bossDyingAtMs = ts
        const showBoss = live || (st.bossDyingAtMs > 0 && ts - st.bossDyingAtMs < 1200)
        if (showBoss !== st.bossVisible) {
          boss.classList.toggle('show', showBoss)
          st.bossVisible = showBoss
        }
        if (showBoss) {
          boss.classList.toggle('dying', w.phase === WP.DYING || w.phase === WP.DEAD)
          if (st.bossShownName !== table.label && bossNameRef.current) {
            bossNameRef.current.textContent = table.label
            st.bossShownName = table.label
          }
          const frac = w.phase >= WP.DYING ? 0 : Math.max(0, w.hp / Math.max(1, w.maxHp))
          st.bossGhost += (frac - st.bossGhost) * (1 - Math.exp(-dtMs / 500))
          if (st.bossGhost < frac) st.bossGhost = frac
          if (bossFillRef.current) bossFillRef.current.style.transform = `scaleX(${frac.toFixed(4)})`
          if (bossGhostRef.current)
            bossGhostRef.current.style.transform = `scaleX(${st.bossGhost.toFixed(4)})`
          const armored = !(w.phase === WP.EXPOSED || w.phase === WP.STAGGER) && w.phase < WP.DYING
          boss.classList.toggle('armored', armored)
          const exposed = w.weakOpen && live
          if (exposed !== st.bossExposed) {
            boss.classList.toggle('exposed', exposed)
            st.bossExposed = exposed
          }
          if (bossTeleRef.current) {
            bossTeleRef.current.style.transform = `scaleX(${(w.phase === WP.WINDUP ? w.telegraphT : 0).toFixed(3)})`
          }
          const label =
            w.phase === WP.EMERGE
              ? 'RISING'
              : w.phase === WP.EXPOSED
                ? 'THE RELIC HEART OPENS'
                : w.phase === WP.STAGGER
                  ? 'STAGGERED'
                  : w.phase >= WP.DYING
                    ? 'BANISHED'
                    : ''
          if (label !== st.bossState && bossStateRef.current) {
            bossStateRef.current.textContent = label
            st.bossState = label
          }
          bossStrikeRef.current?.classList.toggle('show', w.weakOpen && w.phase === WP.EXPOSED)
        }
      }

      // ---- toasts ----
      if (updateToasts(toasts, runState.feedback, ts / 1000)) {
        for (let i = 0; i < toasts.slots.length; i++) {
          const slot = toasts.slots[i]
          const el = toastRefs.current[i]
          if (!el) continue
          if (slot.id < 0) {
            el.className = 'toast'
            continue
          }
          el.className = `toast show t-${slot.kind}`
          const title = el.firstElementChild as HTMLElement | null
          const sub = el.lastElementChild as HTMLElement | null
          if (title) title.textContent = slot.title
          if (sub) sub.textContent = slot.sub
        }
      }

      // ---- objective strip ----
      const obj = objRef.current
      if (obj) {
        const depthLabel = `DEPTH ${runState.depth + 1} · ${getRealmForDepth(runState.depth).realm.label}`
        if (depthLabel !== st.objLine1 && objLine1Ref.current) {
          objLine1Ref.current.textContent = depthLabel
          st.objLine1 = depthLabel
        }
        const gate = worldState.gate
        const sealed = gate.active && enemyState.warden.active && enemyState.warden.phase !== WP.DEAD && enemyState.warden.phase !== WP.DORMANT
        const ready = runState.shiftCharge >= runState.shiftCost
        const line2 = sealed
          ? 'SEALED — FELL THE WARDEN'
          : ready
            ? 'GATE RISES — SNAP IT'
            : `◇ RESONANCE ${Math.floor(runState.shiftCharge)} / ${runState.shiftCost}`
        if (line2 !== st.objLine2 && objLine2Ref.current) {
          objLine2Ref.current.textContent = line2
          st.objLine2 = line2
        }
        const mode = sealed ? 'sealed' : ready ? 'ready' : ''
        if (mode !== st.objMode) {
          obj.classList.toggle('sealed', mode === 'sealed')
          obj.classList.toggle('ready', mode === 'ready')
          st.objMode = mode
        }
        if (objBarRef.current) {
          const frac = Math.min(1, runState.shiftCharge / Math.max(1, runState.shiftCost))
          objBarRef.current.style.transform = `scaleX(${frac.toFixed(4)})`
        }
        // charge stolen: the strip bleeds so the loss is never silent
        if (runState.combat.chargeDrained !== st.lastChargeDrained) {
          st.lastChargeDrained = runState.combat.chargeDrained
          st.drainFlashUntil = ts + 500
        }
        obj.classList.toggle('drained', st.drainFlashUntil > ts)
        // charge crossing cost: a gold sweep answers the collect that armed it
        if (feel.chargeFullCount !== st.chargeFullSeen) {
          st.chargeFullSeen = feel.chargeFullCount
          st.chargeFlashUntil = ts + 700
        }
        obj.classList.toggle('charge-flash', st.chargeFlashUntil > ts)
        if (gate.active && gate.openedAt !== st.lastGateOpenedAt) {
          st.lastGateOpenedAt = gate.openedAt
          st.sweepUntil = ts + 900
        }
        obj.classList.toggle('gate-sweep', st.sweepUntil > ts)
      }

      // ---- score cluster: rolling total + chain multiplier + decay bar ----
      const scoreWrap = scoreWrapRef.current
      if (scoreWrap) {
        const ss = runState.scoreState
        st.scoreShown += (ss.score - st.scoreShown) * (1 - Math.exp(-dtMs / 180))
        if (Math.abs(ss.score - st.scoreShown) < 1) st.scoreShown = ss.score
        const sTxt = String(Math.round(st.scoreShown))
        if (sTxt !== st.scoreText && scoreNumRef.current) {
          scoreNumRef.current.textContent = sTxt
          st.scoreText = sTxt
        }
        const mult = ss.multiplier
        const mTxt = mult.toFixed(1)
        if (mTxt !== st.multText) {
          const chip = multChipRef.current
          if (chip) {
            chip.textContent = `×${mTxt}`
            if (mult > st.multShown + 1e-6) {
              chip.classList.add('pulse')
              st.multPulseUntil = ts + 200
            }
            chip.classList.toggle('hot', mult >= 3)
          }
          st.multText = mTxt
        }
        st.multShown = mult
        if (st.multPulseUntil > 0 && ts > st.multPulseUntil) {
          multChipRef.current?.classList.remove('pulse')
          st.multPulseUntil = 0
        }
        const cTxt = ss.chain > 1 ? `CHAIN ${ss.chain}` : ''
        if (cTxt !== st.chainText && chainNumRef.current) {
          chainNumRef.current.textContent = cTxt
          st.chainText = cTxt
        }
        const since = audioFrame.time - ss.lastSnapTime
        const hasMult = mult > 1.001
        const decayFrac = hasMult ? Math.max(0, 1 - since / SCORING.decayDelaySec) : 0
        if (decayFillRef.current && Math.abs(decayFrac - st.decayShown) > 0.01) {
          decayFillRef.current.style.transform = `scaleX(${decayFrac.toFixed(3)})`
          st.decayShown = decayFrac
        }
        const decaying = hasMult && since > SCORING.decayDelaySec
        if (decaying !== st.decayOn) {
          scoreWrap.classList.toggle('decaying', decaying)
          st.decayOn = decaying
        }
        const awake = ss.score > 0 || hasMult
        if (awake !== st.scoreAwake) {
          scoreWrap.classList.toggle('score-awake', awake)
          st.scoreAwake = awake
        }
      }
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      bubbles.dispose()
    }
  }, [maxLatch, loadout])

  return (
    <div className="hud" data-testid="hud">
      <span className="font-warm" aria-hidden>
        0123456789
      </span>
      <div className="dmg-layer" ref={dmgLayerRef} data-testid="dmg-layer" />
      <div className="dmg-arcs" data-testid="dmg-arcs">
        {[0, 1].map(i => (
          <div
            key={i}
            className="dmg-arc"
            ref={el => {
              arcRefs.current[i] = el
            }}
          />
        ))}
      </div>
      <div className="threat-arrows" data-testid="threat-arrows">
        {[0, 1, 2, 3].map(i => (
          <div
            key={i}
            className="threat-arrow"
            ref={el => {
              arrowRefs.current[i] = el
            }}
          />
        ))}
      </div>
      <div className="reticle rk-none" ref={retRef} data-testid="hud-reticle">
        <div className="crosshair" />
        <div className="ret-brackets" ref={bracketsRef}>
          <i /><i /><i /><i />
        </div>
        <div className="hitmark" ref={hitmarkRef}>
          <i /><i /><i /><i />
        </div>
        <div className="ret-bolt">
          <div className="ret-bolt-fill" ref={retBoltFillRef} />
        </div>
        <div className="ret-draw" ref={retDrawRef} />
        <div className="ret-draw-ticks">
          <i /><i /><i />
        </div>
        <div className="ret-storm">
          <i /><i /><i /><i /><i />
        </div>
        <div className="ret-combo" ref={comboRef} data-testid="hud-combo">
          <span className="combo-num font-warm" ref={comboNumRef}>
            0
          </span>
          <span className="combo-pips">
            <i /><i /><i />
          </span>
          <div className="combo-fuse">
            <div className="combo-fuse-fill" ref={comboFuseRef} />
          </div>
        </div>
        <div className="grade-pop" ref={gradePopRef} />
        <div className="ret-denied">⛓</div>
      </div>
      <div className="weak-marker" ref={weakMarkRef}>
        <i />
      </div>
      <div className="boss-bar" ref={bossRef} data-testid="hud-boss">
        <div className="boss-name" ref={bossNameRef} />
        <div className="boss-state" ref={bossStateRef} />
        <div className="boss-hp">
          <div className="boss-hp-ghost" ref={bossGhostRef} />
          <div className="boss-hp-fill" ref={bossFillRef} />
          <div className="boss-armored-chip">◈ WARDED</div>
        </div>
        <div className="boss-tele" ref={bossTeleRef} />
        <div className="boss-strike" ref={bossStrikeRef}>
          STRIKE THE RELIC HEART
        </div>
      </div>
      <div className="hud-score" ref={scoreWrapRef} data-testid="hud-score">
        <span className="score-num font-warm" ref={scoreNumRef}>
          0
        </span>
        <div className="score-sub">
          <span className="mult-chip" ref={multChipRef}>
            ×1.0
          </span>
          <span className="chain-num" ref={chainNumRef} />
        </div>
        <div className="mult-decay">
          <div className="mult-decay-fill" ref={decayFillRef} />
        </div>
      </div>
      <div className="hud-toasts" data-testid="hud-toasts">
        {[0, 1].map(i => (
          <div
            key={i}
            className="toast"
            ref={el => {
              toastRefs.current[i] = el
            }}
          >
            <b />
            <span />
          </div>
        ))}
      </div>
      <div className="hud-obj" ref={objRef} data-testid="hud-obj">
        <div className="obj-line1" ref={objLine1Ref} />
        <div className="obj-line2">
          <span ref={objLine2Ref} />
          <div className="obj-bar">
            <div className="obj-bar-fill" ref={objBarRef} />
          </div>
        </div>
      </div>
      <div className="hud-hp" ref={hpWrapRef} data-testid="hud-hp">
        <div className="hp-bar">
          <div className="hp-ghost" ref={hpGhostRef} />
          <div className="hp-fill" ref={hpFillRef} />
        </div>
        <span className="hp-num" ref={hpNumRef} />
      </div>
      {anyRites && (
        <div className="hud-rites" data-testid="hud-rites">
          {loadout.map((rite, slot) =>
            rite ? (
              <div
                key={slot}
                className="rite-socket"
                title={rite.effect ? `${rite.name} — ${describeEffect(rite.effect)}` : rite.name}
              >
                <b>{slot + 1}</b>
                <i className="atlas-rune rite-rune" style={runeMaskStyle(rite.glyph)} />
                <span
                  ref={el => {
                    riteRefs.current[slot] = el
                  }}
                >
                  {runState.loadoutCharges[slot]}
                </span>
                <div className="rite-timer">
                  <div
                    className="rite-timer-fill"
                    ref={el => {
                      riteTimerRefs.current[slot] = el
                    }}
                  />
                </div>
              </div>
            ) : null,
          )}
        </div>
      )}
      <div className="hud-latches" ref={latchWrapRef} data-testid="hud-latches">
        {Array.from({ length: maxLatch }, (_, i) => (
          <span
            key={i}
            className="latch-pip"
            ref={el => {
              latchRefs.current[i] = el
            }}
          >
            ◆
          </span>
        ))}
        <em className="latch-caption">DRAGGING</em>
      </div>
    </div>
  )
}
