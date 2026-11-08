import { describe, expect, it } from 'vitest'
import {
  ENEMY,
  LATCH_ANCHORS,
  SWARM_ARCHETYPES,
  WARDEN_ARCHETYPES,
  WK,
} from './enemyArchetypes'
import { REALMS } from './realms'

describe('SWARM_ARCHETYPES', () => {
  it('has exactly one archetype per realm, id-aligned with the ladder', () => {
    expect(SWARM_ARCHETYPES.length).toBe(REALMS.length)
    expect(SWARM_ARCHETYPES.map(a => a.id)).toEqual(REALMS.map(r => r.id))
  })

  it('all numeric parameters are finite and positive where required', () => {
    for (const a of SWARM_ARCHETYPES) {
      for (const v of [a.hp, a.speed, a.accel, a.engageR, a.standoffR, a.windupDur, a.leapSpeed, a.latchDur, a.styleB]) {
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThan(0)
      }
      expect(a.leapRange[0]).toBeGreaterThan(0)
      expect(a.leapRange[1]).toBeGreaterThan(a.leapRange[0])
      expect(a.arcLift).toBeGreaterThanOrEqual(0)
      expect(a.label.length).toBeGreaterThan(3)
      // circling must happen outside the latch radius but inside engage
      expect(a.standoffR).toBeGreaterThan(ENEMY.LATCH_R)
      expect(a.engageR).toBeGreaterThan(a.standoffR)
      // leaps must be able to trigger from the orbit radius band
      expect(a.leapRange[0]).toBeLessThanOrEqual(a.standoffR + 2)
      expect(a.leapRange[1]).toBeGreaterThanOrEqual(a.standoffR)
    }
  })

  it('every archetype has a distinct motion style', () => {
    const styles = SWARM_ARCHETYPES.map(a => a.style)
    expect(new Set(styles).size).toBe(styles.length)
  })
})

describe('WARDEN_ARCHETYPES', () => {
  it('covers every realm with 2-3 attacks including at least one SUMMON', () => {
    expect(WARDEN_ARCHETYPES.length).toBe(REALMS.length)
    expect(WARDEN_ARCHETYPES.map(a => a.id)).toEqual(REALMS.map(r => r.id))
    for (const w of WARDEN_ARCHETYPES) {
      expect(w.attacks.length).toBeGreaterThanOrEqual(2)
      expect(w.attacks.length).toBeLessThanOrEqual(3)
      expect(w.attacks.some(a => a.kind === WK.SUMMON)).toBe(true)
      for (const atk of w.attacks) {
        expect(atk.windup).toBeGreaterThan(0.3) // telegraphs must be readable
        expect(atk.active).toBeGreaterThan(0)
        expect(atk.recover).toBeGreaterThan(0)
        expect(atk.param).toBeGreaterThan(0)
        // blood price: contact attacks hurt, summons never touch you
        expect(atk.damage).toBeGreaterThanOrEqual(0)
        if (atk.kind === WK.SLAM || atk.kind === WK.LASH) expect(atk.damage).toBeGreaterThan(0)
        if (atk.kind === WK.SUMMON) expect(atk.damage).toBe(0)
      }
      expect(w.hp).toBeGreaterThanOrEqual(200)
      expect(w.exposeEvery).toBeGreaterThanOrEqual(2)
      expect(w.weakDur).toBeGreaterThanOrEqual(3)
    }
  })

  it('summon counts never exceed a sane fraction of the swarm cap', () => {
    for (const w of WARDEN_ARCHETYPES) {
      for (const atk of w.attacks) {
        if (atk.kind === WK.SUMMON) expect(atk.param).toBeLessThanOrEqual(4)
      }
    }
  })
})

describe('LATCH_ANCHORS', () => {
  it('matches the latch capacity and stays on the body', () => {
    expect(LATCH_ANCHORS.length).toBe(ENEMY.LATCH_CAP)
    for (const [x, y, z] of LATCH_ANCHORS) {
      expect(Math.abs(x)).toBeLessThan(1)
      expect(Math.abs(y)).toBeLessThan(1)
      expect(Math.abs(z)).toBeLessThan(1)
    }
    // mirrored shoulder/hip pairs
    expect(LATCH_ANCHORS[0][0]).toBeCloseTo(-LATCH_ANCHORS[1][0], 6)
    expect(LATCH_ANCHORS[2][0]).toBeCloseTo(-LATCH_ANCHORS[3][0], 6)
  })
})

describe('ENEMY constants', () => {
  it('tier tables are 4-wide and monotonic in pressure', () => {
    for (const table of [ENEMY.BUDGET, ENEMY.TOKENS]) {
      expect(table.length).toBe(4)
      for (let i = 1; i < 4; i++) expect(table[i]).toBeGreaterThanOrEqual(table[i - 1])
    }
    expect(ENEMY.SPAWN_TICK.length).toBe(4)
    for (let i = 1; i < 4; i++) expect(ENEMY.SPAWN_TICK[i]).toBeLessThanOrEqual(ENEMY.SPAWN_TICK[i - 1])
    expect(ENEMY.TOKENS[0]).toBe(0) // CALM never leaps — the dread contract
    expect(ENEMY.BUDGET[3]).toBeLessThanOrEqual(ENEMY.SWARM_CAP)
    expect(ENEMY.SPAWN_NEAR).toBeLessThan(ENEMY.SPAWN_FAR)
    expect(ENEMY.SPAWN_FAR).toBeLessThan(ENEMY.DESPAWN_R)
  })
})
