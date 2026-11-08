import { describe, expect, it } from 'vitest'
import {
  AIM,
  aimScore,
  alignmentQuality,
  ENEMY_AIM,
  GATE_AIM,
  pickEnemyTarget,
  pickGate,
  pickPoolTarget,
  type EnemyAimPool,
  type PoolPoints,
} from './aim'
import { ES } from './enemyState'
import { ENEMY } from './enemyArchetypes'

const forward = { x: 0, y: 0, z: -1 }

function at(angleRad: number, dist: number) {
  return { x: Math.sin(angleRad) * dist, y: 0, z: -Math.cos(angleRad) * dist }
}

function enemyPool(
  pts: { x: number; y: number; z: number }[],
  states?: number[],
): EnemyAimPool {
  return {
    state: states ?? pts.map(() => ES.CIRCLE),
    x: pts.map(p => p.x),
    y: pts.map(p => p.y),
    z: pts.map(p => p.z),
  }
}

/** Build a SoA pool from plain point specs (all active unless masked). */
function pool(pts: { x: number; y: number; z: number }[], active?: number[]): PoolPoints {
  return {
    active: active ?? pts.map(() => 1),
    x: pts.map(p => p.x),
    y: pts.map(p => p.y),
    z: pts.map(p => p.z),
  }
}

describe('aimScore', () => {
  it('is 0 at the cone edge and beyond', () => {
    expect(aimScore(AIM.coneHalfRad, 20)).toBe(0)
    expect(aimScore(AIM.coneHalfRad * 1.5, 20)).toBe(0)
  })

  it('is 0 outside distance limits', () => {
    expect(aimScore(0, AIM.maxDist + 1)).toBe(0)
    expect(aimScore(0, AIM.minDist - 1)).toBe(0)
  })

  it('prefers centered aim', () => {
    expect(aimScore(0.01, 20)).toBeGreaterThan(aimScore(0.08, 20))
  })
})

describe('alignmentQuality', () => {
  const PERFECT = 0.02618 // 1.5 degrees (SCORING.perfectRad)
  const GOOD = 0.06981 // 4 degrees (SCORING.goodRad)
  const CONE = AIM.coneHalfRad

  it('classifies bands exactly at the scoring thresholds', () => {
    expect(alignmentQuality(0, CONE, PERFECT, GOOD).band).toBe('perfect')
    expect(alignmentQuality(PERFECT, CONE, PERFECT, GOOD).band).toBe('perfect')
    expect(alignmentQuality(PERFECT + 1e-6, CONE, PERFECT, GOOD).band).toBe('good')
    expect(alignmentQuality(GOOD, CONE, PERFECT, GOOD).band).toBe('good')
    expect(alignmentQuality(GOOD + 1e-6, CONE, PERFECT, GOOD).band).toBe('lock')
  })

  it('q is 1 inside perfect and 0 at the cone edge', () => {
    expect(alignmentQuality(0, CONE, PERFECT, GOOD).q).toBe(1)
    expect(alignmentQuality(PERFECT, CONE, PERFECT, GOOD).q).toBe(1)
    expect(alignmentQuality(CONE, CONE, PERFECT, GOOD).q).toBe(0)
    expect(alignmentQuality(CONE * 2, CONE, PERFECT, GOOD).q).toBe(0)
  })

  it('q decreases monotonically across the cone', () => {
    let prev = Infinity
    for (let a = 0; a <= CONE + 1e-9; a += CONE / 20) {
      const { q } = alignmentQuality(a, CONE, PERFECT, GOOD)
      expect(q).toBeLessThanOrEqual(prev + 1e-9)
      expect(q).toBeGreaterThanOrEqual(0)
      expect(q).toBeLessThanOrEqual(1)
      prev = q
    }
  })
})

describe('pickPoolTarget', () => {
  it('selects a point straight ahead', () => {
    const r = pickPoolTarget(pool([at(0, 20)]), 0, 0, 0, forward.x, forward.y, forward.z)
    expect(r.index).toBe(0)
    expect(r.angle).toBeCloseTo(0, 5)
    expect(r.dist).toBeCloseTo(20, 5)
  })

  it('ignores inactive slots', () => {
    const r = pickPoolTarget(pool([at(0, 20)], [0]), 0, 0, 0, forward.x, forward.y, forward.z)
    expect(r.index).toBe(-1)
  })

  it('excludes points behind the camera', () => {
    const behind = { x: 0, y: 0, z: 30 }
    const r = pickPoolTarget(pool([behind]), 0, 0, 0, forward.x, forward.y, forward.z)
    expect(r.index).toBe(-1)
  })

  it('excludes points outside the cone', () => {
    const tenDegrees = (10 * Math.PI) / 180
    const r = pickPoolTarget(pool([at(tenDegrees, 20)]), 0, 0, 0, forward.x, forward.y, forward.z)
    expect(r.index).toBe(-1)
  })

  it('prefers nearer of two equally-centered points', () => {
    const twoDeg = (2 * Math.PI) / 180
    const r = pickPoolTarget(
      pool([at(twoDeg, 60), at(twoDeg, 10)]),
      0,
      0,
      0,
      forward.x,
      forward.y,
      forward.z,
    )
    expect(r.index).toBe(1)
  })

  it('prefers the more centered of two equally-near points', () => {
    const r = pickPoolTarget(
      pool([at(0.1, 20), at(0.02, 20)]),
      0,
      0,
      0,
      forward.x,
      forward.y,
      forward.z,
    )
    expect(r.index).toBe(1)
  })

  it('third-person minDist inflation rejects points between camera and body', () => {
    // Camera 5.5u behind the body: anything closer than minDist + 5.5 is out.
    const cfg = { ...AIM, minDist: AIM.minDist + 5.5 }
    const between = pickPoolTarget(pool([at(0, 4)]), 0, 0, 0, forward.x, forward.y, forward.z, cfg)
    expect(between.index).toBe(-1)
    const ahead = pickPoolTarget(pool([at(0, 12)]), 0, 0, 0, forward.x, forward.y, forward.z, cfg)
    expect(ahead.index).toBe(0)
  })
})

describe('pickGate', () => {
  it('hits a gate inside the wider cone', () => {
    const tenDegrees = (10 * Math.PI) / 180 // outside AIM cone, inside GATE cone
    const g = at(tenDegrees, 50)
    const r = pickGate(g.x, g.y, g.z, 0, 0, 0, forward.x, forward.y, forward.z)
    expect(r.index).toBe(0)
    expect(r.score).toBeGreaterThan(0)
    expect(GATE_AIM.coneHalfRad).toBeGreaterThan(AIM.coneHalfRad)
  })

  it('misses outside cone / behind / beyond reach', () => {
    const wide = at(0.3, 50)
    expect(pickGate(wide.x, wide.y, wide.z, 0, 0, 0, forward.x, forward.y, forward.z).index).toBe(-1)
    expect(pickGate(0, 0, 30, 0, 0, 0, forward.x, forward.y, forward.z).index).toBe(-1)
    const far = at(0, GATE_AIM.maxDist + 5)
    expect(pickGate(far.x, far.y, far.z, 0, 0, 0, forward.x, forward.y, forward.z).index).toBe(-1)
  })
})

describe('pickEnemyTarget', () => {
  it('mirrors the point-cone behavior with the enemy config', () => {
    const p = enemyPool([at(0.02, 20), at(0.1, 20)])
    const r = pickEnemyTarget(p, 0, 0, 0, forward.x, forward.y, forward.z)
    expect(r.index).toBe(0)
    expect(r.score).toBeGreaterThan(0)
    // outside the cone / distance band
    const far = pickEnemyTarget(enemyPool([at(0, ENEMY_AIM.maxDist + 5)]), 0, 0, 0, 0, 0, -1)
    expect(far.index).toBe(-1)
    const near = pickEnemyTarget(enemyPool([at(0, ENEMY_AIM.minDist - 1)]), 0, 0, 0, 0, 0, -1)
    expect(near.index).toBe(-1)
  })

  it('excludes LATCHED, DYING, and DORMANT horrors from the reticle', () => {
    const pts = [at(0.01, 15), at(0.02, 15), at(0.03, 15), at(0.04, 15)]
    const r = pickEnemyTarget(
      enemyPool(pts, [ES.DORMANT, ES.LATCHED, ES.DYING, ES.STALK]),
      0,
      0,
      0,
      forward.x,
      forward.y,
      forward.z,
    )
    expect(r.index).toBe(3)
  })

  it('targets staggered and retreating horrors (punish windows stay open)', () => {
    const r = pickEnemyTarget(
      enemyPool([at(0.01, 15), at(0.05, 15)], [ES.STAGGER, ES.RETREAT]),
      0,
      0,
      0,
      forward.x,
      forward.y,
      forward.z,
    )
    expect(r.index).toBe(0)
  })
})

describe('target sentinel arithmetic', () => {
  it('gate < enemy base, and the enemy range never collides with the warden', () => {
    const TARGET_GATE = 100
    const TARGET_ENEMY_BASE = 200
    const TARGET_WARDEN = 300
    expect(TARGET_GATE).toBeLessThan(TARGET_ENEMY_BASE)
    expect(TARGET_ENEMY_BASE + ENEMY.SWARM_CAP).toBeLessThanOrEqual(TARGET_WARDEN)
  })
})
