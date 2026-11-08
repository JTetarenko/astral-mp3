/**
 * The damage-bubble layer: a fixed pool of DOM spans fed by the feel ring.
 * World hits project ONCE at spawn (hudProjection) then drift in pure CSS —
 * the AAA-standard screen-drift that kills camera-lag swim and per-frame
 * reprojection cost. Damage TAKEN (kinds 4/5) anchors above the HP bar
 * instead. Rapid same-target hits merge into one counting number (bolt
 * streams read as 12..24..36, not confetti); kills always take a fresh slot.
 * Zero steady-state allocation: slots recycle oldest-first.
 */
import { feel, HIT_RING_CAP, HK } from '../../game/feelSignals'
import { hudProjection, makeScreenPoint, projectToScreen } from '../../scene/hudProjection'

const WORLD_POOL = 12
const TAKEN_POOL = 4
const LIFE_MS = 950
const MERGE_MS = 350

interface BubbleSlot {
  el: HTMLSpanElement
  bornAt: number
  targetId: number
  amount: number
  kill: boolean
  active: boolean
}

const scratch = makeScreenPoint()

export interface BubbleLayer {
  /** Drain new hits + reclaim dead slots. Call from the 60Hz HUD lane. */
  update(nowMs: number): void
  dispose(): void
}

export function makeBubbleLayer(root: HTMLElement): BubbleLayer {
  const world: BubbleSlot[] = []
  const taken: BubbleSlot[] = []
  for (let i = 0; i < WORLD_POOL + TAKEN_POOL; i++) {
    const el = document.createElement('span')
    el.className = 'dmg-bubble'
    root.appendChild(el)
    const slot: BubbleSlot = { el, bornAt: -1e9, targetId: -2, amount: 0, kill: false, active: false }
    if (i < WORLD_POOL) world.push(slot)
    else taken.push(slot)
  }
  let lastSeen = feel.hitSerial

  function retire(slot: BubbleSlot): void {
    slot.active = false
    slot.targetId = -2
    slot.el.className = 'dmg-bubble'
    slot.el.textContent = ''
  }

  function restartAnim(el: HTMLElement, cls: string): void {
    el.className = 'dmg-bubble'
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    void el.offsetWidth // reflow: retrigger the CSS animation
    el.className = cls
  }

  function pick(pool: BubbleSlot[], nowMs: number): BubbleSlot {
    let oldest = pool[0]
    for (const s of pool) {
      if (!s.active) return s
      if (s.bornAt < oldest.bornAt) oldest = s
    }
    retire(oldest)
    void nowMs
    return oldest
  }

  function spawnWorld(
    nowMs: number,
    x: number,
    y: number,
    amount: number,
    crit: boolean,
    kill: boolean,
    targetId: number,
  ): void {
    const slot = pick(world, nowMs)
    slot.active = true
    slot.bornAt = nowMs
    slot.targetId = kill ? -2 : targetId // kill bubbles never merge
    slot.amount = amount
    slot.kill = kill
    // seeded jitter keeps stacked hits legible without RNG state
    const j = ((feel.hitSerial * 37) % 29) - 14
    slot.el.style.left = `${Math.round(x + j)}px`
    slot.el.style.top = `${Math.round(y - 8)}px`
    slot.el.textContent = String(Math.round(amount))
    restartAnim(slot.el, kill ? 'dmg-bubble bub-kill' : crit ? 'dmg-bubble bub-crit' : 'dmg-bubble bub-hit')
  }

  function spawnTaken(nowMs: number, amount: number, slotIdx: number): void {
    const slot = taken[slotIdx % TAKEN_POOL]
    if (slot.active && nowMs - slot.bornAt < MERGE_MS) {
      slot.amount += amount
      slot.el.textContent = `-${Math.round(slot.amount)}`
      restartAnim(slot.el, 'dmg-bubble bub-taken')
      slot.bornAt = nowMs
      return
    }
    slot.active = true
    slot.bornAt = nowMs
    slot.amount = amount
    slot.el.style.left = ''
    slot.el.style.top = ''
    slot.el.textContent = `-${Math.round(amount)}`
    restartAnim(slot.el, 'dmg-bubble bub-taken')
  }

  let takenCursor = 0

  return {
    update(nowMs: number): void {
      // reclaim expired
      for (const s of world) if (s.active && nowMs - s.bornAt > LIFE_MS) retire(s)
      for (const s of taken) if (s.active && nowMs - s.bornAt > LIFE_MS) retire(s)
      // drain the ring (backlog clamped to the ring capacity)
      if (feel.hitSerial === lastSeen) return
      const from = Math.max(lastSeen, feel.hitSerial - HIT_RING_CAP)
      for (let ser = from + 1; ser <= feel.hitSerial; ser++) {
        const e = feel.hitRing[ser % HIT_RING_CAP]
        if (e.serial !== ser) continue // overwritten mid-drain
        if (e.kind === HK.PLAYER_TAKEN || e.kind === HK.LATCH_GNAW) {
          spawnTaken(nowMs, e.amount, takenCursor++)
          continue
        }
        // merge rule: a live non-kill bubble on the same target accumulates
        if (e.kill !== 1) {
          let merged = false
          for (const s of world) {
            if (s.active && s.targetId === e.targetId && nowMs - s.bornAt < MERGE_MS) {
              s.amount += e.amount
              s.bornAt = nowMs
              s.el.textContent = String(Math.round(s.amount))
              restartAnim(s.el, e.crit === 1 ? 'dmg-bubble bub-crit' : 'dmg-bubble bub-hit')
              merged = true
              break
            }
          }
          if (merged) continue
        }
        projectToScreen(hudProjection.m, e.x, e.y, e.z, hudProjection.vw, hudProjection.vh, scratch)
        if (!scratch.visible) continue
        spawnWorld(nowMs, scratch.x, scratch.y, e.amount, e.crit === 1, e.kill === 1, e.targetId)
      }
      lastSeen = feel.hitSerial
    },
    dispose(): void {
      for (const s of world) s.el.remove()
      for (const s of taken) s.el.remove()
    },
  }
}
