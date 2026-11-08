import { useEffect, useRef } from 'react'
import { audioFrame } from '../audio/reactiveBus'
import { getSfxKitStatus } from '../audio/sfx'
import {
  damageWarden,
  debugForceLatch,
  debugKillSwarm,
  enemyState,
  WP,
} from '../game/enemyState'
import { feel } from '../game/feelSignals'
import { gameTime, HITSTOP, triggerHitStop } from '../game/gameTime'
import { damagePlayer, HK } from '../game/playerHealth'
import { runState } from '../game/runState'
import { useGameStore } from '../game/state'
import { openGate, worldState } from '../game/worldState'
import { governor, perfStats } from '../scene/perfGovernor'
import { snapController } from '../scene/snapController'
import { forcing, PEAK_STYLES, triggerCombatImpact, visuals } from '../scene/visualTuning'

const HISTORY = 140
const TIER_COLORS = ['#2a3a4a', '#4d7dff', '#ffb838', '#ff4444']

const fmtSec = (s: number) => (s === Infinity ? '-' : `${s.toFixed(1)}s`)

/** ?debug tuning panel: raw band values, spectral-flux sparkline vs threshold,
 * BPM/seed readouts, intensity/tier timeline, FPS. */
export function DebugOverlay() {
  const analysis = useGameStore(s => s.analysis)
  const textRef = useRef<HTMLPreElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const timelineRef = useRef<HTMLCanvasElement>(null)
  const onsetDot = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const flux = new Float32Array(HISTORY)
    const thresh = new Float32Array(HISTORY)
    let idx = 0
    let raf = 0
    let frames = 0
    let fps = 0
    let lastFpsAt = performance.now()
    let lastText = 0
    let onsetGlow = 0

    const tick = () => {
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      frames++
      if (now - lastFpsAt >= 1000) {
        fps = frames
        frames = 0
        lastFpsAt = now
      }

      flux[idx] = audioFrame.flux
      thresh[idx] = audioFrame.fluxThreshold
      idx = (idx + 1) % HISTORY
      if (audioFrame.onset) onsetGlow = 1
      onsetGlow *= 0.9

      if (onsetDot.current) onsetDot.current.style.opacity = String(onsetGlow)

      if (now - lastText > 100 && textRef.current) {
        lastText = now
        textRef.current.textContent =
          `fps    ${fps}\n` +
          `time   ${audioFrame.time.toFixed(2)} / ${audioFrame.duration.toFixed(1)}\n` +
          `bass   ${audioFrame.bass.toFixed(3)}\n` +
          `mids   ${audioFrame.mids.toFixed(3)}\n` +
          `highs  ${audioFrame.highs.toFixed(3)}\n` +
          `loud   ${audioFrame.loudness.toFixed(3)}\n` +
          `flux   ${audioFrame.flux.toFixed(4)}\n` +
          `thresh ${audioFrame.fluxThreshold.toFixed(4)}\n` +
          `bpm    ${audioFrame.bpm}\n` +
          `phase  ${audioFrame.beatPhase.toFixed(2)}\n` +
          `tier   ${audioFrame.tierFrom}→${audioFrame.tier} (${audioFrame.tierBlend.toFixed(2)})` +
          (forcing.tier >= 0 ? ` FORCED ${forcing.tier}\n` : '\n') +
          `inten  ${audioFrame.intensity.toFixed(3)} (off ${audioFrame.intensityOffline.toFixed(3)})` +
          (forcing.intensity >= 0 ? ` FORCED ${forcing.intensity.toFixed(2)}\n` : '\n') +
          `vi     ${visuals.vi.toFixed(2)} rm ${visuals.rm ? 'on' : 'off'}\n` +
          `psy    warp ${visuals.warpAmp.toFixed(3)} kal ${visuals.kaleidoMix.toFixed(2)} echo ${visuals.echoDamp.toFixed(2)}` +
          (forcing.psychePreview > 0 || forcing.echoPreview
            ? ` [P${forcing.psychePreview}${forcing.echoPreview ? ' O' : ''}]\n`
            : '\n') +
          `grid   #${audioFrame.gridBeatIndex} ph ${audioFrame.gridPhase.toFixed(2)} bar ${audioFrame.barPhase.toFixed(2)} conf ${audioFrame.gridConfidence.toFixed(2)}/${audioFrame.barConfidence.toFixed(2)}\n` +
          `sect   #${audioFrame.sectionIndex} ${(audioFrame.sectionProgress * 100) | 0}% next t${audioFrame.nextTier} in ${fmtSec(audioFrame.timeToNextSection)}\n` +
          `drop   in ${fmtSec(audioFrame.timeToDrop)} charge ${visuals.dropCharge.toFixed(2)} rise ${audioFrame.rise.toFixed(2)} trip ${visuals.tripLevel.toFixed(2)}` +
          (forcing.dropCharge >= 0 ? ` FORCED ${forcing.dropCharge.toFixed(2)}\n` : '\n') +
          `impact ${visuals.impactPulse.toFixed(2)} blast ${visuals.blastProgress < 1 ? visuals.blastProgress.toFixed(2) : '-'} ev t${audioFrame.tierCommitCount} d${audioFrame.dropCommitCount}\n` +
          `onset+ mid ${audioFrame.midOnsetStrength.toFixed(2)} hi ${audioFrame.highOnsetStrength.toFixed(2)} pulse ${visuals.beatPulse.toFixed(2)}/${visuals.barPulse.toFixed(2)}\n` +
          `sfx    ${getSfxKitStatus().status} (${getSfxKitStatus().loaded})\n` +
          `perf   L${governor.level} dpr ${perfStats.dpr.toFixed(2)} calls ${perfStats.calls}\n` +
          `view   ${snapController.viewMode} b${snapController.viewBlend.toFixed(2)} cam ${snapController.camDist.toFixed(1)}u\n` +
          `peak   ${PEAK_STYLES[visuals.peakStyle]} clear ${visuals.centerClear.toFixed(2)}\n` +
          `realm  d${worldState.depth} charge ${runState.shiftCharge}/${runState.shiftCost} gate ${worldState.gate.active ? `open ${worldState.gate.openT.toFixed(2)}` : 'closed'}\n` +
          `feel   hp ${runState.hp.toFixed(0)}/${runState.stats.maxHp} whiff ${feel.whiffCount} kills ${feel.killConfirmCount} hits s${feel.hitSerial} stop ${gameTime.stopLeft > 0 ? gameTime.stopLeft.toFixed(3) : '-'}\n` +
          `world  chunks ${worldState.chunks.size} isl ${worldState.slots.reduce((n, s) => n + (s.used ? 1 : 0), 0)} pts ${worldState.points.active.reduce((a, b) => a + b, 0)} pos ${snapController.pos.x.toFixed(0)},${snapController.pos.z.toFixed(0)}\n` +
          `seed   ${analysis ? analysis.seed.toString(16) : '-'}`
      }

      // section timeline: tier bands + offline intensity curve + playhead
      const tl = timelineRef.current
      const tlCtx = tl?.getContext('2d')
      if (tl && tlCtx && analysis) {
        const { sections, curve } = analysis.intensity
        const W = tl.width
        const H = tl.height
        tlCtx.clearRect(0, 0, W, H)
        for (const s of sections) {
          tlCtx.fillStyle = TIER_COLORS[s.tier]
          const x0 = (s.startSec / analysis.duration) * W
          const x1 = (s.endSec / analysis.duration) * W
          tlCtx.fillRect(x0, 0, Math.max(1, x1 - x0), H)
        }
        tlCtx.strokeStyle = 'rgba(255,255,255,0.75)'
        tlCtx.beginPath()
        for (let x = 0; x < W; x++) {
          const v = curve[Math.min(curve.length - 1, Math.floor((x / W) * curve.length))] ?? 0
          const y = H - 1 - v * (H - 2)
          x === 0 ? tlCtx.moveTo(x, y) : tlCtx.lineTo(x, y)
        }
        tlCtx.stroke()
        // beat-grid ticks: short = beats (only when sparse enough), tall = downbeats
        const grid = analysis.beatGrid
        if (grid && grid.beatTimes.length > 0 && grid.confidence > 0) {
          const bts = grid.beatTimes
          if (bts.length <= W) {
            tlCtx.fillStyle = 'rgba(255,255,255,0.35)'
            for (let k = 0; k < bts.length; k++) {
              tlCtx.fillRect((bts[k] / analysis.duration) * W, H - 4, 1, 4)
            }
          }
          const M = Math.max(1, grid.barBeats)
          tlCtx.fillStyle = 'rgba(255,255,255,0.8)'
          for (let k = ((grid.downbeatIndex % M) + M) % M; k < bts.length; k += M) {
            tlCtx.fillRect((bts[k] / analysis.duration) * W, H - 7, 1, 7)
          }
        }
        // rise meter along the top edge
        tlCtx.fillStyle = '#6ef58a'
        tlCtx.fillRect(0, 0, audioFrame.rise * W, 2)
        tlCtx.fillStyle = '#ffffff'
        tlCtx.fillRect((audioFrame.time / Math.max(1e-6, analysis.duration)) * W - 1, 0, 2, H)
      }

      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (canvas && ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        let max = 1e-6
        for (let i = 0; i < HISTORY; i++) max = Math.max(max, flux[i], thresh[i])
        const h = canvas.height
        ctx.strokeStyle = '#ffb838'
        ctx.beginPath()
        for (let i = 0; i < HISTORY; i++) {
          const v = thresh[(idx + i) % HISTORY]
          const y = h - (v / max) * (h - 2) - 1
          i === 0 ? ctx.moveTo(i, y) : ctx.lineTo(i, y)
        }
        ctx.stroke()
        ctx.strokeStyle = '#4d7dff'
        ctx.beginPath()
        for (let i = 0; i < HISTORY; i++) {
          const v = flux[(idx + i) % HISTORY]
          const y = h - (v / max) * (h - 2) - 1
          i === 0 ? ctx.moveTo(i, y) : ctx.lineTo(i, y)
        }
        ctx.stroke()
      }
    }
    raf = requestAnimationFrame(tick)

    // Debug-only forcing keys: Shift+0-3 tier (bare digits are consumable
    // rites now), ` clear, [ ] intensity nudge, P psyche preview cycle,
    // O echo preview toggle, G dropCharge cycle, H fire drop impact,
    // J spawn comet, C fill shift charge (opens gate), B toggle gate,
    // M force realm shift, K force leap wave, L fell the swarm,
    // U warden toggle, Y +1 forced latch.
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Backquote') {
        forcing.tier = -1
        forcing.intensity = -1
        forcing.psychePreview = 0
        forcing.echoPreview = false
        forcing.dropCharge = -1
      } else if (e.code === 'KeyC') {
        runState.shiftCharge = runState.shiftCost
        if (!worldState.gate.active) {
          const p = snapController.pos
          const f = snapController.forward
          openGate(p.x, p.y, p.z, f.x, f.z, audioFrame.time)
        }
      } else if (e.code === 'KeyB') {
        if (worldState.gate.active) {
          worldState.gate.active = false
        } else {
          const p = snapController.pos
          const f = snapController.forward
          openGate(p.x, p.y, p.z, f.x, f.z, audioFrame.time)
        }
      } else if (e.code === 'KeyM') {
        snapController.forceShift()
      } else if (e.code === 'KeyN') {
        forcing.peakStyle = forcing.peakStyle >= 3 ? -1 : forcing.peakStyle + 1
        visuals.peakStyle = Math.max(0, forcing.peakStyle)
      } else if (e.code === 'KeyG') {
        forcing.dropCharge =
          forcing.dropCharge < 0 ? 0.5 : forcing.dropCharge < 0.75 ? 1 : -1
      } else if (e.code === 'KeyH') {
        forcing.impactNow = true
      } else if (e.code === 'KeyJ') {
        forcing.cometNow = true
      } else if (e.code === 'KeyK') {
        // rewind the drop diff so the director fires a coordinated leap wave
        enemyState.lastDropCount = enemyState.lastDropCount - 1
      } else if (e.code === 'KeyL') {
        debugKillSwarm(audioFrame.time)
      } else if (e.code === 'KeyU') {
        if (enemyState.warden.active && enemyState.warden.phase < WP.DYING) {
          damageWarden(enemyState.warden.hp / 0.25 + 100, audioFrame.time, 1)
        } else {
          const p = snapController.pos
          const f = snapController.forward
          openGate(p.x, p.y, p.z, f.x, f.z, audioFrame.time)
          enemyState.lastGateOpenedAt = -1 // force the spawn diff
        }
      } else if (e.code === 'KeyY') {
        const p = snapController.pos
        debugForceLatch(p.x, p.y, p.z, audioFrame.time)
      } else if (e.code === 'KeyX') {
        // forced kill-impact: hit-stop + camera punch + screen kick
        triggerHitStop(HITSTOP.strikeKill)
        snapController.addTrauma(0.75)
        const p = snapController.pos
        triggerCombatImpact(0.95, p.x, p.y, p.z)
      } else if (e.code === 'KeyI') {
        // bleed the player 25 hp (HP-bar / bubble / downed-path testing)
        const p = snapController.pos
        damagePlayer(25, audioFrame.time, HK.PLAYER_TAKEN, p.x, p.y, p.z)
        runState.combat.lastWardenDamageAt = -999 // bypass mercy for spam-testing
      } else if (/^Digit[0-3]$/.test(e.code) && e.shiftKey) {
        forcing.tier = Number(e.code.slice(5))
      } else if (e.code === 'BracketLeft') {
        forcing.intensity = Math.max(0, (forcing.intensity < 0 ? visuals.eI : forcing.intensity) - 0.05)
      } else if (e.code === 'BracketRight') {
        forcing.intensity = Math.min(1, (forcing.intensity < 0 ? visuals.eI : forcing.intensity) + 0.05)
      } else if (e.code === 'KeyP') {
        forcing.psychePreview = (forcing.psychePreview + 1) % 4
      } else if (e.code === 'KeyO') {
        forcing.echoPreview = !forcing.echoPreview
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey)
    }
  }, [analysis])

  return (
    <div className="debug-overlay">
      <div className="debug-head">
        DEBUG <span className="debug-onset" ref={onsetDot} />
      </div>
      <pre ref={textRef} />
      <canvas ref={canvasRef} width={HISTORY} height={44} />
      <canvas ref={timelineRef} width={HISTORY} height={22} style={{ marginTop: 4 }} />
    </div>
  )
}
