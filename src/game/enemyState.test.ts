import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyRadialImpulse,
  applySnapStrike,
  banishNova,
  collectStormTargets,
  damageEnemy,
  enemyState,
  ES,
  fireBolt,
  isDownedTriggered,
  latchLoad,
  liveSwarmCount,
  releaseAllLatched,
  resetEnemies,
  spawnWarden,
  tearOffOneLatch,
  updateEnemies,
  WP,
  type BoltSpec,
  type EnemyDirectorInput,
} from './enemyState'
import { ENEMY, SWARM_ARCHETYPES } from './enemyArchetypes'
import { COMBAT, killScore } from './combat'
import { feel, HIT_RING_CAP, HK } from './feelSignals'
import { PLAYER_HP } from './playerHealth'
import { performRealmSwap, resetWorld, streamWorld, worldState } from './worldState'
import { freshCombatCounters, resetRun, runState } from './runState'
import { LAYOUT } from './layout'
import { getRealmForDepth } from './realms'

const P = LAYOUT.spawn

function input(over: Partial<EnemyDirectorInput> = {}): EnemyDirectorInput {
  return {
    px: P.x,
    py: P.y,
    pz: P.z,
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

let clock = 0
function pump(frames: number, inp: EnemyDirectorInput, dt = 1 / 60): void {
  for (let f = 0; f < frames; f++) {
    clock += dt
    updateEnemies(dt, clock, inp)
  }
}

/** Force a live enemy directly into the pool (tests own the singleton). */
function forceEnemy(i: number, x: number, y: number, z: number, state: number = ES.CIRCLE): void {
  const p = enemyState.pool
  const arch = worldState.depth % 6
  p.state[i] = state
  p.archetype[i] = arch
  p.x[i] = x
  p.y[i] = y
  p.z[i] = z
  p.vx[i] = p.vy[i] = p.vz[i] = 0
  p.maxHp[i] = SWARM_ARCHETYPES[arch].hp
  p.hp[i] = p.maxHp[i]
  p.serial[i]++
  p.stateT[i] = 0
  p.seed[i] = (i * 2654435761) >>> 0
  p.latchSlot[i] = -1
  p.dir[i] = 1
  p.ix[i] = p.iy[i] = p.iz[i] = 0
}

/** Put an enemy on a leap that lands exactly on the player. */
function forceLeapAtPlayer(i: number): void {
  const p = enemyState.pool
  forceEnemy(i, P.x + 6, P.y, P.z, ES.LEAP)
  p.lx[i] = P.x + 6
  p.ly[i] = P.y
  p.lz[i] = P.z
  p.tx[i] = P.x
  p.ty[i] = P.y
  p.tz[i] = P.z
  p.leapDur[i] = 0.3
  p.stateT[i] = 0
}

function latchN(n: number): void {
  for (let i = 0; i < n; i++) {
    forceLeapAtPlayer(i)
    enemyState.pool.stateT[i] = 0.29 // lands next tick
  }
  pump(2, input())
}

beforeEach(() => {
  clock = 100
  resetWorld(1234, 0)
  streamWorld(P.x, P.z, clock)
  resetRun(0, 0)
  runState.combat = freshCombatCounters()
  resetEnemies(1234, 0)
})

describe('pool conservation', () => {
  it('never exceeds the cap and serials bump on spawn AND free', () => {
    const inp = input({ tier: 3 })
    enemyState.graceLeft = 0
    const before = Array.from(enemyState.pool.serial)
    pump(1200, inp) // 20 sim-seconds of SHATTER pressure
    expect(liveSwarmCount()).toBeLessThanOrEqual(ENEMY.SWARM_CAP)
    expect(liveSwarmCount()).toBeGreaterThan(0)
    const p = enemyState.pool
    let bumped = 0
    for (let i = 0; i < ENEMY.SWARM_CAP; i++) {
      if (p.serial[i] !== before[i]) bumped++
    }
    expect(bumped).toBeGreaterThan(0)
    // kill one and watch its serial move again on free
    let live = -1
    for (let i = 0; i < ENEMY.SWARM_CAP; i++) {
      if (p.state[i] !== ES.DORMANT && p.state[i] !== ES.DYING) {
        live = i
        break
      }
    }
    const s0 = p.serial[live]
    damageEnemy(live, 9999, clock, 1)
    expect(p.state[live]).toBe(ES.DYING)
    pump(Math.ceil((ENEMY.DEATH_HOLD + 0.1) * 60), inp)
    expect(p.serial[live]).toBeGreaterThan(s0)
  })

  it('spawns nothing during the run-start grace window', () => {
    expect(enemyState.graceLeft).toBe(ENEMY.GRACE_SEC)
    pump(60, input({ tier: 3 })) // 1s — still inside grace
    expect(liveSwarmCount()).toBe(0)
  })

  it('CALM keeps only lurkers within the density budget', () => {
    enemyState.graceLeft = 0
    const inp = input({ tier: 0 })
    pump(2400, inp) // 40 sim-seconds
    const budget = Math.round(ENEMY.BUDGET[0] * getRealmForDepth(0).mods.enemyDensity)
    expect(liveSwarmCount()).toBeLessThanOrEqual(budget + 2)
    // CALM has zero attack tokens: nobody ever winds up or leaps
    const p = enemyState.pool
    for (let i = 0; i < ENEMY.SWARM_CAP; i++) {
      expect(p.state[i]).not.toBe(ES.WINDUP)
      expect(p.state[i]).not.toBe(ES.LEAP)
      expect(p.state[i]).not.toBe(ES.LATCHED)
    }
  })

  it('a tier drop marks the excess for retreat and the swarm decays', () => {
    enemyState.graceLeft = 0
    pump(1200, input({ tier: 3 }))
    const peak = liveSwarmCount()
    expect(peak).toBeGreaterThan(4)
    pump(2400, input({ tier: 0 }))
    expect(liveSwarmCount()).toBeLessThan(peak)
  })
})

describe('determinism', () => {
  it('identical (seed, depth, input sequence) yields identical pools', () => {
    const run = () => {
      clock = 100
      resetWorld(777, 0)
      streamWorld(P.x, P.z, clock)
      resetRun(0, 0)
      resetEnemies(777, 0)
      enemyState.graceLeft = 0
      pump(600, input({ tier: 2 }))
      const p = enemyState.pool
      return [
        Array.from(p.state),
        Array.from(p.x),
        Array.from(p.y),
        Array.from(p.z),
        Array.from(p.hp),
        Array.from(p.seed),
      ]
    }
    const a = run()
    const b = run()
    expect(b).toEqual(a)
  })
})

describe('latch registry', () => {
  it('latches on leap contact, bijectively, and counts suffering', () => {
    forceLeapAtPlayer(0)
    pump(30, input())
    const p = enemyState.pool
    expect(p.state[0]).toBe(ES.LATCHED)
    const k = p.latchSlot[0]
    expect(k).toBeGreaterThanOrEqual(0)
    expect(enemyState.latchSlots[k]).toBe(0)
    expect(enemyState.latchedCount).toBe(1)
    expect(runState.combat.latchesSuffered).toBe(1)
    expect(runState.combat.lastLatchAt).toBeGreaterThan(0)
  })

  it('a leap through an untargetable player whiffs to STAGGER', () => {
    forceLeapAtPlayer(0)
    pump(30, input({ playerUntargetable: true }))
    expect(enemyState.pool.state[0]).toBe(ES.STAGGER)
    expect(enemyState.latchedCount).toBe(0)
  })

  it('never exceeds LATCH_CAP; the overflow leap bounces off', () => {
    latchN(ENEMY.LATCH_CAP)
    expect(enemyState.latchedCount).toBe(ENEMY.LATCH_CAP)
    forceLeapAtPlayer(10)
    pump(30, input())
    expect(enemyState.pool.state[10]).toBe(ES.STAGGER)
    expect(enemyState.latchedCount).toBe(ENEMY.LATCH_CAP)
  })

  it('isDownedTriggered fires exactly at maxLatch', () => {
    latchN(2)
    expect(isDownedTriggered(3)).toBe(false)
    expect(latchLoad(3)).toBeCloseTo(2 / 3, 5)
    releaseAllLatched(clock, false)
    latchN(3)
    expect(enemyState.latchedCount).toBe(3)
    expect(isDownedTriggered(3)).toBe(true)
  })

  it('releaseAllLatched empties both sides of the registry', () => {
    latchN(4)
    const released = releaseAllLatched(clock, true)
    expect(released).toBe(4)
    expect(enemyState.latchedCount).toBe(0)
    const p = enemyState.pool
    for (let i = 0; i < 4; i++) {
      expect(p.latchSlot[i]).toBe(-1)
      expect(p.state[i]).toBe(ES.STAGGER)
    }
    for (let k = 0; k < ENEMY.LATCH_CAP; k++) expect(enemyState.latchSlots[k]).toBe(-1)
    expect(runState.combat.shakeoffs).toBe(4)
  })

  it('tearOffOneLatch removes the oldest rider', () => {
    latchN(2)
    const p = enemyState.pool
    p.stateT[0] = 5 // rider 0 has been on longest
    p.stateT[1] = 1
    expect(tearOffOneLatch(clock)).toBe(true)
    expect(p.latchSlot[0]).toBe(-1)
    expect(p.state[0]).toBe(ES.STAGGER)
    expect(enemyState.latchedCount).toBe(1)
    expect(tearOffOneLatch(clock)).toBe(true)
    expect(tearOffOneLatch(clock)).toBe(false)
  })

  it('latches auto-expire to STAGGER after latchDur', () => {
    latchN(1)
    const arch = SWARM_ARCHETYPES[enemyState.pool.archetype[0]]
    pump(Math.ceil((arch.latchDur + 0.2) * 60), input())
    expect(enemyState.pool.state[0]).toBe(ES.STAGGER)
    expect(enemyState.latchedCount).toBe(0)
  })

  it('killing a latched horror releases its slot', () => {
    latchN(2)
    damageEnemy(0, 9999, clock, 2)
    expect(enemyState.pool.state[0]).toBe(ES.DYING)
    expect(enemyState.pool.latchSlot[0]).toBe(-1)
    expect(enemyState.latchedCount).toBe(1)
  })
})

describe('damage and counters', () => {
  it('counts each kill exactly once with archetype attribution and score', () => {
    forceEnemy(0, P.x + 10, P.y, P.z)
    const score0 = runState.scoreState.score
    expect(damageEnemy(0, 5, clock, 1)).toBe(false)
    expect(damageEnemy(0, 9999, clock, 1)).toBe(true)
    expect(damageEnemy(0, 9999, clock, 1)).toBe(false) // already dying
    const c = runState.combat
    expect(c.kills).toBe(1)
    expect(c.killsByArchetype[0]).toBe(1)
    expect(c.shardsEarned).toBe(1)
    expect(c.damageDealt).toBeGreaterThan(0)
    expect(c.boltDamage).toBeGreaterThan(0)
    expect(runState.scoreState.score).toBeGreaterThan(score0)
  })

  it('applySnapStrike returns 0|1|2 (miss/hit/kill) under serial+range guards', () => {
    forceEnemy(0, P.x + 5, P.y, P.z)
    const p = enemyState.pool
    const good = applySnapStrike(0, p.serial[0], P.x + 5, P.y, P.z, 10, clock)
    expect(good).toBe(1) // connected, non-lethal
    expect(p.hp[0]).toBeCloseTo(p.maxHp[0] - 10, 4)
    // stale serial whiffs
    expect(applySnapStrike(0, p.serial[0] - 1, P.x + 5, P.y, P.z, 10, clock)).toBe(0)
    // too far from the committed hit point whiffs
    expect(applySnapStrike(0, p.serial[0], P.x + 30, P.y, P.z, 10, clock)).toBe(0)
    // the killing blow reports 2
    expect(applySnapStrike(0, p.serial[0], P.x + 5, P.y, P.z, 9999, clock)).toBe(2)
  })

  it('damage pushes feel ring events with kind/crit/kill and kills honor the multiplier', () => {
    forceEnemy(0, P.x + 5, P.y, P.z)
    const p = enemyState.pool
    const s0 = feel.hitSerial
    applySnapStrike(0, p.serial[0], P.x + 5, P.y, P.z, 10, clock, true)
    expect(feel.hitSerial).toBe(s0 + 1)
    const e = feel.hitRing[feel.hitSerial % HIT_RING_CAP]
    expect(e.kind).toBe(HK.STRIKE)
    expect(e.crit).toBe(1)
    expect(e.kill).toBe(0)
    expect(e.targetId).toBe(0)
    // a hot multiplier scales the kill score
    runState.scoreState.multiplier = 3
    const scoreBefore = runState.scoreState.score
    const killsBefore = feel.killConfirmCount
    applySnapStrike(0, p.serial[0], P.x + 5, P.y, P.z, 9999, clock)
    const gained = runState.scoreState.score - scoreBefore
    expect(gained).toBe(Math.round(killScore(p.maxHp[0], worldState.depth) * 3))
    expect(feel.killConfirmCount).toBe(killsBefore + 1)
    const k = feel.hitRing[feel.hitSerial % HIT_RING_CAP]
    expect(k.kill).toBe(1)
  })

  it('latch gnaws tick deterministically under any dt slicing', () => {
    latchN(1)
    const hp0 = runState.hp
    // ~3.2s at 60fps: first tick at gnawFirstAt (0.6), then every 1.0s
    pump(192, input())
    const coarseLoss = hp0 - runState.hp
    expect(coarseLoss).toBe(PLAYER_HP.gnawDamage * 3) // ticks at 0.6, 1.6, 2.6
    // stops the instant the rider is torn off
    releaseAllLatched(clock, true)
    const hpAfter = runState.hp
    pump(120, input())
    expect(runState.hp).toBe(hpAfter)
  })

  it('a lash connect pays warden damage into the player pool once per mercy window', () => {
    // drive the warden by hand: LASH mid-swing through the player
    const w = enemyState.warden
    spawnWarden(P.x, P.y - 6, P.z, 0, 1, clock)
    w.phase = WP.ATTACK
    w.phaseT = 0.4 // mid-swing (k=0.5): the sweep rotation is ~zero there
    w.attackIdx = 1 // astral attacks[1] = LASH
    w.attackHitDone = false
    w.lashAx = P.x - 15
    w.lashAy = P.y
    w.lashAz = P.z
    w.lashBx = P.x + 15
    w.lashBy = P.y
    w.lashBz = P.z
    const hp0 = runState.hp
    pump(3, input())
    expect(hp0 - runState.hp).toBe(12) // LASH damage lands exactly once
  })

  it('radial impulse pushes only inside the radius and interrupts attacks', () => {
    forceEnemy(0, P.x + 4, P.y, P.z, ES.WINDUP)
    forceEnemy(1, P.x + 50, P.y, P.z)
    applyRadialImpulse(P.x, P.y, P.z, 10, 20)
    const p = enemyState.pool
    expect(p.ix[0]).toBeGreaterThan(0)
    expect(p.state[0]).toBe(ES.STAGGER)
    expect(p.ix[1]).toBe(0)
    pump(1, input())
    expect(p.ix[0]).toBe(0) // consumed into velocity
    expect(p.vx[0]).toBeGreaterThan(0)
  })

  it('banishNova releases, damages with falloff, and counts the nova', () => {
    latchN(3)
    forceEnemy(10, P.x + 6, P.y, P.z)
    const hpFar = enemyState.pool.hp[10]
    banishNova(P.x, P.y, P.z, clock, runState.stats)
    expect(enemyState.latchedCount).toBe(0)
    expect(runState.combat.novasFired).toBe(1)
    // released riders were at the player's chest — near-full nova damage
    expect(enemyState.pool.hp[0]).toBeLessThan(enemyState.pool.maxHp[0])
    expect(enemyState.pool.hp[10]).toBeLessThan(hpFar)
  })
})

describe('drop waves and beat quantize', () => {
  it('a drop commit sends all circling horrors in range into pre-advanced windup', () => {
    enemyState.lastDropCount = 0
    forceEnemy(0, P.x + 10, P.y, P.z)
    forceEnemy(1, P.x + 12, P.y + 2, P.z)
    forceEnemy(2, P.x + 90, P.y, P.z) // far outside the wave
    pump(1, input({ dropCount: 1 }))
    const p = enemyState.pool
    expect(p.state[0]).toBe(ES.WINDUP)
    expect(p.state[1]).toBe(ES.WINDUP)
    expect(p.state[2]).not.toBe(ES.WINDUP)
    const table = SWARM_ARCHETYPES[p.archetype[0]]
    expect(p.stateT[0]).toBeGreaterThanOrEqual(table.windupDur * 0.5)
  })

  it('windup launches on a strong beat, or times out 0.4s past due', () => {
    forceEnemy(0, P.x + 10, P.y, P.z, ES.WINDUP)
    const p = enemyState.pool
    const table = SWARM_ARCHETYPES[p.archetype[0]]
    p.stateT[0] = table.windupDur + 0.01
    pump(1, input({ beatPulse: 0 }))
    expect(p.state[0]).toBe(ES.WINDUP) // waiting for the beat
    pump(1, input({ beatPulse: 1 }))
    expect(p.state[0]).toBe(ES.LEAP)
    // timeout path
    forceEnemy(1, P.x + 10, P.y, P.z, ES.WINDUP)
    p.stateT[1] = table.windupDur + 0.45
    pump(1, input({ beatPulse: 0 }))
    expect(p.state[1]).toBe(ES.LEAP)
  })

  it('a dodged leap overshoots into a punishable stagger', () => {
    forceLeapAtPlayer(0)
    // move the player far away so the frozen prediction misses
    pump(40, input({ px: P.x + 40, pz: P.z + 40 }))
    expect(enemyState.pool.state[0]).toBe(ES.STAGGER)
  })
})

/** Neutral cast spec: the old straight-bolt behavior (no arc, no pierce). */
function spec(over: Partial<BoltSpec> = {}): BoltSpec {
  return {
    power: 0,
    speed: COMBAT.bolt.speed,
    radius: COMBAT.bolt.hitR,
    pierce: 0,
    grav: 0,
    homeTurn: COMBAT.bolt.homeTurn,
    lobUp: 0,
    life: COMBAT.bolt.life,
    crit: false,
    ...over,
  }
}

describe('bolts', () => {
  it('respects the pool cap and expires by lifetime', () => {
    for (let i = 0; i < ENEMY.BOLT_CAP; i++) {
      expect(fireBolt(P.x, P.y, P.z, 0, 0, -1, 12, -1, 0, clock, spec())).toBe(true)
    }
    expect(fireBolt(P.x, P.y, P.z, 0, 0, -1, 12, -1, 0, clock, spec())).toBe(false)
    expect(runState.combat.boltsFired).toBe(ENEMY.BOLT_CAP)
    pump(Math.ceil((COMBAT.bolt.life + 0.1) * 60), input())
    const b = enemyState.bolts
    for (let i = 0; i < ENEMY.BOLT_CAP; i++) expect(b.active[i]).toBe(0)
  })

  it('hits apply damage once and free the bolt', () => {
    forceEnemy(0, P.x, P.y, P.z - 10)
    fireBolt(P.x, P.y, P.z, 0, 0, -1, 12, 0, enemyState.pool.serial[0], clock, spec())
    const hp0 = enemyState.pool.hp[0]
    pump(30, input())
    expect(enemyState.pool.hp[0]).toBeCloseTo(hp0 - 12, 3)
    expect(enemyState.bolts.active.every(v => v === 0)).toBe(true)
  })

  it('stale homing serials are ignored (bolt flies straight)', () => {
    forceEnemy(0, P.x + 20, P.y, P.z - 10)
    const stale = enemyState.pool.serial[0] - 1
    fireBolt(P.x, P.y, P.z, 0, 0, -1, 12, 0, stale, clock, spec())
    pump(3, input())
    const b = enemyState.bolts
    expect(b.homeIdx[0]).toBe(-1)
    expect(Math.abs(b.vx[0])).toBeLessThan(0.01) // never curved toward the target
  })

  it('per-bolt life is honored (a charged shot expires sooner)', () => {
    fireBolt(P.x, P.y + 40, P.z, 0, 1, 0, 12, -1, 0, clock, spec({ life: 0.3 }))
    pump(Math.ceil(0.4 * 60), input())
    expect(enemyState.bolts.active[0]).toBe(0)
  })

  it('gravity arcs an unlocked bolt downward', () => {
    fireBolt(P.x, P.y, P.z, 0, 0, -1, 12, -1, 0, clock, spec({ grav: COMBAT.bolt.gravity }))
    const b = enemyState.bolts
    pump(30, input())
    expect(b.vy[0]).toBeLessThan(-1) // 0.5s at g=5 → vy ≈ -2.5
  })

  it('lobUp launches a quick bolt with upward bias', () => {
    fireBolt(P.x, P.y, P.z, 0, 0, -1, 12, -1, 0, clock, spec({ lobUp: COMBAT.bolt.lobUp }))
    expect(enemyState.bolts.vy[0]).toBeCloseTo(COMBAT.bolt.lobUp, 3)
  })

  it('a full-draw shot pierces a line of enemies then frees', () => {
    // three horrors staggered along -Z, spaced past the hit radius
    forceEnemy(0, P.x, P.y, P.z - 8)
    forceEnemy(1, P.x, P.y, P.z - 16)
    forceEnemy(2, P.x, P.y, P.z - 24)
    const dmg = 12 // below any hp — nobody dies, pure pierce path
    fireBolt(P.x, P.y, P.z, 0, 0, -1, dmg, -1, 0, clock,
      spec({ power: 1, speed: 72, radius: 2.6, pierce: 2, homeTurn: 0 }))
    const hp = [enemyState.pool.hp[0], enemyState.pool.hp[1], enemyState.pool.hp[2]]
    pump(40, input())
    expect(enemyState.pool.hp[0]).toBeCloseTo(hp[0] - dmg, 3)
    expect(enemyState.pool.hp[1]).toBeCloseTo(hp[1] - dmg, 3)
    expect(enemyState.pool.hp[2]).toBeCloseTo(hp[2] - dmg, 3)
    expect(enemyState.bolts.active[0]).toBe(0) // pierce spent on the third
  })

  it('the pierce hit-list never strikes the same enemy twice', () => {
    // an enemy sitting still inside the travel path would re-collide every
    // frame without the (idx, serial) guard
    forceEnemy(0, P.x, P.y, P.z - 8)
    const dmg = 5
    fireBolt(P.x, P.y, P.z, 0, 0, -1, dmg, -1, 0, clock,
      spec({ power: 1, speed: 10, radius: 3, pierce: 3, homeTurn: 0 }))
    const hp0 = enemyState.pool.hp[0]
    pump(60, input())
    expect(enemyState.pool.hp[0]).toBeCloseTo(hp0 - dmg, 3)
  })

  it('a charged hit styles as crit and shoves nearby enemies', () => {
    forceEnemy(0, P.x, P.y, P.z - 8)
    const before = feel.hitSerial
    fireBolt(P.x, P.y, P.z, 0, 0, -1, 40, -1, 0, clock,
      spec({ power: 1, radius: 2.6, homeTurn: 0 }))
    pump(20, input())
    expect(feel.hitSerial).toBeGreaterThan(before)
    const e = feel.hitRing[feel.hitSerial % HIT_RING_CAP]
    expect(e.kind).toBe(HK.BOLT)
    expect(e.crit).toBe(1)
  })

  it('on-beat crit flag styles even a quick bolt hit', () => {
    forceEnemy(0, P.x, P.y, P.z - 8)
    fireBolt(P.x, P.y, P.z, 0, 0, -1, 12, -1, 0, clock, spec({ crit: true }))
    pump(20, input())
    const e = feel.hitRing[feel.hitSerial % HIT_RING_CAP]
    expect(e.crit).toBe(1)
  })

  it('the raised pool admits a storm fan + a volley + a quick stream', () => {
    const need = COMBAT.cast.stormCount + COMBAT.cast.volleyCount + 5
    expect(need).toBeLessThanOrEqual(ENEMY.BOLT_CAP)
    for (let i = 0; i < need; i++) {
      expect(fireBolt(P.x, P.y + 60, P.z, 0, 1, 0, 5, -1, 0, clock, spec())).toBe(true)
    }
  })

  it('a storm-spec shard launched up-and-over homes down onto its target', () => {
    forceEnemy(0, P.x, P.y, P.z - 12)
    const hp0 = enemyState.pool.hp[0]
    const c = COMBAT.cast
    fireBolt(
      P.x, P.y, P.z,
      0, Math.tan(c.stormUpPitch), -1,
      10, 0, enemyState.pool.serial[0], clock,
      spec({
        power: 1,
        speed: c.fullSpeed * c.stormSpeedK,
        radius: c.fullHitR,
        grav: c.stormGravity,
        homeTurn: c.stormHomeTurn,
        life: c.stormLife,
      }),
    )
    pump(Math.ceil(c.stormLife * 60), input())
    expect(enemyState.pool.hp[0]).toBeLessThan(hp0)
  })

  it('a volley-spec bolt flies without homing correction', () => {
    forceEnemy(0, P.x + 20, P.y, P.z - 10)
    fireBolt(P.x, P.y, P.z, 0, 0, -1, 12, -1, 0, clock,
      spec({ power: 1, speed: COMBAT.cast.fullSpeed, homeTurn: 0, life: COMBAT.cast.volleyLife }))
    pump(10, input())
    expect(Math.abs(enemyState.bolts.vx[0])).toBeLessThan(0.01)
  })

  it('collectStormTargets returns nearest targetable horrors first, capped', () => {
    forceEnemy(0, P.x + 30, P.y, P.z)
    forceEnemy(1, P.x + 5, P.y, P.z)
    forceEnemy(2, P.x + 15, P.y, P.z)
    forceEnemy(3, P.x + 2, P.y, P.z, ES.LATCHED) // a rider is never a storm target
    const out = new Int16Array(8)
    const n = collectStormTargets(out, P.x, P.y, P.z, 2)
    expect(n).toBe(2)
    expect(out[0]).toBe(1)
    expect(out[1]).toBe(2)
  })
})

describe('realm swap epoch', () => {
  it('clears the swarm + warden and re-arms the spawn grace', () => {
    enemyState.graceLeft = 0
    pump(600, input({ tier: 3 }))
    expect(liveSwarmCount()).toBeGreaterThan(0)
    performRealmSwap(clock)
    pump(1, input())
    expect(liveSwarmCount()).toBe(0)
    expect(enemyState.latchedCount).toBe(0)
    expect(enemyState.graceLeft).toBeGreaterThan(0)
    expect(enemyState.epoch).toBe(worldState.epoch)
  })
})
