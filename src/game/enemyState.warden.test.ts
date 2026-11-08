import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyWardenWeakHit,
  damageWarden,
  enemyState,
  liveSwarmCount,
  resetEnemies,
  updateEnemies,
  wardenBlocksGate,
  weakPointTarget,
  WP,
  type EnemyDirectorInput,
} from './enemyState'
import { ENEMY, WARDEN_ARCHETYPES, WK } from './enemyArchetypes'
import { COMBAT } from './combat'
import { feel, HIT_RING_CAP, HK } from './feelSignals'
import { openGate, resetWorld, streamWorld, worldState } from './worldState'
import { freshCombatCounters, resetRun, runState } from './runState'
import { LAYOUT } from './layout'

const P = LAYOUT.spawn

function input(over: Partial<EnemyDirectorInput> = {}): EnemyDirectorInput {
  return {
    px: worldState.gate.active ? worldState.gate.x : P.x,
    py: worldState.gate.active ? worldState.gate.y : P.y,
    pz: worldState.gate.active ? worldState.gate.z + 10 : P.z,
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
    stats: { ...runState.stats },
    ...over,
  }
}

let clock = 200
function pump(frames: number, over: Partial<EnemyDirectorInput> = {}, dt = 1 / 30): void {
  for (let f = 0; f < frames; f++) {
    clock += dt
    updateEnemies(dt, clock, input(over))
  }
}

/** Fast-forward the warden into GUARD with the player in engagement range. */
function toGuard(): void {
  pump(Math.ceil((ENEMY.WARDEN_EMERGE_DUR + 0.2) * 30))
  expect(enemyState.warden.phase).toBe(WP.GUARD)
}

beforeEach(() => {
  // clock stays monotonic across tests (like the real elapsed-time clock) so
  // gate.openedAt stamps are always fresh and the spawn diff can fire
  clock += 500
  resetWorld(4321, 0)
  streamWorld(P.x, P.z, clock)
  resetRun(0, 0)
  runState.combat = freshCombatCounters()
  resetEnemies(4321, 0)
  enemyState.graceLeft = 0
  openGate(P.x, P.y, P.z, 0, -1, clock)
  pump(1) // the openedAt diff spawns the warden
})

describe('warden spawn', () => {
  it('manifests the realm-correct archetype when the gate opens', () => {
    const w = enemyState.warden
    expect(w.active).toBe(true)
    expect(w.archetype).toBe(worldState.depth % 6)
    expect(w.phase).toBe(WP.EMERGE)
    expect(w.maxHp).toBe(
      Math.round(WARDEN_ARCHETYPES[w.archetype].hp * worldState.modsGen.wardenHpMult),
    )
    expect(w.hp).toBe(w.maxHp)
    expect(wardenBlocksGate()).toBe(true)
  })

  it('rises through EMERGE into GUARD near the gate', () => {
    toGuard()
    const w = enemyState.warden
    const table = WARDEN_ARCHETYPES[w.archetype]
    expect(Math.abs(w.y - (worldState.gate.y + table.hover))).toBeLessThan(3)
  })
})

describe('attack cycle', () => {
  it('GUARD waits attackPeriod, telegraphs a WINDUP, executes, recovers', () => {
    toGuard()
    const w = enemyState.warden
    const table = WARDEN_ARCHETYPES[w.archetype]
    pump(Math.ceil((table.attackPeriod + 0.2) * 30))
    expect(w.phase).toBe(WP.WINDUP)
    expect(w.telegraphT).toBeGreaterThan(0)
    const atk = table.attacks[0]
    pump(Math.ceil((atk.windup + 0.1) * 30))
    expect(w.phase).toBe(WP.ATTACK)
    pump(Math.ceil((atk.active + atk.recover + 0.2) * 30))
    expect(w.phase === WP.GUARD || w.phase === WP.EXPOSED).toBe(true)
    expect(w.attacksSinceExpose).toBeGreaterThanOrEqual(1)
  })

  it('SUMMON feeds the swarm even in CALM', () => {
    toGuard()
    const w = enemyState.warden
    const table = WARDEN_ARCHETYPES[w.archetype]
    const summonIdx = table.attacks.findIndex(a => a.kind === WK.SUMMON)
    // cycle attacks until the summon lands
    const before = liveSwarmCount()
    for (let cycle = 0; cycle <= summonIdx; cycle++) {
      pump(Math.ceil((table.attackPeriod + 0.2) * 30))
      const atk = table.attacks[w.attackIdx % table.attacks.length]
      pump(Math.ceil((atk.windup + atk.active + atk.recover + 0.3) * 30))
    }
    expect(liveSwarmCount()).toBeGreaterThan(before)
  })

  it('every exposeEvery attacks the relic heart opens for weakDur', () => {
    toGuard()
    const w = enemyState.warden
    const table = WARDEN_ARCHETYPES[w.archetype]
    let guard = 0
    while (w.phase !== WP.EXPOSED && guard++ < 400) pump(15)
    expect(w.phase).toBe(WP.EXPOSED)
    expect(w.weakOpen).toBe(true)
    const out = { x: 0, y: 0, z: 0, open: false }
    weakPointTarget(out)
    expect(out.open).toBe(true)
    // the weak point orbits ON the body ring
    const dx = out.x - w.x
    const dz = out.z - w.z
    expect(Math.sqrt(dx * dx + dz * dz)).toBeCloseTo(table.bodyR * 0.9, 1)
    pump(Math.ceil((table.weakDur + 0.2) * 30))
    expect(w.weakOpen).toBe(false)
    expect(w.phase).toBe(WP.GUARD)
    expect(w.attacksSinceExpose).toBe(0)
  })
})

describe('damage rules', () => {
  it('body damage is armored outside EXPOSED/STAGGER', () => {
    toGuard()
    const w = enemyState.warden
    const hp0 = w.hp
    damageWarden(40, clock, 1)
    expect(hp0 - w.hp).toBeCloseTo(40 * COMBAT.wardenArmor, 4)
  })

  it('weak hit lands full, staggers, and resets the expose cycle', () => {
    toGuard()
    const w = enemyState.warden
    let guard = 0
    while (w.phase !== WP.EXPOSED && guard++ < 400) pump(15)
    const hp0 = w.hp
    applyWardenWeakHit(COMBAT.wardenWeakHit, clock)
    expect(hp0 - w.hp).toBeCloseTo(COMBAT.wardenWeakHit, 4)
    expect(w.phase).toBe(WP.STAGGER)
    expect(w.weakOpen).toBe(false)
    expect(w.attacksSinceExpose).toBe(0)
    // stagger window takes full damage
    const hp1 = w.hp
    damageWarden(40, clock, 1)
    expect(hp1 - w.hp).toBeCloseTo(40, 4)
    pump(Math.ceil((ENEMY.WARDEN_STAGGER_DUR + 0.2) * 30))
    expect(w.phase).toBe(WP.GUARD)
  })

  it('a closed weak point ignores weak hits', () => {
    toGuard()
    const hp0 = enemyState.warden.hp
    applyWardenWeakHit(90, clock)
    expect(enemyState.warden.hp).toBe(hp0)
  })
})

describe('death and rewards', () => {
  it('pays charge/score/counters exactly once, DYING blocks, DEAD frees the gate', () => {
    toGuard()
    const w = enemyState.warden
    runState.shiftCharge = 1
    const score0 = runState.scoreState.score
    damageWarden(w.hp / COMBAT.wardenArmor + 50, clock, 1)
    expect(w.phase).toBe(WP.DYING)
    expect(wardenBlocksGate()).toBe(true) // still sealed through the death rite
    const c = runState.combat
    expect(c.wardenKills).toBe(1)
    expect(c.wardenKillsByArchetype[w.archetype]).toBe(1)
    expect(c.shardsEarned).toBeGreaterThanOrEqual(10)
    expect(runState.shiftCharge).toBeCloseTo(1 + 3 * runState.stats.chargeGainMult, 4)
    expect(runState.scoreState.score).toBeGreaterThan(score0)
    // no double pay
    damageWarden(9999, clock, 1)
    expect(c.wardenKills).toBe(1)
    pump(Math.ceil((ENEMY.WARDEN_DEATH_DUR + 0.2) * 30))
    expect(w.phase).toBe(WP.DEAD)
    expect(wardenBlocksGate()).toBe(false)
  })
})

describe('gate re-placement', () => {
  it('the warden re-manifests at a teleported gate, hp preserved', () => {
    toGuard()
    const w = enemyState.warden
    damageWarden(200, clock, 1) // chip some hp through armor
    const hpBefore = w.hp
    expect(hpBefore).toBeLessThan(w.maxHp)
    // simulate the far-flee gate re-place worldState performs
    openGate(P.x + 300, P.y, P.z + 300, 0, -1, clock)
    pump(1, { px: P.x + 300, py: P.y, pz: P.z + 290 })
    expect(w.phase).toBe(WP.EMERGE)
    expect(w.hp).toBe(hpBefore)
    expect(Math.abs(w.homeX - worldState.gate.x)).toBeLessThan(1)
  })
})

describe('directional damage contract', () => {
  it('a connecting blow stamps the ATTACKER position on the taken event', () => {
    toGuard()
    const s0 = feel.hitSerial
    let ev: (typeof feel.hitRing)[number] | null = null
    let guard = 0
    while (!ev && guard++ < 3000) {
      pump(5)
      for (let s = Math.max(s0, feel.hitSerial - HIT_RING_CAP) + 1; s <= feel.hitSerial; s++) {
        const e = feel.hitRing[s % HIT_RING_CAP]
        if (e.serial === s && e.kind === HK.PLAYER_TAKEN) {
          ev = e
          break
        }
      }
    }
    expect(ev).not.toBeNull()
    expect(ev!.amount).toBeGreaterThan(0)
    // the event sits at the warden's bearing, NOT on the player (the old code
    // resolved w + pd to the player's own position — a zero-length arc)
    const px = worldState.gate.x
    const pz = worldState.gate.z + 10
    const dPlayer = Math.hypot(ev!.x - px, ev!.z - pz)
    expect(dPlayer).toBeGreaterThan(2)
  })
})
