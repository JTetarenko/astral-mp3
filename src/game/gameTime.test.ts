import { beforeEach, describe, expect, it } from 'vitest'
import { gameTime, HITSTOP, resetGameTime, triggerHitStop, updateGameTime, worldDt } from './gameTime'

describe('gameTime hit-stop', () => {
  beforeEach(() => resetGameTime())

  it('clamps any request to maxStop', () => {
    triggerHitStop(5)
    expect(gameTime.stopLeft).toBe(HITSTOP.maxStop)
  })

  it('overlapping triggers take max, never sum', () => {
    triggerHitStop(0.06)
    triggerHitStop(0.03)
    expect(gameTime.stopLeft).toBe(0.06)
    triggerHitStop(0.08)
    expect(gameTime.stopLeft).toBe(0.08)
  })

  it('freezes to scaleDuring while stopped, ramps back to exactly 1', () => {
    triggerHitStop(0.06)
    updateGameTime(0.016)
    expect(gameTime.worldScale).toBe(HITSTOP.scaleDuring)
    // burn the rest of the stop
    updateGameTime(0.06)
    // now ramping: scale rises monotonically
    let prev = -1
    for (let i = 0; i < 6; i++) {
      updateGameTime(0.008)
      expect(gameTime.worldScale).toBeGreaterThanOrEqual(prev)
      prev = gameTime.worldScale
    }
    updateGameTime(0.1)
    expect(gameTime.worldScale).toBe(1)
  })

  it('worldDt multiplies the clamped dt by worldScale', () => {
    expect(worldDt(0.5)).toBeCloseTo(0.1, 9) // 0.1 clamp preserved
    triggerHitStop(0.05)
    updateGameTime(0.001)
    expect(worldDt(0.016)).toBe(0)
  })

  it('stopCount is monotonic and survives reset', () => {
    const before = gameTime.stopCount
    triggerHitStop(0.03)
    triggerHitStop(0.03)
    expect(gameTime.stopCount).toBe(before + 2)
    resetGameTime()
    expect(gameTime.stopCount).toBe(before + 2)
    expect(gameTime.worldScale).toBe(1)
    expect(gameTime.stopLeft).toBe(0)
  })

  it('zero/negative requests are ignored', () => {
    triggerHitStop(0)
    triggerHitStop(-1)
    expect(gameTime.stopLeft).toBe(0)
  })
})
