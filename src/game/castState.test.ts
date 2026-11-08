import { describe, expect, it } from 'vitest'
import { CP, makeCastState, recoverDuration, resetCast, stepCast, type CastLoose } from './castState'
import {
  castDamage,
  castGravity,
  castHitR,
  castHomeTurn,
  castLife,
  castPierce,
  castSpeed,
  CHARGED_HIT_DMG,
  COMBAT,
} from './combat'

const DT = 1 / 120 // fine-grained fixed step for exact boundary checks

/** Drive the machine with a scripted hold pattern; returns every loose. */
function drive(
  cs: ReturnType<typeof makeCastState>,
  frames: number,
  held: (t: number) => boolean,
  start = false,
  canAct: () => boolean = () => true,
  castMult = 1,
  drawMult = 1,
): CastLoose[] {
  const out: CastLoose[] = []
  let t = 0
  for (let f = 0; f < frames; f++) {
    const edge = f === 0 && start
    const l = stepCast(cs, edge, held(t), canAct(), DT, castMult, drawMult)
    if (l) out.push(l)
    t += DT
  }
  return out
}

describe('castState machine', () => {
  it('a tap looses a quick bolt exactly at windup end', () => {
    const cs = makeCastState()
    // press for one frame only, release immediately
    const looses = drive(cs, 300, t => t < DT, true)
    expect(looses).toHaveLength(1)
    expect(looses[0].power).toBe(0)
  })

  it('holding never autofires — one loose per press', () => {
    const cs = makeCastState()
    const looses = drive(cs, 1200, () => true, true) // held 10s
    expect(looses).toHaveLength(0) // still drawing, no release
    expect(cs.phase).toBe(CP.CHARGE)
    expect(cs.power).toBe(1)
  })

  it('release mid-draw looses at current power with the minChargePower floor', () => {
    const cs = makeCastState()
    // release almost immediately after entering CHARGE
    const windup = COMBAT.cast.windup
    const looses = drive(cs, 300, t => t < windup + 0.02, true)
    expect(looses).toHaveLength(1)
    expect(looses[0].power).toBeCloseTo(COMBAT.cast.minChargePower, 5)
  })

  it('a full hold then release looses at power 1', () => {
    const cs = makeCastState()
    const holdFor = COMBAT.cast.windup + COMBAT.cast.chargeTime + 0.2
    const looses = drive(cs, 300, t => t < holdFor, true)
    expect(looses).toHaveLength(1)
    expect(looses[0].power).toBe(1)
  })

  it('recover scales with loose power and castSpeedMult', () => {
    expect(recoverDuration(0, 1)).toBeCloseTo(COMBAT.cast.recoverQuick, 6)
    expect(recoverDuration(1, 1)).toBeCloseTo(COMBAT.cast.recoverFull, 6)
    expect(recoverDuration(1, 2)).toBeCloseTo(COMBAT.cast.recoverFull / 2, 6)
  })

  it('castSpeedMult shortens the windup; drawSpeedMult shortens the ramp', () => {
    const fast = makeCastState()
    const slow = makeCastState()
    // 2x cast speed: tap looses in half the frames
    const framesFor = (cs: typeof fast, mult: number) => {
      let n = 0
      for (let f = 0; f < 600; f++) {
        n++
        if (stepCast(cs, f === 0, false, true, DT, mult, 1)) break
      }
      return n
    }
    const nFast = framesFor(fast, 2)
    const nSlow = framesFor(slow, 1)
    expect(nFast).toBeLessThan(nSlow)
    // 2x draw speed reaches full power in half the time
    const cs = makeCastState()
    drive(cs, Math.ceil((COMBAT.cast.windup + COMBAT.cast.chargeTime / 2 + 0.05) / DT), () => true, true, () => true, 1, 2)
    expect(cs.power).toBe(1)
  })

  it('!canAct mid-cast cancels outright without a loose', () => {
    const cs = makeCastState()
    let act = true
    const looses = drive(cs, 120, () => true, true, () => act)
    expect(looses).toHaveLength(0)
    act = false
    const after = drive(cs, 10, () => true, false, () => act)
    expect(after).toHaveLength(0)
    expect(cs.phase).toBe(CP.IDLE)
    expect(cs.power).toBe(0)
  })

  it('a second press cannot start until RECOVER completes', () => {
    const cs = makeCastState()
    drive(cs, Math.ceil((COMBAT.cast.windup + DT) / DT) + 1, t => t < DT, true)
    expect(cs.phase).toBe(CP.RECOVER)
    stepCast(cs, true, true, true, DT, 1, 1) // press during recover — ignored
    expect(cs.phase).toBe(CP.RECOVER)
  })

  it('resetCast restores a clean idle', () => {
    const cs = makeCastState()
    drive(cs, 60, () => true, true)
    resetCast(cs)
    expect(cs).toEqual(makeCastState())
  })
})

describe('overdraw', () => {
  const fullAt = COMBAT.cast.windup + COMBAT.cast.chargeTime
  const splitAt = fullAt + COMBAT.cast.overdrawTime

  it('holding past full draw ramps overdraw to 1 and holds without firing', () => {
    const cs = makeCastState()
    const looses = drive(cs, Math.ceil((splitAt + 0.3) / DT), () => true, true)
    expect(looses).toHaveLength(0)
    expect(cs.phase).toBe(CP.CHARGE)
    expect(cs.power).toBe(1)
    expect(cs.over).toBe(1)
  })

  it('release inside the overdraw window looses at full power with over < 1', () => {
    const cs = makeCastState()
    const holdFor = fullAt + COMBAT.cast.overdrawTime * 0.5
    const looses = drive(cs, Math.ceil((splitAt + 0.3) / DT), t => t < holdFor, true)
    expect(looses).toHaveLength(1)
    expect(looses[0].power).toBe(1)
    expect(looses[0].over).toBeGreaterThan(0.3)
    expect(looses[0].over).toBeLessThan(1)
  })

  it('release past the overdraw window carries over === 1 on the loose', () => {
    const cs = makeCastState()
    const looses = drive(cs, Math.ceil((splitAt + 0.4) / DT), t => t < splitAt + 0.1, true)
    expect(looses).toHaveLength(1)
    expect(looses[0].over).toBe(1)
  })

  it('overdraw never accumulates below full power', () => {
    const cs = makeCastState()
    const looses = drive(cs, 300, t => t < fullAt - 0.1, true)
    expect(looses).toHaveLength(1)
    expect(looses[0].power).toBeLessThan(1)
    expect(looses[0].over).toBe(0)
  })

  it('a quick tap looses with over 0', () => {
    const cs = makeCastState()
    const looses = drive(cs, 300, t => t < DT, true)
    expect(looses[0].over).toBe(0)
  })

  it('drawSpeedMult shortens the overdraw window like the ramp', () => {
    const cs = makeCastState()
    const holdFor = COMBAT.cast.windup + (COMBAT.cast.chargeTime + COMBAT.cast.overdrawTime) / 2 + 0.05
    drive(cs, Math.ceil(holdFor / DT), () => true, true, () => true, 1, 2)
    expect(cs.over).toBe(1)
  })

  it('!canAct during overdraw cancels outright without a loose', () => {
    const cs = makeCastState()
    let act = true
    drive(cs, Math.ceil((splitAt + 0.1) / DT), () => true, true, () => act)
    expect(cs.over).toBe(1)
    act = false
    const after = drive(cs, 5, () => true, false, () => act)
    expect(after).toHaveLength(0)
    expect(cs.phase).toBe(CP.IDLE)
    expect(cs.over).toBe(0)
  })
})

describe('cast curves', () => {
  it('damage eases in from quick to full', () => {
    expect(castDamage(0, 1)).toBe(COMBAT.bolt.damage)
    expect(castDamage(1, 1)).toBe(COMBAT.cast.fullDamage)
    // ease-in: half draw pays less than the midpoint
    expect(castDamage(0.5, 1)).toBeLessThan((COMBAT.bolt.damage + COMBAT.cast.fullDamage) / 2)
    expect(castDamage(0.5, 2)).toBeCloseTo(castDamage(0.5, 1) * 2, 6)
  })

  it('speed/hitR/gravity/homing/life lerp to full-draw targets', () => {
    expect(castSpeed(0)).toBe(COMBAT.bolt.speed)
    expect(castSpeed(1)).toBe(COMBAT.cast.fullSpeed)
    expect(castHitR(1)).toBe(COMBAT.cast.fullHitR)
    expect(castGravity(1)).toBe(COMBAT.cast.fullGravity)
    expect(castGravity(0)).toBe(COMBAT.bolt.gravity)
    expect(castHomeTurn(1)).toBeCloseTo(COMBAT.cast.fullHomeTurn, 6)
    expect(castLife(1)).toBeCloseTo(COMBAT.cast.fullLife, 6)
  })

  it('pierce tiers: none below half, one at half, max at full', () => {
    expect(castPierce(0, 0)).toBe(0)
    expect(castPierce(0.49, 0)).toBe(0)
    expect(castPierce(0.5, 0)).toBe(1)
    expect(castPierce(1, 0)).toBe(COMBAT.cast.maxPierce)
    expect(castPierce(1, 2)).toBe(COMBAT.cast.maxPierce + 2)
    expect(castPierce(0.6, 1)).toBe(2)
  })

  it('CHARGED_HIT_DMG sits between quick and full damage', () => {
    expect(CHARGED_HIT_DMG).toBeGreaterThan(COMBAT.bolt.damage)
    expect(CHARGED_HIT_DMG).toBeLessThan(COMBAT.cast.fullDamage)
    expect(CHARGED_HIT_DMG).toBeCloseTo(castDamage(0.5, 1), 6)
  })
})
